#!/bin/sh
#
# Acceleratio update launcher. Runs in a privileged, host-PID Job on the server
# that holds the installation and hands the update to the host's systemd, so
# the update outlives this Pod, the API, the console and a k3s restart.
#
# Environment (set by the API): UPDATE_ID, UPDATE_ROOT, CONFIG_DIR,
# TARGET_VERSION, RELEASE_URL, UPDATE_SHA256, INSTALL_SHA256,
# STATUS_NAMESPACE, STATUS_CONFIGMAP, RUNNER_SCRIPT.
set -eu

host() {
  nsenter -t 1 -m -u -i -n -p -- "$@"
}

dir="${UPDATE_ROOT}/${UPDATE_ID}"

if ! host test -f "${CONFIG_DIR}/manifests/acceleratio.yaml"; then
  echo "ERROR: $(host hostname) has no installation in ${CONFIG_DIR}. Update from the server the platform was installed on with scripts/update.sh." >&2
  exit 2
fi

if ! host sh -c 'command -v systemd-run >/dev/null 2>&1'; then
  echo "ERROR: systemd-run is not available on $(host hostname). Update over SSH with scripts/update.sh." >&2
  exit 2
fi

if host systemctl is-active --quiet acceleratio-update.service; then
  echo "ERROR: Another update is already running on $(host hostname) (acceleratio-update.service)." >&2
  exit 3
fi

host mkdir -p "$dir"
host chmod 700 "$dir"
printf '%s' "$RUNNER_SCRIPT" | host sh -c 'cat > "$1" && chmod 700 "$1"' sh "${dir}/run.sh"

host systemd-run \
  --unit=acceleratio-update \
  --description="Acceleratio update to ${TARGET_VERSION}" \
  --collect \
  --setenv=UPDATE_ID="$UPDATE_ID" \
  --setenv=CONFIG_DIR="$CONFIG_DIR" \
  --setenv=TARGET_VERSION="$TARGET_VERSION" \
  --setenv=RELEASE_URL="$RELEASE_URL" \
  --setenv=UPDATE_SHA256="$UPDATE_SHA256" \
  --setenv=INSTALL_SHA256="$INSTALL_SHA256" \
  --setenv=STATUS_NAMESPACE="$STATUS_NAMESPACE" \
  --setenv=STATUS_CONFIGMAP="$STATUS_CONFIGMAP" \
  /bin/bash "${dir}/run.sh"

echo "Started acceleratio-update.service on $(host hostname) (${dir})"
