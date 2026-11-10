# Installer

`deploy/install.sh` turns a fresh Ubuntu or Debian server into an Acceleratio
cloud with a single command. It works on bare metal, a private server or any
other hardware. It provisions a single-node Kubernetes cluster:

- k3s `v1.36.5+k3s1` with embedded etcd
- Cilium `1.20.4` as the CNI, replacing flannel and kube-proxy
- Helm `3.18.0`
- SeaweedFS `4.51.0` (master, volume, filer and S3)
- SeaweedFS CSI `0.2.43` with the default StorageClass `seaweedfs-storage`
- VictoriaMetrics single node (chart `0.50.0`), which scrapes kubelet and
  cAdvisor metrics for the project Observability tab and keeps 14 days on the
  server's own disk (`/var/lib/victoria-metrics`)
- VictoriaLogs single node with Vector (chart `victoria-logs-single`
  `0.13.11`): Vector collects the stdout and stderr of project services for the
  project Logs tab, and VictoriaLogs keeps 7 days, at most 2 GiB, on the
  server's own disk (`/var/lib/victoria-logs`). Platform namespaces are not
  collected. Together they use about 90 MiB of memory at rest and about 110 MiB
  at 1,000 lines/s (limits 256 MiB and 160 MiB)
- An image registry (zot `v2.1.23`) for services built from GitHub, on a
  50 GiB SeaweedFS volume; see [Image registry](#image-registry)

and then deploys Acceleratio into the `acceleratio` namespace:

- PostgreSQL (`postgres:17-alpine`), stored on the server's own disk
- the API (`ghcr.io/acceleratio-cloud/api:0.2.2`), which migrates the database on
  every start through an init container
- the console (`ghcr.io/acceleratio-cloud/console:0.2.2`)

When it finishes, the installer prints the dashboard URL.

## Tested

Cluster bootstrap verified on Ubuntu 24.04.5 (4 vCPU, 8 GiB RAM), Ubuntu 22.04.5 (6 vCPU,
11 GiB RAM, kernel 5.15) and Debian 12 (6 vCPU, 11 GiB RAM), with and without
Docker. The test matrix covered a fresh install, the stdin/one-line path
(`bash -s --`), an idempotent re-run, a reboot, an external kubeconfig, a
PVC/DNS smoke test, S3 authentication, an etcd snapshot, live uninstall and
reinstall, `--reset --yes`, `--help`, `--config`, a custom
namespace/StorageClass/`CONFIG_DIR`/`LOG_DIR` with S3 disabled, and the
sqlite, swap and port-conflict preflight refusals. The Acceleratio
deployment step has been checked with `--dry-run` and manifest validation only.

## Requirements

- Ubuntu 22.04/24.04 or Debian 12, amd64 or arm64
- root access (the script uses `sudo`)
- 2 vCPU, 4 GiB RAM and 20 GiB free disk recommended
  (the script refuses less than 2 GiB RAM and 10 GiB disk)
- Linux kernel 5.10 or newer
- `/dev/fuse` available on the host
- outbound HTTPS to `get.k3s.io`, `get.helm.sh`, `quay.io`, GitHub Pages and
  Docker Hub (the smoke test pulls `busybox:1.36`)
- ports `30300/tcp` (console) and `30080/tcp` (API) reachable from the browsers
  that will use the dashboard
- ports `6443/tcp`, `80/tcp`, `443/tcp` free; `8472/udp` between nodes if the
  cluster is expanded later. Open `80/tcp` and `443/tcp` to the internet to use
  a [custom domain](#custom-domain)
- swap disabled (or `ALLOW_SWAP=1` if you accept the kubelet risk)

OpenVZ/LXC hosts often do not expose `/dev/fuse`; the installer stops
before making changes if FUSE is unavailable.

## Quick start

On the server, with root:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/deploy/install.sh | sudo bash
```

When it finishes, it prints the dashboard address:

```
────────────────────────────────────────────────────────────────
  ● Acceleratio is ready
  Your private cloud is up and running.
────────────────────────────────────────────────────────────────

  Open the dashboard
    Console       http://203.0.113.10:30300
    First account http://203.0.113.10:30300/auth/installation
    API           http://203.0.113.10:30080
```

Open the **First account** link and create the first account to start
working with the system.

Flags go after `bash -s --`, so the same one-liner works without a checkout:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/deploy/install.sh | sudo bash -s -- --dry-run
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/deploy/install.sh | sudo bash -s -- --config /root/install.env
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/deploy/install.sh | sudo bash -s -- --reset --yes
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/deploy/install.sh | sudo bash -s -- --help
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
9. **Acceleratio** — generates the database password and session secret (kept
   in `/etc/acceleratio/acceleratio.env`), applies
   `/etc/acceleratio/manifests/acceleratio.yaml` and waits for PostgreSQL, the
   API and the console to become ready. The console and API are published on
   node ports `30300` and `30080`. The API runs with a ServiceAccount bound to
   `cluster-admin`, because it creates namespaces, workloads, volumes and
   network policies for projects. It also runs the image registry and waits
   until the node reaches it. Before that, it configures the Traefik
   bundled with k3s with a Let's Encrypt certificate resolver through
   `/etc/acceleratio/manifests/traefik-config.yaml` (see
   [Custom domain](#custom-domain)).

Steps 6–8 run at the same time as VictoriaMetrics, VictoriaLogs and the
CloudNativePG operator: they are independent once Cilium is up. Each line they
print is prefixed with its group (`[storage]`, `[metrics]`, `[logs]`, `[cnpg]`),
and each step logs how long it took.

The installer is idempotent: a second run updates configuration and Helm
releases instead of recreating the cluster. Run directly (a repair), it
re-applies every release and repeats the smoke test. Run by `update.sh`, it
leaves alone any release whose chart, settings and values match its last
successful run (recorded in `/etc/acceleratio/helm-state`), and runs the smoke
test only when k3s, Cilium or the storage changed.

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
| `K3S_JOIN_URL` | `https://<K3S_NODE_IP>:6443` | API server address given to servers added from the console |
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
| `VICTORIAMETRICS_CHART_VERSION` | `0.50.0` | `victoria-metrics-single` chart version |
| `VICTORIAMETRICS_NAMESPACE` | `victoria-metrics` | VictoriaMetrics namespace |
| `VICTORIAMETRICS_RELEASE` | `victoria-metrics` | Helm release and Service name |
| `VICTORIAMETRICS_DATA_DIR` | `/var/lib/victoria-metrics` | hostPath for the metrics database |
| `VICTORIAMETRICS_RETENTION` | `14d` | how long metrics are kept |
| `VICTORIALOGS_CHART_VERSION` | `0.13.11` | `victoria-logs-single` chart version (includes Vector) |
| `VICTORIALOGS_NAMESPACE` | `victoria-logs` | VictoriaLogs and Vector namespace |
| `VICTORIALOGS_RELEASE` | `victoria-logs` | Helm release and Service name |
| `VICTORIALOGS_DATA_DIR` | `/var/lib/victoria-logs` | hostPath for the log store |
| `VICTORIALOGS_RETENTION` | `7d` | how long logs are kept |
| `VICTORIALOGS_MAX_DISK` | `2GiB` | disk cap; the oldest logs go first beyond it |
| `ACCELERATIO_NAMESPACE` | `acceleratio` | namespace for PostgreSQL, the API and the console |
| `ACCELERATIO_VERSION` | `0.2.2` | image tag for the API and the console |
| `ACCELERATIO_API_IMAGE` | `ghcr.io/acceleratio-cloud/api:<version>` | API image |
| `ACCELERATIO_CONSOLE_IMAGE` | `ghcr.io/acceleratio-cloud/console:<version>` | console image |
| `POSTGRES_IMAGE` | `postgres:17-alpine` | PostgreSQL image |
| `POSTGRES_DATA_DIR` | `/var/lib/acceleratio/postgres` | hostPath for the database files |
| `ACCELERATIO_CONSOLE_NODE_PORT` | `30300` | node port of the console |
| `ACCELERATIO_API_NODE_PORT` | `30080` | node port of the API |
| `ACCELERATIO_PUBLIC_HOST` | public IPv4 | host name or IP used in the dashboard URLs |
| `ACCELERATIO_CONSOLE_URL` | `http://<host>:30300` | full console URL, e.g. behind a domain or reverse proxy |
| `ACCELERATIO_API_URL` | `http://<host>:30080` | full API URL; the browser must reach it |
| `ACCELERATIO_ACME_EMAIL` | empty | optional Let's Encrypt contact address for a custom domain |
| `CONFIG_DIR` | `/etc/acceleratio` | generated values, kubeconfig, secrets and S3 credentials |
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
sudo k3s kubectl -n acceleratio get pods -o wide
sudo k3s etcd-snapshot list
```

Expected:

- the node is `Ready` and has role `control-plane`
- Cilium and `cilium-operator` are ready in `kube-system`
- SeaweedFS master, volume and filer pods are `Running`
- `seaweedfs-storage` is the only StorageClass marked `(default)`
- `postgres-0`, `api-*` and `console-*` are `Running` in `acceleratio`

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

## Cluster servers

The console's **Servers** page lists the cluster's servers and manages them.
The installer stores the join URL, the cluster join token and the CIDRs in the
API's `api` secret (`K3S_JOIN_URL`, `K3S_JOIN_TOKEN`, `K3S_CLUSTER_CIDR`,
`K3S_SERVICE_CIDR`); without them, adding a server reports that it is not
configured. Installations made before this feature need the variables added to
that secret and the API restarted.

**Add a server.** The wizard asks for a name, a role, the server's address and
an SSH user and private key. The key is sent once, kept in memory for the
operation and never stored. The check shows the server's SSH host key
fingerprint; compare it with `ssh-keygen -lf` on the server. Adding pins that
key, so the join token is only sent to the server you checked. A check runs first and must pass: Linux with
systemd, root or passwordless sudo, curl, CPU, memory and free disk, no k3s on
the server, port 10250 free, a route to the API server (`:6443`) and to
`get.k3s.io`, and the kubelet port of the other nodes (a warning only). The
API then installs k3s at the cluster's version as a worker (agent) or, for
high availability, as a control-plane server that joins etcd, and waits for the
node to be Ready. Open ports on the new server: 10250 and 8472/udp and 4240
(Cilium) from the other nodes; 6443 and 2379-2380 for control-plane servers.
The server needs outbound internet access to install k3s.

**Cordon and uncordon** stop and resume scheduling of new pods on a node.

**Drain** shows what moves before it starts: pods to evict, pods that stay
(DaemonSet, static and finished pods), pods protected by a PodDisruptionBudget
and pods that would lose data (no controller, emptyDir or hostPath). Eviction
goes through the eviction API one pod at a time and retries while a budget
refuses; pods still on the node after the timeout (5 minutes by default) are
listed and the operation fails. Services with several replicas keep serving
during a drain; a service with one replica restarts on another server.

**Remove** drains the server and deletes the Node from the cluster; with SSH
access it also runs the k3s uninstall script (as root directly, otherwise
through passwordless sudo). For a worker k3s is uninstalled first, since a
running kubelet registers a deleted Node again: if the uninstall fails the Node
stays, drained and cordoned, and without SSH access you have to stop k3s on the
server yourself. For a control-plane server the Node is deleted first, so k3s
removes its etcd member while quorum holds, and k3s is uninstalled afterwards.
A server that is not Ready (for example a dead machine) can still be removed:
its pods are deleted without waiting for the unreachable kubelet and disappear
with the Node; leave SSH access off for it. You type the server name
to confirm. Removal is refused for the only server in the cluster, for the last control-plane server, and while data
exists only on that server: a PersistentVolume pinned to it (local or hostPath
volumes) or the only SeaweedFS volume server, whose data is on a hostPath of
that node. The default install runs SeaweedFS with one volume server, so the
server it runs on cannot be removed until you add volume servers and move the
data. Removing a control-plane server relies on k3s removing its etcd member
when the Node is deleted; check `k3s etcd` health afterwards.

**Labels and taints** are edited per server. A service can pin itself to
servers with a **Node selector** (service settings, Placement).

Every operation is saved with the account that started it, its steps and log
(secrets removed), and only one operation runs per server at a time. An
operation interrupted by an API restart is marked failed; check the server and
start it again.

## Kubeconfig

The installer writes:

- `/root/.kube/config` and the invoking sudo user's `~/.kube/config`
- `/etc/acceleratio/kubeconfig.yaml` with the public IP as the API server

For external access:

```bash
scp root@<SERVER_IP>:/etc/acceleratio/kubeconfig.yaml .
export KUBECONFIG=$PWD/kubeconfig.yaml
kubectl get nodes
```

The k3s API certificate includes the node IP, the detected public IP and the
node name as SANs. If the server is behind NAT, `node-ip` stays on the private
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

## Image registry

GitHub services are built by BuildKit Jobs in the `acceleratio-builds`
namespace (the root `Dockerfile`, or a Railpack plan when there is none; the
Job downloads a pinned, checksummed Railpack release from github.com) and pushed to a zot registry in the `acceleratio` namespace. It is
not published outside the cluster and has no authentication: project pods
cannot reach it (their network policy), and build pods may reach only DNS, the
registry and the internet. Images are kept on a `REGISTRY_SIZE` volume of the
default StorageClass; the 20 newest per service and the build cache are kept,
older ones are garbage collected after a day.

containerd pulls from the host network and cannot resolve cluster DNS, so the
registry Service has a fixed ClusterIP (`REGISTRY_CLUSTER_IP`, by default
`.50` in the service CIDR) and every node maps `registry.acceleratio.internal`
to it in `/etc/rancher/k3s/registries.yaml`. The installer writes that file
(changing it restarts k3s) and the console writes it on servers it joins.

## Dashboard address

By default the URLs use the detected public IPv4. The browser must reach both
the console and the API, so open both node ports in the firewall. To use a
domain or a TLS reverse proxy, publish the console and the API and tell the
installer their final URLs:

```bash
ACCELERATIO_CONSOLE_URL=https://console.example.com \
ACCELERATIO_API_URL=https://api.example.com \
  sudo -E ./deploy/install.sh
```

Re-running with different URLs updates the deployments. Keep the console and
the API on the same registrable domain so the session cookie is sent to the
API.

## Custom domain

The console can move the dashboard to your own domain with an automatic
Let's Encrypt certificate:

1. Create a DNS `A` record for the domain (for example `cloud.example.com`)
   pointing to the server's public IPv4. The console shows the address it
   expects.
2. Open `80/tcp` and `443/tcp` to the internet. Let's Encrypt validates the
   domain over HTTP on port 80 (HTTP-01), and the dashboard is served on 443.
3. In the console, open **Settings → System**, enter the new URL, wait for the
   DNS check to pass and apply the change.

The console is then served at `https://<domain>` and the API at
`https://<domain>/api`, both through the Traefik bundled with k3s. The old
`http://<server-ip>:30300` and `:30080` URLs keep working as a fallback.

To get certificate expiry notices, set `ACCELERATIO_ACME_EMAIL` before
running the installer. Traefik keeps its ACME account and certificates in
`/var/lib/acceleratio/traefik` on the server.

Installs made before this feature must re-run the installer once
(`sudo ./deploy/install.sh`) so it adds the Traefik certificate resolver and
passes the server IP to the API; the console refuses to apply a domain until
then. The installer replaces the `kube-system/traefik` HelmChartConfig; if you
had your own, it saves a copy next to the manifest first.

## Database

PostgreSQL runs as the StatefulSet `postgres` and keeps its files on the
server's own disk (`/var/lib/acceleratio/postgres`), not on SeaweedFS, so the
platform does not depend on itself to start. The database password and the
session secret are generated once and reused by later runs. Back up
`/var/lib/acceleratio/postgres` and `/etc/acceleratio/acceleratio.env` together.

## Update

`update.sh` brings an existing installation to the versions pinned in the
target `install.sh`: k3s, Helm, Cilium, SeaweedFS, the SeaweedFS CSI driver,
VictoriaMetrics, VictoriaLogs with Vector and Acceleratio (API and console).
Pull the new release, then:

```bash
sudo ./deploy/update.sh --dry-run   # print the plan, change nothing
sudo ./deploy/update.sh             # ask for confirmation, then update
```

Or with the published script:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/deploy/update.sh | sudo bash -s -- --yes
```

That one-liner runs whatever is on `main` as root, with nothing to check it
against. To verify what you run, pin a commit or release you reviewed, take its
SHA-256 from somewhere you trust (a release note, or `sha256sum
deploy/update.sh deploy/install.sh` on your own checkout of that commit), and
check both files:

```bash
REF=<commit-or-tag>
curl -fsSLO --proto '=https' https://raw.githubusercontent.com/acceleratio-cloud/core/$REF/deploy/update.sh
sha256sum update.sh                      # compare with the hash you trust
sudo bash update.sh --ref "$REF" --sha256 <sha256-of-install.sh>
```

`--sha256` makes the script refuse to run an `install.sh` with a different
hash. Without it, a downloaded `install.sh` is run unverified: the script prints
its hash and warns, unless `--ref` is a full commit hash.

It works as follows:

1. Takes `install.sh` from next to the script (or downloads it for `--ref`,
   default `main`, when run through a pipe) and reads the target versions from
   it.
2. Prints a table of every component, its current and its target version, and
   exits if nothing changes.
3. Refuses a downgrade unless `--allow-downgrade` is given, because database
   migrations only move forward. It also refuses a PostgreSQL major version
   change, which needs a dump and restore.
4. Backs up to `/var/backups/acceleratio/<timestamp>/`: a `pg_dump` of the
   database, `acceleratio.env`, the generated manifests, the Helm values and
   revisions, and an etcd snapshot (`--no-backup` skips the dump and the
   snapshot). The default location is outside `/etc/acceleratio` because
   `uninstall.sh` and `install.sh --reset` remove that directory. The script
   checks that the disk has room (the database size plus 256 MiB) and warns
   when the backup is on the same disk as the database. Point `--backup-dir`
   at a separate disk or mount to survive a disk failure.
5. Runs the target `install.sh` with the same `--config`, then waits for
   PostgreSQL, the API and the console and checks `/healthz`. After a
   successful update it keeps the newest 5 backups (`--keep-backups N`; `0`
   keeps all) and deletes older ones, but never the newest one that has a
   database dump. Only timestamped folders inside the backup directory are
   removed.
6. If anything fails, or you press Ctrl-C or send `SIGTERM`, stops
   `install.sh`, rolls back the Helm releases that changed (`helm rollback`)
   and re-applies the previous Acceleratio manifest. A dropped SSH session
   (`SIGHUP`) is ignored, so the update keeps going and the log is still
   written to `/var/log/acceleratio/update-<timestamp>.log`.

Before changing anything, it also stops when:

- k3s or Cilium would skip a minor version. Kubernetes and Cilium support
  upgrading one minor version at a time (`--allow-version-skip` overrides).
- the node ports, the database directory or the dashboard URLs you pass differ
  from what is running, which happens when the original `--config` or
  environment is forgotten (`--allow-config-changes` overrides).

It warns when the API or console version changes, because the API migrates the
database on start and a rollback restores the old images but not the old
schema. If the previous API does not answer after a rollback, restore the
database from the backup.

The k3s binary and the database are not rolled back automatically: migrations
cannot be undone and a restore overwrites data. On failure the script prints
the commands to restore the database and etcd from the backup.

Options: `--ref REF`, `--sha256 HASH`, `--config FILE`, `--yes`, `--dry-run`,
`--no-backup`, `--backup-dir DIR`, `--keep-backups N`, `--allow-downgrade`,
`--allow-version-skip`, `--allow-config-changes`. `--backup-dir` and
`--keep-backups` can also be set as `BACKUP_ROOT` and `BACKUP_KEEP` in the
environment or the `--config` file.

If you installed with `--config` or environment overrides, pass the same ones
to `update.sh`, as with `uninstall.sh`. Updating k3s or Cilium on the single
node briefly interrupts the cluster network, so plan a short downtime window.

### Update from the console

Settings → System → **Platform version** shows the installed release, the
version of every component (API, console, Kubernetes, the Helm charts and
PostgreSQL) and the latest stable release on
[GitHub Releases](https://github.com/acceleratio-cloud/core/releases) with its
release notes. The API checks for releases 30 seconds after it starts and then
every 6 hours; **Check for updates** checks at once. Pre-releases and drafts are
never offered.

**Update to vX.Y.Z** runs the same `update.sh` as above, on the server, without
SSH:

1. The API downloads the release's `SHA256SUMS` and creates a short-lived,
   privileged Job (`platform-update-<id>` in the `acceleratio` namespace) on
   the node that runs PostgreSQL, which is the node `install.sh` ran on.
2. The Job enters the host's namespaces with `nsenter`, writes a runner script
   to `/var/lib/acceleratio/updates/<id>/` and starts it as the transient
   systemd unit `acceleratio-update.service`. The update therefore keeps
   running while the API, the console and k3s restart. The unit name also
   prevents a second update from starting on the server. The database prevents
   a second update in the console.
3. The runner downloads `update.sh` and `install.sh` of the release and
   refuses to run them unless both match `SHA256SUMS`. It then runs
   `update.sh --yes --sha256 <install.sh hash>`, adding
   `--config /etc/acceleratio/install.env` when that file exists. `update.sh`
   backs up, updates, verifies and rolls back exactly as described above.
4. Every few seconds the runner publishes the stage and the last 128 KiB of
   the log to the ConfigMap `platform-update-<id>`. The API copies them into
   the `platform_update` table, so the console shows the steps, the live log
   and the outcome. It reconnects on its own while the API restarts, and
   offers to reload the console once the update succeeds.

`install.sh --config FILE` keeps a copy of `FILE` as
`/etc/acceleratio/install.env`, so a console update runs with the same
settings. An installation made with environment variables only has no such
file. If its settings differ from the defaults, the configuration check in
`update.sh` stops the update before changing anything. Write the settings to
`/etc/acceleratio/install.env` (shell syntax, as for `--config`) to fix that.

The outcome is one of:

- **Updated**: every component runs the release and is healthy.
- **Failed** before the install step: nothing was changed (for example a
  checksum mismatch, no access to github.com, or a configuration difference).
- **Rolled back**: the install failed. The Helm releases and the Acceleratio
  manifests were restored to the previous version. The database and the k3s
  binary were not. The backup location and the restore commands are at the end
  of the log.
- **Failed** after the install started with an incomplete rollback: follow the
  recovery steps at the end of the log.

The full log stays on the server in `/var/log/acceleratio/update.log` and
`/var/lib/acceleratio/updates/<id>/update.log` (work directories are kept for
30 days); `journalctl -u acceleratio-update` shows the runner itself. If the
server stops reporting for 45 minutes, the console marks the update failed;
check those logs on the server.

The server needs outbound HTTPS to `api.github.com`, `github.com` and the
container registry. Without internet access the check reports that GitHub
cannot be reached. Update such installations over SSH with `update.sh` and an
`install.sh` you copied to the server. Set `PLATFORM_UPDATES_ENABLED=0` in the
API environment to turn updates from the console off. Use
`PLATFORM_UPDATE_CHECK_INTERVAL_MS` to change the check interval (`0` turns
the background check off) and `ACCELERATIO_RELEASE_REPOSITORY` (`owner/repo`)
to follow a fork. A development build (an API image without a release
version) and an API that runs outside the cluster never offer updates.

The console does not downgrade. To go back to an older release after a
successful update, restore the backup over SSH as described above.

## Re-run and reset

Re-running the installer is safe for configuration and Helm changes (to move
to a new release, prefer [`update.sh`](#update), which also backs up and rolls
back):

```bash
sudo ./deploy/install.sh
```

To start from scratch, including etcd and SeaweedFS data:

```bash
sudo ./deploy/install.sh --reset --yes
```

`--reset` is destructive. It removes the k3s datastore, Cilium networking and
`/var/lib/seaweedfs`, the database in `/var/lib/acceleratio/postgres` and
`/etc/acceleratio`. It is not an in-place migration from an existing sqlite
k3s cluster; the installer normally refuses that case.

## Uninstall

```bash
sudo ./deploy/uninstall.sh
```

Or with the published script:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/deploy/uninstall.sh | sudo bash -s -- --yes
```

The uninstaller removes the Helm releases, detaches Cilium BPF filters from the
host interfaces, removes Cilium CNI files and interfaces, and then removes k3s,
etcd, the database and SeaweedFS data. Detaching the filters before the CNI is removed keeps
SSH and host networking usable without a reboot. It keeps kubeconfig files in
`/root/.kube` and user home directories.

If you changed `SEAWEEDFS_NAMESPACE`, `SEAWEEDFS_RELEASE`,
`SEAWEEDFS_CSI_RELEASE`, `SEAWEEDFS_DATA_DIR`, `ACCELERATIO_NAMESPACE`,
`POSTGRES_DATA_DIR`, `CONFIG_DIR` or the
`CILIUM_CNI_*` paths, pass the same values to `uninstall.sh`; otherwise it
will look for the defaults.

## Troubleshooting

**Update or re-install stops with "Node(s) not ready".** Cilium and the
SeaweedFS CSI driver are DaemonSets, and both scripts wait until every node runs
them. A server that is down (`NotReady`, often also `SchedulingDisabled` after an
unfinished removal) would make that wait time out after ten minutes and the
update roll back, so `update.sh` checks every node before the backup and
`install.sh` checks the other nodes before Cilium, and stops with the node's
name. Nothing has changed at that point. Bring the server back, or remove it
(Servers in the console, or `sudo k3s kubectl delete node <name>`), then run the
update again:

```bash
sudo k3s kubectl get nodes
```

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

**apt/dpkg lock on a fresh server.** cloud-init or unattended-upgrades may still be
installing packages. The installer waits up to 10 minutes and passes
`DPkg::Lock::Timeout=600` to apt. If it times out, inspect the holder with
`pgrep -a 'apt|dpkg'` and re-run.

**The dashboard does not open.** Check the pods, then the firewall:

```bash
sudo k3s kubectl -n acceleratio get pods
sudo k3s kubectl -n acceleratio logs deploy/api --all-containers
curl -i http://127.0.0.1:30300/healthz
```

If both answer locally, open TCP `30300` and `30080` in the host or network
firewall. `ImagePullBackOff` means the server cannot reach Docker Hub.

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

- The installer creates a single-node cluster. Embedded etcd has no quorum
  redundancy until you add control-plane servers (three for quorum) from the
  console.
- Servers added from the console join over the address in `K3S_JOIN_URL`. SSH
  host keys are not verified; compare the logged fingerprint.
- SeaweedFS does not rebalance onto added servers.
- SeaweedFS state is on hostPath and is not replicated or backed up. A
  production deployment needs real disks, backups and probably multiple
  volume servers.
- SeaweedFS S3 is in-cluster only and has no TLS termination from this
  installer.
- The console and API are published on plain HTTP node ports. For TLS, set a
  [custom domain](#custom-domain) in the console, or put a reverse proxy in
  front and pass its URLs as `ACCELERATIO_CONSOLE_URL` and
  `ACCELERATIO_API_URL`.
- PostgreSQL is a single instance on a hostPath, without replication or
  automatic backups.
- RHEL/Rocky/Alma are not supported by this installer yet.
- The installer disables the k3s `local-storage` addon. Do not run it on an
  existing cluster that still uses `local-path` volumes; start from a fresh
  host or migrate those volumes first.
