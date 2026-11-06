#!/usr/bin/env bash
#
# Acceleratio update runner. Started on the server as the transient
# acceleratio-update.service by the console's update launcher.
#
# Downloads update.sh and install.sh of the target release, checks them
# against the release's SHA256SUMS and runs update.sh, which backs up the
# database, runs install.sh and rolls back on failure. Progress (stage, outcome
# and the tail of the log) is published to a ConfigMap that the API reads, so
# the console can follow the update while the API itself is replaced.
#
# Environment: UPDATE_ID, CONFIG_DIR, TARGET_VERSION, RELEASE_URL,
# UPDATE_SHA256, INSTALL_SHA256, STATUS_NAMESPACE, STATUS_CONFIGMAP.
set -uo pipefail

: "${UPDATE_ID:?}" "${TARGET_VERSION:?}" "${RELEASE_URL:?}"
: "${UPDATE_SHA256:?}" "${INSTALL_SHA256:?}"
: "${STATUS_NAMESPACE:?}" "${STATUS_CONFIGMAP:?}"
CONFIG_DIR="${CONFIG_DIR:-/etc/acceleratio}"

# Bytes of log published to the ConfigMap (the limit of a ConfigMap is 1 MiB).
LOG_TAIL_BYTES=131072
# How long the final status is retried while the cluster restarts.
PUBLISH_DEADLINE_SECONDS=1800

WORK_DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="${WORK_DIR}/update.log"
STATUS="${WORK_DIR}/status"
STAGE_FILE="${WORK_DIR}/stage"
LOG_TAIL="${WORK_DIR}/log.tail"

export KUBECONFIG="${K3S_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
export NO_COLOR=1
export PATH="${PATH:+${PATH}:}/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

phase=running
stage=download
outcome=""
message=""
exit_code=""

log() {
  printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" >>"$LOG"
}

write_status() {
  {
    printf 'phase=%s\n' "$phase"
    printf 'stage=%s\n' "$stage"
    printf 'exit_code=%s\n' "$exit_code"
    printf 'message=%s\n' "$(printf '%s' "$message" | tr '\r\n' '  ')"
    printf 'reported_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >"${STATUS}.tmp" && mv -f "${STATUS}.tmp" "$STATUS"
}

# publish: writes the status and the log tail to the ConfigMap. Server-side
# apply keeps no last-applied annotation, so the log is stored only once.
publish() {
  write_status
  tail -c "$LOG_TAIL_BYTES" "$LOG" >"$LOG_TAIL" 2>/dev/null || : >"$LOG_TAIL"
  k3s kubectl -n "$STATUS_NAMESPACE" create configmap "$STATUS_CONFIGMAP" \
    --from-file=status="$STATUS" --from-file=log="$LOG_TAIL" \
    --dry-run=client -o yaml 2>/dev/null \
    | k3s kubectl apply --server-side --force-conflicts \
      --field-manager=acceleratio-updater -f - >/dev/null 2>&1
}

# finish PHASE MESSAGE: records the outcome and keeps publishing it until the
# cluster accepts it (k3s may be restarting at the end of an update).
finish() {
  phase=$1
  message=$2
  log "Finished: ${phase}. ${message}"
  local deadline=$((SECONDS + PUBLISH_DEADLINE_SECONDS))
  until publish; do
    if ((SECONDS >= deadline)); then
      log "Could not publish the final status to the cluster."
      exit 1
    fi
    sleep 10
  done
  prune_old_runs
  exit 0
}

fail() {
  log "ERROR: $*"
  finish failed "$*"
}

# Keeps the work directories of the last 30 days.
prune_old_runs() {
  find "$(dirname "$WORK_DIR")" -mindepth 1 -maxdepth 1 -type d -mtime +30 \
    -exec rm -rf {} + 2>/dev/null || true
}

download() {
  curl -fsSL --proto '=https' --tlsv1.2 --retry 3 --retry-delay 2 \
    --connect-timeout 15 --max-time 300 \
    "${RELEASE_URL}/$1" -o "${WORK_DIR}/$1"
}

# verify FILE HASH: the file must match the hash from the release's SHA256SUMS.
verify() {
  local actual
  actual="$(sha256sum "${WORK_DIR}/$1" | awk '{print $1}')"
  if [ "$actual" != "$2" ]; then
    fail "${1} does not match the checksum published with ${TARGET_VERSION} (expected ${2}, got ${actual}). Nothing was changed."
  fi
  log "${1}: sha256 ${actual} verified"
}

# read_stage: the stage update.sh reports through ACCELERATIO_UPDATE_STAGE_FILE.
read_stage() {
  local reported=""
  reported="$(head -n 1 "$STAGE_FILE" 2>/dev/null || true)"
  case "$reported" in
    prepare|backup|install|verify|cleanup|rollback)
      stage=$reported
      ;;
    rolled_back|rollback_failed)
      stage=rollback
      outcome=$reported
      ;;
    up_to_date)
      outcome=$reported
      ;;
  esac
}

last_error() {
  grep -E 'ERROR:' "$LOG" 2>/dev/null | tail -n 1 | sed -E 's/^.*ERROR:[[:space:]]*//' || true
}

: >"$LOG"
log "Updating Acceleratio to ${TARGET_VERSION} (update ${UPDATE_ID})"
publish || log "The cluster does not accept the status yet; retrying while the update runs."

for file in update.sh install.sh; do
  log "Downloading ${file} from ${RELEASE_URL}"
  download "$file" || fail "Could not download ${file} of ${TARGET_VERSION}. Check that the server can reach github.com. Nothing was changed."
done

verify update.sh "$UPDATE_SHA256"
verify install.sh "$INSTALL_SHA256"

args=(--yes --sha256 "$INSTALL_SHA256")
if [ -f "${CONFIG_DIR}/install.env" ]; then
  args+=(--config "${CONFIG_DIR}/install.env")
  log "Using the installation settings from ${CONFIG_DIR}/install.env"
fi

stage=prepare
: >"$STAGE_FILE"
publish || true

log "Running update.sh ${args[*]}"
ACCELERATIO_UPDATE_STAGE_FILE="$STAGE_FILE" CONFIG_DIR="$CONFIG_DIR" \
  bash "${WORK_DIR}/update.sh" "${args[@]}" >>"$LOG" 2>&1 </dev/null &
pid=$!

while kill -0 "$pid" 2>/dev/null; do
  read_stage
  publish || true
  sleep 3
done

rc=0
wait "$pid" || rc=$?
read_stage
exit_code=$rc

if ((rc == 0)); then
  stage="done"
  if [ "$outcome" = "up_to_date" ]; then
    finish succeeded "Every component already runs the versions of ${TARGET_VERSION}."
  fi
  finish succeeded "Acceleratio ${TARGET_VERSION} is installed and healthy."
fi

reason="$(last_error)"
case "$outcome" in
  rolled_back)
    finish rolled_back "The update failed and the previous version was restored. The database was not rolled back; the backup location is in the log.${reason:+ Cause: ${reason}}"
    ;;
  rollback_failed)
    finish failed "The update failed and the automatic rollback did not fully succeed. Follow the recovery steps at the end of the log.${reason:+ Cause: ${reason}}"
    ;;
esac

case "$stage" in
  prepare|backup)
    finish failed "The update stopped before changing anything.${reason:+ ${reason}}"
    ;;
esac

finish failed "The update failed (exit code ${rc}).${reason:+ ${reason}} See the log."
