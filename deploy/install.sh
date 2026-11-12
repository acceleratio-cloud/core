#!/usr/bin/env bash
#
# Acceleratio installer.
#
# Installs a single-node k3s cluster with embedded etcd, Cilium as the CNI
# (replacing both flannel and kube-proxy), Longhorn block storage with the
# default StorageClass `longhorn`, and RustFS as the S3 object store.
#
# It then deploys Acceleratio itself into the `acceleratio` namespace:
# PostgreSQL, the API and the console, and prints the dashboard URL.
#
# Works on any Ubuntu/Debian server: bare metal, a private server or any other
# hardware.
#
# Usage: sudo ./deploy/install.sh [--dry-run] [--config FILE] [--reset] [--yes]
#
set -Eeuo pipefail

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]:-$0}")"
readonly SCRIPT_NAME
readonly MANAGED_BY="Acceleratio deploy/install.sh"

# ---------------------------------------------------------------------------
# Defaults (override with environment variables or --config FILE).
# scripts/cluster.sh and deploy/update.sh read the KEY="${KEY:-default}" lines
# below, so keep that form.
# ---------------------------------------------------------------------------

# Empty K3S_VERSION means "latest release from K3S_CHANNEL".
# scripts/cluster.sh reads this default; keep the KEY="${KEY-default}" form.
K3S_VERSION="${K3S_VERSION-v1.36.5+k3s1}"
K3S_CHANNEL="${K3S_CHANNEL:-stable}"
K3S_NODE_NAME="${K3S_NODE_NAME:-}"
K3S_NODE_IP="${K3S_NODE_IP:-}"
K3S_PUBLIC_IP="${K3S_PUBLIC_IP:-auto}"
K3S_CLUSTER_CIDR="${K3S_CLUSTER_CIDR:-10.42.0.0/16}"
K3S_SERVICE_CIDR="${K3S_SERVICE_CIDR:-10.43.0.0/16}"
K3S_ETCD_SNAPSHOT_CRON="${K3S_ETCD_SNAPSHOT_CRON-0 3 * * *}"
K3S_KUBECONFIG="${K3S_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"

# scripts/cluster.sh reads this default; keep the KEY="${KEY:-default}" form.
CILIUM_VERSION="${CILIUM_VERSION:-1.20.4}"
CILIUM_CNI_CONF_PATH="${CILIUM_CNI_CONF_PATH:-/etc/cni/net.d}"
CILIUM_CNI_BIN_PATH="${CILIUM_CNI_BIN_PATH:-/opt/cni/bin}"
HELM_VERSION="${HELM_VERSION:-3.18.0}"

# longhorn: Longhorn volumes (servers). local-path: the k3s local-path
# provisioner, for development machines that cannot run Longhorn (OrbStack and
# other LXC/OpenVZ containers have no working iSCSI).
STORAGE_BACKEND="${STORAGE_BACKEND:-longhorn}"
LONGHORN_CHART_VERSION="${LONGHORN_CHART_VERSION:-1.13.0}"
LONGHORN_NAMESPACE="${LONGHORN_NAMESPACE:-longhorn-system}"
LONGHORN_RELEASE="${LONGHORN_RELEASE:-longhorn}"
LONGHORN_DATA_DIR="${LONGHORN_DATA_DIR:-/var/lib/longhorn}"
LONGHORN_REPLICAS="${LONGHORN_REPLICAS:-1}"
# Empty means "longhorn" (or "local-path" with STORAGE_BACKEND=local-path).
STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME:-}"

# RustFS: the single S3 object store (buckets, PostgreSQL backups, static
# sites). One pod on a volume of the platform StorageClass.
RUSTFS_IMAGE="${RUSTFS_IMAGE:-rustfs/rustfs:1.0.5@sha256:b81d16a90ee25bd9511280127ca1471788c6e874cf0f0da759645f46b2dc1d74}"
# The rc client for admin Jobs; keep in step with RUSTFS_RC_IMAGE in the API.
RC_IMAGE="${RC_IMAGE:-rustfs/rc:v0.1.37@sha256:7e93fd410a8fe51514f89373e093392c92095b98dc6140335fcfe956810c4c80}"
RUSTFS_NAMESPACE="${RUSTFS_NAMESPACE:-rustfs}"
RUSTFS_SIZE="${RUSTFS_SIZE:-50Gi}"
SITES_BUCKET="${SITES_BUCKET:-acceleratio-sites}"

# scripts/cluster.sh reads this default; keep the KEY="${KEY:-default}" form.
VICTORIAMETRICS_CHART_VERSION="${VICTORIAMETRICS_CHART_VERSION:-0.50.0}"
VICTORIAMETRICS_NAMESPACE="${VICTORIAMETRICS_NAMESPACE:-victoria-metrics}"
VICTORIAMETRICS_RELEASE="${VICTORIAMETRICS_RELEASE:-victoria-metrics}"
VICTORIAMETRICS_DATA_DIR="${VICTORIAMETRICS_DATA_DIR:-/var/lib/victoria-metrics}"
VICTORIAMETRICS_RETENTION="${VICTORIAMETRICS_RETENTION:-14d}"

# scripts/cluster.sh reads this default; keep the KEY="${KEY:-default}" form.
VICTORIALOGS_CHART_VERSION="${VICTORIALOGS_CHART_VERSION:-0.13.11}"
VICTORIALOGS_NAMESPACE="${VICTORIALOGS_NAMESPACE:-victoria-logs}"
VICTORIALOGS_RELEASE="${VICTORIALOGS_RELEASE:-victoria-logs}"
VICTORIALOGS_DATA_DIR="${VICTORIALOGS_DATA_DIR:-/var/lib/victoria-logs}"
VICTORIALOGS_RETENTION="${VICTORIALOGS_RETENTION:-7d}"
VICTORIALOGS_MAX_DISK="${VICTORIALOGS_MAX_DISK:-2GiB}"

# CloudNativePG operator: runs the PostgreSQL workloads' Cluster resources.
CNPG_CHART_VERSION="${CNPG_CHART_VERSION:-0.29.1}"
CNPG_NAMESPACE="${CNPG_NAMESPACE:-cnpg-system}"
CNPG_RELEASE="${CNPG_RELEASE:-cnpg}"

ACCELERATIO_NAMESPACE="${ACCELERATIO_NAMESPACE:-acceleratio}"
ACCELERATIO_VERSION="${ACCELERATIO_VERSION:-0.3.0}"
ACCELERATIO_API_IMAGE="${ACCELERATIO_API_IMAGE:-ghcr.io/acceleratio-cloud/api:${ACCELERATIO_VERSION}}"
ACCELERATIO_CONSOLE_IMAGE="${ACCELERATIO_CONSOLE_IMAGE:-ghcr.io/acceleratio-cloud/console:${ACCELERATIO_VERSION}}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:17-alpine}"
# Image registry for services built from GitHub. Nodes pull through a mirror
# in /etc/rancher/k3s/registries.yaml: containerd runs on the host network and
# cannot resolve cluster DNS, so the Service has a fixed ClusterIP.
REGISTRY_IMAGE="${REGISTRY_IMAGE:-ghcr.io/project-zot/zot:v2.1.23}"
REGISTRY_SIZE="${REGISTRY_SIZE:-50Gi}"
REGISTRY_CLUSTER_IP="${REGISTRY_CLUSTER_IP:-}"
# Image references in workloads use this name; only the mirror resolves it.
# Keep in step with REGISTRY_PULL_HOST in the API.
readonly REGISTRY_HOST="registry.acceleratio.internal"
ACCELERATIO_DATA_DIR="${ACCELERATIO_DATA_DIR:-/var/lib/acceleratio}"
POSTGRES_DATA_DIR="${POSTGRES_DATA_DIR:-${ACCELERATIO_DATA_DIR}/postgres}"
# The console and API are published on these node ports (30000-32767).
ACCELERATIO_CONSOLE_NODE_PORT="${ACCELERATIO_CONSOLE_NODE_PORT:-30300}"
ACCELERATIO_API_NODE_PORT="${ACCELERATIO_API_NODE_PORT:-30080}"
# Host name or IP users reach the server on (default: the public IPv4), or the
# full URLs when the console and API sit behind a domain or a reverse proxy.
ACCELERATIO_PUBLIC_HOST="${ACCELERATIO_PUBLIC_HOST:-}"
ACCELERATIO_CONSOLE_URL="${ACCELERATIO_CONSOLE_URL:-}"
ACCELERATIO_API_URL="${ACCELERATIO_API_URL:-}"
# Optional contact address for Let's Encrypt certificates issued for a custom
# domain set in Console -> Settings -> System. Empty registers without one.
ACCELERATIO_ACME_EMAIL="${ACCELERATIO_ACME_EMAIL:-}"
# Traefik keeps its ACME account and certificates here (hostPath on the node).
TRAEFIK_DATA_DIR="${TRAEFIK_DATA_DIR:-${ACCELERATIO_DATA_DIR}/traefik}"

CONFIG_DIR="${CONFIG_DIR:-/etc/acceleratio}"
LOG_DIR="${LOG_DIR:-/var/log/acceleratio}"
ALLOW_SWAP="${ALLOW_SWAP:-0}"

# Runtime state, not configurable.
DRY_RUN=0
RESET=0
ASSUME_YES=0
CONFIG_FILE=""
K3S_CONFIG_CHANGED=0
HELM_BIN=""
LOG_FILE=""
SMOKE_NAMESPACE="acceleratio-smoke"
# update.sh sets ACCELERATIO_SKIP_UNCHANGED=1: Helm releases deployed by an
# earlier run with the same chart, arguments and values are left alone, and the
# smoke test runs only when k3s, Cilium or the storage changed. A direct run
# (fresh install or repair) always applies everything.
SKIP_UNCHANGED="${ACCELERATIO_SKIP_UNCHANGED:-0}"
SMOKE_NEEDED=$(( SKIP_UNCHANGED ? 0 : 1 ))

# ---------------------------------------------------------------------------
# Logging and helpers.
# ---------------------------------------------------------------------------

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'
  C_RED=$'\033[31m'
  C_GREEN=$'\033[32m'
  C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'
else
  C_RESET=""
  C_RED=""
  C_GREEN=""
  C_YELLOW=""
  C_BLUE=""
fi

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

run() {
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would run: $*"
    return 0
  fi
  log_info "RUN: $*"
  "$@"
}

# report_step LABEL: tells a supervising update.sh runner (the console) what
# the install stage is doing. Without ACCELERATIO_UPDATE_STAGE_FILE it does
# nothing.
report_step() {
  if [ -n "${ACCELERATIO_UPDATE_STAGE_FILE:-}" ]; then
    printf 'install\n%s\n' "$1" >"$ACCELERATIO_UPDATE_STAGE_FILE" 2>/dev/null || true
  fi
}

# step LABEL FUNC: reports LABEL, runs FUNC and logs how long it took.
step() {
  local started=$SECONDS
  report_step "$1"
  "$2"
  log_ok "Step $2 took $((SECONDS - started))s"
}

# run_parallel GROUP...: runs each "name:func func..." group as a background
# job (its functions in order) with its output prefixed by [name], then fails
# if any group failed. A failed group does not stop the others: killing helm
# mid-upgrade would leave its release locked.
run_parallel() {
  local group name fn i failed=""
  local pids=() names=()
  for group in "$@"; do
    name="${group%%:*}"
    (
      for fn in ${group#*:}; do
        started=$SECONDS
        "$fn"
        log_ok "Step ${fn} took $((SECONDS - started))s"
      done
    ) > >(sed -u "s/^/[${name}] /") 2>&1 &
    pids+=("$!")
    names+=("$name")
  done
  for i in "${!pids[@]}"; do
    wait "${pids[$i]}" || failed="${failed:+${failed}, }${names[$i]}"
  done
  [ -z "$failed" ] || die "Failed: ${failed}. The lines prefixed with their name above show why."
}

# helm_install RELEASE CHART ARGS...: helm upgrade --install with ARGS (which
# include --namespace). In SKIP_UNCHANGED mode a release that is deployed with
# the same chart, ARGS and values files as the last successful run is skipped.
helm_install() {
  local release=$1 namespace="" prev="" arg digest stamp
  for arg in "$@"; do
    if [ "$prev" = "--namespace" ]; then namespace=$arg; fi
    prev=$arg
  done
  digest="$(
    {
      printf '%s\n' "$@"
      prev=""
      for arg in "$@"; do
        if [ "$prev" = "--values" ]; then cat "$arg"; fi
        prev=$arg
      done
    } | sha256sum | cut -d' ' -f1
  )"
  stamp="${CONFIG_DIR}/helm-state/${namespace}.${release}"

  if (( SKIP_UNCHANGED )) && [ "$(cat "$stamp" 2>/dev/null)" = "$digest" ] &&
    "$HELM_BIN" status "$release" --namespace "$namespace" 2>/dev/null | grep -qx 'STATUS: deployed'; then
    log_info "${release} is unchanged since the last run; not upgrading it"
    return 0
  fi

  "$HELM_BIN" upgrade --install "$@"
  install -d -m 0700 "${CONFIG_DIR}/helm-state"
  printf '%s\n' "$digest" >"$stamp"
  SMOKE_NEEDED=1
}

# prepull_images: pulls the platform's own images in the background while the
# charts install, so the pods find them in containerd. Best effort: kubelet
# pulls again whatever is missing.
prepull_images() {
  local image
  if (( DRY_RUN )); then
    return 0
  fi
  for image in "$ACCELERATIO_API_IMAGE" "$ACCELERATIO_CONSOLE_IMAGE" \
    "$POSTGRES_IMAGE" "$REGISTRY_IMAGE" "$RUSTFS_IMAGE" "$RC_IMAGE" busybox:1.36; do
    k3s crictl pull "$image" >/dev/null 2>&1 &
  done
}

setup_logging() {
  if (( DRY_RUN )); then
    LOG_FILE="/dev/null"
    return 0
  fi
  mkdir -p "$LOG_DIR"
  LOG_FILE="$LOG_DIR/install-$(date +%Y%m%d-%H%M%S).log"
  ln -sfn "$LOG_FILE" "$LOG_DIR/install.log"
  exec > >(tee -a "$LOG_FILE") 2>&1
  log_info "Log file: $LOG_FILE"
}

on_error() {
  local exit_code=$?
  local line=${1:-unknown}
  trap - ERR
  log_error "Installation failed at line ${line} (exit code ${exit_code})."
  if [ -n "$LOG_FILE" ] && [ "$LOG_FILE" != "/dev/null" ]; then
    log_error "Log: ${LOG_FILE}"
  fi
  if command -v k3s >/dev/null 2>&1; then
    log_error "Diagnostics:"
    k3s kubectl --request-timeout=10s get nodes -o wide 2>/dev/null || true
    k3s kubectl --request-timeout=10s get pods -A 2>/dev/null || true
    systemctl status k3s --no-pager 2>/dev/null | head -n 20 || true
    journalctl -u k3s -n 40 --no-pager 2>/dev/null || true
  fi
  exit "$exit_code"
}

trap 'on_error ${LINENO}' ERR

write_file() {
  # write_file PATH MODE <<'EOF' ... EOF
  local path=$1
  local mode=$2
  local tmp
  tmp="$(mktemp)"
  cat >"$tmp"
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would write ${path}"
    rm -f "$tmp"
    return 0
  fi
  install -d -m 0755 "$(dirname "$path")"
  if [ -f "$path" ] && cmp -s "$tmp" "$path"; then
    chmod "$mode" "$path"
    rm -f "$tmp"
    return 0
  fi
  install -m "$mode" "$tmp" "$path"
  rm -f "$tmp"
}

is_ipv4() {
  [[ ${1:-} =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]
}

usage() {
  cat <<'EOF'
Acceleratio installer

Installs on any Ubuntu/Debian server (bare metal, private server, any hardware):
  - k3s with embedded etcd (single node, server + worker)
  - Cilium as CNI with kube-proxy replacement
  - Longhorn block storage and the default StorageClass longhorn
    (STORAGE_BACKEND=local-path uses the k3s local-path provisioner instead)
  - RustFS, the S3 object store, in namespace "rustfs"
  - VictoriaMetrics (single node) scraping kubelet and cAdvisor metrics
    for the console's Observability tab
  - VictoriaLogs (single node) with Vector collecting project container logs
    for the console's Logs tab
  - CloudNativePG operator for PostgreSQL workloads
  - Acceleratio in namespace "acceleratio": PostgreSQL, API and console,
    then prints the dashboard URL

Usage:
  sudo ./deploy/install.sh [options]

Options:
  --dry-run          Check prerequisites and print planned actions only.
  --config FILE      Load variables from FILE (shell syntax).
  --reset            Remove an existing k3s/Longhorn installation first.
                     Destructive: deletes etcd, Cilium networking, every
                     volume, RustFS data, VictoriaMetrics and VictoriaLogs history. Requires --yes when stdin is not a TTY.
  --yes, -y          Do not ask for confirmation.
  --help, -h         Show this help.

Common variables (environment or --config):
  K3S_VERSION                 default v1.36.5+k3s1 (empty = K3S_CHANNEL latest)
  K3S_CHANNEL                 default stable
  K3S_NODE_NAME               default short hostname
  K3S_NODE_IP                 default primary interface IPv4
  K3S_PUBLIC_IP               default auto-detected; used for TLS SAN/kubeconfig
  K3S_CLUSTER_CIDR            default 10.42.0.0/16
  K3S_SERVICE_CIDR            default 10.43.0.0/16
  K3S_ETCD_SNAPSHOT_CRON      default "0 3 * * *" (empty disables snapshots)
  CILIUM_VERSION              default 1.20.4
  CILIUM_CNI_CONF_PATH        default /etc/cni/net.d
  CILIUM_CNI_BIN_PATH         default /opt/cni/bin
  HELM_VERSION                default 3.18.0
  STORAGE_BACKEND             default longhorn (local-path for development)
  LONGHORN_CHART_VERSION      default 1.13.0
  LONGHORN_NAMESPACE          default longhorn-system
  LONGHORN_RELEASE            default longhorn
  LONGHORN_DATA_DIR           default /var/lib/longhorn
  LONGHORN_REPLICAS           default 1 (copies of each platform volume)
  STORAGE_CLASS_NAME          default longhorn (local-path with local-path)
  RUSTFS_IMAGE                default rustfs/rustfs:1.0.5 (pinned by digest)
  RC_IMAGE                    default rustfs/rc:v0.1.37 (pinned by digest)
  RUSTFS_NAMESPACE            default rustfs
  RUSTFS_SIZE                 default 50Gi (volume for all S3 data)
  SITES_BUCKET                default acceleratio-sites
  VICTORIAMETRICS_CHART_VERSION default 0.50.0
  VICTORIAMETRICS_NAMESPACE   default victoria-metrics
  VICTORIAMETRICS_RELEASE     default victoria-metrics
  VICTORIAMETRICS_DATA_DIR    default /var/lib/victoria-metrics
  VICTORIAMETRICS_RETENTION   default 14d
  VICTORIALOGS_CHART_VERSION  default 0.13.11
  VICTORIALOGS_NAMESPACE      default victoria-logs
  VICTORIALOGS_RELEASE        default victoria-logs
  VICTORIALOGS_DATA_DIR       default /var/lib/victoria-logs
  VICTORIALOGS_RETENTION      default 7d
  VICTORIALOGS_MAX_DISK       default 2GiB (oldest logs are dropped beyond it)
  CNPG_CHART_VERSION          default 0.29.1
  CNPG_NAMESPACE              default cnpg-system
  CNPG_RELEASE                default cnpg
  ACCELERATIO_NAMESPACE       default acceleratio
  ACCELERATIO_VERSION         default 0.3.0 (image tag for API and console)
  ACCELERATIO_API_IMAGE       default ghcr.io/acceleratio-cloud/api:<version>
  ACCELERATIO_CONSOLE_IMAGE   default ghcr.io/acceleratio-cloud/console:<version>
  POSTGRES_IMAGE              default postgres:17-alpine
  REGISTRY_IMAGE              default ghcr.io/project-zot/zot:v2.1.23
  REGISTRY_SIZE               default 50Gi (volume for built images)
  REGISTRY_CLUSTER_IP         default <service CIDR>.50 (fixed registry ClusterIP)
  POSTGRES_DATA_DIR           default /var/lib/acceleratio/postgres
  ACCELERATIO_CONSOLE_NODE_PORT default 30300
  ACCELERATIO_API_NODE_PORT   default 30080
  ACCELERATIO_PUBLIC_HOST     default public IPv4; host used in the URLs
  ACCELERATIO_CONSOLE_URL     default http://<host>:<console port>
  ACCELERATIO_API_URL         default http://<host>:<api port>
  ACCELERATIO_ACME_EMAIL      default empty; Let's Encrypt contact for custom domains
  CONFIG_DIR                  default /etc/acceleratio
  LOG_DIR                     default /var/log/acceleratio
  ALLOW_SWAP                  default 0 (kubelet requires swap off)

Examples:
  sudo ./deploy/install.sh
  sudo ./deploy/install.sh --dry-run
  sudo ./deploy/install.sh --config /etc/acceleratio/install.env
EOF
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      --config)
        if (($# < 2)); then
          die "--config requires a file path"
        fi
        CONFIG_FILE="$2"
        shift 2
        ;;
      --reset)
        RESET=1
        shift
        ;;
      --yes|-y)
        ASSUME_YES=1
        shift
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
  # shellcheck source=/dev/null
  . "$CONFIG_FILE"
}

# ---------------------------------------------------------------------------
# Preflight.
# ---------------------------------------------------------------------------

check_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "This installer must run as root. Re-run with: sudo bash $0"
  fi
}

check_os() {
  [ -r /etc/os-release ] || die "Cannot read /etc/os-release; unsupported OS"
  # shellcheck source=/dev/null
  . /etc/os-release
  case "${ID:-}" in
    ubuntu|debian)
      ;;
    *)
      die "Unsupported OS '${ID:-unknown}'. Supported: Ubuntu 22.04/24.04, Debian 12."
      ;;
  esac
  if command -v dpkg >/dev/null 2>&1; then
    if [ "${ID}" = "ubuntu" ] && ! dpkg --compare-versions "${VERSION_ID:-0}" ge "22.04"; then
      die "Ubuntu ${VERSION_ID:-unknown} is too old. Use 22.04 or 24.04."
    fi
    if [ "${ID}" = "debian" ] && ! dpkg --compare-versions "${VERSION_ID:-0}" ge "12"; then
      die "Debian ${VERSION_ID:-unknown} is too old. Use 12 or newer."
    fi
  fi
  log_info "OS: ${PRETTY_NAME:-${ID} ${VERSION_ID:-}}"
}

check_arch() {
  case "$(uname -m)" in
    x86_64|amd64)
      ARCH="amd64"
      ;;
    aarch64|arm64)
      ARCH="arm64"
      ;;
    *)
      die "Unsupported architecture: $(uname -m). Supported: amd64, arm64."
      ;;
  esac
  log_info "Architecture: ${ARCH}"
}

check_kernel() {
  local kernel_version
  kernel_version="$(uname -r | sed 's/[^0-9.].*$//')"
  if [ -z "$kernel_version" ]; then
    die "Cannot determine kernel version"
  fi
  if [ "$(printf '%s\n' 5.10 "$kernel_version" | sort -V | awk 'NR == 1')" != "5.10" ]; then
    die "Kernel ${kernel_version} is too old. Cilium requires Linux 5.10 or newer."
  fi
  log_info "Kernel: ${kernel_version}"
}

check_memory() {
  local mem_kb mem_gb
  mem_kb="$(awk '/^MemTotal:/ {print $2}' /proc/meminfo)"
  mem_gb=$((mem_kb / 1024 / 1024))
  if ((mem_gb < 2)); then
    die "At least 2 GiB RAM is required (found ${mem_gb} GiB). 4 GiB recommended."
  fi
  if ((mem_gb < 4)); then
    log_warn "Only ${mem_gb} GiB RAM. 4 GiB or more is recommended for k3s + Cilium + Longhorn."
  else
    log_info "Memory: ${mem_gb} GiB"
  fi
}

check_disk() {
  local check_path avail_kb avail_gb
  check_path="$LONGHORN_DATA_DIR"
  if [ ! -d "$check_path" ]; then
    check_path="$(dirname "$check_path")"
  fi
  if [ ! -d "$check_path" ]; then
    check_path="/var/lib"
  fi
  avail_kb="$(df -Pk "$check_path" | awk 'NR==2 {print $4}')"
  avail_gb=$((avail_kb / 1024 / 1024))
  if ((avail_gb < 10)); then
    die "At least 10 GiB free disk is required under ${check_path} (found ${avail_gb} GiB)."
  fi
  if ((avail_gb < 20)); then
    log_warn "Only ${avail_gb} GiB free under ${check_path}. 20 GiB or more is recommended."
  else
    log_info "Free disk under ${check_path}: ${avail_gb} GiB"
  fi
}

check_swap() {
  if ! command -v swapon >/dev/null 2>&1; then
    return 0
  fi
  if [ -n "$(swapon --show --noheadings 2>/dev/null || true)" ]; then
    if [ "$ALLOW_SWAP" = "1" ]; then
      log_warn "Swap is active and ALLOW_SWAP=1; kubelet may reject the node."
    else
      die "Swap is active. Disable it first (swapoff -a and remove it from /etc/fstab), or set ALLOW_SWAP=1."
    fi
  fi
}

# resolve_storage: fills STORAGE_CLASS_NAME after --config is loaded.
resolve_storage() {
  case "$STORAGE_BACKEND" in
    longhorn) STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME:-longhorn}" ;;
    local-path) STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME:-local-path}" ;;
    *) die "STORAGE_BACKEND must be longhorn or local-path (got '${STORAGE_BACKEND}')" ;;
  esac
  if ! [[ $LONGHORN_REPLICAS =~ ^[1-3]$ ]]; then
    die "LONGHORN_REPLICAS must be 1, 2 or 3 (got '${LONGHORN_REPLICAS}')"
  fi
}

# check_iscsi: Longhorn attaches volumes over iSCSI, which needs iscsid on the
# host. In LXC/OpenVZ containers iscsid starts but cannot talk to the kernel
# ("sendmsg: bug? ctrl_fd"), so test it for real instead of trusting the unit.
check_iscsi() {
  [ "$STORAGE_BACKEND" = "longhorn" ] || return 0
  if (( DRY_RUN )); then
    if ! command -v iscsiadm >/dev/null 2>&1; then
      log_info "DRY-RUN: open-iscsi is not installed; the real install would install it."
    fi
    return 0
  fi
  if [ -r /proc/1/environ ] && tr '\0' '\n' </proc/1/environ 2>/dev/null | grep -qx 'container=lxc'; then
    die "Longhorn requires a VM or bare metal; LXC/OpenVZ containers are not supported. For a development machine set STORAGE_BACKEND=local-path."
  fi
  if [ -d /proc/vz ] && [ ! -d /proc/bc ]; then
    die "Longhorn requires a VM or bare metal; LXC/OpenVZ containers are not supported. For a development machine set STORAGE_BACKEND=local-path."
  fi
  log_info "Storage: Longhorn (iSCSI is checked after the host packages are installed)"
}

# verify_iscsi: runs after open-iscsi is installed. `iscsiadm -m session`
# exits 21 when there are simply no sessions; anything else that mentions the
# control socket means iscsid cannot reach the kernel.
verify_iscsi() {
  local out rc=0
  [ "$STORAGE_BACKEND" = "longhorn" ] || return 0
  (( DRY_RUN )) && return 0
  systemctl enable --now iscsid >/dev/null 2>&1 || systemctl enable --now iscsid.socket >/dev/null 2>&1 || true
  out="$(iscsiadm -m session 2>&1)" || rc=$?
  if (( rc != 0 && rc != 21 )) || printf '%s' "$out" | grep -qi 'ctrl_fd\|can not connect to iscsid\|iscsid is not running'; then
    die "iscsid does not work on this host (${out:-exit ${rc}}). Longhorn requires a VM or bare metal; LXC/OpenVZ containers are not supported. For a development machine set STORAGE_BACKEND=local-path."
  fi
  log_info "iSCSI: available"
}

check_existing_k3s() {
  if [ ! -x /usr/local/bin/k3s ]; then
    return 0
  fi
  if [ -f /var/lib/rancher/k3s/server/db/state.db ] &&
     [ ! -d /var/lib/rancher/k3s/server/db/etcd ]; then
    if (( RESET )); then
      log_warn "Existing k3s uses sqlite. --reset will remove it and create an etcd cluster."
    else
      die "Existing k3s uses sqlite. k3s cannot switch to etcd in place. Use a fresh server or run with --reset (destructive)."
    fi
  elif [ -d /var/lib/rancher/k3s/server/db/etcd ]; then
    log_info "Existing k3s etcd datastore detected; the installer will update it in place."
  fi
}

detect_network() {
  if [ -z "$K3S_NODE_IP" ]; then
    if command -v ip >/dev/null 2>&1; then
      K3S_NODE_IP="$(ip -4 route get 1.1.1.1 2>/dev/null |
        awk '{for (i=1; i<=NF; i++) if ($i == "src") {print $(i+1); exit}}')"
    fi
  fi
  if [ -z "$K3S_NODE_IP" ]; then
    local candidate
    for candidate in $(hostname -I 2>/dev/null || true); do
      if is_ipv4 "$candidate"; then
        K3S_NODE_IP="$candidate"
        break
      fi
    done
  fi
  if ! is_ipv4 "$K3S_NODE_IP"; then
    die "Cannot determine a valid IPv4 node IP. Set K3S_NODE_IP explicitly."
  fi

  if [ "$K3S_PUBLIC_IP" = "auto" ]; then
    K3S_PUBLIC_IP="$(curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null || true)"
  fi
  if ! is_ipv4 "$K3S_PUBLIC_IP"; then
    log_warn "Cannot detect a public IPv4; using the node IP for the API certificate."
    K3S_PUBLIC_IP="$K3S_NODE_IP"
  fi

  if [ -z "$K3S_NODE_NAME" ]; then
    K3S_NODE_NAME="$(hostname -s 2>/dev/null || hostname 2>/dev/null || true)"
  fi
  K3S_NODE_NAME="$(printf '%s' "$K3S_NODE_NAME" |
    tr '[:upper:]' '[:lower:]' |
    sed -e 's/[^a-z0-9.-]/-/g' -e 's/^[.-]*//' -e 's/[.-]*$//')"
  if [ -z "$K3S_NODE_NAME" ]; then
    K3S_NODE_NAME="k3s-node-1"
  fi
  K3S_NODE_NAME="${K3S_NODE_NAME:0:63}"

  K3S_SANS=()
  add_san() {
    local candidate=$1
    local existing
    [ -n "$candidate" ] || return 0
    for existing in "${K3S_SANS[@]}"; do
      if [ "$existing" = "$candidate" ]; then
        return 0
      fi
    done
    K3S_SANS+=("$candidate")
  }
  add_san "$K3S_NODE_IP"
  add_san "$K3S_PUBLIC_IP"
  add_san "$K3S_NODE_NAME"
  add_san "127.0.0.1"
  add_san "localhost"

  log_info "Node name: ${K3S_NODE_NAME}"
  log_info "Node IP: ${K3S_NODE_IP}"
  log_info "Public IP: ${K3S_PUBLIC_IP}"
}

check_connectivity() {
  local url
  for url in \
    "https://get.k3s.io" \
    "https://get.helm.sh/helm-v${HELM_VERSION}-linux-${ARCH}.tar.gz" \
    "https://quay.io/" \
    "https://charts.longhorn.io/index.yaml"; do
    if ! curl -fsSI --retry 2 --retry-delay 2 --max-time 20 -o /dev/null "$url"; then
      die "Cannot reach ${url}. Check DNS, outbound HTTPS and the requested versions."
    fi
  done
  log_info "Outbound HTTPS: OK"
}

check_ports() {
  if ! command -v ss >/dev/null 2>&1; then
    return 0
  fi
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E '(:|\.)6443$' >/dev/null 2>&1; then
    if [ ! -x /usr/local/bin/k3s ]; then
      die "Port 6443 is already in use. Stop the conflicting service before installing k3s."
    fi
  fi
  if [ -z "$(ss -ltn 2>/dev/null | awk '{print $4}' | grep -E '(:|\.)(80|443)$' || true)" ]; then
    return 0
  fi
  if [ ! -x /usr/local/bin/k3s ]; then
    log_warn "Port 80 or 443 is already in use; k3s Traefik may fail to bind."
  fi
}

ufw_active() {
  command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep "Status: active" >/dev/null
}

check_warnings() {
  if systemctl is-active --quiet docker 2>/dev/null; then
    log_warn "Docker is active. It can coexist with k3s/Cilium, but its iptables rules are not managed by this installer."
  fi
  if ufw_active; then
    log_warn "UFW is active. The installer allows traffic from ${K3S_CLUSTER_CIDR} and ${K3S_SERVICE_CIDR} and keeps your other rules. Open ${ACCELERATIO_CONSOLE_NODE_PORT}/tcp and ${ACCELERATIO_API_NODE_PORT}/tcp for the dashboard, and 6443/tcp, 80/tcp, 443/tcp and 8472/udp between cluster nodes if needed."
  fi
  if systemctl is-active --quiet firewalld 2>/dev/null; then
    log_warn "firewalld is active. Cilium requires careful firewall configuration; review its rules."
  fi
}

preflight() {
  log_info "Running preflight checks"
  command -v curl >/dev/null 2>&1 || die "curl is required. Install it first: apt-get update && apt-get install -y curl ca-certificates"
  check_root
  check_os
  check_arch
  check_kernel
  check_memory
  check_disk
  check_swap
  check_iscsi
  check_existing_k3s
  detect_network
  check_connectivity
  check_ports
  check_warnings
  log_ok "Preflight checks passed"
}

# ---------------------------------------------------------------------------
# Reset (explicit, destructive).
# ---------------------------------------------------------------------------

validate_cni_paths() {
  local path
  for path in "$CILIUM_CNI_CONF_PATH" "$CILIUM_CNI_BIN_PATH"; do
    case "$path" in
      ""|"/"|"/etc"|"/opt"|"/var"|"/var/lib")
        die "Refusing to use unsafe CNI path: '${path}'"
        ;;
    esac
  done
}

detach_cilium_bpf() {
  local dev
  if ! command -v tc >/dev/null 2>&1 || ! command -v ip >/dev/null 2>&1; then
    log_warn "tc or ip is missing; skipping Cilium BPF detach."
    return 0
  fi
  log_info "Detaching Cilium BPF filters from host interfaces"
  while IFS= read -r dev; do
    [ -n "$dev" ] || continue
    tc qdisc del dev "$dev" clsact 2>/dev/null || true
    tc qdisc del dev "$dev" ingress 2>/dev/null || true
  done < <(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | cut -d@ -f1)
}

# uninstall_longhorn_release HELM: the pods using volumes go first (projects,
# RustFS, the registry), so Longhorn can detach them. Longhorn refuses to
# uninstall until deleting-confirmation-flag is set.
uninstall_longhorn_release() {
  local helm_cmd=$1
  k3s kubectl -n "$LONGHORN_NAMESPACE" get settings.longhorn.io deleting-confirmation-flag >/dev/null 2>&1 || return 0
  k3s kubectl delete namespace -l app.kubernetes.io/managed-by=acceleratio --wait=true --timeout=180s >/dev/null 2>&1 || true
  k3s kubectl delete namespace "$RUSTFS_NAMESPACE" "$ACCELERATIO_NAMESPACE" --ignore-not-found --wait=true --timeout=180s >/dev/null 2>&1 || true
  k3s kubectl -n "$LONGHORN_NAMESPACE" patch settings.longhorn.io deleting-confirmation-flag \
    --type merge -p '{"value":"true"}' >/dev/null 2>&1 || true
  "$helm_cmd" uninstall "$LONGHORN_RELEASE" -n "$LONGHORN_NAMESPACE" --ignore-not-found --wait --timeout 10m >/dev/null 2>&1 ||
    log_warn "Longhorn did not uninstall cleanly; k3s removal below clears what is left."
}

# logout_iscsi: Longhorn volumes are iSCSI sessions on the host; k3s-uninstall
# does not end them, and a stale session keeps the device busy.
logout_iscsi() {
  command -v iscsiadm >/dev/null 2>&1 || return 0
  iscsiadm -m node --logoutall=all >/dev/null 2>&1 || true
}

reset_installation() {
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would remove the existing k3s/Cilium/Longhorn/RustFS/Acceleratio installation"
    return 0
  fi
  if (( ! ASSUME_YES )); then
    if [ ! -t 0 ]; then
      die "--reset requires --yes when stdin is not a terminal."
    fi
    printf 'This deletes k3s, etcd, Cilium, every volume (Longhorn, RustFS) and database data. Type "reset" to continue: '
    read -r answer
    if [ "$answer" != "reset" ]; then
      die "Reset aborted."
    fi
  fi

  case "$LONGHORN_DATA_DIR" in
    ""|"/"|"/var"|"/var/lib"|"/etc")
      die "Refusing to remove unsafe data directory: '${LONGHORN_DATA_DIR}'"
      ;;
  esac
  case "$POSTGRES_DATA_DIR" in
    ""|"/"|"/var"|"/var/lib"|"/etc")
      die "Refusing to remove unsafe data directory: '${POSTGRES_DATA_DIR}'"
      ;;
  esac
  case "$VICTORIAMETRICS_DATA_DIR" in
    ""|"/"|"/var"|"/var/lib"|"/etc")
      die "Refusing to remove unsafe data directory: '${VICTORIAMETRICS_DATA_DIR}'"
      ;;
  esac
  case "$VICTORIALOGS_DATA_DIR" in
    ""|"/"|"/var"|"/var/lib"|"/etc")
      die "Refusing to remove unsafe data directory: '${VICTORIALOGS_DATA_DIR}'"
      ;;
  esac

  log_warn "Removing existing installation"
  local helm_cmd=""
  helm_cmd="$(command -v helm 2>/dev/null || true)"
  if [ -n "$helm_cmd" ] && [ -f "$K3S_KUBECONFIG" ]; then
    export KUBECONFIG="$K3S_KUBECONFIG"
    "$helm_cmd" uninstall "$VICTORIALOGS_RELEASE" -n "$VICTORIALOGS_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    "$helm_cmd" uninstall "$VICTORIAMETRICS_RELEASE" -n "$VICTORIAMETRICS_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    uninstall_longhorn_release "$helm_cmd"
    "$helm_cmd" uninstall cilium -n kube-system --ignore-not-found >/dev/null 2>&1 || true
  fi

  detach_cilium_bpf
  logout_iscsi
  remove_multipath

  rm -f "${CILIUM_CNI_CONF_PATH%/}"/*cilium* 2>/dev/null || true
  rm -f "${CILIUM_CNI_BIN_PATH%/}/cilium-cni" 2>/dev/null || true
  rm -f /var/lib/rancher/k3s/agent/etc/cni/net.d/*cilium* 2>/dev/null || true
  rm -f /var/lib/rancher/k3s/data/cni/cilium-cni 2>/dev/null || true

  if command -v ip >/dev/null 2>&1; then
    ip link delete cilium_host 2>/dev/null || true
    ip link delete cilium_net 2>/dev/null || true
    ip link delete cilium_vxlan 2>/dev/null || true
  fi
  if command -v iptables-save >/dev/null 2>&1 && command -v iptables-restore >/dev/null 2>&1; then
    iptables-save 2>/dev/null | grep -iv cilium | iptables-restore 2>/dev/null || true
  fi
  if command -v ip6tables-save >/dev/null 2>&1 && command -v ip6tables-restore >/dev/null 2>&1; then
    ip6tables-save 2>/dev/null | grep -iv cilium | ip6tables-restore 2>/dev/null || true
  fi

  if [ -x /usr/local/bin/k3s-uninstall.sh ]; then
    /usr/local/bin/k3s-uninstall.sh || true
  else
    systemctl disable --now k3s >/dev/null 2>&1 || true
    rm -f /usr/local/bin/k3s /usr/local/bin/k3s-killall.sh /usr/local/bin/k3s-uninstall.sh
    rm -f /etc/systemd/system/k3s.service /etc/systemd/system/k3s.service.env
    systemctl daemon-reload >/dev/null 2>&1 || true
  fi

  local cilium_mount
  for cilium_mount in /var/run/cilium/cgroupv2 /run/cilium/cgroupv2; do
    if grep -qs " ${cilium_mount} " /proc/mounts; then
      umount -l "$cilium_mount" 2>/dev/null || true
    fi
  done
  rm -rf "$LONGHORN_DATA_DIR"
  rm -rf "$VICTORIAMETRICS_DATA_DIR"
  rm -rf "$VICTORIALOGS_DATA_DIR"
  rm -rf /var/lib/vector
  rm -rf "$POSTGRES_DATA_DIR"
  rm -rf "$CONFIG_DIR"
  rm -rf /etc/rancher/k3s
  rm -rf /var/lib/rancher/k3s
  rm -rf /var/run/cilium /var/lib/cilium 2>/dev/null || true
  log_ok "Existing installation removed"
}

# ---------------------------------------------------------------------------
# Host packages.
# ---------------------------------------------------------------------------

# UFW's default deny drops pod traffic to the host (CoreDNS cannot reach the
# API server through 10.43.0.1 -> node:6443), so allow the pod and service
# CIDRs in and through the host. The comment lets uninstall.sh find the rules;
# ufw skips rules that already exist.
UFW_RULE_COMMENT="acceleratio-cluster"

configure_ufw() {
  ufw_active || return 0
  log_info "UFW is active: allowing ${K3S_CLUSTER_CIDR} and ${K3S_SERVICE_CIDR}"
  local cidr
  for cidr in "$K3S_CLUSTER_CIDR" "$K3S_SERVICE_CIDR"; do
    run ufw allow from "$cidr" comment "$UFW_RULE_COMMENT"
    run ufw route allow from "$cidr" comment "$UFW_RULE_COMMENT"
    run ufw route allow to "$cidr" comment "$UFW_RULE_COMMENT"
  done
}

# Ubuntu Server runs multipathd, which claims Longhorn's iSCSI disks and breaks
# their mounts. Blacklist only Longhorn's devices (vendor IET, product
# VIRTUAL-DISK), as the Longhorn documentation recommends, so a host's own
# multipath setup keeps working.
# The block sits between markers so uninstall.sh and --reset can remove it.
readonly MULTIPATH_BEGIN="# BEGIN acceleratio longhorn"
readonly MULTIPATH_END="# END acceleratio longhorn"

configure_multipath() {
  local conf=/etc/multipath.conf
  if [ -f "$conf" ] && grep -qxF "$MULTIPATH_BEGIN" "$conf"; then
    return 0
  fi
  if ! command -v multipathd >/dev/null 2>&1 && [ ! -f "$conf" ]; then
    return 0
  fi
  log_info "Blacklisting Longhorn devices in ${conf}"
  printf '%s\n# Longhorn volumes are not multipath.\nblacklist {\n    device {\n        vendor "IET"\n        product "VIRTUAL-DISK"\n    }\n}\n%s\n' \
    "$MULTIPATH_BEGIN" "$MULTIPATH_END" >>"$conf"
  if systemctl is-active --quiet multipathd 2>/dev/null; then
    systemctl restart multipathd
  fi
}

remove_multipath() {
  local conf=/etc/multipath.conf
  [ -f "$conf" ] && grep -qxF "$MULTIPATH_BEGIN" "$conf" || return 0
  sed -i "/^${MULTIPATH_BEGIN}\$/,/^${MULTIPATH_END}\$/d" "$conf"
  if systemctl is-active --quiet multipathd 2>/dev/null; then
    systemctl restart multipathd || true
  fi
}

wait_for_apt_lock() {
  local deadline=$((SECONDS + 600))
  local locks=(
    /var/lib/dpkg/lock-frontend
    /var/lib/dpkg/lock
    /var/lib/apt/lists/lock
    /var/cache/apt/archives/lock
  )

  if ! command -v fuser >/dev/null 2>&1; then
    return 0
  fi
  while fuser "${locks[@]}" >/dev/null 2>&1; do
    if (( SECONDS >= deadline )); then
      die "Timed out waiting for the apt/dpkg lock. Check: pgrep -a 'apt|dpkg'"
    fi
    log_info "Waiting for the apt/dpkg lock held by another process"
    sleep 5
  done
}

install_packages() {
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install curl, ca-certificates, tar, gzip, iptables, iproute2, conntrack, socat, kmod, procps (and open-iscsi, nfs-common for Longhorn)"
    return 0
  fi
  local storage_packages=()
  if [ "$STORAGE_BACKEND" = "longhorn" ]; then
    # Longhorn's manager checks for the NFS client at start, even without RWX.
    storage_packages=(open-iscsi nfs-common)
  fi
  log_info "Installing host packages"
  export DEBIAN_FRONTEND=noninteractive
  wait_for_apt_lock
  apt-get -o DPkg::Lock::Timeout=600 update -qq
  apt-get -o DPkg::Lock::Timeout=600 install -y -qq --no-install-recommends \
    curl ca-certificates tar gzip iptables iproute2 conntrack socat kmod procps util-linux \
    "${storage_packages[@]}"
  if [ "$STORAGE_BACKEND" = "longhorn" ]; then
    modprobe iscsi_tcp >/dev/null 2>&1 || true
    printf '# %s\niscsi_tcp\n' "$MANAGED_BY" >/etc/modules-load.d/acceleratio.conf
    configure_multipath
    verify_iscsi
  fi

  cat >/etc/sysctl.d/99-acceleratio.conf <<'EOF'
# Managed by Acceleratio deploy/install.sh
net.ipv4.ip_forward = 1
EOF
  sysctl --system >/dev/null
  log_ok "Host packages installed"
}

# ---------------------------------------------------------------------------
# k3s with embedded etcd.
# ---------------------------------------------------------------------------

build_k3s_config() {
  local destination=$1
  local san
  {
    echo "# ${MANAGED_BY} - manual edits will be overwritten."
    echo "node-name: ${K3S_NODE_NAME}"
    echo "node-ip: ${K3S_NODE_IP}"
    echo 'write-kubeconfig-mode: "0600"'
    echo "cluster-cidr: ${K3S_CLUSTER_CIDR}"
    echo "service-cidr: ${K3S_SERVICE_CIDR}"
    echo "tls-san:"
    for san in "${K3S_SANS[@]}"; do
      echo "  - ${san}"
    done
    echo "cluster-init: true"
    echo "flannel-backend: none"
    echo "disable-network-policy: true"
    echo "disable-kube-proxy: true"
    # local-path is the development storage; servers use Longhorn only.
    if [ "$STORAGE_BACKEND" = "longhorn" ]; then
      echo "disable:"
      echo "  - local-storage"
    fi
    # kubelet pulls one image at a time by default, which serialises a fresh
    # install behind every chart's images.
    echo "kubelet-arg:"
    echo "  - serialize-image-pulls=false"
    if [ -n "$K3S_ETCD_SNAPSHOT_CRON" ]; then
      echo "etcd-snapshot-schedule-cron: \"${K3S_ETCD_SNAPSHOT_CRON}\""
    else
      echo "etcd-disable-snapshots: true"
    fi
  } >"$destination"
}

resolve_registry_cluster_ip() {
  [ -n "$REGISTRY_CLUSTER_IP" ] && return 0
  # shortcut: assumes an IPv4 service CIDR of /24 or wider; set
  # REGISTRY_CLUSTER_IP for anything else.
  local base="${K3S_SERVICE_CIDR%/*}"
  REGISTRY_CLUSTER_IP="${base%.*}.50"
}

# Same mirror the console writes on joined nodes (node-join-script.ts).
build_k3s_registries() {
  cat >"$1" <<EOF
# ${MANAGED_BY} - manual edits will be overwritten.
mirrors:
  "${REGISTRY_HOST}":
    endpoint:
      - "http://${REGISTRY_CLUSTER_IP}:5000"
EOF
}

install_k3s() {
  local installed_version=""
  local install_needed=1
  local config_tmp
  local registries_tmp
  local install_script

  config_tmp="$(mktemp)"
  build_k3s_config "$config_tmp"
  registries_tmp="$(mktemp)"
  build_k3s_registries "$registries_tmp"

  if (( DRY_RUN )); then
    log_info "DRY-RUN: k3s config:"
    sed 's/^/    /' "$config_tmp"
    log_info "DRY-RUN: k3s registries.yaml:"
    sed 's/^/    /' "$registries_tmp"
    rm -f "$config_tmp" "$registries_tmp"
    log_info "DRY-RUN: would install k3s ${K3S_VERSION:-latest from ${K3S_CHANNEL}}"
    return 0
  fi

  mkdir -p /etc/rancher/k3s
  if [ -f /etc/rancher/k3s/config.yaml ] && ! cmp -s "$config_tmp" /etc/rancher/k3s/config.yaml; then
    cp -a /etc/rancher/k3s/config.yaml "/etc/rancher/k3s/config.yaml.bak.$(date +%s)"
    K3S_CONFIG_CHANGED=1
    log_warn "k3s config changed; a restart will be required."
  fi
  if [ ! -f /etc/rancher/k3s/config.yaml ] || ! cmp -s "$config_tmp" /etc/rancher/k3s/config.yaml; then
    if [ ! -f /etc/rancher/k3s/config.yaml ] && [ -x /usr/local/bin/k3s ]; then
      K3S_CONFIG_CHANGED=1
    fi
    install -m 0600 "$config_tmp" /etc/rancher/k3s/config.yaml
  fi
  rm -f "$config_tmp"

  # k3s reads registries.yaml only at start, so a change needs a restart too.
  if ! cmp -s "$registries_tmp" /etc/rancher/k3s/registries.yaml 2>/dev/null; then
    if [ -x /usr/local/bin/k3s ]; then
      K3S_CONFIG_CHANGED=1
    fi
    install -m 0644 "$registries_tmp" /etc/rancher/k3s/registries.yaml
  fi
  rm -f "$registries_tmp"

  if [ -x /usr/local/bin/k3s ]; then
    installed_version="$(/usr/local/bin/k3s --version 2>/dev/null | awk 'NR == 1 {print $3}')"
    if [ -n "$K3S_VERSION" ] && [ "$installed_version" = "$K3S_VERSION" ]; then
      install_needed=0
    elif [ -z "$K3S_VERSION" ]; then
      install_needed=0
    fi
  fi

  if (( install_needed || K3S_CONFIG_CHANGED )); then
    SMOKE_NEEDED=1
  fi
  if (( install_needed )); then
    log_info "Installing k3s ${K3S_VERSION:-latest from ${K3S_CHANNEL}}"
    install_script="$(mktemp)"
    curl -fsSL --retry 3 https://get.k3s.io -o "$install_script"
    if [ -n "$K3S_VERSION" ]; then
      INSTALL_K3S_EXEC=server INSTALL_K3S_VERSION="$K3S_VERSION" sh "$install_script"
    else
      INSTALL_K3S_EXEC=server INSTALL_K3S_CHANNEL="$K3S_CHANNEL" sh "$install_script"
    fi
    rm -f "$install_script"
  else
    log_info "k3s ${installed_version} is already installed"
  fi

  systemctl enable k3s >/dev/null 2>&1 || true
  if (( install_needed == 0 )) && (( K3S_CONFIG_CHANGED == 1 )); then
    log_info "Restarting k3s to apply the new configuration"
    systemctl restart k3s
  fi
  systemctl start k3s

  wait_for_api
  log_ok "k3s is running with embedded etcd"
}

wait_for_api() {
  local deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    if [ -f "$K3S_KUBECONFIG" ] && k3s kubectl get --raw=/readyz >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  die "k3s API did not become ready. Check: journalctl -u k3s -n 100"
}

configure_kubeconfig() {
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install kubeconfig for root and SUDO_USER"
    return 0
  fi
  mkdir -p /root/.kube
  if [ -f /root/.kube/config ] && ! cmp -s "$K3S_KUBECONFIG" /root/.kube/config; then
    cp -a /root/.kube/config "/root/.kube/config.bak.$(date +%s)"
  fi
  cp "$K3S_KUBECONFIG" /root/.kube/config
  chmod 0600 /root/.kube/config

  local external_config
  external_config="$(mktemp)"
  sed "s#https://127.0.0.1:6443#https://${K3S_PUBLIC_IP}:6443#g" "$K3S_KUBECONFIG" >"$external_config"
  write_file "${CONFIG_DIR}/kubeconfig.yaml" 0600 <"$external_config"
  rm -f "$external_config"

  if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ]; then
    local user_home
    local user_group
    user_home="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
    user_group="$(id -gn "$SUDO_USER" 2>/dev/null || true)"
    if [ -n "$user_home" ] && [ -d "$user_home" ] && [ -n "$user_group" ]; then
      install -d -m 0700 -o "$SUDO_USER" -g "$user_group" "$user_home/.kube"
      if [ -f "$user_home/.kube/config" ] && ! cmp -s "$K3S_KUBECONFIG" "$user_home/.kube/config"; then
        cp -a "$user_home/.kube/config" "$user_home/.kube/config.bak.$(date +%s)"
      fi
      cp "$K3S_KUBECONFIG" "$user_home/.kube/config"
      chown "$SUDO_USER:$user_group" "$user_home/.kube/config"
      chmod 0600 "$user_home/.kube/config"
    fi
  fi
  log_ok "Kubeconfig installed at /root/.kube/config"
}

# ---------------------------------------------------------------------------
# Helm.
# ---------------------------------------------------------------------------

install_helm() {
  local current_version=""
  local archive
  local download_dir

  if command -v helm >/dev/null 2>&1; then
    current_version="$(helm version --short 2>/dev/null | sed 's/^v//; s/+.*//' || true)"
    if [ "$current_version" = "$HELM_VERSION" ]; then
      HELM_BIN="$(command -v helm)"
      log_info "Helm ${HELM_VERSION} is already installed"
      return 0
    fi
  fi

  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install Helm ${HELM_VERSION}"
    return 0
  fi

  log_info "Installing Helm ${HELM_VERSION}"
  archive="helm-v${HELM_VERSION}-linux-${ARCH}.tar.gz"
  download_dir="$(mktemp -d)"
  curl -fsSL --retry 3 "https://get.helm.sh/${archive}" -o "${download_dir}/${archive}"
  curl -fsSL --retry 3 "https://get.helm.sh/${archive}.sha256sum" -o "${download_dir}/${archive}.sha256sum"
  (
    cd "$download_dir"
    sha256sum -c "${archive}.sha256sum"
  )
  tar -xzf "${download_dir}/${archive}" -C "$download_dir"
  install -m 0755 "${download_dir}/linux-${ARCH}/helm" /usr/local/bin/helm
  rm -rf "$download_dir"
  HELM_BIN="/usr/local/bin/helm"
  export PATH="/usr/local/bin:${PATH}"
  hash -r 2>/dev/null || true
  log_ok "Helm $("$HELM_BIN" version --short) installed"
}

prepare_helm_environment() {
  export KUBECONFIG="$K3S_KUBECONFIG"
  export HELM_CACHE_HOME="${HELM_CACHE_HOME:-/var/cache/helm}"
  export HELM_CONFIG_HOME="${HELM_CONFIG_HOME:-${CONFIG_DIR}/helm}"
  export HELM_DATA_HOME="${HELM_DATA_HOME:-/var/lib/helm}"
  if (( ! DRY_RUN )); then
    mkdir -p "$HELM_CACHE_HOME" "$HELM_CONFIG_HOME" "$HELM_DATA_HOME"
  fi
}

prepare_helm_repos() {
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would add Longhorn, VictoriaMetrics (VictoriaMetrics and VictoriaLogs charts) and CloudNativePG Helm repositories"
    return 0
  fi
  log_info "Adding Helm repositories"
  if [ "$STORAGE_BACKEND" = "longhorn" ]; then
    "$HELM_BIN" repo add --force-update longhorn https://charts.longhorn.io >/dev/null
    "$HELM_BIN" repo update longhorn >/dev/null
  fi
  "$HELM_BIN" repo add --force-update victoria-metrics https://victoriametrics.github.io/helm-charts/ >/dev/null
  "$HELM_BIN" repo update victoria-metrics >/dev/null
  "$HELM_BIN" repo add --force-update cnpg https://cloudnative-pg.github.io/charts >/dev/null
  "$HELM_BIN" repo update cnpg >/dev/null
}

# ---------------------------------------------------------------------------
# Cilium.
# ---------------------------------------------------------------------------

write_cilium_values() {
  write_file "${CONFIG_DIR}/cilium-values.yaml" 0644 <<EOF
# ${MANAGED_BY} - manual edits will be overwritten.
ipam:
  mode: cluster-pool
  operator:
    clusterPoolIPv4PodCIDRList:
      - "${K3S_CLUSTER_CIDR}"
kubeProxyReplacement: "true"
k8sServiceHost: "${K3S_NODE_IP}"
k8sServicePort: 6443
bpf:
  masquerade: true
# k3s v1.36 uses the standard CNI paths. Override only for a custom runtime.
cni:
  confPath: "${CILIUM_CNI_CONF_PATH}"
  binPath: "${CILIUM_CNI_BIN_PATH}"
operator:
  replicas: 1
EOF
}

# not_ready_nodes [EXCEPT]: names of the nodes whose Ready condition is not
# True, one per line, leaving out EXCEPT. A node with no Ready condition at
# all counts as not ready.
not_ready_nodes() {
  k3s kubectl --request-timeout=15s get nodes -o jsonpath='{range .items[*]}{.metadata.name}{" "}{range .status.conditions[?(@.type=="Ready")]}{.status}{end}{"\n"}{end}' 2>/dev/null |
    awk -v skip="${1:-}" '$1 != skip && $2 != "True" { print $1 }'
}

# check_other_nodes_ready: Cilium and the Longhorn manager are DaemonSets,
# and the installer waits until every node runs them. Another node that is
# down would only surface as a rollout timeout many minutes later, so stop
# before touching anything. This node is left out: on a fresh install it
# stays NotReady until Cilium is installed.
check_other_nodes_ready() {
  local nodes
  nodes="$(not_ready_nodes "$K3S_NODE_NAME" | paste -sd ',' - | sed 's/,/, /g')" || true
  [ -z "$nodes" ] && return 0

  die "Node(s) not ready: ${nodes}. Cilium and the storage driver must run on every node, so the install cannot finish while one is down. Bring the node back, or remove it (Servers in the console, or: k3s kubectl delete node NAME), then run the installer again."
}

install_cilium() {
  write_cilium_values
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install Cilium ${CILIUM_VERSION} with kube-proxy replacement"
    return 0
  fi

  check_other_nodes_ready

  log_info "Installing Cilium ${CILIUM_VERSION} (kube-proxy replacement)"
  helm_install cilium oci://quay.io/cilium/charts/cilium \
    --version "$CILIUM_VERSION" \
    --namespace kube-system \
    --values "${CONFIG_DIR}/cilium-values.yaml" \
    --wait --timeout 15m

  if ! k3s kubectl -n kube-system rollout status daemonset/cilium --timeout=10m; then
    local stuck
    stuck="$(not_ready_nodes | paste -sd ',' - | sed 's/,/, /g')" || true
    die "Cilium did not become ready on every node within 10 minutes.${stuck:+ Node(s) not ready: ${stuck}.} Check: k3s kubectl -n kube-system get pods -l k8s-app=cilium -o wide"
  fi
  k3s kubectl -n kube-system rollout status deployment/cilium-operator --timeout=10m

  # Remove CNI files written by older versions of this installer. k3s 1.36
  # reads /etc/cni/net.d, not the old /var/lib/rancher/k3s/... paths.
  if [ "$CILIUM_CNI_CONF_PATH" != "/var/lib/rancher/k3s/agent/etc/cni/net.d" ]; then
    rm -f /var/lib/rancher/k3s/agent/etc/cni/net.d/*cilium* 2>/dev/null || true
  fi
  if [ "$CILIUM_CNI_BIN_PATH" != "/var/lib/rancher/k3s/data/cni" ]; then
    rm -f /var/lib/rancher/k3s/data/cni/cilium-cni 2>/dev/null || true
  fi

  if k3s kubectl -n kube-system get daemonset kube-proxy >/dev/null 2>&1; then
    log_warn "A kube-proxy DaemonSet is still present; deleting it because Cilium replaces kube-proxy."
    k3s kubectl -n kube-system delete daemonset kube-proxy --ignore-not-found
  fi

  if ! k3s kubectl wait --for=condition=Ready node --all --timeout=300s; then
    log_warn "Node did not become Ready after Cilium; restarting k3s once."
    systemctl restart k3s
    wait_for_api
    k3s kubectl wait --for=condition=Ready node --all --timeout=300s
  fi

  if ! k3s kubectl -n kube-system rollout status deployment/coredns --timeout=30s >/dev/null 2>&1; then
    log_warn "CoreDNS did not become ready after CNI initialization; restarting it."
    k3s kubectl -n kube-system rollout restart deployment/coredns >/dev/null
    k3s kubectl -n kube-system rollout status deployment/coredns --timeout=5m
  fi
  if ! ls "${CILIUM_CNI_CONF_PATH}"/*cilium* >/dev/null 2>&1; then
    log_warn "Cilium CNI configuration was not found under ${CILIUM_CNI_CONF_PATH}"
  fi
  log_ok "Cilium is ready"
}

# ---------------------------------------------------------------------------
# Storage: Longhorn (servers) or local-path (development), and the platform
# StorageClass.
# ---------------------------------------------------------------------------

ensure_namespace() {
  local namespace=$1
  if k3s kubectl get namespace "$namespace" >/dev/null 2>&1; then
    return 0
  fi
  k3s kubectl create namespace "$namespace"
}

write_longhorn_values() {
  write_file "${CONFIG_DIR}/longhorn-values.yaml" 0644 <<EOF
# ${MANAGED_BY} - manual edits will be overwritten.
# The platform StorageClass is written by the installer (install_storage),
# so the chart creates none.
persistence:
  createStorageClass: false
  defaultClass: false
# The console manages storage; Longhorn's own UI is not exposed.
longhornUI:
  replicas: 0
# One controller of each kind is enough for a small cluster; they are
# leader-elected and Kubernetes reschedules them.
longhornGlobalManager:
  replicas: 1
csi:
  attacherReplicaCount: 1
  provisionerReplicaCount: 1
  resizerReplicaCount: 1
  snapshotterReplicaCount: 1
defaultSettings:
  defaultDataPath: "${LONGHORN_DATA_DIR}"
  defaultReplicaCount: '{"v1":"${LONGHORN_REPLICAS}","v2":"${LONGHORN_REPLICAS}"}'
  # Volumes are thin. At the default 100% the registry and RustFS volumes
  # (50Gi each) do not fit an 80 GB disk with 25% kept free.
  storageOverProvisioningPercentage: 300
  # A drain moves the last healthy replica of a volume to another node before
  # the node goes, instead of refusing or losing it.
  nodeDrainPolicy: block-for-eviction-if-contains-last-replica
  upgradeChecker: false
EOF
}

# longhorn_nodes_ready: true when every Kubernetes node has a Longhorn node
# that reports Ready.
longhorn_nodes_ready() {
  local want have
  want="$(k3s kubectl get nodes --no-headers 2>/dev/null | wc -l)"
  have="$(k3s kubectl -n "$LONGHORN_NAMESPACE" get nodes.longhorn.io \
    -o jsonpath='{range .items[*]}{range .status.conditions[?(@.type=="Ready")]}{.status}{"\n"}{end}{end}' 2>/dev/null |
    grep -c '^True$' || true)"
  [ "$want" -gt 0 ] && [ "$have" -ge "$want" ]
}

install_longhorn() {
  [ "$STORAGE_BACKEND" = "longhorn" ] || return 0
  write_longhorn_values
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install Longhorn ${LONGHORN_CHART_VERSION} in namespace ${LONGHORN_NAMESPACE} (data in ${LONGHORN_DATA_DIR}, ${LONGHORN_REPLICAS} replica(s))"
    return 0
  fi

  log_info "Installing Longhorn ${LONGHORN_CHART_VERSION}"
  install -d -m 0755 "$LONGHORN_DATA_DIR"
  ensure_namespace "$LONGHORN_NAMESPACE"
  helm_install "$LONGHORN_RELEASE" longhorn/longhorn \
    --version "$LONGHORN_CHART_VERSION" \
    --namespace "$LONGHORN_NAMESPACE" \
    --values "${CONFIG_DIR}/longhorn-values.yaml" \
    --wait --timeout 15m

  k3s kubectl -n "$LONGHORN_NAMESPACE" rollout status daemonset/longhorn-manager --timeout=10m
  k3s kubectl -n "$LONGHORN_NAMESPACE" rollout status deployment/longhorn-driver-deployer --timeout=10m

  # The driver deployer creates the CSI plugin after it starts.
  local deadline=$((SECONDS + 600))
  until k3s kubectl get csidriver driver.longhorn.io >/dev/null 2>&1 &&
    k3s kubectl -n "$LONGHORN_NAMESPACE" get daemonset longhorn-csi-plugin >/dev/null 2>&1 &&
    longhorn_nodes_ready; do
    if (( SECONDS >= deadline )); then
      k3s kubectl -n "$LONGHORN_NAMESPACE" get pods -o wide || true
      k3s kubectl -n "$LONGHORN_NAMESPACE" get nodes.longhorn.io -o yaml 2>/dev/null | grep -A3 'type: Ready' || true
      die "Longhorn did not become ready within 10 minutes. Check: k3s kubectl -n ${LONGHORN_NAMESPACE} get pods"
    fi
    sleep 5
  done
  k3s kubectl -n "$LONGHORN_NAMESPACE" rollout status daemonset/longhorn-csi-plugin --timeout=10m
  log_ok "Longhorn is ready"
}

write_storage_class() {
  write_file "${CONFIG_DIR}/manifests/storage-class.yaml" 0644 <<EOF
# ${MANAGED_BY} - manual edits will be overwritten.
# The platform StorageClass: every platform volume (registry, RustFS) and the
# services' volumes when no storage profile is chosen.
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ${STORAGE_CLASS_NAME}
  labels:
    app.kubernetes.io/part-of: acceleratio
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: driver.longhorn.io
reclaimPolicy: Delete
allowVolumeExpansion: true
volumeBindingMode: Immediate
parameters:
  numberOfReplicas: "${LONGHORN_REPLICAS}"
  dataLocality: best-effort
  staleReplicaTimeout: "30"
  fsType: ext4
EOF
}

install_storage() {
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would make ${STORAGE_CLASS_NAME} (${STORAGE_BACKEND}) the default StorageClass"
    return 0
  fi

  if [ "$STORAGE_BACKEND" = "longhorn" ]; then
    write_storage_class
    # StorageClass parameters cannot change in place. Recreating the class
    # leaves existing volumes as they are; new ones use the new settings.
    if ! k3s kubectl apply -f "${CONFIG_DIR}/manifests/storage-class.yaml" >/dev/null 2>&1; then
      log_warn "Recreating StorageClass ${STORAGE_CLASS_NAME} with the new settings"
      k3s kubectl replace --force -f "${CONFIG_DIR}/manifests/storage-class.yaml" >/dev/null
    fi
  else
    # k3s writes local-path from its bundled manifest shortly after start.
    local deadline=$((SECONDS + 180))
    until k3s kubectl get storageclass "$STORAGE_CLASS_NAME" >/dev/null 2>&1; do
      (( SECONDS < deadline )) || die "StorageClass ${STORAGE_CLASS_NAME} did not appear. k3s creates it unless local-storage is disabled in /etc/rancher/k3s/config.yaml."
      sleep 2
    done
  fi

  ensure_default_storage_class
  log_ok "${STORAGE_CLASS_NAME} is the default StorageClass"
}

ensure_default_storage_class() {
  local provisioner expected default_value default_classes sc

  expected="driver.longhorn.io"
  [ "$STORAGE_BACKEND" = "local-path" ] && expected="rancher.io/local-path"
  provisioner="$(k3s kubectl get storageclass "$STORAGE_CLASS_NAME" \
    -o jsonpath='{.provisioner}' 2>/dev/null || true)"
  if [ "$provisioner" != "$expected" ]; then
    die "StorageClass ${STORAGE_CLASS_NAME} has unexpected provisioner '${provisioner}' (expected ${expected})"
  fi

  default_value="$(k3s kubectl get storageclass "$STORAGE_CLASS_NAME" \
    -o jsonpath='{.metadata.annotations.storageclass\.kubernetes\.io/is-default-class}' 2>/dev/null || true)"
  if [ "$default_value" != "true" ]; then
    log_warn "Marking ${STORAGE_CLASS_NAME} as the default StorageClass"
    k3s kubectl patch storageclass "$STORAGE_CLASS_NAME" --type merge \
      -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
  fi

  default_classes="$(k3s kubectl get storageclass -o jsonpath='{range .items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")]}{.metadata.name}{"\n"}{end}')"
  while IFS= read -r sc; do
    if [ -n "$sc" ] && [ "$sc" != "$STORAGE_CLASS_NAME" ]; then
      log_warn "Removing default annotation from StorageClass ${sc}"
      k3s kubectl patch storageclass "$sc" --type merge \
        -p '{"metadata":{"annotations":{"storageclass.kubernetes.io/is-default-class":"false"}}}'
    fi
  done <<< "$default_classes"
}

# ---------------------------------------------------------------------------
# RustFS: the S3 object store.
# ---------------------------------------------------------------------------

readonly RUSTFS_ADMIN_SECRET="rustfs-root"
readonly RUSTFS_UID=10001

rustfs_endpoint() {
  printf 'http://rustfs.%s.svc.cluster.local:9000' "$RUSTFS_NAMESPACE"
}

write_rustfs_manifest() {
  write_file "${CONFIG_DIR}/manifests/rustfs.yaml" 0644 <<EOF
# ${MANAGED_BY} - manual edits will be overwritten.
# Single-node, single-drive RustFS on a volume of the platform StorageClass.
# The admin keys live in Secret ${RUSTFS_ADMIN_SECRET}, created once.
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: rustfs-data
  namespace: ${RUSTFS_NAMESPACE}
  labels:
    app.kubernetes.io/name: rustfs
    app.kubernetes.io/part-of: acceleratio
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: ${STORAGE_CLASS_NAME}
  resources:
    requests:
      storage: ${RUSTFS_SIZE}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: rustfs
  namespace: ${RUSTFS_NAMESPACE}
  labels:
    app.kubernetes.io/name: rustfs
    app.kubernetes.io/part-of: acceleratio
spec:
  replicas: 1
  # One writer on a ReadWriteOnce volume.
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app.kubernetes.io/name: rustfs
  template:
    metadata:
      labels:
        app.kubernetes.io/name: rustfs
        app.kubernetes.io/part-of: acceleratio
    spec:
      automountServiceAccountToken: false
      initContainers:
        # The image runs as ${RUSTFS_UID}; a fresh volume belongs to root.
        - name: chown
          image: busybox:1.36
          imagePullPolicy: IfNotPresent
          command: ["chown", "${RUSTFS_UID}:${RUSTFS_UID}", "/data"]
          volumeMounts:
            - name: data
              mountPath: /data
      containers:
        - name: rustfs
          image: ${RUSTFS_IMAGE}
          imagePullPolicy: IfNotPresent
          env:
            - name: RUSTFS_VOLUMES
              value: /data
            - name: RUSTFS_ADDRESS
              value: ":9000"
            - name: RUSTFS_CONSOLE_ENABLE
              value: "false"
            # fdatasync before a write is acknowledged.
            - name: RUSTFS_DURABILITY_MODE
              value: strict
            - name: RUSTFS_ACCESS_KEY
              valueFrom:
                secretKeyRef:
                  name: ${RUSTFS_ADMIN_SECRET}
                  key: RUSTFS_ACCESS_KEY
            - name: RUSTFS_SECRET_KEY
              valueFrom:
                secretKeyRef:
                  name: ${RUSTFS_ADMIN_SECRET}
                  key: RUSTFS_SECRET_KEY
          ports:
            - name: s3
              containerPort: 9000
          readinessProbe:
            tcpSocket:
              port: s3
            periodSeconds: 5
          livenessProbe:
            tcpSocket:
              port: s3
            initialDelaySeconds: 20
            periodSeconds: 15
            failureThreshold: 6
          resources:
            requests:
              cpu: 100m
              memory: 128Mi
          volumeMounts:
            - name: data
              mountPath: /data
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: rustfs-data
---
apiVersion: v1
kind: Service
metadata:
  name: rustfs
  namespace: ${RUSTFS_NAMESPACE}
  labels:
    app.kubernetes.io/name: rustfs
spec:
  selector:
    app.kubernetes.io/name: rustfs
  ports:
    - name: s3
      port: 9000
      targetPort: s3
EOF
}

# ensure_rustfs_secret: random admin keys, generated once and kept across
# re-runs (a new key would lock the API out of the existing data).
ensure_rustfs_secret() {
  if k3s kubectl -n "$RUSTFS_NAMESPACE" get secret "$RUSTFS_ADMIN_SECRET" >/dev/null 2>&1; then
    return 0
  fi
  local access_key secret_key
  access_key="acc$(od -An -N9 -tx1 /dev/urandom | tr -d ' \n')"
  secret_key="$(od -An -N20 -tx1 /dev/urandom | tr -d ' \n')"
  k3s kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${RUSTFS_ADMIN_SECRET}
  namespace: ${RUSTFS_NAMESPACE}
  labels:
    app.kubernetes.io/part-of: acceleratio
type: Opaque
stringData:
  RUSTFS_ACCESS_KEY: "${access_key}"
  RUSTFS_SECRET_KEY: "${secret_key}"
EOF
}

# run_rc_job NAME SCRIPT: runs SCRIPT with the rc client in the RustFS
# namespace, with the alias "admin" set up, and waits for it. The admin keys
# come from the Secret as environment variables, never from the script text.
run_rc_job() {
  local name=$1 script=$2 phase="" deadline
  k3s kubectl -n "$RUSTFS_NAMESPACE" delete job "$name" --ignore-not-found --wait=true >/dev/null 2>&1 || true
  k3s kubectl apply -f - >/dev/null <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: ${name}
  namespace: ${RUSTFS_NAMESPACE}
  labels:
    app.kubernetes.io/part-of: acceleratio
spec:
  backoffLimit: 0
  activeDeadlineSeconds: 300
  template:
    spec:
      restartPolicy: Never
      automountServiceAccountToken: false
      containers:
        - name: rc
          image: ${RC_IMAGE}
          imagePullPolicy: IfNotPresent
          envFrom:
            - secretRef:
                name: ${RUSTFS_ADMIN_SECRET}
          command:
            - sh
            - -ec
            - |
              rc alias set admin $(rustfs_endpoint) "\$RUSTFS_ACCESS_KEY" "\$RUSTFS_SECRET_KEY" --bucket-lookup path >/dev/null
$(printf '%s\n' "$script" | sed 's/^/              /')
EOF
  deadline=$((SECONDS + 330))
  while (( SECONDS < deadline )); do
    phase="$(k3s kubectl -n "$RUSTFS_NAMESPACE" get job "$name" \
      -o jsonpath='{range .status.conditions[?(@.status=="True")]}{.type}{"\n"}{end}' 2>/dev/null || true)"
    case "$phase" in
      *Complete*) break ;;
      *Failed*) break ;;
    esac
    sleep 2
  done
  if [[ $phase != *Complete* ]]; then
    k3s kubectl -n "$RUSTFS_NAMESPACE" logs "job/${name}" 2>/dev/null | tail -n 20 || true
    k3s kubectl -n "$RUSTFS_NAMESPACE" describe "job/${name}" 2>/dev/null | tail -n 20 || true
    return 1
  fi
  k3s kubectl -n "$RUSTFS_NAMESPACE" logs "job/${name}" 2>/dev/null || true
  k3s kubectl -n "$RUSTFS_NAMESPACE" delete job "$name" --ignore-not-found >/dev/null 2>&1 || true
}

install_rustfs() {
  if (( DRY_RUN )); then
    write_rustfs_manifest
    log_info "DRY-RUN: would install RustFS (${RUSTFS_IMAGE%%@*}, ${RUSTFS_SIZE} volume) in namespace ${RUSTFS_NAMESPACE} and create bucket ${SITES_BUCKET}"
    return 0
  fi

  log_info "Installing RustFS ${RUSTFS_IMAGE%%@*}"
  ensure_namespace "$RUSTFS_NAMESPACE"
  ensure_rustfs_secret
  local before
  before="$(cat "${CONFIG_DIR}/manifests/rustfs.yaml" 2>/dev/null || true)"
  write_rustfs_manifest
  # A new RustFS image or setting gets the S3 smoke test, as charts do.
  if [ "$before" != "$(cat "${CONFIG_DIR}/manifests/rustfs.yaml")" ]; then
    SMOKE_NEEDED=1
  fi
  k3s kubectl apply -f "${CONFIG_DIR}/manifests/rustfs.yaml" >/dev/null
  if ! k3s kubectl -n "$RUSTFS_NAMESPACE" rollout status deployment/rustfs --timeout=10m; then
    k3s kubectl -n "$RUSTFS_NAMESPACE" describe pod -l app.kubernetes.io/name=rustfs | tail -n 30 || true
    k3s kubectl -n "$RUSTFS_NAMESPACE" logs deployment/rustfs --all-containers --tail=30 || true
    die "RustFS did not become ready."
  fi

  # The platform bucket for static site files; creating it again is a no-op.
  run_rc_job rustfs-setup "rc bucket create admin/${SITES_BUCKET} >/dev/null" ||
    die "Could not create the bucket ${SITES_BUCKET} in RustFS."

  local access_key secret_key
  access_key="$(k3s kubectl -n "$RUSTFS_NAMESPACE" get secret "$RUSTFS_ADMIN_SECRET" \
    -o jsonpath='{.data.RUSTFS_ACCESS_KEY}' | base64 -d)"
  secret_key="$(k3s kubectl -n "$RUSTFS_NAMESPACE" get secret "$RUSTFS_ADMIN_SECRET" \
    -o jsonpath='{.data.RUSTFS_SECRET_KEY}' | base64 -d)"
  write_file "${CONFIG_DIR}/rustfs-s3.env" 0600 <<EOF
# ${MANAGED_BY} - contains credentials, do not commit.
RUSTFS_S3_ENDPOINT=$(rustfs_endpoint)
RUSTFS_ACCESS_KEY=${access_key}
RUSTFS_SECRET_KEY=${secret_key}
EOF
  log_ok "RustFS is ready; admin keys saved to ${CONFIG_DIR}/rustfs-s3.env"
}

# ---------------------------------------------------------------------------
# Verification.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# VictoriaMetrics.
# ---------------------------------------------------------------------------

write_victoriametrics_values() {
  write_file "${CONFIG_DIR}/victoriametrics-values.yaml" 0644 <<EOF
# ${MANAGED_BY} - manual edits will be overwritten.
# Single-node VictoriaMetrics with the chart's built-in Kubernetes scrape
# config (kubelet and cAdvisor through the API server). The API reads it
# through the API server's service proxy for the Observability tab.
# The TSDB lives on hostPath, so metrics keep working while the storage layer
# is down.
server:
  fullnameOverride: "${VICTORIAMETRICS_RELEASE}"
  retentionPeriod: "${VICTORIAMETRICS_RETENTION}"
  scrape:
    enabled: true
  persistentVolume:
    enabled: false
  extraArgs:
    storageDataPath: /vm-data
  extraVolumes:
    - name: data
      hostPath:
        path: "${VICTORIAMETRICS_DATA_DIR}"
        type: DirectoryOrCreate
  extraVolumeMounts:
    - name: data
      mountPath: /vm-data
EOF
}

install_victoriametrics() {
  write_victoriametrics_values

  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install VictoriaMetrics ${VICTORIAMETRICS_CHART_VERSION} in namespace ${VICTORIAMETRICS_NAMESPACE}"
    return 0
  fi

  log_info "Installing VictoriaMetrics ${VICTORIAMETRICS_CHART_VERSION}"
  install -d -m 0755 "$VICTORIAMETRICS_DATA_DIR"
  ensure_namespace "$VICTORIAMETRICS_NAMESPACE"

  helm_install "$VICTORIAMETRICS_RELEASE" victoria-metrics/victoria-metrics-single \
    --version "$VICTORIAMETRICS_CHART_VERSION" \
    --namespace "$VICTORIAMETRICS_NAMESPACE" \
    --values "${CONFIG_DIR}/victoriametrics-values.yaml" \
    --wait --timeout 10m

  k3s kubectl -n "$VICTORIAMETRICS_NAMESPACE" rollout status \
    "statefulset/${VICTORIAMETRICS_RELEASE}" --timeout=5m
  log_ok "VictoriaMetrics is ready"
}

# ---------------------------------------------------------------------------
# CloudNativePG operator.
# ---------------------------------------------------------------------------
install_cnpg() {
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install CloudNativePG operator ${CNPG_CHART_VERSION} in namespace ${CNPG_NAMESPACE}"
    return 0
  fi

  log_info "Installing CloudNativePG operator ${CNPG_CHART_VERSION}"
  ensure_namespace "$CNPG_NAMESPACE"

  helm_install "$CNPG_RELEASE" cnpg/cloudnative-pg \
    --version "$CNPG_CHART_VERSION" \
    --namespace "$CNPG_NAMESPACE" \
    --wait --timeout 10m
  log_ok "CloudNativePG operator is ready"
}

# ---------------------------------------------------------------------------
# VictoriaLogs and Vector.
# ---------------------------------------------------------------------------

# Prints the values for the victoria-logs-single chart. scripts/cluster.sh
# extracts this function to install the same configuration locally, so it
# must only read the VICTORIALOGS_* variables and print to stdout.
#
# Vector runs as a DaemonSet and reads container logs only from project
# namespaces (labelled app.kubernetes.io/managed-by=acceleratio), never from
# the platform itself. It normalises every line to a few flat fields
# (namespace, pod, container, workload_id, level, stream) and detects the
# level once, at ingestion, so the console filters on an indexed field
# instead of matching text on every query. Resource limits keep both
# components small enough for a 4 GiB server.
victorialogs_values() {
  cat <<EOF
# ${MANAGED_BY:-Acceleratio} - manual edits will be overwritten.
# Single-node VictoriaLogs for the project Logs tab, fed by Vector. The API
# reads it through the API server's service proxy. Data lives on hostPath, so
# logs keep working while the storage layer is down.
server:
  fullnameOverride: "${VICTORIALOGS_RELEASE}"
  retentionPeriod: "${VICTORIALOGS_RETENTION}"
  retentionDiskSpaceUsage: "${VICTORIALOGS_MAX_DISK}"
  persistentVolume:
    enabled: false
  podSecurityContext:
    enabled: false
  resources:
    requests:
      cpu: 25m
      memory: 48Mi
    limits:
      memory: 256Mi
  extraArgs:
    storageDataPath: /vl-data
    search.maxConcurrentRequests: "4"
  extraVolumes:
    - name: data
      hostPath:
        path: "${VICTORIALOGS_DATA_DIR}"
        type: DirectoryOrCreate
  extraVolumeMounts:
    - name: data
      mountPath: /vl-data
vector:
  enabled: true
  resources:
    requests:
      cpu: 20m
      memory: 32Mi
    limits:
      cpu: 500m
      memory: 160Mi
  customConfig:
    sources:
      k8s:
        type: kubernetes_logs
        extra_namespace_label_selector: app.kubernetes.io/managed-by=acceleratio
        glob_minimum_cooldown_ms: 5000
        max_line_bytes: 65536
    transforms:
      parser:
        type: remap
        inputs: [k8s]
        drop_on_abort: true
        source: |
          k = object(.kubernetes) ?? {}
          # Second guard behind the namespace label selector: platform logs
          # never reach the store.
          if !starts_with(to_string(k.pod_namespace) ?? "", "project-") {
            abort
          }
          labels = object(k.pod_labels) ?? {}
          raw = to_string(.message) ?? ""
          head = truncate(raw, 512)

          level = null
          if starts_with(strip_whitespace(head), "{") {
            parsed = object(parse_json(raw) ?? null) ?? {}
            candidate = parsed.level || parsed.severity || parsed.lvl || parsed.levelname || parsed.log_level || parsed.loglevel
            if is_integer(candidate) {
              n = int!(candidate)
              level = if n >= 50 { "error" } else if n >= 40 { "warn" } else if n >= 30 { "info" } else { "debug" }
            } else if is_string(candidate) {
              level = string!(candidate)
            }
          }
          if level == null {
            kv = parse_regex(head, r'(?i)\b(?:level|lvl|severity)\s*[=:]\s*"?(?P<value>[a-z]+)') ?? {}
            level = kv.value
          }
          if level == null {
            glog = parse_regex(head, r'^(?P<value>[IWEF])\d{4} \d{2}:\d{2}:\d{2}') ?? {}
            level = glog.value
          }
          if level == null {
            level = if match(head, r'\b(FATAL|PANIC|CRITICAL|CRIT|EMERG|ALERT|ERROR|ERR)\b') || match(head, r'(?i)^\s*(error|fatal|panic)\b') || starts_with(head, "Traceback ") {
              "error"
            } else if match(head, r'\b(WARN|WARNING)\b') || match(head, r'(?i)^\s*warn(ing)?\b') {
              "warn"
            } else if match(head, r'\b(INFO|NOTICE)\b') {
              "info"
            } else if match(head, r'\b(DEBUG|TRACE)\b') {
              "debug"
            } else {
              null
            }
          }
          if level != null {
            l = downcase(to_string(level))
            level = if includes(["fatal", "panic", "critical", "crit", "emerg", "emergency", "alert", "error", "err", "severe", "e", "f"], l) {
              "error"
            } else if includes(["warn", "warning", "w"], l) {
              "warn"
            } else if includes(["info", "information", "informational", "notice", "i"], l) {
              "info"
            } else if includes(["debug", "trace", "verbose", "fine", "d", "t"], l) {
              "debug"
            } else {
              null
            }
          }

          . = {
            "timestamp": .timestamp,
            "message": raw,
            "stream": .stream,
            "namespace": k.pod_namespace,
            "pod": k.pod_name,
            "container": k.container_name,
            "workload_id": get(labels, ["acceleratio.io/workload-id"]) ?? null,
            "level": level
          }
          . = compact(.)
      throttle:
        type: throttle
        inputs: [parser]
        threshold: 2000
        window_secs: 1
        key_field: '{{ "{{ pod }}" }}'
    sinks:
      vlogs:
        inputs: [throttle]
        request:
          headers:
            VL-Time-Field: timestamp
            VL-Stream-Fields: namespace,pod,container
            VL-Msg-Field: message
EOF
}

write_victorialogs_values() {
  victorialogs_values | write_file "${CONFIG_DIR}/victorialogs-values.yaml" 0644
}

install_victorialogs() {
  write_victorialogs_values

  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install VictoriaLogs ${VICTORIALOGS_CHART_VERSION} and Vector in namespace ${VICTORIALOGS_NAMESPACE}"
    return 0
  fi

  log_info "Installing VictoriaLogs ${VICTORIALOGS_CHART_VERSION} with Vector"
  install -d -m 0755 "$VICTORIALOGS_DATA_DIR"
  ensure_namespace "$VICTORIALOGS_NAMESPACE"

  helm_install "$VICTORIALOGS_RELEASE" victoria-metrics/victoria-logs-single \
    --version "$VICTORIALOGS_CHART_VERSION" \
    --namespace "$VICTORIALOGS_NAMESPACE" \
    --values "${CONFIG_DIR}/victorialogs-values.yaml" \
    --wait --timeout 10m

  k3s kubectl -n "$VICTORIALOGS_NAMESPACE" rollout status \
    "statefulset/${VICTORIALOGS_RELEASE}" --timeout=5m
  k3s kubectl -n "$VICTORIALOGS_NAMESPACE" rollout status \
    "daemonset/${VICTORIALOGS_RELEASE}-vector" --timeout=5m
  log_ok "VictoriaLogs is ready"
}

verify_installation() {
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would verify the cluster and run a PVC and S3 smoke test"
    return 0
  fi

  log_info "Cluster nodes:"
  k3s kubectl get nodes -o wide
  log_info "StorageClasses:"
  k3s kubectl get storageclass
  if [ "$STORAGE_BACKEND" = "longhorn" ]; then
    log_info "Longhorn pods:"
    k3s kubectl -n "$LONGHORN_NAMESPACE" get pods -o wide
  fi
  log_info "RustFS pods:"
  k3s kubectl -n "$RUSTFS_NAMESPACE" get pods -o wide
  log_info "VictoriaMetrics pods:"
  k3s kubectl -n "$VICTORIAMETRICS_NAMESPACE" get pods -o wide
  log_info "VictoriaLogs pods:"
  k3s kubectl -n "$VICTORIALOGS_NAMESPACE" get pods -o wide
  log_info "CloudNativePG pods:"
  k3s kubectl -n "$CNPG_NAMESPACE" get pods -o wide
  log_info "Cilium status:"
  k3s kubectl -n kube-system get daemonset/cilium deployment/cilium-operator

  if (( SMOKE_NEEDED )); then
    smoke_test
    s3_smoke_test
  else
    log_info "k3s, Cilium and the storage are unchanged; skipping the storage and DNS smoke test"
  fi
  log_ok "Verification passed"
}

smoke_test() {
  local phase=""
  local deadline
  local logs

  log_info "Running storage and DNS smoke test"
  k3s kubectl delete namespace "$SMOKE_NAMESPACE" --ignore-not-found --wait=true --timeout=120s >/dev/null 2>&1 || true
  k3s kubectl create namespace "$SMOKE_NAMESPACE" >/dev/null

  k3s kubectl apply -f - >/dev/null <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: smoke
  namespace: ${SMOKE_NAMESPACE}
spec:
  accessModes:
    - ReadWriteOnce
  resources:
    requests:
      storage: 10Mi
---
apiVersion: v1
kind: Pod
metadata:
  name: smoke
  namespace: ${SMOKE_NAMESPACE}
spec:
  restartPolicy: Never
  containers:
    - name: smoke
      image: busybox:1.36
      imagePullPolicy: IfNotPresent
      command:
        - /bin/sh
        - -ec
      args:
        - |
          nslookup kubernetes.default.svc.cluster.local >/dev/null
          echo "hello-storage" > /data/probe.txt
          test "\$(cat /data/probe.txt)" = "hello-storage"
          cat /data/probe.txt
      volumeMounts:
        - name: data
          mountPath: /data
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: smoke
EOF

  deadline=$((SECONDS + 180))
  while (( SECONDS < deadline )); do
    phase="$(k3s kubectl -n "$SMOKE_NAMESPACE" get pvc smoke -o jsonpath='{.status.phase}' 2>/dev/null || true)"
    if [ "$phase" = "Bound" ]; then
      break
    fi
    sleep 2
  done
  if [ "$phase" != "Bound" ]; then
    k3s kubectl -n "$SMOKE_NAMESPACE" describe pvc smoke || true
    die "Smoke-test PVC did not bind to the default StorageClass."
  fi

  deadline=$((SECONDS + 240))
  while (( SECONDS < deadline )); do
    phase="$(k3s kubectl -n "$SMOKE_NAMESPACE" get pod smoke -o jsonpath='{.status.phase}' 2>/dev/null || true)"
    if [ "$phase" = "Succeeded" ]; then
      break
    fi
    if [ "$phase" = "Failed" ]; then
      k3s kubectl -n "$SMOKE_NAMESPACE" logs smoke || true
      die "Smoke-test pod failed."
    fi
    sleep 2
  done
  if [ "$phase" != "Succeeded" ]; then
    k3s kubectl -n "$SMOKE_NAMESPACE" describe pod smoke || true
    die "Smoke-test pod did not complete."
  fi

  logs="$(k3s kubectl -n "$SMOKE_NAMESPACE" logs smoke)"
  if [ "$logs" != "hello-storage" ]; then
    die "Smoke-test read back unexpected data: '${logs}'"
  fi
  log_ok "PVC bound, data written and DNS resolved"

  k3s kubectl delete namespace "$SMOKE_NAMESPACE" --wait=true --timeout=120s >/dev/null 2>&1 || \
    log_warn "Could not delete smoke-test namespace ${SMOKE_NAMESPACE}; remove it manually."
}

# s3_smoke_test: writes, reads and deletes an object in a temporary bucket.
s3_smoke_test() {
  local bucket out
  bucket="acceleratio-smoke-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')"
  log_info "Running the S3 smoke test"
  out="$(run_rc_job rustfs-smoke "rc bucket create admin/${bucket} >/dev/null
echo hello-s3 | rc pipe admin/${bucket}/probe.txt >/dev/null
test \"\$(rc cat admin/${bucket}/probe.txt)\" = hello-s3
rc bucket remove --force admin/${bucket} >/dev/null
echo S3_SMOKE_OK")" || die "S3 smoke test failed: RustFS did not store and return an object. ${out}"
  [[ $out == *S3_SMOKE_OK* ]] || die "S3 smoke test failed: ${out}"
  log_ok "S3 object written, read back and deleted"
}

# ---------------------------------------------------------------------------
# Acceleratio application: PostgreSQL, API and console in the cluster.
# ---------------------------------------------------------------------------

generate_secret() {
  od -An -N32 -tx1 /dev/urandom | tr -d ' \n'
}

read_env_value() {
  # read_env_value FILE KEY: prints the value of KEY=value, or nothing.
  [ -r "$1" ] || return 0
  sed -n "s/^${2}=//p" "$1" | head -n 1
}

resolve_acceleratio_urls() {
  local host="${ACCELERATIO_PUBLIC_HOST:-$K3S_PUBLIC_IP}"

  ACCELERATIO_CONSOLE_URL="${ACCELERATIO_CONSOLE_URL:-http://${host}:${ACCELERATIO_CONSOLE_NODE_PORT}}"
  ACCELERATIO_API_URL="${ACCELERATIO_API_URL:-http://${host}:${ACCELERATIO_API_NODE_PORT}}"
  ACCELERATIO_CONSOLE_URL="${ACCELERATIO_CONSOLE_URL%/}"
  ACCELERATIO_API_URL="${ACCELERATIO_API_URL%/}"

  # The API accepts credentialed requests from every address the console is
  # reachable on; the node address also works from the local network.
  ACCELERATIO_CORS_ORIGINS="$ACCELERATIO_CONSOLE_URL"
  if [ "$K3S_NODE_IP" != "$host" ]; then
    ACCELERATIO_CORS_ORIGINS="${ACCELERATIO_CORS_ORIGINS},http://${K3S_NODE_IP}:${ACCELERATIO_CONSOLE_NODE_PORT}"
  fi
}

prepare_acceleratio_secrets() {
  local env_file="${CONFIG_DIR}/acceleratio.env"

  POSTGRES_PASSWORD="$(read_env_value "$env_file" POSTGRES_PASSWORD)"
  BETTER_AUTH_SECRET="$(read_env_value "$env_file" BETTER_AUTH_SECRET)"
  INTEGRATIONS_ENCRYPTION_KEY="$(read_env_value "$env_file" INTEGRATIONS_ENCRYPTION_KEY)"
  [ -n "$POSTGRES_PASSWORD" ] || POSTGRES_PASSWORD="$(generate_secret)"
  [ -n "$BETTER_AUTH_SECRET" ] || BETTER_AUTH_SECRET="$(generate_secret)"
  # Encrypts integration credentials (GitHub App keys) in the database. Losing
  # it makes them unreadable, so it is kept across re-runs and updates.
  [ -n "$INTEGRATIONS_ENCRYPTION_KEY" ] || INTEGRATIONS_ENCRYPTION_KEY="$(generate_secret)"

  # Kept so a re-run reuses the same database password and session secret.
  write_file "$env_file" 0600 <<EOF
# ${MANAGED_BY} - contains secrets, do not commit.
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
BETTER_AUTH_SECRET=${BETTER_AUTH_SECRET}
INTEGRATIONS_ENCRYPTION_KEY=${INTEGRATIONS_ENCRYPTION_KEY}
EOF
}

write_acceleratio_manifest() {
  local ns="$ACCELERATIO_NAMESPACE"
  local db_url="postgresql://acceleratio:${POSTGRES_PASSWORD}@postgres.${ns}.svc.cluster.local:5432/acceleratio"
  local api_internal="http://api.${ns}.svc.cluster.local:8080"
  # Lets the console join more servers: it needs the address other nodes reach
  # the API server on and the cluster join token.
  local join_url="${K3S_JOIN_URL:-https://${K3S_NODE_IP}:6443}"
  local join_token=""
  if [ -r /var/lib/rancher/k3s/server/node-token ]; then
    join_token="$(tr -d '\n' </var/lib/rancher/k3s/server/node-token)"
  fi

  ACCELERATIO_MANIFEST="${CONFIG_DIR}/manifests/acceleratio.yaml"
  write_file "$ACCELERATIO_MANIFEST" 0600 <<EOF
# ${MANAGED_BY} - manual edits will be overwritten. Contains secrets.
apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
  labels:
    app.kubernetes.io/part-of: acceleratio
---
apiVersion: v1
kind: Secret
metadata:
  name: postgres
  namespace: ${ns}
type: Opaque
stringData:
  POSTGRES_USER: acceleratio
  POSTGRES_PASSWORD: "${POSTGRES_PASSWORD}"
  POSTGRES_DB: acceleratio
---
apiVersion: v1
kind: Secret
metadata:
  name: api
  namespace: ${ns}
type: Opaque
stringData:
  DATABASE_URL: "${db_url}"
  BETTER_AUTH_SECRET: "${BETTER_AUTH_SECRET}"
  INTEGRATIONS_ENCRYPTION_KEY: "${INTEGRATIONS_ENCRYPTION_KEY}"
  K3S_JOIN_URL: "${join_url}"
  K3S_JOIN_TOKEN: "${join_token}"
  K3S_CLUSTER_CIDR: "${K3S_CLUSTER_CIDR}"
  K3S_SERVICE_CIDR: "${K3S_SERVICE_CIDR}"
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: ${ns}
  labels:
    app.kubernetes.io/name: postgres
spec:
  clusterIP: None
  selector:
    app.kubernetes.io/name: postgres
  ports:
    - name: postgres
      port: 5432
      targetPort: postgres
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: ${ns}
  labels:
    app.kubernetes.io/name: postgres
    app.kubernetes.io/part-of: acceleratio
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: postgres
  template:
    metadata:
      labels:
        app.kubernetes.io/name: postgres
        app.kubernetes.io/part-of: acceleratio
    spec:
      containers:
        - name: postgres
          image: ${POSTGRES_IMAGE}
          imagePullPolicy: IfNotPresent
          ports:
            - name: postgres
              containerPort: 5432
          envFrom:
            - secretRef:
                name: postgres
          env:
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "acceleratio", "-d", "acceleratio"]
            periodSeconds: 5
            timeoutSeconds: 5
            failureThreshold: 12
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "acceleratio", "-d", "acceleratio"]
            initialDelaySeconds: 30
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 6
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
      volumes:
        # The database lives on the node's own disk: it must not depend on
        # the storage layer, which in turn is managed through this API.
        - name: data
          hostPath:
            path: ${POSTGRES_DATA_DIR}
            type: DirectoryOrCreate
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: api
  namespace: ${ns}
---
# The API creates namespaces, workloads, volumes and network policies for
# projects, so it needs cluster-wide permissions.
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: acceleratio-api
  labels:
    app.kubernetes.io/part-of: acceleratio
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: cluster-admin
subjects:
  - kind: ServiceAccount
    name: api
    namespace: ${ns}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: ${ns}
  labels:
    app.kubernetes.io/name: api
    app.kubernetes.io/part-of: acceleratio
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: api
  template:
    metadata:
      labels:
        app.kubernetes.io/name: api
        app.kubernetes.io/part-of: acceleratio
    spec:
      serviceAccountName: api
      initContainers:
        # Applies pending database migrations before the API starts. It keeps
        # retrying (via pod restarts) until PostgreSQL accepts connections.
        - name: migrate
          image: ${ACCELERATIO_API_IMAGE}
          imagePullPolicy: IfNotPresent
          command: ["node", "dist/vendor/db/migrate.js"]
          envFrom:
            - secretRef:
                name: api
      containers:
        - name: api
          image: ${ACCELERATIO_API_IMAGE}
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 8080
          envFrom:
            - secretRef:
                name: api
          env:
            - name: PORT
              value: "8080"
            - name: BETTER_AUTH_URL
              value: "${ACCELERATIO_API_URL}"
            - name: CORS_ORIGINS
              value: "${ACCELERATIO_CORS_ORIGINS}"
            - name: RUSTFS_NAMESPACE
              value: "${RUSTFS_NAMESPACE}"
            - name: RUSTFS_S3_ENDPOINT
              value: "$(rustfs_endpoint)"
            - name: RUSTFS_RC_IMAGE
              value: "${RC_IMAGE}"
            - name: SITES_BUCKET
              value: "${SITES_BUCKET}"
            - name: VICTORIAMETRICS_ADDRESS
              value: "${VICTORIAMETRICS_RELEASE}.${VICTORIAMETRICS_NAMESPACE}:8428"
            - name: VICTORIALOGS_ADDRESS
              value: "${VICTORIALOGS_RELEASE}.${VICTORIALOGS_NAMESPACE}:9428"
            - name: PLATFORM_STORAGE_CLASS_NAME
              value: "${STORAGE_CLASS_NAME}"
            # Where build Jobs push images; nodes pull them as ${REGISTRY_HOST}.
            - name: BUILD_REGISTRY
              value: "registry.${ns}.svc.cluster.local:5000"
            - name: REGISTRY_CLUSTER_IP
              value: "${REGISTRY_CLUSTER_IP}"
            # Shown in the DNS instructions when an admin sets a custom domain.
            - name: ACCELERATIO_PUBLIC_IP
              value: "${K3S_PUBLIC_IP}"
          readinessProbe:
            httpGet:
              path: /healthz
              port: http
            periodSeconds: 5
            failureThreshold: 12
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 20
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 6
          resources:
            requests:
              cpu: 100m
              memory: 256Mi
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: ${ns}
  labels:
    app.kubernetes.io/name: api
spec:
  type: NodePort
  selector:
    app.kubernetes.io/name: api
  ports:
    - name: http
      port: 8080
      targetPort: http
      nodePort: ${ACCELERATIO_API_NODE_PORT}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: console
  namespace: ${ns}
  labels:
    app.kubernetes.io/name: console
    app.kubernetes.io/part-of: acceleratio
spec:
  replicas: 1
  selector:
    matchLabels:
      app.kubernetes.io/name: console
  template:
    metadata:
      labels:
        app.kubernetes.io/name: console
        app.kubernetes.io/part-of: acceleratio
    spec:
      containers:
        - name: console
          image: ${ACCELERATIO_CONSOLE_IMAGE}
          imagePullPolicy: IfNotPresent
          ports:
            - name: http
              containerPort: 3000
          env:
            # The address the browser uses to reach the API.
            - name: API_URL
              value: "${ACCELERATIO_API_URL}"
            # Server-side calls stay inside the cluster.
            - name: API_INTERNAL_URL
              value: "${api_internal}"
          readinessProbe:
            httpGet:
              path: /healthz
              port: http
            periodSeconds: 5
            failureThreshold: 12
          livenessProbe:
            httpGet:
              path: /healthz
              port: http
            initialDelaySeconds: 20
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 6
          resources:
            requests:
              cpu: 50m
              memory: 128Mi
---
apiVersion: v1
kind: Service
metadata:
  name: console
  namespace: ${ns}
  labels:
    app.kubernetes.io/name: console
spec:
  type: NodePort
  selector:
    app.kubernetes.io/name: console
  ports:
    - name: http
      port: 3000
      targetPort: http
      nodePort: ${ACCELERATIO_CONSOLE_NODE_PORT}
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: registry
  namespace: ${ns}
data:
  # Retention keeps the build cache and the 20 newest images per service.
  config.json: |
    {
      "distSpecVersion": "1.1.1",
      "storage": {
        "rootDirectory": "/var/lib/registry",
        "dedupe": false,
        "gc": true,
        "gcDelay": "1h",
        "gcInterval": "24h",
        "retention": {
          "delay": "24h",
          "policies": [
            {
              "repositories": ["**"],
              "deleteReferrers": true,
              "deleteUntagged": true,
              "keepTags": [
                { "patterns": ["^buildcache\$"] },
                { "mostRecentlyPushedCount": 20 }
              ]
            }
          ]
        }
      },
      "http": { "address": "0.0.0.0", "port": "5000" },
      "log": { "level": "info" }
    }
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: registry
  namespace: ${ns}
  labels:
    app.kubernetes.io/name: registry
    app.kubernetes.io/part-of: acceleratio
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: ${STORAGE_CLASS_NAME}
  resources:
    requests:
      storage: ${REGISTRY_SIZE}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: registry
  namespace: ${ns}
  labels:
    app.kubernetes.io/name: registry
    app.kubernetes.io/part-of: acceleratio
spec:
  replicas: 1
  # One writer on a ReadWriteOnce volume.
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app.kubernetes.io/name: registry
  template:
    metadata:
      labels:
        app.kubernetes.io/name: registry
        app.kubernetes.io/part-of: acceleratio
    spec:
      containers:
        - name: registry
          image: ${REGISTRY_IMAGE}
          imagePullPolicy: IfNotPresent
          args: ["serve", "/etc/zot/config.json"]
          ports:
            - name: http
              containerPort: 5000
          readinessProbe:
            httpGet:
              path: /v2/
              port: http
            periodSeconds: 5
          livenessProbe:
            httpGet:
              path: /v2/
              port: http
            initialDelaySeconds: 20
            periodSeconds: 15
            timeoutSeconds: 5
            failureThreshold: 6
          resources:
            requests:
              cpu: 50m
              memory: 128Mi
          volumeMounts:
            - name: config
              mountPath: /etc/zot
            - name: data
              mountPath: /var/lib/registry
      volumes:
        - name: config
          configMap:
            name: registry
        - name: data
          persistentVolumeClaim:
            claimName: registry
---
# Not exposed outside the cluster and without auth: project pods cannot reach
# it (their CiliumNetworkPolicy), build pods may only push to it.
apiVersion: v1
kind: Service
metadata:
  name: registry
  namespace: ${ns}
  labels:
    app.kubernetes.io/name: registry
spec:
  clusterIP: ${REGISTRY_CLUSTER_IP}
  selector:
    app.kubernetes.io/name: registry
  ports:
    - name: http
      port: 5000
      targetPort: http
EOF
}

# ---------------------------------------------------------------------------
# Traefik (bundled with k3s): Let's Encrypt for custom domains.
# ---------------------------------------------------------------------------

# Traefik runs as this user and group in the k3s chart (podSecurityContext).
readonly TRAEFIK_UID=65532

validate_acme_email() {
  [ -n "$ACCELERATIO_ACME_EMAIL" ] || return 0
  if [[ ! $ACCELERATIO_ACME_EMAIL =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then
    die "ACCELERATIO_ACME_EMAIL is not a valid email address: ${ACCELERATIO_ACME_EMAIL}"
  fi
}

write_traefik_config() {
  local acme_email=""

  if [ -n "$ACCELERATIO_ACME_EMAIL" ]; then
    acme_email="
          email: \"${ACCELERATIO_ACME_EMAIL}\""
  fi

  TRAEFIK_CONFIG_MANIFEST="${CONFIG_DIR}/manifests/traefik-config.yaml"
  # k3s merges valuesContent into its bundled Traefik chart and redeploys it.
  # The API checks that this object exists before it applies a custom domain.
  write_file "$TRAEFIK_CONFIG_MANIFEST" 0644 <<EOF
# ${MANAGED_BY} - manual edits will be overwritten.
apiVersion: helm.cattle.io/v1
kind: HelmChartConfig
metadata:
  name: traefik
  namespace: kube-system
  labels:
    app.kubernetes.io/part-of: acceleratio
spec:
  valuesContent: |-
    # IngressRoutes for a custom domain request certificates from this
    # resolver with tls.certResolver: letsencrypt.
    certificatesResolvers:
      letsencrypt:
        acme:${acme_email}
          storage: /data/acme.json
          httpChallenge:
            entryPoint: web
    # The chart always mounts its own emptyDir volume; move it aside so /data
    # is the hostPath below and certificates survive pod restarts.
    persistence:
      path: /chart-data
    deployment:
      additionalVolumes:
        - name: acme
          hostPath:
            path: ${TRAEFIK_DATA_DIR}
            type: Directory
    additionalVolumeMounts:
      - name: acme
        mountPath: /data
EOF
}

configure_traefik() {
  local owner

  validate_acme_email
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would create ${TRAEFIK_DATA_DIR} and configure the Traefik letsencrypt certificate resolver"
    return 0
  fi

  log_info "Configuring Traefik for custom domains (Let's Encrypt)"
  install -d -m 0700 -o "$TRAEFIK_UID" -g "$TRAEFIK_UID" "$TRAEFIK_DATA_DIR"
  # install -d leaves an existing directory's owner and mode alone.
  chown "${TRAEFIK_UID}:${TRAEFIK_UID}" "$TRAEFIK_DATA_DIR"
  chmod 0700 "$TRAEFIK_DATA_DIR"

  owner="$(k3s kubectl -n kube-system get helmchartconfig traefik \
    -o jsonpath='{.metadata.labels.app\.kubernetes\.io/part-of}' 2>/dev/null || true)"
  if k3s kubectl -n kube-system get helmchartconfig traefik >/dev/null 2>&1 && [ "$owner" != "acceleratio" ]; then
    log_warn "Replacing the existing kube-system/traefik HelmChartConfig (a backup is in ${CONFIG_DIR}/manifests)."
    install -d -m 0755 "${CONFIG_DIR}/manifests"
    k3s kubectl -n kube-system get helmchartconfig traefik -o yaml \
      >"${CONFIG_DIR}/manifests/traefik-config.yaml.bak.$(date +%s)"
  fi

  write_traefik_config
  k3s kubectl apply -f "$TRAEFIK_CONFIG_MANIFEST"
  log_ok "Traefik certificate resolver letsencrypt configured (k3s redeploys Traefik in the background)"
}

wait_for_http() {
  # wait_for_http URL LABEL
  local deadline=$((SECONDS + 120))
  while (( SECONDS < deadline )); do
    if curl -fsS --max-time 5 -o /dev/null "$1" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  die "$2 did not answer at $1."
}

install_acceleratio() {
  local ns="$ACCELERATIO_NAMESPACE"

  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install PostgreSQL, the API and the console in namespace ${ns}"
    log_info "DRY-RUN: API image ${ACCELERATIO_API_IMAGE}, console image ${ACCELERATIO_CONSOLE_IMAGE}"
    return 0
  fi

  log_info "Installing Acceleratio (PostgreSQL, API, console) in namespace ${ns}"
  prepare_acceleratio_secrets
  write_acceleratio_manifest
  k3s kubectl apply -f "$ACCELERATIO_MANIFEST"

  log_info "Waiting for PostgreSQL"
  if ! k3s kubectl -n "$ns" rollout status statefulset/postgres --timeout=300s; then
    k3s kubectl -n "$ns" describe pod -l app.kubernetes.io/name=postgres || true
    die "PostgreSQL did not become ready."
  fi

  # The first start pulls two images and runs the database migrations.
  log_info "Waiting for the API (pulls the image and migrates the database)"
  if ! k3s kubectl -n "$ns" rollout status deployment/api --timeout=600s; then
    k3s kubectl -n "$ns" describe pod -l app.kubernetes.io/name=api || true
    k3s kubectl -n "$ns" logs deployment/api --all-containers --tail=50 || true
    die "The API did not become ready."
  fi

  log_info "Waiting for the image registry"
  if ! k3s kubectl -n "$ns" rollout status deployment/registry --timeout=300s; then
    k3s kubectl -n "$ns" describe pod -l app.kubernetes.io/name=registry || true
    die "The image registry did not become ready."
  fi
  # The address containerd pulls from, checked from the host network.
  wait_for_http "http://${REGISTRY_CLUSTER_IP}:5000/v2/" "The image registry"

  log_info "Waiting for the console"
  if ! k3s kubectl -n "$ns" rollout status deployment/console --timeout=600s; then
    k3s kubectl -n "$ns" describe pod -l app.kubernetes.io/name=console || true
    die "The console did not become ready."
  fi

  wait_for_http "http://127.0.0.1:${ACCELERATIO_API_NODE_PORT}/healthz" "The API"
  wait_for_http "http://127.0.0.1:${ACCELERATIO_CONSOLE_NODE_PORT}/healthz" "The console"
  log_ok "Acceleratio is running in namespace ${ns}"
}

# save_config: keeps a copy of --config as ${CONFIG_DIR}/install.env, so an
# update started from the console (which passes that file to update.sh) runs
# with the settings of this installation.
save_config() {
  local target="${CONFIG_DIR}/install.env"
  if [ -z "$CONFIG_FILE" ]; then
    return 0
  fi
  if [ -e "$target" ] && [ "$CONFIG_FILE" -ef "$target" ]; then
    return 0
  fi
  write_file "$target" 0600 <"$CONFIG_FILE"
  log_info "Saved the installation settings to ${target}"
}

# ---------------------------------------------------------------------------
# Summary.
# ---------------------------------------------------------------------------

print_summary() {
  local k3s_version="unknown"
  local default_sc=""
  local rule bullet
  local bold="" dim="" cyan=""

  if (( DRY_RUN )); then
    k3s_version="${K3S_VERSION:-latest from ${K3S_CHANNEL}}"
    default_sc="$STORAGE_CLASS_NAME"
  else
    if command -v k3s >/dev/null 2>&1; then
      k3s_version="$(k3s --version 2>/dev/null | awk 'NR == 1 {print $3}')"
    fi
    if command -v k3s >/dev/null 2>&1 && [ -f "$K3S_KUBECONFIG" ]; then
      default_sc="$(k3s kubectl get storageclass -o jsonpath='{range .items[?(@.metadata.annotations.storageclass\.kubernetes\.io/is-default-class=="true")]}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)"
    fi
  fi

  if [ -n "$C_RESET" ]; then
    bold=$'\033[1m'
    dim=$'\033[2m'
    cyan=$'\033[36m'
  fi
  case "${LC_ALL:-${LC_CTYPE:-${LANG:-}}}" in
    *UTF-8*|*utf-8*|*UTF8*|*utf8*)
      rule="$(printf '%.0s─' {1..64})"
      bullet="●"
      ;;
    *)
      rule="$(printf '%.0s-' {1..64})"
      bullet="*"
      ;;
  esac

  printf '\n%s\n' "${C_GREEN}${rule}${C_RESET}"
  if (( DRY_RUN )); then
    printf '  %s%s Acceleratio dry run complete%s\n' "$bold" "$bullet" "$C_RESET"
    printf '  %sNo changes were made.%s\n' "$dim" "$C_RESET"
  else
    printf '  %s%s Acceleratio is ready%s\n' "${bold}${C_GREEN}" "$bullet" "$C_RESET"
    printf '  %sYour private cloud is up and running.%s\n' "$dim" "$C_RESET"
  fi
  printf '%s\n\n' "${C_GREEN}${rule}${C_RESET}"

  printf '  %sOpen the dashboard%s\n' "$bold" "$C_RESET"
  printf '    Console       %s%s%s\n' "${bold}${cyan}" "$ACCELERATIO_CONSOLE_URL" "$C_RESET"
  printf '    First account %s%s/auth/installation%s\n' "$cyan" "$ACCELERATIO_CONSOLE_URL" "$C_RESET"
  printf '    API           %s%s%s\n' "$cyan" "$ACCELERATIO_API_URL" "$C_RESET"
  printf '\n'
  printf '  %sCreate the first account to get started.%s\n' "$dim" "$C_RESET"
  printf '  %sOpen TCP ports %s and %s in your firewall if the page does not load.%s\n' \
    "$dim" "$ACCELERATIO_CONSOLE_NODE_PORT" "$ACCELERATIO_API_NODE_PORT" "$C_RESET"
  printf '\n'

  printf '  %sWhat was installed%s\n' "$bold" "$C_RESET"
  printf '    Namespace     %s (PostgreSQL, API, console)\n' "$ACCELERATIO_NAMESPACE"
  printf '    k3s           %s (embedded etcd)\n' "$k3s_version"
  printf '    Cilium        %s (CNI, kube-proxy replacement)\n' "$CILIUM_VERSION"
  if [ "$STORAGE_BACKEND" = "longhorn" ]; then
    printf '    Longhorn      %s (namespace %s)\n' "$LONGHORN_CHART_VERSION" "$LONGHORN_NAMESPACE"
  fi
  printf '    RustFS        %s (namespace %s)\n' "${RUSTFS_IMAGE%%@*}" "$RUSTFS_NAMESPACE"
  printf '    VictoriaMetrics %s (namespace %s)\n' "$VICTORIAMETRICS_CHART_VERSION" "$VICTORIAMETRICS_NAMESPACE"
  printf '    VictoriaLogs  %s with Vector (namespace %s)\n' "$VICTORIALOGS_CHART_VERSION" "$VICTORIALOGS_NAMESPACE"
  printf '    CloudNativePG %s (namespace %s)\n' "$CNPG_CHART_VERSION" "$CNPG_NAMESPACE"
  printf '    Storage       %s (default StorageClass)\n' "${default_sc:-$STORAGE_CLASS_NAME}"
  printf '\n'

  printf '  %sFiles on this server%s\n' "$bold" "$C_RESET"
  printf '    Kubeconfig    /root/.kube/config\n'
  printf '    Remote access %s/kubeconfig.yaml\n' "$CONFIG_DIR"
  printf '    Secrets       %s/acceleratio.env\n' "$CONFIG_DIR"
  printf '    S3 keys       %s/rustfs-s3.env\n' "$CONFIG_DIR"
  printf '    Database      %s\n' "$POSTGRES_DATA_DIR"
  printf '    Install log   %s\n' "$LOG_FILE"
  printf '\n'

  printf '  %sUseful commands%s\n' "$bold" "$C_RESET"
  printf '    k3s kubectl -n %s get pods\n' "$ACCELERATIO_NAMESPACE"
  printf '    k3s kubectl -n %s logs deploy/api\n' "$ACCELERATIO_NAMESPACE"
  printf '    scp root@%s:%s/kubeconfig.yaml .\n' "$K3S_PUBLIC_IP" "$CONFIG_DIR"
  printf '\n'
  printf '  %sUpdate:%s sudo ./deploy/update.sh    %sRepair:%s sudo ./deploy/install.sh    %sRemove:%s sudo ./deploy/uninstall.sh\n' \
    "$dim" "$C_RESET" "$dim" "$C_RESET" "$dim" "$C_RESET"
  printf '%s\n' "${C_GREEN}${rule}${C_RESET}"
}

# ---------------------------------------------------------------------------
# Main.
# ---------------------------------------------------------------------------

main() {
  parse_args "$@"
  load_config
  resolve_storage
  check_root
  setup_logging
  log_info "Acceleratio installer ${SCRIPT_NAME} starting"
  validate_cni_paths
  preflight
  resolve_registry_cluster_ip

  if (( RESET )); then
    reset_installation
  fi

  step "Installing host packages" install_packages
  configure_ufw
  step "Installing k3s" install_k3s
  prepull_images
  step "Installing the kubeconfig" configure_kubeconfig
  step "Installing Helm" install_helm
  prepare_helm_environment
  step "Updating Helm repositories" prepare_helm_repos
  step "Installing Cilium (networking)" install_cilium
  resolve_acceleratio_urls
  step "Configuring Traefik" configure_traefik
  # Independent of each other once the network is up: metrics and logs keep
  # their data on hostPath, not on the storage layer.
  report_step "Installing storage, metrics, logs and the PostgreSQL operator"
  run_parallel \
    "storage:install_longhorn install_storage install_rustfs verify_installation" \
    "metrics:install_victoriametrics" \
    "logs:install_victorialogs" \
    "cnpg:install_cnpg"
  step "Starting PostgreSQL, the API and the console" install_acceleratio
  save_config
  print_summary
}

main "$@"
