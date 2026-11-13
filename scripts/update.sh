#!/usr/bin/env bash
#
# Acceleratio updater.
#
# Updates an installation made by scripts/install.sh to the versions pinned in
# the target install.sh: k3s, Helm, Cilium, Longhorn, RustFS (and its rc
# client), VictoriaMetrics, VictoriaLogs, the CloudNativePG operator and
# Acceleratio (API and console).
#
# It prints a plan, takes a backup, runs the target install.sh (which is
# idempotent and owns the order of the steps), verifies the result and rolls
# back the Helm releases and the Acceleratio manifests if the update fails.
# The k3s binary and the database are never rolled back automatically.
#
# Usage: sudo ./scripts/update.sh [--ref REF] [--config FILE] [--yes]
#                                [--dry-run] [--no-backup] [--allow-downgrade]
#                                [--allow-version-skip] [--allow-config-changes]
#                                [--sha256 HASH] [--backup-dir DIR]
#                                [--keep-backups N]
#
set -Eeuo pipefail

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]:-$0}")"
readonly SCRIPT_NAME
readonly REPO_RAW_URL="https://raw.githubusercontent.com/acceleratio-cloud/core"

# ---------------------------------------------------------------------------
# Settings that describe where the installation lives. They must match the
# values used by install.sh (same environment or --config FILE).
# ---------------------------------------------------------------------------

K3S_KUBECONFIG="${K3S_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
CONFIG_DIR="${CONFIG_DIR:-/etc/acceleratio}"
LOG_DIR="${LOG_DIR:-/var/log/acceleratio}"
LOCK_FILE="${LOCK_FILE:-/run/acceleratio-update.lock}"

# Runtime state, not configurable.
REF=""
CONFIG_FILE=""
DRY_RUN=0
ASSUME_YES=0
NO_BACKUP=0
ALLOW_DOWNGRADE=0
ALLOW_VERSION_SKIP=0
ALLOW_CONFIG_CHANGES=0
LOG_FILE=""
WORK_DIR=""
TARGET_INSTALL=""
BACKUP_DIR=""
# Where backups go and how many to keep. The default root is outside
# CONFIG_DIR because uninstall.sh and install.sh --reset remove CONFIG_DIR.
BACKUP_ROOT="${BACKUP_ROOT:-}"
BACKUP_KEEP="${BACKUP_KEEP:-}"
INSTALL_SHA256="${INSTALL_SHA256:-}"
CLI_BACKUP_ROOT=""
CLI_BACKUP_KEEP=""
CLI_SHA256=""
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
INSTALL_STARTED=0
INSTALL_PID=""
ROLLED_BACK=0
PLAN_CHANGES=0
NAMESPACE=""

# Plan rows: parallel arrays filled by add_row.
PLAN_NAMES=()
PLAN_CURRENT=()
PLAN_TARGET=()
# Helm releases that are part of the update: "release|namespace".
HELM_RELEASES=()
# Helm revisions before the update: "release|namespace|revision".
HELM_REVISIONS=()

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
  C_BOLD=$'\033[1m'
else
  C_RESET=""
  C_RED=""
  C_GREEN=""
  C_YELLOW=""
  C_BLUE=""
  C_BOLD=""
fi

# ---------------------------------------------------------------------------
# Logging and helpers.
# ---------------------------------------------------------------------------

log_info() {
  printf '%s[%s]%s %s\n' "$C_BLUE" "$(date +%H:%M:%S)" "$C_RESET" "$*"
}

log_ok() {
  printf '%s[%s]%s %s\n' "$C_GREEN" "$(date +%H:%M:%S)" "$C_RESET" "$*"
}

log_warn() {
  printf '%s[%s] WARN:%s %s\n' "$C_YELLOW" "$(date +%H:%M:%S)" "$C_RESET" "$*" >&2
}

log_error() {
  printf '%s[%s] ERROR:%s %s\n' "$C_RED" "$(date +%H:%M:%S)" "$C_RESET" "$*" >&2
}

die() {
  log_error "$*"
  if [ -n "$LOG_FILE" ] && [ "$LOG_FILE" != "/dev/null" ]; then
    log_error "Log: ${LOG_FILE}"
  fi
  exit 1
}

# report_stage NAME: tells a supervising process (the console's update runner)
# where the update stands. It sets ACCELERATIO_UPDATE_STAGE_FILE; without it
# this does nothing. Stages: prepare, backup, install, verify, cleanup,
# rollback, and the outcomes up_to_date, rolled_back and rollback_failed.
report_stage() {
  if [ -n "${ACCELERATIO_UPDATE_STAGE_FILE:-}" ]; then
    printf '%s\n' "$1" >"$ACCELERATIO_UPDATE_STAGE_FILE" 2>/dev/null || true
  fi
}

cleanup() {
  if [ -n "$WORK_DIR" ] && [ -d "$WORK_DIR" ]; then
    rm -rf "$WORK_DIR"
  fi
}

on_error() {
  local exit_code=$?
  local line=${1:-unknown}
  trap - ERR
  log_error "Update failed at line ${line} (exit code ${exit_code})."
  if (( INSTALL_STARTED && ! ROLLED_BACK )); then
    rollback || true
  fi
  if [ -n "$LOG_FILE" ] && [ "$LOG_FILE" != "/dev/null" ]; then
    log_error "Log: ${LOG_FILE}"
  fi
  exit "$exit_code"
}

on_signal() {
  # on_signal NAME: stop the install in progress and roll back.
  local name=$1
  trap '' INT TERM
  log_error "Received ${name}; stopping the update."
  if [ -n "$INSTALL_PID" ] && kill -0 "$INSTALL_PID" 2>/dev/null; then
    kill -TERM -- "-${INSTALL_PID}" 2>/dev/null || kill -TERM "$INSTALL_PID" 2>/dev/null || true
    wait "$INSTALL_PID" 2>/dev/null || true
    INSTALL_PID=""
  fi
  if (( INSTALL_STARTED && ! ROLLED_BACK )); then
    rollback || true
  fi
  exit 130
}

trap 'on_error ${LINENO}' ERR
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap cleanup EXIT

kubectl() {
  k3s kubectl "$@"
}

usage() {
  cat <<'EOF'
Acceleratio updater

Updates an installation made by scripts/install.sh to the versions pinned in
the target install.sh: k3s, Helm, Cilium, Longhorn, RustFS (and its rc
client), VictoriaMetrics, VictoriaLogs, the CloudNativePG operator and
Acceleratio (API and console).

It prints the plan (current -> target version), backs up the database and the
cluster state, runs the target install.sh, verifies the result and, if the
update fails, rolls back the Helm releases and the Acceleratio manifests.
The k3s binary and the database are not rolled back automatically; the script
prints the commands to restore them from the backup.

Usage:
  sudo ./scripts/update.sh [options]

Options:
  --ref REF            Git ref (branch, tag or commit) to take install.sh
                       from. Downloads it instead of using the sibling
                       install.sh. Default: the install.sh next to this
                       script, or main when run through a pipe.
  --config FILE        Load variables from FILE (shell syntax). Pass the same
                       file that was used to install.
  --yes, -y            Do not ask for confirmation.
  --dry-run            Print the plan and exit. Changes nothing.
  --no-backup          Skip the database dump and the etcd snapshot.
  --allow-downgrade    Allow a target version older than the current one.
                       Database migrations only move forward, so a downgrade
                       can leave the API unable to start.
  --allow-version-skip Allow k3s or Cilium to jump more than one minor
                       version. Kubernetes and Cilium only support upgrading
                       one minor version at a time.
  --allow-config-changes
                       Allow the update to change the node ports, the
                       database directory or the dashboard URLs of the
                       running installation. Without it the update stops when
                       the configuration you pass differs from what runs.
  --sha256 HASH        Require install.sh (the downloaded one or the sibling
                       file) to have this SHA-256. Take the hash from a
                       release or a commit you reviewed. Without it, a
                       downloaded install.sh is run unverified; the script
                       prints its hash and warns.
  --backup-dir DIR     Where to keep backups (default /var/backups/acceleratio;
                       BACKUP_ROOT). Use a separate disk or mount: a backup on
                       the same disk as the database does not survive a disk
                       failure.
  --keep-backups N     Keep the newest N backups and delete older ones after a
                       successful update (default 5; BACKUP_KEEP). 0 keeps
                       everything. The newest backup with a database dump is
                       always kept.
  --help, -h           Show this help.

Variables (environment or --config) are the same as for install.sh, for
example ACCELERATIO_VERSION, K3S_VERSION, CONFIG_DIR and LOG_DIR. Pass the
overrides that were used at install time, as with uninstall.sh.

The update keeps running if your SSH session drops (SIGHUP is ignored). Ctrl-C
or SIGTERM stops it and rolls back.

Examples:
  sudo ./scripts/update.sh
  sudo ./scripts/update.sh --dry-run
  sudo ./scripts/update.sh --config /root/install.env --yes
  curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/scripts/update.sh | sudo bash -s -- --yes
EOF
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --ref)
        (($# >= 2)) || die "--ref requires a value"
        REF="$2"
        shift 2
        ;;
      --config)
        (($# >= 2)) || die "--config requires a file path"
        CONFIG_FILE="$2"
        shift 2
        ;;
      --yes|-y)
        ASSUME_YES=1
        shift
        ;;
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --no-backup)
        NO_BACKUP=1
        shift
        ;;
      --allow-downgrade)
        ALLOW_DOWNGRADE=1
        shift
        ;;
      --allow-version-skip)
        ALLOW_VERSION_SKIP=1
        shift
        ;;
      --allow-config-changes)
        ALLOW_CONFIG_CHANGES=1
        shift
        ;;
      --sha256)
        (($# >= 2)) || die "--sha256 requires a value"
        CLI_SHA256="$2"
        shift 2
        ;;
      --backup-dir)
        (($# >= 2)) || die "--backup-dir requires a directory"
        CLI_BACKUP_ROOT="$2"
        shift 2
        ;;
      --keep-backups)
        (($# >= 2)) || die "--keep-backups requires a number"
        CLI_BACKUP_KEEP="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1 (use --help)"
        ;;
    esac
  done
}

load_config() {
  if [ -z "$CONFIG_FILE" ]; then
    return 0
  fi
  [ -r "$CONFIG_FILE" ] || die "Config file is not readable: $CONFIG_FILE"
  # Keep the explicit --config path usable after sourcing changes the cwd.
  CONFIG_FILE="$(cd "$(dirname "$CONFIG_FILE")" && pwd)/$(basename "$CONFIG_FILE")"
  # shellcheck source=/dev/null
  . "$CONFIG_FILE"
}

resolve_settings() {
  # Command-line options win over the config file and the environment.
  BACKUP_ROOT="${CLI_BACKUP_ROOT:-${BACKUP_ROOT:-/var/backups/acceleratio}}"
  BACKUP_KEEP="${CLI_BACKUP_KEEP:-${BACKUP_KEEP:-5}}"
  INSTALL_SHA256="${CLI_SHA256:-$INSTALL_SHA256}"
  case "$BACKUP_ROOT" in
    /*) ;;
    *) die "--backup-dir must be an absolute path: ${BACKUP_ROOT}" ;;
  esac
  [[ $BACKUP_KEEP =~ ^[0-9]+$ ]] || die "--keep-backups must be a number: ${BACKUP_KEEP}"
  if [ -n "$INSTALL_SHA256" ]; then
    INSTALL_SHA256="$(printf '%s' "$INSTALL_SHA256" | tr 'A-F' 'a-f')"
    [[ $INSTALL_SHA256 =~ ^[0-9a-f]{64}$ ]] || die "--sha256 must be 64 hexadecimal characters."
  fi
}

check_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "Run as root: sudo ${SCRIPT_NAME}"
  fi
}

setup_logging() {
  if (( DRY_RUN )); then
    LOG_FILE="/dev/null"
    return 0
  fi
  mkdir -p "$LOG_DIR"
  LOG_FILE="${LOG_DIR}/update-${TIMESTAMP}.log"
  ln -sfn "$LOG_FILE" "${LOG_DIR}/update.log"
  # A closed terminal (dropped SSH session) must not stop the update. With
  # HUP and PIPE ignored, tee reports the failed terminal write (silenced
  # here) and keeps streaming to the log file, byte for byte as before.
  exec > >(
    trap '' HUP PIPE
    exec tee -a "$LOG_FILE" 2>/dev/null
  ) 2>&1
  log_info "Log file: ${LOG_FILE}"
}

acquire_lock() {
  if (( DRY_RUN )); then
    return 0
  fi
  exec 9>"$LOCK_FILE"
  flock -n 9 || die "Another update is already running."
}

# ---------------------------------------------------------------------------
# Target install.sh and its default versions.
# ---------------------------------------------------------------------------

fetch_target_install() {
  local self="${BASH_SOURCE[0]:-}"
  local self_dir=""

  if [ -n "$self" ] && [ -f "$self" ]; then
    self_dir="$(cd "$(dirname "$self")" && pwd)"
  fi

  if [ -z "$REF" ] && [ -n "$self_dir" ] && [ -f "${self_dir}/install.sh" ]; then
    TARGET_INSTALL="${self_dir}/install.sh"
    log_info "Using ${TARGET_INSTALL}"
  else
    REF="${REF:-main}"
    WORK_DIR="$(mktemp -d)"
    TARGET_INSTALL="${WORK_DIR}/install.sh"
    log_info "Downloading install.sh (${REF})"
    curl -fsSL --proto '=https' --tlsv1.2 --retry 3 \
      "${REPO_RAW_URL}/${REF}/scripts/install.sh" -o "$TARGET_INSTALL" \
      || die "Could not download install.sh for ref ${REF}."
  fi

  # Verify before anything reads or runs the file.
  verify_target_checksum
  bash -n "$TARGET_INSTALL" || die "The target install.sh has a syntax error."
  grep -q '^# Acceleratio installer\.' "$TARGET_INSTALL" \
    || die "The target file is not the Acceleratio installer."
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    die "sha256sum is required to verify install.sh."
  fi
}

verify_target_checksum() {
  local actual
  actual="$(sha256_of "$TARGET_INSTALL")"

  if [ -n "$INSTALL_SHA256" ]; then
    if [ "$actual" != "$INSTALL_SHA256" ]; then
      die "install.sh does not match the expected checksum. Expected ${INSTALL_SHA256}, got ${actual}. Nothing was run."
    fi
    log_ok "install.sh checksum verified (sha256 ${actual})"
  elif [ -n "$WORK_DIR" ]; then
    if [[ $REF =~ ^[0-9a-f]{40}$ ]]; then
      log_info "install.sh pinned to commit ${REF} (sha256 ${actual})"
    else
      log_warn "install.sh was downloaded from the moving ref '${REF}' and is NOT verified (sha256 ${actual}). Pass --sha256 with a hash you trust, or use a commit hash as --ref."
    fi
  fi
}

# default_of KEY: the default value install.sh gives KEY, taken from its
# KEY="${KEY:-value}" or KEY="${KEY-value}" line.
default_of() {
  sed -n "s/^${1}=\"\${${1}:\{0,1\}-\(.*\)}\"\$/\1/p" "$TARGET_INSTALL" | head -n 1
}

# target_of KEY: the value KEY will have during the update. The environment or
# --config wins, otherwise the default of the target install.sh.
target_of() {
  if [ -n "${!1+x}" ]; then
    printf '%s' "${!1}"
  else
    default_of "$1"
  fi
}

# ---------------------------------------------------------------------------
# Current state.
# ---------------------------------------------------------------------------

current_k3s_version() {
  k3s --version 2>/dev/null | awk 'NR == 1 {print $3}' || true
}

current_helm_version() {
  helm version --short 2>/dev/null | sed 's/^v//; s/+.*//' || true
}

# helm_release_field RELEASE NAMESPACE FIELD: a field of `helm list -o json`.
helm_release_field() {
  helm list -n "$2" --filter "^${1}\$" -o json 2>/dev/null \
    | sed -n "s/.*\"${3}\":\"\\([^\"]*\\)\".*/\\1/p" | head -n 1 || true
}

# helm_chart_version RELEASE NAMESPACE: the chart version of a release.
helm_chart_version() {
  helm_release_field "$1" "$2" chart | sed 's/.*-\([0-9][^-]*\)$/\1/'
}

current_image() {
  # current_image KIND NAME NAMESPACE
  kubectl -n "$3" get "$1" "$2" \
    -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true
}

# version_lt A B: true when A is a lower version than B.
version_lt() {
  [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" = "$1" ]
}

add_row() {
  # add_row NAME CURRENT TARGET
  [ -n "${3:-}" ] || die "Could not determine the target version of $1 from ${TARGET_INSTALL}."
  PLAN_NAMES+=("$1")
  PLAN_CURRENT+=("${2:-?}")
  PLAN_TARGET+=("$3")
}

image_tag() {
  printf '%s' "${1##*:}"
}

image_repo() {
  printf '%s' "${1%:*}"
}

is_downgrade() {
  # is_downgrade CURRENT TARGET: both must be plain versions or images with the
  # same repository; anything else cannot be ordered and is not a downgrade.
  local cur=$1 tgt=$2 cur_repo="" tgt_repo=""
  case "$cur" in *:*) cur_repo="$(image_repo "$cur")"; cur="$(image_tag "$cur")";; *) cur_repo="";; esac
  case "$tgt" in *:*) tgt_repo="$(image_repo "$tgt")"; tgt="$(image_tag "$tgt")";; *) tgt_repo="";; esac
  [ "$cur_repo" = "$tgt_repo" ] || return 1
  [[ $cur =~ ^v?[0-9] ]] && [[ $tgt =~ ^v?[0-9] ]] || return 1
  version_lt "$tgt" "$cur"
}

postgres_major() {
  local tag
  tag="$(image_tag "$1")"
  printf '%s' "${tag%%[!0-9]*}"
}

collect_plan() {
  local ns lh_ns lh_rel rustfs_ns vm_ns vm_rel vl_ns vl_rel cnpg_ns cnpg_rel
  local target api_image console_image pg_image cur
  local version

  ns="$(target_of ACCELERATIO_NAMESPACE)"
  lh_ns="$(target_of LONGHORN_NAMESPACE)"
  lh_rel="$(target_of LONGHORN_RELEASE)"
  rustfs_ns="$(target_of RUSTFS_NAMESPACE)"
  vm_ns="$(target_of VICTORIAMETRICS_NAMESPACE)"
  vm_rel="$(target_of VICTORIAMETRICS_RELEASE)"
  vl_ns="$(target_of VICTORIALOGS_NAMESPACE)"
  vl_rel="$(target_of VICTORIALOGS_RELEASE)"
  cnpg_ns="$(target_of CNPG_NAMESPACE)"
  cnpg_rel="$(target_of CNPG_RELEASE)"

  # Where the pieces live, for the steps that follow.
  NAMESPACE="$ns"
  HELM_RELEASES=(
    "cilium|kube-system"
    "${lh_rel}|${lh_ns}"
    "${vm_rel}|${vm_ns}"
    "${vl_rel}|${vl_ns}"
    "${cnpg_rel}|${cnpg_ns}"
  )

  target="$(target_of K3S_VERSION)"
  if [ -n "$target" ]; then
    add_row "k3s" "$(current_k3s_version)" "$target"
  else
    log_warn "K3S_VERSION is empty (latest of the channel); k3s is left out of the plan."
  fi
  add_row "Helm" "$(current_helm_version)" "$(target_of HELM_VERSION)"
  add_row "Cilium" "$(helm_chart_version cilium kube-system)" "$(target_of CILIUM_VERSION)"
  if [ "$(target_of STORAGE_BACKEND)" = "longhorn" ]; then
    add_row "Longhorn" "$(helm_chart_version "$lh_rel" "$lh_ns")" "$(target_of LONGHORN_CHART_VERSION)"
  fi
  # RustFS is replaced in place (Recreate); its data stays on the volume.
  # Images are shown without their digest.
  cur="$(current_image deployment rustfs "$rustfs_ns")"
  target="$(target_of RUSTFS_IMAGE)"
  add_row "RustFS" "${cur%%@*}" "${target%%@*}"
  cur="$(kubectl -n "$ns" get deployment api \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="RUSTFS_RC_IMAGE")].value}' 2>/dev/null || true)"
  target="$(target_of RC_IMAGE)"
  add_row "RustFS rc client" "${cur%%@*}" "${target%%@*}"
  add_row "VictoriaMetrics" "$(helm_chart_version "$vm_rel" "$vm_ns")" "$(target_of VICTORIAMETRICS_CHART_VERSION)"
  add_row "VictoriaLogs" "$(helm_chart_version "$vl_rel" "$vl_ns")" "$(target_of VICTORIALOGS_CHART_VERSION)"
  add_row "CloudNativePG" "$(helm_chart_version "$cnpg_rel" "$cnpg_ns")" "$(target_of CNPG_CHART_VERSION)"

  version="$(target_of ACCELERATIO_VERSION)"
  api_image="${ACCELERATIO_API_IMAGE:-ghcr.io/acceleratio-cloud/api:${version}}"
  console_image="${ACCELERATIO_CONSOLE_IMAGE:-ghcr.io/acceleratio-cloud/console:${version}}"
  pg_image="$(target_of POSTGRES_IMAGE)"

  add_row "Acceleratio API" "$(current_image deployment api "$ns")" "$api_image"
  add_row "Acceleratio console" "$(current_image deployment console "$ns")" "$console_image"

  cur="$(current_image statefulset postgres "$ns")"
  if [ -n "$cur" ] && [ "$cur" != "$pg_image" ]; then
    if [ "$(postgres_major "$cur")" != "$(postgres_major "$pg_image")" ]; then
      die "POSTGRES_IMAGE would change PostgreSQL ${cur} -> ${pg_image}. A major upgrade needs a dump and restore and is not supported by update.sh."
    fi
  fi
  add_row "PostgreSQL" "$cur" "$pg_image"
}

print_plan() {
  local i changes=0 marker
  printf '\n%s%-22s %-42s %s%s\n' "$C_BOLD" "Component" "Current" "Target" "$C_RESET"
  for i in "${!PLAN_NAMES[@]}"; do
    if [ "${PLAN_CURRENT[$i]}" = "${PLAN_TARGET[$i]}" ]; then
      marker="  "
    else
      marker="->"
      changes=$((changes + 1))
    fi
    printf '%-22s %-42s %s %s\n' "${PLAN_NAMES[$i]}" "${PLAN_CURRENT[$i]}" "$marker" "${PLAN_TARGET[$i]}"
  done
  printf '\n'
  PLAN_CHANGES=$changes
}

check_downgrades() {
  local i found=0
  for i in "${!PLAN_NAMES[@]}"; do
    if is_downgrade "${PLAN_CURRENT[$i]}" "${PLAN_TARGET[$i]}"; then
      log_error "${PLAN_NAMES[$i]}: ${PLAN_CURRENT[$i]} -> ${PLAN_TARGET[$i]} is a downgrade."
      found=1
    fi
  done
  if (( found )); then
    if (( ALLOW_DOWNGRADE )); then
      log_warn "Continuing because --allow-downgrade was given."
    else
      die "Refusing to downgrade: database migrations only move forward. Use --allow-downgrade to override."
    fi
  fi
}

minor_of() {
  # minor_of VERSION: "major.minor" of v1.36.5+k3s1 or 1.20.4, empty if not numeric.
  local v=${1#v} major minor
  [[ $v =~ ^[0-9]+\.[0-9]+ ]] || return 0
  IFS=. read -r major minor _ <<<"$v"
  printf '%s.%s' "$major" "$minor"
}

check_version_skips() {
  # k3s (Kubernetes), Cilium and Longhorn support upgrades one minor version
  # at a time.
  local i name cur tgt cur_mm tgt_mm found=0
  for i in "${!PLAN_NAMES[@]}"; do
    name="${PLAN_NAMES[$i]}"
    case "$name" in k3s|Cilium|Longhorn) ;; *) continue ;; esac
    cur_mm="$(minor_of "${PLAN_CURRENT[$i]}")"
    tgt_mm="$(minor_of "${PLAN_TARGET[$i]}")"
    [ -n "$cur_mm" ] && [ -n "$tgt_mm" ] || continue
    if [ "${cur_mm%%.*}" != "${tgt_mm%%.*}" ] \
       || (( ${tgt_mm##*.} - ${cur_mm##*.} > 1 )); then
      log_error "${name}: ${PLAN_CURRENT[$i]} -> ${PLAN_TARGET[$i]} skips a minor version. Upgrade one minor version at a time (set the next minor in the config and run update.sh again)."
      found=1
    fi
  done
  if (( found )); then
    if (( ALLOW_VERSION_SKIP )); then
      log_warn "Continuing because --allow-version-skip was given."
    else
      die "Refusing to skip minor versions. Use --allow-version-skip to override."
    fi
  fi
}

warn_migrations() {
  local i changed=0
  for i in "${!PLAN_NAMES[@]}"; do
    case "${PLAN_NAMES[$i]}" in
      "Acceleratio API"|"Acceleratio console")
        [ "${PLAN_CURRENT[$i]}" != "${PLAN_TARGET[$i]}" ] && changed=1
        ;;
    esac
  done
  (( changed )) || return 0
  log_warn "The API migrates the database every time it starts. Migrations only move forward: a rollback restores the old images, not the old schema."
  if (( NO_BACKUP )); then
    log_warn "--no-backup is set: database changes cannot be restored if the new version misbehaves."
  fi
}

# check_config_drift: the configuration you pass must match the installation
# that is running. install.sh would otherwise silently reset what differs.
check_config_drift() {
  local ns="$NAMESPACE" found=() cur tgt host port explicit

  port="$(target_of ACCELERATIO_API_NODE_PORT)"
  cur="$(kubectl -n "$ns" get service api -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || true)"
  if [ -n "$cur" ] && [ "$cur" != "$port" ]; then
    found+=("API node port: running ${cur}, target ${port}")
  fi
  tgt="$(target_of ACCELERATIO_CONSOLE_NODE_PORT)"
  cur="$(kubectl -n "$ns" get service console -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || true)"
  if [ -n "$cur" ] && [ "$cur" != "$tgt" ]; then
    found+=("Console node port: running ${cur}, target ${tgt}")
  fi
  local console_port=$tgt

  tgt="$(target_of POSTGRES_DATA_DIR)"
  tgt="${tgt//\$\{ACCELERATIO_DATA_DIR\}/$(target_of ACCELERATIO_DATA_DIR)}"
  cur="$(kubectl -n "$ns" get statefulset postgres \
    -o jsonpath='{.spec.template.spec.volumes[*].hostPath.path}' 2>/dev/null || true)"
  if [ -n "$cur" ] && [ "$cur" != "$tgt" ]; then
    found+=("Database directory: running ${cur}, target ${tgt}")
  fi

  host="${ACCELERATIO_PUBLIC_HOST-}"

  # API URL (BETTER_AUTH_URL of the API) and console URL (first CORS origin).
  cur="$(kubectl -n "$ns" get deployment api \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="BETTER_AUTH_URL")].value}' 2>/dev/null || true)"
  explicit="${ACCELERATIO_API_URL-}"
  drift_url "API URL" "ACCELERATIO_API_URL" "$cur" "$explicit" "$host" "$port"

  cur="$(kubectl -n "$ns" get deployment api \
    -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="CORS_ORIGINS")].value}' 2>/dev/null || true)"
  cur="${cur%%,*}"
  explicit="${ACCELERATIO_CONSOLE_URL-}"
  drift_url "Console URL" "ACCELERATIO_CONSOLE_URL" "$cur" "$explicit" "$host" "$console_port"

  [ ${#found[@]} -gt 0 ] || return 0
  local item
  for item in "${found[@]}"; do
    log_error "Configuration differs from the running installation: ${item}"
  done
  if (( ALLOW_CONFIG_CHANGES )); then
    log_warn "Continuing because --allow-config-changes was given."
  else
    die "Pass the same --config or environment as at install time, or use --allow-config-changes to apply the difference."
  fi
}

# drift_url LABEL VAR LIVE EXPLICIT HOST PORT: appends to the caller's found
# array when the live URL is not what the target configuration would produce.
drift_url() {
  local label=$1 var=$2 live=$3 explicit=$4 host=$5 port=$6
  [ -n "$live" ] || return 0
  if [ -n "$explicit" ]; then
    if [ "${live%/}" != "${explicit%/}" ]; then
      found+=("${label}: running ${live}, target ${explicit%/}")
    fi
  elif [ -n "$host" ]; then
    if [ "$live" != "http://${host}:${port}" ]; then
      found+=("${label}: running ${live}, target http://${host}:${port}")
    fi
  elif [[ ! $live =~ ^http://[^/:]+:${port}$ ]]; then
    found+=("${label}: running ${live}, but ${var} is not set (the default is http://<server ip>:${port})")
  fi
}

confirm() {
  local answer=""
  if (( ASSUME_YES )); then
    return 0
  fi
  if [ -t 0 ]; then
    read -r -p "Apply this update? [y/N] " answer
  elif [ -r /dev/tty ]; then
    read -r -p "Apply this update? [y/N] " answer </dev/tty
  else
    die "No terminal to ask for confirmation. Re-run with --yes."
  fi
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) die "Cancelled." ;;
  esac
}

preflight() {
  command -v k3s >/dev/null 2>&1 || die "k3s is not installed. Use install.sh for a fresh install."
  [ -f "$K3S_KUBECONFIG" ] || die "k3s kubeconfig not found at ${K3S_KUBECONFIG}."
  command -v helm >/dev/null 2>&1 || die "helm is not installed. Use install.sh to repair the installation."
  command -v curl >/dev/null 2>&1 || die "curl is required."
  export KUBECONFIG="$K3S_KUBECONFIG"
  kubectl --request-timeout=15s get nodes >/dev/null 2>&1 \
    || die "The cluster does not answer. Check: systemctl status k3s"
  kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 \
    || die "Namespace ${NAMESPACE} not found. Is Acceleratio installed? Pass the same CONFIG as at install time."
  # install.sh --dev runs no API and console, which this update checks and rolls back.
  kubectl -n "$NAMESPACE" get deployment api >/dev/null 2>&1 \
    || die "This is a development server (install.sh --dev, no API in ${NAMESPACE}). Update it with: sudo ./scripts/install.sh --dev"
}

# not_ready_nodes: names of the nodes whose Ready condition is not True, one
# per line. A node with no Ready condition at all counts as not ready.
not_ready_nodes() {
  kubectl --request-timeout=15s get nodes -o jsonpath='{range .items[*]}{.metadata.name}{" "}{range .status.conditions[?(@.type=="Ready")]}{.status}{end}{"\n"}{end}' |
    awk '$2 != "True" { print $1 }'
}

# check_nodes_ready: the install rolls DaemonSets (Cilium, the Longhorn
# manager and CSI plugin) out to every node and waits for each one. A node that is down never
# reports its pod, so the wait times out after many minutes and the update
# rolls back. Stop here instead, before the backup, and say which node it is.
check_nodes_ready() {
  local nodes
  nodes="$(not_ready_nodes)" || die "Could not list the cluster nodes. Check: systemctl status k3s"
  [ -z "$nodes" ] && return 0

  nodes="$(printf '%s' "$nodes" | paste -sd ',' - | sed 's/,/, /g')"
  die "Node(s) not ready: ${nodes}. The update rolls Cilium and the storage driver out to every node and cannot finish while one is down. Bring the node back, or remove it (Servers in the console, or: k3s kubectl delete node NAME), then run the update again. Nothing was changed."
}

# ---------------------------------------------------------------------------
# Backup and rollback state.
# ---------------------------------------------------------------------------

record_helm_revisions() {
  local entry release namespace revision
  HELM_REVISIONS=()
  for entry in "${HELM_RELEASES[@]}"; do
    release="${entry%%|*}"
    namespace="${entry##*|}"
    revision="$(helm_release_field "$release" "$namespace" revision)"
    if [ -n "$revision" ]; then
      HELM_REVISIONS+=("${release}|${namespace}|${revision}")
    fi
  done
}

# device_of PATH: the filesystem PATH is on, empty if it does not exist here.
device_of() {
  [ -e "$1" ] || return 0
  df -P "$1" 2>/dev/null | awk 'NR == 2 {print $1}' || true
}

check_backup_space() {
  # Needs room for the dump (at most the database size) plus a margin, and
  # warns when the backup shares a disk with the database.
  local size free_kb need_kb pg_dir backup_dev data_dev

  if (( NO_BACKUP )); then
    return 0
  fi

  size="$(kubectl -n "$NAMESPACE" exec postgres-0 -c postgres -- \
    psql -U acceleratio -d acceleratio -Atc 'select pg_database_size(current_database())' 2>/dev/null || true)"
  free_kb="$(df -Pk "$BACKUP_ROOT" 2>/dev/null | awk 'NR == 2 {print $4}' || true)"
  if [[ $size =~ ^[0-9]+$ ]] && [[ $free_kb =~ ^[0-9]+$ ]]; then
    need_kb=$(( size / 1024 + 262144 ))
    if (( free_kb < need_kb )); then
      die "Not enough space for the backup in ${BACKUP_ROOT}: ${free_kb} KiB free, about ${need_kb} KiB needed. Use --backup-dir on a bigger disk, delete old backups, or re-run with --no-backup."
    fi
  else
    log_warn "Could not check the free space for the backup in ${BACKUP_ROOT}."
  fi

  pg_dir="$(kubectl -n "$NAMESPACE" get statefulset postgres \
    -o jsonpath='{.spec.template.spec.volumes[*].hostPath.path}' 2>/dev/null || true)"
  backup_dev="$(device_of "$BACKUP_ROOT")"
  data_dev="$(device_of "$pg_dir")"
  if [ -n "$backup_dev" ] && [ "$backup_dev" = "$data_dev" ]; then
    log_warn "The backup is on the same disk as the database (${backup_dev}); it will not survive a disk failure. Copy it elsewhere or use --backup-dir on another disk."
  fi
}

prune_backups() {
  # Keep the newest BACKUP_KEEP backups, plus the newest one that has a
  # database dump even if it is older. Only timestamped directories under
  # BACKUP_ROOT are ever removed.
  local name count=0 dump_kept=0 has_dump keep

  if (( BACKUP_KEEP == 0 )) || [ ! -d "$BACKUP_ROOT" ]; then
    return 0
  fi

  # The grep keeps only strict timestamp names, so ls output is safe to parse.
  # shellcheck disable=SC2010
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    count=$((count + 1))
    has_dump=0
    [ -f "${BACKUP_ROOT}/${name}/acceleratio.pgdump" ] && has_dump=1
    keep=0
    if (( count <= BACKUP_KEEP )); then
      keep=1
    elif (( has_dump && ! dump_kept )); then
      keep=1
    fi
    (( has_dump && keep )) && dump_kept=1
    if (( ! keep )); then
      log_info "Removing old backup ${BACKUP_ROOT}/${name}"
      rm -rf "${BACKUP_ROOT:?}/${name}"
    fi
  done < <(ls -1 "$BACKUP_ROOT" 2>/dev/null | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r)
}

take_snapshot() {
  # Always kept: manifests and helm state are small and make the rollback
  # possible. The database dump and the etcd snapshot are skipped by
  # --no-backup.
  local entry release namespace revision
  BACKUP_DIR="${BACKUP_ROOT}/${TIMESTAMP}"
  install -d -m 0700 "$BACKUP_ROOT"
  chmod 0700 "$BACKUP_ROOT"
  check_backup_space
  install -d -m 0700 "$BACKUP_DIR" "${BACKUP_DIR}/manifests"
  log_info "Saving the current configuration to ${BACKUP_DIR}"

  if [ -d "${CONFIG_DIR}/manifests" ]; then
    cp -a "${CONFIG_DIR}/manifests/." "${BACKUP_DIR}/manifests/"
  fi
  if [ -f "${CONFIG_DIR}/acceleratio.env" ]; then
    install -m 0600 "${CONFIG_DIR}/acceleratio.env" "${BACKUP_DIR}/acceleratio.env"
  fi

  record_helm_revisions
  : >"${BACKUP_DIR}/helm-revisions.txt"
  for entry in ${HELM_REVISIONS[@]+"${HELM_REVISIONS[@]}"}; do
    IFS='|' read -r release namespace revision <<<"$entry"
    printf '%s %s %s\n' "$release" "$namespace" "$revision" >>"${BACKUP_DIR}/helm-revisions.txt"
    helm get values "$release" -n "$namespace" >"${BACKUP_DIR}/helm-values-${release}.yaml" 2>/dev/null || true
  done
  find "$BACKUP_DIR" -type d -exec chmod 0700 {} +
  find "$BACKUP_DIR" -type f -exec chmod 0600 {} +
}

backup_data() {
  local ns="$NAMESPACE"
  local dump="${BACKUP_DIR}/acceleratio.pgdump"

  if (( NO_BACKUP )); then
    log_warn "Skipping the database dump and the etcd snapshot (--no-backup)."
    return 0
  fi

  log_info "Dumping the database"
  if ! (umask 077; kubectl -n "$ns" exec postgres-0 -c postgres -- \
        pg_dump -U acceleratio -Fc acceleratio >"$dump"); then
    rm -f "$dump"
    die "The database dump failed. Fix PostgreSQL or re-run with --no-backup."
  fi
  [ -s "$dump" ] || die "The database dump is empty."
  log_ok "Database dump: ${dump} ($(du -h "$dump" | cut -f1))"

  log_info "Saving an etcd snapshot"
  k3s etcd-snapshot save --name "acceleratio-update-${TIMESTAMP}" >/dev/null \
    || die "The etcd snapshot failed. Fix k3s or re-run with --no-backup."
  log_ok "etcd snapshot acceleratio-update-${TIMESTAMP} saved"
}

rollback() {
  local ns="$NAMESPACE"
  local entry release namespace revision current
  local failed=0

  ROLLED_BACK=1
  report_stage rollback
  # The releases go back to older revisions, so install.sh must not trust
  # what it recorded as deployed.
  rm -rf "${CONFIG_DIR}/helm-state"
  log_warn "Rolling back the Helm releases and the Acceleratio manifests"

  for entry in ${HELM_REVISIONS[@]+"${HELM_REVISIONS[@]}"}; do
    IFS='|' read -r release namespace revision <<<"$entry"
    current="$(helm_release_field "$release" "$namespace" revision)"
    if [ -n "$current" ] && [ "$current" != "$revision" ]; then
      log_info "helm rollback ${release} -> revision ${revision}"
      if ! helm rollback "$release" "$revision" -n "$namespace" --wait --timeout 10m; then
        log_error "Could not roll back ${release}."
        failed=1
      fi
    fi
  done

  if [ ! -f "${BACKUP_DIR}/manifests/acceleratio.yaml" ]; then
    log_error "No saved Acceleratio manifest in ${BACKUP_DIR}; the application was not rolled back."
    failed=1
  else
    log_info "Re-applying the previous Acceleratio manifest"
    if kubectl apply -f "${BACKUP_DIR}/manifests/acceleratio.yaml" \
       && kubectl -n "$ns" rollout status deployment/api --timeout=300s \
       && kubectl -n "$ns" rollout status deployment/console --timeout=300s; then
      log_ok "Acceleratio is back on the previous manifest"
      # The previous manifest may use another node port than the target
      # configuration (--allow-config-changes), so ask the restored Service.
      local api_port
      api_port="$(kubectl -n "$ns" get service api -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || true)"
      api_port="${api_port:-$(target_of ACCELERATIO_API_NODE_PORT)}"
      if ! wait_for_http "http://127.0.0.1:${api_port}/healthz" "The previous API"; then
        log_error "The previous API does not answer. The new version may already have migrated the database, which the old API cannot use. Restore the database from the backup (commands below)."
        failed=1
      fi
    else
      log_error "Acceleratio did not become ready after the rollback."
      failed=1
    fi
  fi
  if [ -f "${BACKUP_DIR}/manifests/traefik-config.yaml" ]; then
    kubectl apply -f "${BACKUP_DIR}/manifests/traefik-config.yaml" >/dev/null 2>&1 || true
  fi
  if [ -f "${BACKUP_DIR}/manifests/rustfs.yaml" ]; then
    kubectl apply -f "${BACKUP_DIR}/manifests/rustfs.yaml" >/dev/null 2>&1 || true
  fi

  print_recovery_help
  if (( failed )); then
    report_stage rollback_failed
    log_error "The rollback did not fully succeed. Inspect: k3s kubectl -n ${ns} get pods"
  else
    report_stage rolled_back
  fi
}

print_recovery_help() {
  printf '\n%sThe k3s binary and the database were not rolled back automatically.%s\n' "$C_BOLD" "$C_RESET"
  printf 'Backup:           %s\n' "$BACKUP_DIR"
  if (( ! NO_BACKUP )) && [ -f "${BACKUP_DIR}/acceleratio.pgdump" ]; then
    printf 'Restore database: k3s kubectl -n %s exec -i postgres-0 -c postgres -- pg_restore -U acceleratio -d acceleratio --clean --if-exists < %s/acceleratio.pgdump\n' \
      "$NAMESPACE" "$BACKUP_DIR"
    printf 'Restore etcd:     systemctl stop k3s && k3s server --cluster-reset --cluster-reset-restore-path=/var/lib/rancher/k3s/server/db/snapshots/acceleratio-update-%s*\n' \
      "$TIMESTAMP"
  fi
  printf '\n'
}

# ---------------------------------------------------------------------------
# Update.
# ---------------------------------------------------------------------------

run_install() {
  local args=()
  if [ -n "$CONFIG_FILE" ]; then
    args+=(--config "$CONFIG_FILE")
  fi
  local rc=0
  INSTALL_STARTED=1
  log_info "Running the target install.sh"
  # Own process group, so a signal can stop install.sh and everything it started.
  set -m
  # Unchanged Helm releases and an untouched storage need no work.
  ACCELERATIO_SKIP_UNCHANGED=1 bash "$TARGET_INSTALL" ${args[@]+"${args[@]}"} &
  INSTALL_PID=$!
  set +m
  wait "$INSTALL_PID" || rc=$?
  INSTALL_PID=""
  return "$rc"
}

wait_for_http() {
  # wait_for_http URL LABEL: Services can briefly reset connections while the
  # old pod terminates, so retry every kind of failure for up to two minutes.
  local deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    if curl -fsS --max-time 5 -o /dev/null "$1" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  log_error "$2 did not answer at $1."
  return 1
}

verify_update() {
  local ns="$NAMESPACE"
  local api_port console_port
  api_port="$(target_of ACCELERATIO_API_NODE_PORT)"
  console_port="$(target_of ACCELERATIO_CONSOLE_NODE_PORT)"

  log_info "Verifying the update"
  kubectl -n "$ns" rollout status statefulset/postgres --timeout=300s
  kubectl -n "$ns" rollout status deployment/api --timeout=600s
  kubectl -n "$ns" rollout status deployment/console --timeout=600s
  wait_for_http "http://127.0.0.1:${api_port}/healthz" "The API"
  wait_for_http "http://127.0.0.1:${console_port}/healthz" "The console"
  log_ok "PostgreSQL, the API and the console are healthy"
}

main() {
  # A dropped SSH session must not stop an update halfway; children inherit this.
  trap '' HUP
  parse_args "$@"
  load_config
  resolve_settings
  check_root
  setup_logging
  acquire_lock
  log_info "Acceleratio updater ${SCRIPT_NAME} starting"

  report_stage prepare
  fetch_target_install
  NAMESPACE="$(target_of ACCELERATIO_NAMESPACE)"
  preflight
  check_nodes_ready
  collect_plan
  print_plan

  if (( PLAN_CHANGES == 0 )); then
    report_stage up_to_date
    log_ok "Everything is already at the target versions. Nothing to do."
    exit 0
  fi

  check_downgrades
  check_version_skips
  check_config_drift
  warn_migrations

  if (( DRY_RUN )); then
    log_info "DRY-RUN: no changes were made."
    exit 0
  fi

  confirm
  report_stage backup
  take_snapshot
  backup_data

  report_stage install
  run_install
  report_stage verify
  verify_update

  report_stage cleanup
  prune_backups
  log_ok "Update complete. Backup kept in ${BACKUP_DIR}"
}

main "$@"
