#!/usr/bin/env bash
#
# Manage the local development cluster: an OrbStack Linux machine running the
# same stack the server installer builds.
#
#   ./scripts/cluster.sh up          create the machine and install the cluster; idempotent
#   ./scripts/cluster.sh down        delete the machine and its kubeconfig
#   ./scripts/cluster.sh status      show the machine, nodes, pods and StorageClasses
#   ./scripts/cluster.sh kubeconfig  print the kubeconfig path used by the API
#   ./scripts/cluster.sh env         print the cluster values the API needs (join URL, token, CIDRs)
#   ./scripts/cluster.sh name        print the machine name
#
# The machine runs deploy/install.sh from this checkout (OrbStack shares the
# Mac filesystem with its machines), so local development gets k3s with
# embedded etcd, Cilium, SeaweedFS + CSI, VictoriaMetrics and VictoriaLogs
# exactly as a server does. The installer also deploys the released API and
# console into the cluster; they are scaled to zero because `make dev` runs
# them from source on the Mac.
#
# Environment:
#   ACCELERATIO_MACHINE=name   machine name (default acceleratio)
#   MACHINE_IMAGE=distro:ver   machine image (default ubuntu:24.04)
#   REINSTALL=1                run the installer again even if the cluster is ready
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

MACHINE="${ACCELERATIO_MACHINE:-acceleratio}"
MACHINE_IMAGE="${MACHINE_IMAGE:-ubuntu:24.04}"
KUBECONFIG_PATH="${HOME}/.kube/${MACHINE}-orbstack.yaml"
CONTEXT_NAME="orbstack-${MACHINE}"
NAMESPACE="acceleratio"

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_BLUE=$'\033[1;34m'
  C_RED=$'\033[1;31m'
  C_YELLOW=$'\033[1;33m'
  C_RESET=$'\033[0m'
else
  C_BLUE=""
  C_RED=""
  C_YELLOW=""
  C_RESET=""
fi

log() {
  printf '\n%s==> %s%s\n' "$C_BLUE" "$*" "$C_RESET" >&2
}

die() {
  printf '\n%sError: %s%s\n' "$C_RED" "$*" "$C_RESET" >&2
  exit 1
}

warn() {
  printf '\n%sWarning: %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2
}

require() {
  command -v "$1" >/dev/null 2>&1 || die "$2"
}

# Run a command in the machine as root. Output is the command's own.
vm() {
  orbctl run -m "$MACHINE" sudo "$@"
}

kube() {
  KUBECONFIG="$KUBECONFIG_PATH" kubectl "$@"
}

require_orbstack() {
  require orbctl "OrbStack is required. Install it from https://orbstack.dev (brew install --cask orbstack) and try again."
  require kubectl "kubectl is required. Install it with 'brew install kubectl' and try again."
}

orbstack_running() {
  [[ "$(orbctl status 2>/dev/null || true)" == "Running" ]]
}

machine_state() {
  # Prints running, stopped, or nothing when the machine does not exist.
  if orbctl list -q -r 2>/dev/null | grep -qx "$MACHINE"; then
    printf 'running'
  elif orbctl list -q 2>/dev/null | grep -qx "$MACHINE"; then
    printf 'stopped'
  fi
}

machine_ip() {
  vm ip -4 -o addr show eth0 | awk '{ sub(/\/.*/, "", $4); print $4; exit }'
}

cluster_ready() {
  # The installer finished when the node is Ready and the platform namespace exists.
  vm k3s kubectl get node --no-headers 2>/dev/null | grep -q ' Ready ' &&
    vm k3s kubectl get namespace "$NAMESPACE" >/dev/null 2>&1
}

ensure_machine() {
  local state

  if ! orbstack_running; then
    log "Starting OrbStack"
    orbctl start >/dev/null
  fi

  state="$(machine_state)"
  case "$state" in
    running) ;;
    "")
      log "Creating OrbStack machine ${MACHINE} (${MACHINE_IMAGE})"
      orbctl create "$MACHINE_IMAGE" "$MACHINE"
      ;;
    *)
      log "Starting OrbStack machine ${MACHINE}"
      orbctl start "$MACHINE"
      ;;
  esac

  # The installer refuses a host with active swap, and OrbStack machines come
  # with zram swap that returns after a restart. Disabling it affects only the
  # machine.
  vm swapoff -a
}

install_cluster() {
  local ip="$1" attempt

  vm test -f "${ROOT_DIR}/deploy/install.sh" ||
    die "The machine cannot see ${ROOT_DIR}. OrbStack shares /Users and /Volumes with machines; keep the checkout under one of them."

  # The installer detects the Mac's public address by default, which the
  # browser could not use. Pin every address to the machine's own.
  vm tee /root/install.env >/dev/null <<EOF
K3S_NODE_IP=${ip}
K3S_PUBLIC_IP=${ip}
ACCELERATIO_PUBLIC_HOST=${ip}
ACCELERATIO_CONSOLE_URL=http://${ip}:30300
ACCELERATIO_API_URL=http://${ip}:30080
EOF
  vm chmod 600 /root/install.env

  log "Installing the cluster (k3s, Cilium, SeaweedFS, VictoriaMetrics, VictoriaLogs); this takes a few minutes the first time"
  for attempt in 1 2 3; do
    if vm bash "${ROOT_DIR}/deploy/install.sh" --config /root/install.env >&2; then
      return 0
    fi
    # k3s restarts while the installer reconfigures it, which occasionally
    # races its smoke test. The installer is idempotent, so run it again.
    if ((attempt < 3)); then
      warn "The installer failed (attempt ${attempt}/3); retrying in 10s."
      sleep 10
    fi
  done

  die "The installer failed after 3 attempts. See /var/log/acceleratio/install.log in the machine (orbctl run -m ${MACHINE} sudo less /var/log/acceleratio/install.log)."
}

write_kubeconfig() {
  mkdir -p "$(dirname "$KUBECONFIG_PATH")"
  (umask 077 && vm cat /etc/acceleratio/kubeconfig.yaml >"$KUBECONFIG_PATH")
  chmod 600 "$KUBECONFIG_PATH"
  # The installer names the context "default". A distinct name keeps it apart
  # from other clusters and is what scripts/dev.sh recognises as local.
  kube config rename-context default "$CONTEXT_NAME" >/dev/null 2>&1 || true
  # OrbStack forwards the machine's ports to localhost, and the API server
  # certificate includes 127.0.0.1. Going through localhost keeps the kubeconfig
  # valid when the machine's IP changes, and avoids macOS blocking terminals and
  # editors from reaching the machine's LAN address (Privacy & Security >
  # Local Network).
  # OrbStack sometimes stops forwarding the port (e.g. after k3s restarts); then
  # fall back to the machine's own address, which the certificate also covers.
  local host=127.0.0.1
  if ! curl -sk -m 3 -o /dev/null "https://127.0.0.1:6443/healthz"; then
    host="$(machine_ip)"
    warn "localhost:6443 is not forwarded by OrbStack; using ${host}."
  fi
  kube config set-cluster default --server="https://${host}:6443" >/dev/null
}

up() {
  local ip

  require_orbstack
  ensure_machine

  if [[ "${REINSTALL:-0}" != "1" ]] && cluster_ready; then
    log "Cluster in ${MACHINE} is already installed"
  else
    ip="$(machine_ip)"
    [[ -n "$ip" ]] || die "Could not read the machine's IP address."
    install_cluster "$ip"
  fi

  # `make dev` runs the API and console from source against this cluster, so
  # the released copies the installer deploys would only compete with them.
  vm k3s kubectl -n "$NAMESPACE" scale deployment/api deployment/console --replicas=0 >/dev/null

  write_kubeconfig
  kube wait --for=condition=Ready node --all --timeout=120s >/dev/null

  log "Local cluster is ready"
  printf '    Machine:    %s\n' "$MACHINE" >&2
  printf '    KUBECONFIG: %s (context %s)\n' "$KUBECONFIG_PATH" "$CONTEXT_NAME" >&2
  printf '    Next:       make dev (it picks up this kubeconfig automatically)\n' >&2
}

down() {
  require orbctl "OrbStack is required. Install it from https://orbstack.dev."

  if [[ -n "$(machine_state)" ]]; then
    log "Deleting OrbStack machine ${MACHINE}"
    orbctl delete -f "$MACHINE"
  else
    log "Machine ${MACHINE} does not exist"
  fi
  rm -f "$KUBECONFIG_PATH"
  log "Cluster deleted"
}

status() {
  require orbctl "OrbStack is required. Install it from https://orbstack.dev."

  orbctl list || true

  if [[ ! -f "$KUBECONFIG_PATH" ]]; then
    printf '\nNo kubeconfig at %s. Run make cluster-up.\n' "$KUBECONFIG_PATH"
    return
  fi

  printf '\nKUBECONFIG: %s\n\n' "$KUBECONFIG_PATH"
  kube get nodes -o wide || true
  printf '\n'
  kube get pods -A --no-headers 2>/dev/null |
    awk '{ if ($4 != "Running" && $4 != "Completed") bad++; total++ } END { printf "%d pods, %d not running\n", total, bad }' || true
  printf '\n'
  kube get storageclass || true
}

# Values the installer stores for the in-cluster API. The API running from
# source needs the same ones to add servers from the console.
print_env() {
  local key value

  [[ -f "$KUBECONFIG_PATH" ]] || exit 0

  for key in K3S_JOIN_URL K3S_JOIN_TOKEN K3S_CLUSTER_CIDR K3S_SERVICE_CIDR; do
    value="$(kube -n "$NAMESPACE" get secret api -o "jsonpath={.data.${key}}" 2>/dev/null | base64 -d 2>/dev/null || true)"
    [[ -n "$value" ]] && printf '%s=%s\n' "$key" "$value"
  done
}

case "${1:-}" in
  up)
    up
    ;;
  down)
    down
    ;;
  status)
    status
    ;;
  env)
    print_env
    ;;
  name)
    printf '%s\n' "$MACHINE"
    ;;
  kubeconfig)
    printf '%s\n' "$KUBECONFIG_PATH"
    ;;
  *)
    printf 'Usage: %s <up|down|status|env|name|kubeconfig>\n' "$0" >&2
    exit 1
    ;;
esac
