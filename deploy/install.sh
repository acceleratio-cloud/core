#!/usr/bin/env bash
#
# Acceleratio VPS installer.
#
# Installs a single-node k3s cluster with embedded etcd, Cilium as the CNI
# (replacing both flannel and kube-proxy), SeaweedFS and the SeaweedFS CSI
# driver. The CSI driver creates the default StorageClass `seaweedfs-storage`.
#
# The Acceleratio application is intentionally not installed yet.
#
# Usage: sudo ./deploy/install.sh [--dry-run] [--config FILE] [--reset] [--yes]
#
set -Eeuo pipefail

SCRIPT_NAME="$(basename "${BASH_SOURCE[0]:-$0}")"
readonly SCRIPT_NAME
readonly MANAGED_BY="Acceleratio deploy/install.sh"

# ---------------------------------------------------------------------------
# Defaults (override with environment variables or --config FILE).
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

SEAWEEDFS_CHART_VERSION="${SEAWEEDFS_CHART_VERSION:-4.51.0}"
SEAWEEDFS_CSI_CHART_VERSION="${SEAWEEDFS_CSI_CHART_VERSION:-0.2.43}"
SEAWEEDFS_NAMESPACE="${SEAWEEDFS_NAMESPACE:-seaweedfs}"
SEAWEEDFS_RELEASE="${SEAWEEDFS_RELEASE:-seaweedfs}"
SEAWEEDFS_CSI_RELEASE="${SEAWEEDFS_CSI_RELEASE:-seaweedfs-csi}"
SEAWEEDFS_DATA_DIR="${SEAWEEDFS_DATA_DIR:-/var/lib/seaweedfs}"
SEAWEEDFS_S3_ENABLED="${SEAWEEDFS_S3_ENABLED:-true}"
STORAGE_CLASS_NAME="${STORAGE_CLASS_NAME:-seaweedfs-storage}"

CONFIG_DIR="${CONFIG_DIR:-/etc/acceleratio}"
LOG_DIR="${LOG_DIR:-/var/log/acceleratio}"
ALLOW_SWAP="${ALLOW_SWAP:-0}"

# Runtime state, not configurable.
DRY_RUN=0
RESET=0
ASSUME_YES=0
CONFIG_FILE=""
K3S_CONFIG_CHANGED=0
SW_FULLNAME=""
CSI_FULLNAME=""
HELM_BIN=""
LOG_FILE=""
SMOKE_NAMESPACE="acceleratio-smoke"

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
Acceleratio VPS installer

Installs:
  - k3s with embedded etcd (single node, server + worker)
  - Cilium as CNI with kube-proxy replacement
  - SeaweedFS (master, volume, filer, S3)
  - SeaweedFS CSI driver and the configured default StorageClass
    (default seaweedfs-storage)

The Acceleratio application is not installed yet.

Usage:
  sudo ./deploy/install.sh [options]

Options:
  --dry-run          Check prerequisites and print planned actions only.
  --config FILE      Load variables from FILE (shell syntax).
  --reset            Remove an existing k3s/SeaweedFS installation first.
                     Destructive: deletes etcd, Cilium networking and
                     SeaweedFS data. Requires --yes when stdin is not a TTY.
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
  SEAWEEDFS_CHART_VERSION     default 4.51.0
  SEAWEEDFS_CSI_CHART_VERSION default 0.2.43
  SEAWEEDFS_NAMESPACE         default seaweedfs
  SEAWEEDFS_RELEASE           default seaweedfs
  SEAWEEDFS_CSI_RELEASE       default seaweedfs-csi
  SEAWEEDFS_DATA_DIR          default /var/lib/seaweedfs
  SEAWEEDFS_S3_ENABLED        default true
  STORAGE_CLASS_NAME          default seaweedfs-storage
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
    log_warn "Only ${mem_gb} GiB RAM. 4 GiB or more is recommended for k3s + Cilium + SeaweedFS."
  else
    log_info "Memory: ${mem_gb} GiB"
  fi
}

check_disk() {
  local check_path avail_kb avail_gb
  check_path="$SEAWEEDFS_DATA_DIR"
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

check_fuse() {
  if [ ! -e /dev/fuse ]; then
    if (( DRY_RUN )); then
      log_warn "DRY-RUN: /dev/fuse is missing; the real install would fail."
      return 0
    fi
    if command -v modprobe >/dev/null 2>&1; then
      modprobe fuse >/dev/null 2>&1 || true
    fi
  fi
  if [ ! -e /dev/fuse ]; then
    die "/dev/fuse is missing. The SeaweedFS CSI driver requires FUSE. Some VPS/OpenVZ hosts do not expose it."
  fi
  log_info "FUSE: available"
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
      die "Existing k3s uses sqlite. k3s cannot switch to etcd in place. Use a fresh VPS or run with --reset (destructive)."
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
    "https://seaweedfs.github.io/seaweedfs/helm/index.yaml" \
    "https://seaweedfs.github.io/seaweedfs-csi-driver/helm/index.yaml"; do
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

check_warnings() {
  if systemctl is-active --quiet docker 2>/dev/null; then
    log_warn "Docker is active. It can coexist with k3s/Cilium, but its iptables rules are not managed by this installer."
  fi
  if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep "Status: active" >/dev/null 2>&1; then
    log_warn "UFW is active. Open 6443/tcp, 80/tcp, 443/tcp and 8472/udp between cluster nodes if needed."
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
  check_fuse
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

reset_installation() {
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would remove the existing k3s/Cilium/SeaweedFS installation"
    return 0
  fi
  if (( ! ASSUME_YES )); then
    if [ ! -t 0 ]; then
      die "--reset requires --yes when stdin is not a terminal."
    fi
    printf 'This deletes k3s, etcd, Cilium and SeaweedFS data. Type "reset" to continue: '
    read -r answer
    if [ "$answer" != "reset" ]; then
      die "Reset aborted."
    fi
  fi

  case "$SEAWEEDFS_DATA_DIR" in
    ""|"/"|"/var"|"/var/lib"|"/etc")
      die "Refusing to remove unsafe data directory: '${SEAWEEDFS_DATA_DIR}'"
      ;;
  esac

  log_warn "Removing existing installation"
  local helm_cmd=""
  helm_cmd="$(command -v helm 2>/dev/null || true)"
  if [ -n "$helm_cmd" ] && [ -f "$K3S_KUBECONFIG" ]; then
    export KUBECONFIG="$K3S_KUBECONFIG"
    "$helm_cmd" uninstall "$SEAWEEDFS_CSI_RELEASE" -n "$SEAWEEDFS_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    "$helm_cmd" uninstall "$SEAWEEDFS_RELEASE" -n "$SEAWEEDFS_NAMESPACE" --ignore-not-found >/dev/null 2>&1 || true
    "$helm_cmd" uninstall cilium -n kube-system --ignore-not-found >/dev/null 2>&1 || true
  fi

  detach_cilium_bpf

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
  rm -rf "$SEAWEEDFS_DATA_DIR"
  rm -rf "$CONFIG_DIR"
  rm -rf /etc/rancher/k3s
  rm -rf /var/lib/rancher/k3s
  rm -rf /var/run/cilium /var/lib/cilium 2>/dev/null || true
  log_ok "Existing installation removed"
}

# ---------------------------------------------------------------------------
# Host packages.
# ---------------------------------------------------------------------------

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
    log_info "DRY-RUN: would install curl, ca-certificates, tar, gzip, fuse3, iptables, iproute2, conntrack, socat, kmod, procps"
    return 0
  fi
  log_info "Installing host packages"
  export DEBIAN_FRONTEND=noninteractive
  wait_for_apt_lock
  apt-get -o DPkg::Lock::Timeout=600 update -qq
  apt-get -o DPkg::Lock::Timeout=600 install -y -qq --no-install-recommends \
    curl ca-certificates tar gzip fuse3 iptables iproute2 conntrack socat kmod procps util-linux
  modprobe fuse >/dev/null 2>&1 || true

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
    echo "disable:"
    echo "  - local-storage"
    if [ -n "$K3S_ETCD_SNAPSHOT_CRON" ]; then
      echo "etcd-snapshot-schedule-cron: \"${K3S_ETCD_SNAPSHOT_CRON}\""
    else
      echo "etcd-disable-snapshots: true"
    fi
  } >"$destination"
}

install_k3s() {
  local installed_version=""
  local install_needed=1
  local config_tmp
  local install_script

  config_tmp="$(mktemp)"
  build_k3s_config "$config_tmp"

  if (( DRY_RUN )); then
    log_info "DRY-RUN: k3s config:"
    sed 's/^/    /' "$config_tmp"
    rm -f "$config_tmp"
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

  if [ -x /usr/local/bin/k3s ]; then
    installed_version="$(/usr/local/bin/k3s --version 2>/dev/null | awk 'NR == 1 {print $3}')"
    if [ -n "$K3S_VERSION" ] && [ "$installed_version" = "$K3S_VERSION" ]; then
      install_needed=0
    elif [ -z "$K3S_VERSION" ]; then
      install_needed=0
    fi
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
    log_info "DRY-RUN: would add SeaweedFS Helm repositories"
    return 0
  fi
  log_info "Adding Helm repositories"
  "$HELM_BIN" repo add --force-update seaweedfs https://seaweedfs.github.io/seaweedfs/helm >/dev/null
  "$HELM_BIN" repo add --force-update seaweedfs-csi-driver https://seaweedfs.github.io/seaweedfs-csi-driver/helm >/dev/null
  "$HELM_BIN" repo update seaweedfs >/dev/null
  "$HELM_BIN" repo update seaweedfs-csi-driver >/dev/null
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

install_cilium() {
  write_cilium_values
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install Cilium ${CILIUM_VERSION} with kube-proxy replacement"
    return 0
  fi

  log_info "Installing Cilium ${CILIUM_VERSION} (kube-proxy replacement)"
  "$HELM_BIN" upgrade --install cilium oci://quay.io/cilium/charts/cilium \
    --version "$CILIUM_VERSION" \
    --namespace kube-system \
    --values "${CONFIG_DIR}/cilium-values.yaml" \
    --wait --timeout 15m

  k3s kubectl -n kube-system rollout status daemonset/cilium --timeout=10m
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
# SeaweedFS.
# ---------------------------------------------------------------------------

compute_seaweedfs_fullname() {
  case "$SEAWEEDFS_RELEASE" in
    *seaweedfs*)
      SW_FULLNAME="$SEAWEEDFS_RELEASE"
      ;;
    *)
      SW_FULLNAME="${SEAWEEDFS_RELEASE}-seaweedfs"
      ;;
  esac
}

write_seaweedfs_values() {
  local s3_enabled="false"
  local s3_auth="false"
  if [ "$SEAWEEDFS_S3_ENABLED" = "true" ]; then
    s3_enabled="true"
    s3_auth="true"
  fi

  write_file "${CONFIG_DIR}/seaweedfs-values.yaml" 0644 <<EOF
# ${MANAGED_BY} - manual edits will be overwritten.
# SeaweedFS keeps its own state on hostPath: the CSI driver cannot be used
# before it exists.
master:
  replicas: 1
  data:
    type: hostPath
    hostPathPrefix: "${SEAWEEDFS_DATA_DIR}"
  logs:
    type: hostPath
    hostPathPrefix: "${SEAWEEDFS_DATA_DIR}"
volume:
  replicas: 1
  dataDirs:
    - name: data1
      type: hostPath
      hostPathPrefix: "${SEAWEEDFS_DATA_DIR}"
      maxVolumes: 0
  logs:
    type: hostPath
    hostPathPrefix: "${SEAWEEDFS_DATA_DIR}"
filer:
  replicas: 1
  data:
    type: hostPath
    hostPathPrefix: "${SEAWEEDFS_DATA_DIR}"
  logs:
    type: hostPath
    hostPathPrefix: "${SEAWEEDFS_DATA_DIR}"
  s3:
    enabled: ${s3_enabled}
    enableAuth: ${s3_auth}
    # The chart leaves httpsPort as a truthy "0" and then renders an invalid
    # service port. An explicit integer 0 makes the chart omit the TLS port.
    httpsPort: 0
EOF
}

ensure_namespace() {
  local namespace=$1
  if k3s kubectl get namespace "$namespace" >/dev/null 2>&1; then
    return 0
  fi
  k3s kubectl create namespace "$namespace"
}

install_seaweedfs() {
  compute_seaweedfs_fullname
  write_seaweedfs_values

  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install SeaweedFS ${SEAWEEDFS_CHART_VERSION} in namespace ${SEAWEEDFS_NAMESPACE}"
    return 0
  fi

  log_info "Installing SeaweedFS ${SEAWEEDFS_CHART_VERSION}"
  install -d -m 0755 "$SEAWEEDFS_DATA_DIR"
  ensure_namespace "$SEAWEEDFS_NAMESPACE"

  "$HELM_BIN" upgrade --install "$SEAWEEDFS_RELEASE" seaweedfs/seaweedfs \
    --version "$SEAWEEDFS_CHART_VERSION" \
    --namespace "$SEAWEEDFS_NAMESPACE" \
    --values "${CONFIG_DIR}/seaweedfs-values.yaml" \
    --wait --timeout 20m

  local component
  for component in master volume filer; do
    k3s kubectl -n "$SEAWEEDFS_NAMESPACE" rollout status \
      "statefulset/${SW_FULLNAME}-${component}" --timeout=10m
  done

  if [ "$SEAWEEDFS_S3_ENABLED" = "true" ]; then
    save_seaweedfs_s3_credentials
  fi

  log_ok "SeaweedFS is ready"
}

save_seaweedfs_s3_credentials() {
  local secret_name="${SW_FULLNAME}-s3-secret"
  local access_key
  local secret_key
  local endpoint
  local deadline=$((SECONDS + 120))

  while (( SECONDS < deadline )); do
    if k3s kubectl -n "$SEAWEEDFS_NAMESPACE" get secret "$secret_name" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done

  access_key="$(k3s kubectl -n "$SEAWEEDFS_NAMESPACE" get secret "$secret_name" \
    -o jsonpath='{.data.admin_access_key_id}' 2>/dev/null | base64 -d 2>/dev/null || true)"
  secret_key="$(k3s kubectl -n "$SEAWEEDFS_NAMESPACE" get secret "$secret_name" \
    -o jsonpath='{.data.admin_secret_access_key}' 2>/dev/null | base64 -d 2>/dev/null || true)"
  if [ -z "$access_key" ] || [ -z "$secret_key" ]; then
    log_warn "Cannot read the SeaweedFS S3 credentials from secret ${secret_name}."
    return 0
  fi

  endpoint="http://${SW_FULLNAME}-s3.${SEAWEEDFS_NAMESPACE}.svc.cluster.local:8333"
  write_file "${CONFIG_DIR}/seaweedfs-s3.env" 0600 <<EOF
# ${MANAGED_BY} - contains credentials, do not commit.
SEAWEEDFS_S3_ENDPOINT=${endpoint}
SEAWEEDFS_S3_ACCESS_KEY=${access_key}
SEAWEEDFS_S3_SECRET_KEY=${secret_key}
EOF
  log_ok "SeaweedFS S3 credentials saved to ${CONFIG_DIR}/seaweedfs-s3.env"
}

# ---------------------------------------------------------------------------
# SeaweedFS CSI and the default StorageClass.
# ---------------------------------------------------------------------------

write_csi_values() {
  write_file "${CONFIG_DIR}/seaweedfs-csi-values.yaml" 0644 <<EOF
# ${MANAGED_BY} - manual edits will be overwritten.
seaweedfsFiler: "${SW_FULLNAME}-filer.${SEAWEEDFS_NAMESPACE}.svc.cluster.local:8888"
storageClassName: "${STORAGE_CLASS_NAME}"
storageClassVolumeBindingMode: Immediate
isDefaultStorageClass: true
EOF
}

compute_csi_fullname() {
  # The CSI chart names resources after the release, not after the chart.
  CSI_FULLNAME="${SEAWEEDFS_CSI_RELEASE:0:52}"
  CSI_FULLNAME="${CSI_FULLNAME%-}"
}

install_csi() {
  compute_seaweedfs_fullname
  compute_csi_fullname
  write_csi_values

  if (( DRY_RUN )); then
    log_info "DRY-RUN: would install SeaweedFS CSI ${SEAWEEDFS_CSI_CHART_VERSION} and default StorageClass ${STORAGE_CLASS_NAME}"
    return 0
  fi

  log_info "Installing SeaweedFS CSI ${SEAWEEDFS_CSI_CHART_VERSION}"
  "$HELM_BIN" upgrade --install "$SEAWEEDFS_CSI_RELEASE" seaweedfs-csi-driver/seaweedfs-csi-driver \
    --version "$SEAWEEDFS_CSI_CHART_VERSION" \
    --namespace "$SEAWEEDFS_NAMESPACE" \
    --values "${CONFIG_DIR}/seaweedfs-csi-values.yaml" \
    --wait --timeout 10m

  k3s kubectl -n "$SEAWEEDFS_NAMESPACE" rollout status \
    "deployment/${CSI_FULLNAME}-controller" --timeout=10m
  k3s kubectl -n "$SEAWEEDFS_NAMESPACE" rollout status \
    "daemonset/${CSI_FULLNAME}-node" --timeout=10m
  # The mount DaemonSet uses OnDelete, so rollout status is not supported.
  # The chart labels the pod after the release, not with a fixed name.
  k3s kubectl -n "$SEAWEEDFS_NAMESPACE" wait --for=condition=Ready \
    pod -l "app=${CSI_FULLNAME}-mount" --timeout=10m

  ensure_default_storage_class
  log_ok "SeaweedFS CSI is ready; ${STORAGE_CLASS_NAME} is the default StorageClass"
}

ensure_default_storage_class() {
  local provisioner
  local default_value
  local default_classes
  local sc

  provisioner="$(k3s kubectl get storageclass "$STORAGE_CLASS_NAME" \
    -o jsonpath='{.provisioner}' 2>/dev/null || true)"
  if [ "$provisioner" != "seaweedfs-csi-driver" ]; then
    die "StorageClass ${STORAGE_CLASS_NAME} has unexpected provisioner '${provisioner}'"
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
# Verification.
# ---------------------------------------------------------------------------

verify_installation() {
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would verify the cluster and run a PVC smoke test"
    return 0
  fi

  log_info "Cluster nodes:"
  k3s kubectl get nodes -o wide
  log_info "StorageClasses:"
  k3s kubectl get storageclass
  log_info "SeaweedFS pods:"
  k3s kubectl -n "$SEAWEEDFS_NAMESPACE" get pods -o wide
  log_info "Cilium status:"
  k3s kubectl -n kube-system get daemonset/cilium deployment/cilium-operator

  smoke_test
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
          echo "hello-seaweedfs" > /data/probe.txt
          test "\$(cat /data/probe.txt)" = "hello-seaweedfs"
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
  if [ "$logs" != "hello-seaweedfs" ]; then
    die "Smoke-test read back unexpected data: '${logs}'"
  fi
  log_ok "PVC bound, data written and DNS resolved"

  k3s kubectl delete namespace "$SMOKE_NAMESPACE" --wait=true --timeout=120s >/dev/null 2>&1 || \
    log_warn "Could not delete smoke-test namespace ${SMOKE_NAMESPACE}; remove it manually."
}

# ---------------------------------------------------------------------------
# Summary.
# ---------------------------------------------------------------------------

print_summary() {
  local k3s_version="unknown"
  local default_sc=""
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

  if (( DRY_RUN )); then
    printf '\n%s\n' "${C_GREEN}Acceleratio VPS dry run complete${C_RESET}"
  else
    printf '\n%s\n' "${C_GREEN}Acceleratio VPS installation complete${C_RESET}"
  fi
  printf '%s\n' "------------------------------------------------------------"
  printf '  k3s:              %s (embedded etcd)\n' "$k3s_version"
  printf '  Cilium:           %s (CNI, kube-proxy replacement)\n' "$CILIUM_VERSION"
  printf '  SeaweedFS:        %s (namespace %s)\n' "$SEAWEEDFS_CHART_VERSION" "$SEAWEEDFS_NAMESPACE"
  printf '  SeaweedFS CSI:    %s\n' "$SEAWEEDFS_CSI_CHART_VERSION"
  printf '  Default SC:       %s\n' "${default_sc:-$STORAGE_CLASS_NAME}"
  printf '  Data directory:   %s\n' "$SEAWEEDFS_DATA_DIR"
  printf '  Kubeconfig:       /root/.kube/config\n'
  printf '  External config:  %s/kubeconfig.yaml\n' "$CONFIG_DIR"
  if [ "$SEAWEEDFS_S3_ENABLED" = "true" ]; then
    printf '  S3 credentials:   %s/seaweedfs-s3.env\n' "$CONFIG_DIR"
  fi
  printf '  Log:              %s\n' "$LOG_FILE"
  printf '  Application:      not installed (out of scope for this version)\n'
  printf '%s\n' "------------------------------------------------------------"
  printf '  export KUBECONFIG=/etc/rancher/k3s/k3s.yaml\n'
  printf '  k3s kubectl get nodes\n'
  printf '  scp root@%s:%s/kubeconfig.yaml .\n' "$K3S_PUBLIC_IP" "$CONFIG_DIR"
  printf '\n'
  if (( DRY_RUN )); then
    printf '%s\n' "Dry run complete: no changes were made."
  else
    printf 'Uninstall: sudo ./deploy/uninstall.sh\n'
    printf 'Re-run:    sudo ./deploy/install.sh\n'
  fi
}

# ---------------------------------------------------------------------------
# Main.
# ---------------------------------------------------------------------------

main() {
  parse_args "$@"
  load_config
  check_root
  setup_logging
  log_info "Acceleratio installer ${SCRIPT_NAME} starting"
  validate_cni_paths
  preflight

  if (( RESET )); then
    reset_installation
  fi

  install_packages
  install_k3s
  configure_kubeconfig
  install_helm
  prepare_helm_environment
  prepare_helm_repos
  install_cilium
  install_seaweedfs
  install_csi
  verify_installation
  print_summary
}

main "$@"
