#!/usr/bin/env bash
#
# Acceleratio uninstaller.
#
# Removes the Helm releases, Cilium networking, k3s, Longhorn volumes, RustFS,
# VictoriaMetrics and VictoriaLogs data that scripts/install.sh created. This is
# destructive.
#
# Usage: sudo ./scripts/uninstall.sh [--dry-run] [--yes]
#
set -Eeuo pipefail

LONGHORN_NAMESPACE="${LONGHORN_NAMESPACE:-longhorn-system}"
LONGHORN_RELEASE="${LONGHORN_RELEASE:-longhorn}"
LONGHORN_DATA_DIR="${LONGHORN_DATA_DIR:-/var/lib/longhorn}"
RUSTFS_NAMESPACE="${RUSTFS_NAMESPACE:-rustfs}"
VICTORIAMETRICS_NAMESPACE="${VICTORIAMETRICS_NAMESPACE:-victoria-metrics}"
VICTORIAMETRICS_RELEASE="${VICTORIAMETRICS_RELEASE:-victoria-metrics}"
VICTORIAMETRICS_DATA_DIR="${VICTORIAMETRICS_DATA_DIR:-/var/lib/victoria-metrics}"
VICTORIALOGS_NAMESPACE="${VICTORIALOGS_NAMESPACE:-victoria-logs}"
VICTORIALOGS_RELEASE="${VICTORIALOGS_RELEASE:-victoria-logs}"
VICTORIALOGS_DATA_DIR="${VICTORIALOGS_DATA_DIR:-/var/lib/victoria-logs}"
# Vector's file checkpoints (hostPath set by the victoria-logs-single chart).
VECTOR_DATA_DIR="/var/lib/vector"
ACCELERATIO_NAMESPACE="${ACCELERATIO_NAMESPACE:-acceleratio}"
ACCELERATIO_DATA_DIR="${ACCELERATIO_DATA_DIR:-/var/lib/acceleratio}"
POSTGRES_DATA_DIR="${POSTGRES_DATA_DIR:-${ACCELERATIO_DATA_DIR}/postgres}"
K3S_KUBECONFIG="${K3S_KUBECONFIG:-/etc/rancher/k3s/k3s.yaml}"
CILIUM_CNI_CONF_PATH="${CILIUM_CNI_CONF_PATH:-/etc/cni/net.d}"
CILIUM_CNI_BIN_PATH="${CILIUM_CNI_BIN_PATH:-/opt/cni/bin}"
CONFIG_DIR="${CONFIG_DIR:-/etc/acceleratio}"

DRY_RUN=0
ASSUME_YES=0

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

die() {
  printf '%s[%s] ERROR:%s %s\n' "$C_RED" "$(date +%H:%M:%S)" "$C_RESET" "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Acceleratio uninstaller

Removes:
  - the Acceleratio namespace (PostgreSQL, API, console) and its database files
  - project namespaces, RustFS and the Longhorn Helm release with every volume
  - Cilium Helm release and its CNI files/interfaces
  - k3s and its embedded etcd
  - Longhorn data (/var/lib/longhorn), iSCSI sessions, PostgreSQL data,
    /etc/acceleratio and the UFW rules the installer added

CILIUM_CNI_CONF_PATH and CILIUM_CNI_BIN_PATH are respected if the installer
used custom CNI paths. Kubeconfigs in /root/.kube and user home directories
are kept.

Usage:
  sudo ./scripts/uninstall.sh [options]

Options:
  --dry-run   Print planned actions only.
  --yes, -y   Do not ask for confirmation (required for non-interactive use).
  --help, -h  Show this help.

One-liner:
  curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/scripts/uninstall.sh | sudo bash -s -- --yes
EOF
}

parse_args() {
  while (($# > 0)); do
    case "$1" in
      --dry-run)
        DRY_RUN=1
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

run() {
  if (( DRY_RUN )); then
    log_info "DRY-RUN: would run: $*"
    return 0
  fi
  log_info "RUN: $*"
  "$@"
}

check_root() {
  if [ "$(id -u)" -ne 0 ]; then
    die "This uninstaller must run as root. Re-run with: sudo bash $0"
  fi
}

confirm() {
  if (( ASSUME_YES )) || (( DRY_RUN )); then
    return 0
  fi
  if [ ! -t 0 ]; then
    die "--yes is required when stdin is not a terminal."
  fi
  printf 'This deletes k3s, etcd, Cilium, every volume (Longhorn, RustFS) and database data. Type "uninstall" to continue: '
  read -r answer
  if [ "$answer" != "uninstall" ]; then
    die "Uninstall aborted."
  fi
}

uninstall_helm_releases() {
  local helm_cmd=""
  helm_cmd="$(command -v helm 2>/dev/null || true)"
  if [ -z "$helm_cmd" ] || [ ! -f "$K3S_KUBECONFIG" ]; then
    log_warn "Helm or the k3s kubeconfig is missing; skipping Helm uninstalls."
    return 0
  fi
  export KUBECONFIG="$K3S_KUBECONFIG"

  if command -v k3s >/dev/null 2>&1; then
    run k3s kubectl delete namespace "$ACCELERATIO_NAMESPACE" --ignore-not-found --wait=true --timeout=180s || true
    run k3s kubectl delete clusterrolebinding acceleratio-api --ignore-not-found || true
    # Pods that use volumes go before Longhorn, so it can detach them.
    run k3s kubectl delete namespace -l app.kubernetes.io/managed-by=acceleratio --wait=true --timeout=180s || true
    run k3s kubectl delete namespace "$RUSTFS_NAMESPACE" --ignore-not-found --wait=true --timeout=180s || true
    # Longhorn refuses to uninstall until this flag is set.
    if k3s kubectl -n "$LONGHORN_NAMESPACE" get settings.longhorn.io deleting-confirmation-flag >/dev/null 2>&1; then
      run k3s kubectl -n "$LONGHORN_NAMESPACE" patch settings.longhorn.io deleting-confirmation-flag \
        --type merge -p '{"value":"true"}' || true
      run "$helm_cmd" uninstall "$LONGHORN_RELEASE" -n "$LONGHORN_NAMESPACE" --ignore-not-found --wait --timeout 10m ||
        log_warn "Longhorn did not uninstall cleanly; removing k3s clears what is left."
    fi
  fi

  run "$helm_cmd" uninstall "$VICTORIALOGS_RELEASE" -n "$VICTORIALOGS_NAMESPACE" --ignore-not-found
  run "$helm_cmd" uninstall "$VICTORIAMETRICS_RELEASE" -n "$VICTORIAMETRICS_NAMESPACE" --ignore-not-found
  run "$helm_cmd" uninstall cilium -n kube-system --ignore-not-found

  if [ -f "$K3S_KUBECONFIG" ] && command -v k3s >/dev/null 2>&1; then
    run k3s kubectl delete namespace "$LONGHORN_NAMESPACE" --ignore-not-found --wait=true --timeout=180s || true
    run k3s kubectl delete namespace "$VICTORIAMETRICS_NAMESPACE" --ignore-not-found --wait=true --timeout=180s || true
    run k3s kubectl delete namespace "$VICTORIALOGS_NAMESPACE" --ignore-not-found --wait=true --timeout=180s || true
  fi
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
    run tc qdisc del dev "$dev" clsact || true
    run tc qdisc del dev "$dev" ingress || true
  done < <(ip -o link show 2>/dev/null | awk -F': ' '{print $2}' | cut -d@ -f1)
}

unmount_cilium_cgroup() {
  local path
  for path in /var/run/cilium/cgroupv2 /run/cilium/cgroupv2; do
    if grep -qs " ${path} " /proc/mounts; then
      run umount -l "$path" || true
    fi
  done
}

remove_cilium() {
  run rm -f "${CILIUM_CNI_CONF_PATH%/}"/*cilium*
  run rm -f "${CILIUM_CNI_BIN_PATH%/}/cilium-cni"
  run rm -f /var/lib/rancher/k3s/agent/etc/cni/net.d/*cilium*
  run rm -f /var/lib/rancher/k3s/data/cni/cilium-cni

  if command -v ip >/dev/null 2>&1; then
    run ip link delete cilium_host || true
    run ip link delete cilium_net || true
    run ip link delete cilium_vxlan || true
  fi
  if command -v iptables-save >/dev/null 2>&1 && command -v iptables-restore >/dev/null 2>&1; then
    if (( ! DRY_RUN )); then
      iptables-save 2>/dev/null | grep -iv cilium | iptables-restore 2>/dev/null || true
    fi
  fi
  if command -v ip6tables-save >/dev/null 2>&1 && command -v ip6tables-restore >/dev/null 2>&1; then
    if (( ! DRY_RUN )); then
      ip6tables-save 2>/dev/null | grep -iv cilium | ip6tables-restore 2>/dev/null || true
    fi
  fi
}

# The Longhorn blacklist install.sh added between these markers.
remove_multipath() {
  local conf=/etc/multipath.conf
  [ -f "$conf" ] && grep -qxF "# BEGIN acceleratio longhorn" "$conf" || return 0
  run sed -i '/^# BEGIN acceleratio longhorn$/,/^# END acceleratio longhorn$/d' "$conf"
  if systemctl is-active --quiet multipathd 2>/dev/null; then
    run systemctl restart multipathd || true
  fi
}

# Longhorn volumes are iSCSI sessions on the host; removing k3s does not end
# them.
logout_iscsi() {
  command -v iscsiadm >/dev/null 2>&1 || return 0
  run iscsiadm -m node --logoutall=all || true
}

remove_k3s() {
  if [ -x /usr/local/bin/k3s-uninstall.sh ]; then
    run /usr/local/bin/k3s-uninstall.sh
  else
    log_warn "k3s-uninstall.sh not found; removing k3s files and directories only."
    if command -v systemctl >/dev/null 2>&1; then
      run systemctl disable --now k3s || true
    fi
    run rm -f /usr/local/bin/k3s /usr/local/bin/k3s-killall.sh /usr/local/bin/k3s-uninstall.sh
    run rm -f /etc/systemd/system/k3s.service /etc/systemd/system/k3s.service.env
    if command -v systemctl >/dev/null 2>&1; then
      run systemctl daemon-reload || true
    fi
  fi
}

validate_data_dir() {
  local dir
  for dir in "$LONGHORN_DATA_DIR" "$VICTORIAMETRICS_DATA_DIR" "$VICTORIALOGS_DATA_DIR" "$POSTGRES_DATA_DIR"; do
    case "$dir" in
      ""|"/"|"/var"|"/var/lib"|"/etc")
        die "Refusing to remove unsafe data directory: '${dir}'"
        ;;
    esac
  done
}

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

remove_data() {
  run rm -rf "$LONGHORN_DATA_DIR"
  run rm -f /etc/modules-load.d/acceleratio.conf
  run rm -rf "$VICTORIAMETRICS_DATA_DIR"
  run rm -rf "$VICTORIALOGS_DATA_DIR"
  run rm -rf "$VECTOR_DATA_DIR"
  run rm -rf "$POSTGRES_DATA_DIR"
  run rm -rf "$CONFIG_DIR"
  run rm -rf /etc/rancher/k3s
  run rm -rf /var/lib/rancher/k3s
  unmount_cilium_cgroup
  if ! run rm -rf /var/run/cilium /var/lib/cilium; then
    log_warn "Could not fully remove Cilium runtime directories; check /var/run/cilium."
  fi
}

# Deletes the UFW rules install.sh tagged with this comment, highest number
# first so the remaining numbers stay valid.
remove_ufw_rules() {
  command -v ufw >/dev/null 2>&1 || return 0
  local number
  for number in $(ufw status numbered 2>/dev/null | sed -n 's/^\[ *\([0-9]*\)\].*# acceleratio-cluster *$/\1/p' | sort -rn); do
    run ufw --force delete "$number"
  done
}

print_summary() {
  if (( DRY_RUN )); then
    printf '\n%s\n' "${C_GREEN}Acceleratio uninstall dry run complete${C_RESET}"
    printf 'Would remove: k3s, etcd, Cilium, Acceleratio, Longhorn, RustFS, VictoriaMetrics, VictoriaLogs, %s, %s and %s\n' "$LONGHORN_DATA_DIR" "$VICTORIAMETRICS_DATA_DIR" "$VICTORIALOGS_DATA_DIR"
    printf 'Would keep: /root/.kube/config and user kubeconfigs\n'
    printf 'Dry run complete: no changes were made.\n'
  else
    printf '\n%s\n' "${C_GREEN}Acceleratio uninstall complete${C_RESET}"
    printf 'Kept: /root/.kube/config and user kubeconfigs\n'
    printf 'Removed: k3s, etcd, Cilium, Acceleratio, Longhorn, RustFS, VictoriaMetrics, VictoriaLogs, %s, %s and %s\n' "$LONGHORN_DATA_DIR" "$VICTORIAMETRICS_DATA_DIR" "$VICTORIALOGS_DATA_DIR"
    printf 'Reinstall: sudo ./scripts/install.sh\n'
  fi
}

main() {
  parse_args "$@"
  check_root
  validate_data_dir
  validate_cni_paths
  confirm
  log_warn "Removing Acceleratio installation"
  uninstall_helm_releases
  detach_cilium_bpf
  remove_cilium
  remove_k3s
  logout_iscsi
  remove_multipath
  remove_data
  remove_ufw_rules
  print_summary
}

main "$@"
