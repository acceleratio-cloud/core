# VPS installer

`deploy/install.sh` provisions a single-node Kubernetes cluster on a fresh
Ubuntu or Debian VPS and prepares it for Acceleratio:

- k3s `v1.36.5+k3s1` with embedded etcd
- Cilium `1.20.4` as the CNI, replacing flannel and kube-proxy
- Helm `3.18.0`
- SeaweedFS `4.51.0` (master, volume, filer and S3)
- SeaweedFS CSI `0.2.43` with the default StorageClass `seaweedfs-storage`

The Acceleratio application is not installed yet. The script is structured so
an application role can be added later without changing the cluster bootstrap.

## Tested

Verified on Ubuntu 24.04.5 (4 vCPU, 8 GiB RAM), Ubuntu 22.04.5 (6 vCPU,
11 GiB RAM, kernel 5.15) and Debian 12 (6 vCPU, 11 GiB RAM), with and without
Docker. The test matrix covered a fresh install, the stdin/one-line path
(`bash -s --`), an idempotent re-run, a reboot, an external kubeconfig, a
PVC/DNS smoke test, S3 authentication, an etcd snapshot, live uninstall and
reinstall, `--reset --yes`, `--help`, `--config`, a custom
namespace/StorageClass/`CONFIG_DIR`/`LOG_DIR` with S3 disabled, and the
sqlite, swap and port-conflict preflight refusals.

## Requirements

- Ubuntu 22.04/24.04 or Debian 12, amd64 or arm64
- root access (the script uses `sudo`)
- 2 vCPU, 4 GiB RAM and 20 GiB free disk recommended
  (the script refuses less than 2 GiB RAM and 10 GiB disk)
- Linux kernel 5.10 or newer
- `/dev/fuse` available on the host
- outbound HTTPS to `get.k3s.io`, `get.helm.sh`, `quay.io`, GitHub Pages and
  Docker Hub (the smoke test pulls `busybox:1.36`)
- ports `6443/tcp`, `80/tcp`, `443/tcp` free; `8472/udp` between nodes if the
  cluster is expanded later
- swap disabled (or `ALLOW_SWAP=1` if you accept the kubelet risk)

OpenVZ/LXC VPS instances often do not expose `/dev/fuse`; the installer stops
before making changes if FUSE is unavailable.

## Quick start

On the VPS, with root:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-dev/core/main/deploy/install.sh | sudo bash
```

Flags go after `bash -s --`, so the same one-liner works without a checkout:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-dev/core/main/deploy/install.sh | sudo bash -s -- --dry-run
curl -fsSL https://raw.githubusercontent.com/acceleratio-dev/core/main/deploy/install.sh | sudo bash -s -- --config /root/install.env
curl -fsSL https://raw.githubusercontent.com/acceleratio-dev/core/main/deploy/install.sh | sudo bash -s -- --reset --yes
curl -fsSL https://raw.githubusercontent.com/acceleratio-dev/core/main/deploy/install.sh | sudo bash -s -- --help
```

Or from a checkout:

```bash
sudo ./deploy/install.sh
```

Useful flags:

```bash
sudo ./deploy/install.sh --dry-run                 # preflight and planned actions only
sudo ./deploy/install.sh --config ./install.env    # override versions and paths
sudo ./deploy/install.sh --reset --yes             # destructive clean reinstall
```

Logs are written to `/var/log/acceleratio/install-<timestamp>.log`; the latest
log is also linked as `/var/log/acceleratio/install.log`.

## What the script does

1. **Preflight** — OS, architecture, kernel, memory, disk, swap, FUSE, ports,
   DNS/HTTPS and any existing k3s datastore.
2. **Host packages** — `curl`, `fuse3`, `iptables`, `conntrack`, `socat`, etc.
   and `net.ipv4.ip_forward=1`. Waits for a cloud-init or unattended-upgrades
   apt/dpkg lock before installing.
3. **k3s** — writes `/etc/rancher/k3s/config.yaml` and installs k3s with
   `cluster-init: true`, flannel disabled, network policy disabled and
   kube-proxy disabled.
4. **Helm** — installs the pinned Helm binary.
5. **Cilium** — installs Cilium with `kubeProxyReplacement: true` and the
   CNI paths used by k3s 1.36 (`/etc/cni/net.d` and `/opt/cni/bin`), then waits
   for the node and CoreDNS.
6. **SeaweedFS** — installs master, volume, filer and the in-cluster S3
   endpoint. SeaweedFS state lives on hostPath under `/var/lib/seaweedfs`.
7. **Storage** — installs the SeaweedFS CSI driver, creates the configured
   StorageClass (default `seaweedfs-storage`), marks it default and removes
   the default annotation from any other StorageClass.
8. **Verification** — checks nodes, Cilium, SeaweedFS and runs a PVC + DNS
   smoke test that writes and reads a file through the default StorageClass.

The installer is idempotent: a second run updates configuration and Helm
releases instead of recreating the cluster.

## Configuration

Every variable can be set in the environment or in a file passed to
`--config`. The file is shell syntax and is sourced by the installer.

| Variable | Default | Purpose |
|---|---|---|
| `K3S_VERSION` | `v1.36.5+k3s1` | empty means latest from `K3S_CHANNEL` |
| `K3S_CHANNEL` | `stable` | used only when `K3S_VERSION` is empty |
| `K3S_NODE_NAME` | short hostname | node name |
| `K3S_NODE_IP` | primary interface IPv4 | must exist on a real interface |
| `K3S_PUBLIC_IP` | auto-detected | TLS SAN and external kubeconfig |
| `K3S_CLUSTER_CIDR` | `10.42.0.0/16` | must match Cilium IPAM |
| `K3S_SERVICE_CIDR` | `10.43.0.0/16` | Kubernetes service CIDR |
| `K3S_ETCD_SNAPSHOT_CRON` | `0 3 * * *` | empty disables etcd snapshots |
| `CILIUM_VERSION` | `1.20.4` | Cilium chart version |
| `CILIUM_CNI_CONF_PATH` | `/etc/cni/net.d` | CNI config directory used by the container runtime |
| `CILIUM_CNI_BIN_PATH` | `/opt/cni/bin` | CNI plugin directory used by the container runtime |
| `HELM_VERSION` | `3.18.0` | Helm binary version |
| `SEAWEEDFS_CHART_VERSION` | `4.51.0` | SeaweedFS chart version |
| `SEAWEEDFS_CSI_CHART_VERSION` | `0.2.43` | SeaweedFS CSI chart version |
| `SEAWEEDFS_NAMESPACE` | `seaweedfs` | SeaweedFS namespace |
| `SEAWEEDFS_RELEASE` | `seaweedfs` | Helm release name |
| `SEAWEEDFS_CSI_RELEASE` | `seaweedfs-csi` | CSI Helm release name |
| `SEAWEEDFS_DATA_DIR` | `/var/lib/seaweedfs` | hostPath for SeaweedFS state |
| `SEAWEEDFS_S3_ENABLED` | `true` | in-cluster S3 on the filer |
| `STORAGE_CLASS_NAME` | `seaweedfs-storage` | default StorageClass name |
| `CONFIG_DIR` | `/etc/acceleratio` | generated values, kubeconfig and S3 credentials |
| `LOG_DIR` | `/var/log/acceleratio` | installer logs |
| `ALLOW_SWAP` | `0` | set to `1` to continue with active swap |

See `install.env.example` for a starting point.

## Verify

```bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

sudo k3s kubectl get nodes -o wide
sudo k3s kubectl get pods -A
sudo k3s kubectl get storageclass
sudo k3s kubectl -n seaweedfs get pods -o wide
sudo k3s etcd-snapshot list
```

Expected:

- the node is `Ready` and has role `control-plane`
- Cilium and `cilium-operator` are ready in `kube-system`
- SeaweedFS master, volume and filer pods are `Running`
- `seaweedfs-storage` is the only StorageClass marked `(default)`

`k3s etcd-snapshot` can print `Unknown flag --...` warnings because it parses
the k3s config file with a reduced flag set. Snapshots and the scheduled
snapshot job still work.

The installer runs its own PVC smoke test. To repeat it manually:

```bash
sudo k3s kubectl apply -f - <<'EOF'
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: smoke
spec:
  accessModes: [ReadWriteOnce]
  resources:
    requests:
      storage: 10Mi
EOF

sudo k3s kubectl get pvc smoke -w
```

The claim should bind to `seaweedfs-storage`.

## Kubeconfig

The installer writes:

- `/root/.kube/config` and the invoking sudo user's `~/.kube/config`
- `/etc/acceleratio/kubeconfig.yaml` with the public IP as the API server

For external access:

```bash
scp root@<VPS_IP>:/etc/acceleratio/kubeconfig.yaml .
export KUBECONFIG=$PWD/kubeconfig.yaml
kubectl get nodes
```

The k3s API certificate includes the node IP, the detected public IP and the
node name as SANs. If the VPS is behind NAT, `node-ip` stays on the private
interface and the public address is added as an additional SAN for external
clients.

## SeaweedFS S3

When `SEAWEEDFS_S3_ENABLED=true`, the filer exposes S3 inside the cluster:

```
http://seaweedfs-s3.seaweedfs.svc.cluster.local:8333
```

Credentials are generated by the chart and written to
`${CONFIG_DIR}/seaweedfs-s3.env` (by default
`/etc/acceleratio/seaweedfs-s3.env`) with mode `0600`. The endpoint is not
published outside the cluster. Port-forward it for local use:

```bash
sudo k3s kubectl -n seaweedfs port-forward svc/seaweedfs-s3 8333:8333
```

## Re-run and reset

Re-running the installer is safe for configuration and Helm changes:

```bash
sudo ./deploy/install.sh
```

To start from scratch, including etcd and SeaweedFS data:

```bash
sudo ./deploy/install.sh --reset --yes
```

`--reset` is destructive. It removes the k3s datastore, Cilium networking and
`/var/lib/seaweedfs`. It is not an in-place migration from an existing sqlite
k3s cluster; the installer normally refuses that case.

## Uninstall

```bash
sudo ./deploy/uninstall.sh
```

Or with the published script:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-dev/core/main/deploy/uninstall.sh | sudo bash -s -- --yes
```

The uninstaller removes the Helm releases, detaches Cilium BPF filters from the
host interfaces, removes Cilium CNI files and interfaces, and then removes k3s,
etcd and SeaweedFS data. Detaching the filters before the CNI is removed keeps
SSH and host networking usable without a reboot. It keeps kubeconfig files in
`/root/.kube` and user home directories.

If you changed `SEAWEEDFS_NAMESPACE`, `SEAWEEDFS_RELEASE`,
`SEAWEEDFS_CSI_RELEASE`, `SEAWEEDFS_DATA_DIR`, `CONFIG_DIR` or the
`CILIUM_CNI_*` paths, pass the same values to `uninstall.sh`; otherwise it
will look for the defaults.

## Troubleshooting

**Node stays `NotReady` after Cilium.** k3s 1.36 reads the standard CNI paths,
so Cilium must write its config to `/etc/cni/net.d` and its plugin to
`/opt/cni/bin`:

```bash
ls -l /etc/cni/net.d/
ls -l /opt/cni/bin/cilium-cni
sudo k3s kubectl -n kube-system logs ds/cilium --tail=100
```

If the container runtime uses different paths, set `CILIUM_CNI_CONF_PATH` and
`CILIUM_CNI_BIN_PATH` in the config file. Check the runtime values with:

```bash
sudo k3s crictl info | grep -A4 '"cni"'
```

**The installer refuses to start.** Check the message: common causes are an
existing sqlite k3s datastore, active swap, missing `/dev/fuse`, less than
10 GiB free disk, or a port conflict on `6443`.

**apt/dpkg lock on a fresh VPS.** cloud-init or unattended-upgrades may still be
installing packages. The installer waits up to 10 minutes and passes
`DPkg::Lock::Timeout=600` to apt. If it times out, inspect the holder with
`pgrep -a 'apt|dpkg'` and re-run.

**Helm release is stuck.** Inspect it with:

```bash
sudo helm list -A
sudo helm history <release> -n <namespace>
sudo k3s kubectl -n <namespace> get pods
```

Fix the underlying issue and re-run the installer. For a clean test host, use
`--reset --yes`.

**Cilium and kube-proxy both present.** The installer deletes a stale
`kube-proxy` DaemonSet when it finds one. Check:

```bash
sudo k3s kubectl -n kube-system get ds
```

**Docker is already installed.** The installer does not stop Docker, but Cilium
and Docker both manage host networking. The tested Ubuntu 24.04, Ubuntu 22.04
and Debian 12 setups kept a healthy Docker container running throughout,
including after a reboot. If pods lose connectivity, stop Docker, re-run the
installer, and check Docker's iptables rules before starting it again.

**SeaweedFS CSI pods fail.** Confirm `/dev/fuse` exists and the node has the
CSI node and mount DaemonSets:

```bash
ls -l /dev/fuse
sudo k3s kubectl -n seaweedfs get ds
```

## Limitations

- Single-node design. Embedded etcd has no quorum redundancy; this is not an
  HA control plane.
- SeaweedFS state is on hostPath and is not replicated or backed up. A
  production deployment needs real disks, backups and probably multiple
  volume servers.
- SeaweedFS S3 is in-cluster only and has no TLS termination from this
  installer.
- The Acceleratio application, ingress for it and its database are not part
  of this version.
- RHEL/Rocky/Alma are not supported by this installer yet.
- The installer disables the k3s `local-storage` addon. Do not run it on an
  existing cluster that still uses `local-path` volumes; start from a fresh
  host or migrate those volumes first.
