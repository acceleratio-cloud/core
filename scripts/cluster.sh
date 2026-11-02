#!/usr/bin/env bash
#
# Manage a disposable local Kubernetes cluster for development.
#
#   ./scripts/cluster.sh up      create a k3d cluster and install Cilium
#   ./scripts/cluster.sh down    delete the cluster and its kubeconfig
#   ./scripts/cluster.sh status  show the cluster, nodes, and Cilium pods
#   ./scripts/cluster.sh kubeconfig  print the kubeconfig path used by the API
#
# The cluster matches the production CNI closely enough for local work:
# k3s with flannel and the built-in network policy controller disabled, and
# Cilium installed for CNI and CiliumNetworkPolicy support.
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

CLUSTER_NAME="${K3D_CLUSTER_NAME:-acceleratio-dev}"
K3D_MIN_VERSION="5.9.0"
KUBECONFIG_PATH="${HOME}/.k3d/kubeconfig-${CLUSTER_NAME}.yaml"

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
  printf '\n%s==> %s%s\n' "$C_BLUE" "$*" "$C_RESET"
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

# deploy/install.sh must stay self-contained for the curl-based install, so it
# owns the version defaults. Read them instead of duplicating the pins here.
installer_default() {
  local key="$1" value

  value="$(grep -E "^${key}=" "$ROOT_DIR/deploy/install.sh" 2>/dev/null | head -n 1 | sed -E 's/^[^=]+="\$\{[^}]*-(.*)\}"[[:space:]]*$/\1/' || true)"
  [[ -n "$value" ]] || die "Could not read ${key} from deploy/install.sh."
  printf '%s' "$value"
}

K3S_VERSION=""
K3S_IMAGE=""
CILIUM_VERSION=""

load_cluster_versions() {
  K3S_VERSION="${K3S_VERSION:-$(installer_default K3S_VERSION)}"
  K3S_IMAGE="${K3S_IMAGE:-rancher/k3s:${K3S_VERSION/+/-}}"
  CILIUM_VERSION="${CILIUM_VERSION:-$(installer_default CILIUM_VERSION)}"
}

version_ge() {
  local IFS=.
  local -a current=(${1#v}) required=(${2#v})
  local i current_segment required_segment

  for ((i = 0; i < ${#required[@]}; i++)); do
    current_segment="${current[i]:-0}"
    current_segment="${current_segment%%[!0-9]*}"
    required_segment="${required[i]:-0}"
    required_segment="${required_segment%%[!0-9]*}"
    current_segment="${current_segment:-0}"
    required_segment="${required_segment:-0}"

    if ((10#$current_segment > 10#$required_segment)); then
      return 0
    fi
    if ((10#$current_segment < 10#$required_segment)); then
      return 1
    fi
  done

  return 0
}

check_k3d_version() {
  local installed
  installed="$(k3d version 2>/dev/null | awk '/^k3d version/{ print $3 }' | sed 's/^v//')"

  [[ -n "$installed" ]] || die "Could not determine the k3d version."

  if ! version_ge "$installed" "$K3D_MIN_VERSION"; then
    die "k3d ${K3D_MIN_VERSION} or newer is required (found ${installed}). Upgrade with 'brew install k3d' or https://k3d.io."
  fi
}

cluster_exists() {
  local output

  # `k3d cluster list <name>` exits 1 both when the cluster is missing and when
  # k3d itself fails, so it cannot tell those cases apart. Listing everything
  # lets us distinguish an empty result from a k3d or Docker error.
  if ! output="$(k3d cluster list -o json 2>&1)"; then
    if grep -Eq 'No (nodes|clusters) found' <<<"$output"; then
      return 1
    fi
    return 2
  fi

  grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"${CLUSTER_NAME}\"" <<<"$output"
}

write_kubeconfig() {
  mkdir -p "$(dirname "$KUBECONFIG_PATH")"
  k3d kubeconfig merge "$CLUSTER_NAME" \
    --output "$KUBECONFIG_PATH" \
    --overwrite >/dev/null
  chmod 600 "$KUBECONFIG_PATH"
}

install_cilium() {
  local attempt

  load_cluster_versions
  log "Installing Cilium ${CILIUM_VERSION}"

  for attempt in 1 2 3; do
    if KUBECONFIG="$KUBECONFIG_PATH" helm upgrade --install cilium \
      oci://quay.io/cilium/charts/cilium \
      --version "$CILIUM_VERSION" \
      --namespace kube-system \
      --set ipam.mode=cluster-pool \
      --set ipam.operator.clusterPoolIPv4PodCIDRList=10.42.0.0/16 \
      --set ipam.operator.clusterPoolIPv4MaskSize=24 \
      --set kubeProxyReplacement=false \
      --set operator.replicas=1 \
      --wait --timeout 15m; then
      return 0
    fi

    if ((attempt < 3)); then
      warn "Cilium installation failed (attempt ${attempt}/3); retrying in 5s."
      sleep 5
    fi
  done

  die "Cilium installation failed after 3 attempts."
}

up() {
  local exists_status=0

  require docker "Docker is required. Install Docker Desktop or Docker Engine and try again."
  require k3d "k3d is required. Install it from https://k3d.io and try again."
  require helm "Helm is required. Install it from https://helm.sh and try again."
  require kubectl "kubectl is required. Install it from https://kubernetes.io/docs/tasks/tools/ and try again."
  load_cluster_versions
  check_k3d_version
  docker info >/dev/null 2>&1 ||
    die "The Docker daemon is not running. Start Docker and try again."

  cluster_exists || exists_status=$?
  case "$exists_status" in
    0)
      log "Cluster ${CLUSTER_NAME} already exists"
      ;;
    1)
      log "Creating k3d cluster ${CLUSTER_NAME} (k3s ${K3S_IMAGE})"
      k3d cluster create "$CLUSTER_NAME" \
        --image "$K3S_IMAGE" \
        --servers 1 \
        --agents 0 \
        --kubeconfig-update-default=false \
        --kubeconfig-switch-context=false \
        --k3s-arg "--disable=traefik@server:0" \
        --k3s-arg "--disable=servicelb@server:0" \
        --k3s-arg "--flannel-backend=none@server:0" \
        --k3s-arg "--disable-network-policy@server:0" \
        --wait --timeout 5m
      ;;
    *)
      die "Could not query k3d clusters. Is the Docker daemon running?"
      ;;
  esac

  log "Writing kubeconfig to ${KUBECONFIG_PATH}"
  write_kubeconfig

  install_cilium

  log "Waiting for the node and Cilium to become ready"
  KUBECONFIG="$KUBECONFIG_PATH" kubectl wait \
    --for=condition=Ready node --all --timeout=300s
  KUBECONFIG="$KUBECONFIG_PATH" kubectl -n kube-system rollout status \
    daemonset/cilium --timeout=10m
  KUBECONFIG="$KUBECONFIG_PATH" kubectl get \
    crd/ciliumnetworkpolicies.cilium.io >/dev/null

  log "Local cluster is ready"
  printf '    KUBECONFIG: %s\n' "$KUBECONFIG_PATH"
  printf '    Next: make dev (it picks up this kubeconfig automatically)\n'
}

down() {
  local exists_status=0

  require docker "Docker is required. Install Docker Desktop or Docker Engine and try again."
  require k3d "k3d is required. Install it from https://k3d.io and try again."
  docker info >/dev/null 2>&1 ||
    die "The Docker daemon is not running. Start Docker and try again."

  cluster_exists || exists_status=$?
  case "$exists_status" in
    0)
      log "Deleting k3d cluster ${CLUSTER_NAME}"
      k3d cluster delete "$CLUSTER_NAME"
      rm -f "$KUBECONFIG_PATH"
      log "Cluster deleted"
      ;;
    1)
      log "Cluster ${CLUSTER_NAME} does not exist"
      rm -f "$KUBECONFIG_PATH"
      ;;
    *)
      die "Could not query k3d clusters. Is the Docker daemon running?"
      ;;
  esac
}

status() {
  require k3d "k3d is required. Install it from https://k3d.io and try again."

  k3d cluster list "$CLUSTER_NAME" || true

  if [[ ! -f "$KUBECONFIG_PATH" ]]; then
    printf '\nNo kubeconfig at %s. Run make cluster-up.\n' "$KUBECONFIG_PATH"
    return
  fi

  printf '\nKUBECONFIG: %s\n\n' "$KUBECONFIG_PATH"
  KUBECONFIG="$KUBECONFIG_PATH" kubectl get nodes -o wide || true
  printf '\n'
  KUBECONFIG="$KUBECONFIG_PATH" kubectl -n kube-system get pods \
    -l k8s-app=cilium || true
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
  name)
    printf '%s\n' "$CLUSTER_NAME"
    ;;
  kubeconfig)
    printf '%s\n' "$KUBECONFIG_PATH"
    ;;
  *)
    printf 'Usage: %s <up|down|status|name|kubeconfig>\n' "$0" >&2
    exit 1
    ;;
esac
