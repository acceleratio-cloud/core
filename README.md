# Acceleratio

**Open-source, self-hosted cloud platform. Your cloud, your data, your control.**

Acceleratio turns servers you own into a private cloud with the deploy-and-operate
experience of a managed platform such as Railway, Render, Northflank or Vercel. You
install it on your own hardware, and the control plane, the workloads and the data
stay inside your infrastructure, with no vendor account and no hosted service
required to run it.

It is built for platform and infrastructure engineers in organizations that must
run workloads and keep data on infrastructure they control: sovereign, regulated
and security-conscious teams that want a managed-platform workflow without handing
the keys to a third party.

### What you get

- **One-command install.** A single script turns a fresh Ubuntu or Debian server
  into a working cloud: single-node k3s with embedded etcd, Cilium networking,
  SeaweedFS storage, VictoriaMetrics metrics, VictoriaLogs logs and the
  Acceleratio control plane.
- **Projects and services.** Group workloads into projects on a visual canvas and
  run Docker services from any image, with versioned configuration, environment
  variables and secrets.
- **Domains with automatic HTTPS.** Every Docker service gets a generated domain,
  and custom domains go live with Let's Encrypt certificates once their DNS points
  at your server.
- **Object storage.** S3-compatible buckets backed by SeaweedFS, with access keys
  managed from the console, plus configurable storage classes for volumes.
- **Observability and access.** Per-project metrics, project-wide logs with live
  tail, search and per-service filters, instance status and a browser terminal
  into running containers, without leaving the console.
- **Private networking.** Every service of a project reaches every other one by
  its private name (`postgres.internal`) on any port, so an app talks to its
  database without a public domain. Projects are isolated from each other with
  Cilium network policies.
- **Operator-first console.** First-run setup creates the initial account;
  servers, storage and system settings are managed from the same web console.
- **Built on open components.** Kubernetes (k3s), Cilium, SeaweedFS, Traefik,
  VictoriaMetrics, VictoriaLogs, Vector and PostgreSQL. Everything runs on a cluster you control, and
  you can inspect it with the standard Kubernetes tools.

## Installation

### Install on a server

One command turns a fresh Ubuntu or Debian server (bare metal, a private
server or any other hardware) into a working Acceleratio cloud. The installer
sets up a single-node k3s cluster with embedded etcd, Cilium and SeaweedFS with
a default SeaweedFS StorageClass, then deploys PostgreSQL, the API and the
console into the `acceleratio` namespace.

Requirements: Ubuntu 22.04/24.04 or Debian 12 (amd64 or arm64), root access,
2 vCPU, 4 GiB RAM and 20 GiB free disk recommended, a Linux 5.10+ kernel with
`/dev/fuse`, and outbound HTTPS. The full list is in
[deploy/README.md](./deploy/README.md#requirements).

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/deploy/install.sh | sudo bash
```

When it finishes, it prints the dashboard URL (by default
`http://<server-ip>:30300`). Open `/auth/installation` there and create the
first account to start working with the system. Open TCP ports `30300` and
`30080` in your firewall if the page does not load. To use a custom domain with
HTTPS, also open `80/tcp` and `443/tcp` to the internet.

Prefer to read the script first? Download it, review it, then run it:

```bash
curl -fsSLO https://raw.githubusercontent.com/acceleratio-cloud/core/main/deploy/install.sh
less install.sh
sudo bash install.sh
```

Configuration (versions, node IP, namespace, images, domain and TLS) is set
through environment variables or an `install.env` file; see
[deploy/install.env.example](./deploy/install.env.example) and
[deploy/README.md](./deploy/README.md).

### Update

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/deploy/update.sh | sudo bash
```

The updater asks for confirmation (pass `--yes` to skip it), backs up before
changing anything and rolls back if the new version does not become healthy. Use
`--dry-run` to see what it would do.

### Uninstall

To remove everything, including the database:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/deploy/uninstall.sh | sudo bash -s -- --yes
```

Requirements, configuration, domains and TLS, verification and uninstall
details live in [deploy/README.md](./deploy/README.md).

## Local development

Prerequisites: [Bun](https://bun.sh) 1.2 or newer and Docker with Compose v2.
`make dev` also needs `make`; if it is not installed, run `./scripts/dev.sh`
instead. Cluster-backed features additionally need k3d 5.9 or newer, Helm, and
kubectl (`brew install k3d helm kubectl` on macOS).

```bash
git clone https://github.com/acceleratio-cloud/core.git
cd core
make cluster-up   # optional: disposable local k3d cluster with Cilium
make dev
```

`make dev` performs the whole fresh-clone setup:

1. creates `apps/api/.env` (with a generated auth secret) and
   `apps/frontend/.env.local` from the committed examples,
2. installs dependencies for `packages/shared`, `apps/api` and `apps/frontend`,
3. starts PostgreSQL through Docker Compose,
4. applies the Drizzle migrations, and
5. runs the API and the console in watch mode.

Once both servers are up:

- Console: <http://localhost:3000>
- API: <http://localhost:8080>

The first visit to the console redirects to <http://localhost:3000/auth/installation>.
Create the initial account there with any email and a password of at least eight
characters, then sign in. No seeded credentials are required.

Press `Ctrl+C` to stop the API and the console. PostgreSQL keeps running so data
survives restarts; stop it with `make db-down`.

`./scripts/dev.sh` is equivalent to `make dev` if you prefer not to use Make.

The Compose database is bound to `127.0.0.1:5433` so it does not collide with a
PostgreSQL already running on the default port and is not reachable from other
machines. If you change it with `POSTGRES_PORT`, update `DATABASE_URL` in
`apps/api/.env` to match.

If `8080` or `3000` is already in use, `make dev` stops with a clear message.
Free the port, or change `PORT` in `apps/api/.env` and update `BETTER_AUTH_URL`
there and `NEXT_PUBLIC_API_URL` in `apps/frontend/.env.local`. For the console,
run `WEB_PORT=3001 make dev` and add `http://localhost:3001` to `CORS_ORIGINS`
in `apps/api/.env`.

### Kubernetes target

The API is a Kubernetes control plane: the servers page and the project and
workload features read and write the cluster it targets. The target is chosen in
this order:

1. `KUBECONFIG` from the shell environment or `apps/api/.env` (a path to a
   kubeconfig file or the YAML contents themselves). An exported shell value
   wins, matching dotenv, and `make dev` validates whichever value the API will
   actually use. A leading `~` in a path is expanded.
2. the disposable k3d cluster created by `make cluster-up`; its kubeconfig path
   is printed by `./scripts/cluster.sh kubeconfig`,
3. the current context in your default kubeconfig (`~/.kube/config`), or
4. the in-cluster service account when running inside Kubernetes.

For local development, use the disposable cluster:

```bash
make cluster-up     # create k3d + k3s + Cilium + SeaweedFS + VictoriaMetrics + VictoriaLogs; idempotent
make dev            # picks up the k3d kubeconfig automatically
make cluster-status # show nodes, Cilium and SeaweedFS pods, StorageClasses
make cluster-down   # delete the cluster and its kubeconfig
```

The cluster disables flannel and the k3s network policy controller, then installs
Cilium. That matches the production CNI closely enough for workloads and for the
`CiliumNetworkPolicy` resources created by project isolation. k3d 5.9 or newer
is required because older releases cannot start the current k3s images. The
first `make cluster-up` pulls the k3s, Cilium and SeaweedFS images.

SeaweedFS and its CSI driver are installed as on a server, so the default
StorageClass is `seaweedfs-storage` and the console's storage settings can
create and use custom classes. Data lives inside the k3d node container and is
deleted with the cluster. The CSI driver needs `/dev/fuse` in the node; set
`SEAWEEDFS=0` to skip SeaweedFS (k3s `local-path` then stays the default).

VictoriaMetrics (single node) scrapes kubelet and cAdvisor metrics for the
project Observability tab. Its data lives inside the k3d node container with 7
days of retention; set `VICTORIAMETRICS=0` to skip it, and the tab then shows
that the metrics backend is unavailable. The API reaches it through the API
server's service proxy at `VICTORIAMETRICS_ADDRESS` (default
`victoria-metrics.victoria-metrics:8428`).

VictoriaLogs (single node) with Vector collects the stdout and stderr of project
services for the project Logs tab, with the same values as a server (they come
from `victorialogs_values` in `deploy/install.sh`) and 3 days of retention; set
`VICTORIALOGS=0` to skip it, and the tab then shows that log storage is
unavailable. The API reaches it through the API server's service proxy at
`VICTORIALOGS_ADDRESS` (default `victoria-logs.victoria-logs:9428`).

The SeaweedFS S3 gateway runs with authentication on, as on a server, so S3 bucket
services can be created locally. A cluster created before S3 was enabled has no
gateway: recreate it with `make cluster-down && make cluster-up`. The API finds
SeaweedFS through `SEAWEEDFS_NAMESPACE`, `SEAWEEDFS_MASTER`, `SEAWEEDFS_FILER`,
`SEAWEEDFS_S3_ENDPOINT` and `SEAWEEDFS_SHELL_IMAGE`; the defaults match both
installers.

The local cluster reads the k3s, Cilium and SeaweedFS chart versions from
`deploy/install.sh`, so local development and the server installer move together.
Override them with `K3S_VERSION`, `K3S_IMAGE`, `CILIUM_VERSION`,
`SEAWEEDFS_CHART_VERSION` or `SEAWEEDFS_CSI_CHART_VERSION` if needed.

Local development must not point at a shared or production cluster. `make dev`
validates the effective target, including an explicit `KUBECONFIG`, and refuses
to start unless it recognizes a local cluster (`minikube`, `kind-*`, `k3d-*`,
`docker-desktop`, `rancher-desktop`, `orbstack`, `colima`) or you pass
`ALLOW_REMOTE_KUBECONTEXT=1`. Only use that override for an intentional
non-local development cluster.

Without any kubeconfig the API still starts and the console works, but
cluster-backed endpoints return 503.

### Setup without starting the servers

```bash
make setup        # install, create env files, start Postgres, run migrations
make db-up        # start PostgreSQL only
make migrate      # apply pending migrations
make db-down      # stop PostgreSQL (the data volume is kept)
```

### Manual sequence

The same steps can be run by hand. The manual path does not run the Kubernetes
context guard, so export the disposable kubeconfig yourself before starting the
API; otherwise the API uses the current `~/.kube/config` context.

```bash
# 1. Environment
cp apps/api/.env.example apps/api/.env
# set BETTER_AUTH_SECRET in apps/api/.env to a 32-byte random value:
#   openssl rand -base64 32
cp apps/frontend/.env.example apps/frontend/.env.local

# 2. Dependencies and the shared package
(cd packages/shared && bun install && bun run build)
(cd apps/api && bun install)
(cd apps/frontend && bun install)

# 3. Database
docker compose up -d --wait postgres
(cd apps/api && bun run db:migrate)

# 4. Development servers (one terminal each)
# In the API terminal, after `make cluster-up` (skip the export if you do not
# use cluster features):
export KUBECONFIG="$(./scripts/cluster.sh kubeconfig)"
(cd apps/api && bun run start:dev)

# In the console terminal:
(cd apps/frontend && bun run dev)
```

### Building container images

Both Dockerfiles build from the repository root because the applications depend
on `packages/shared` through a `file:` dependency. The images run as the
unprivileged `node` user.

```bash
docker build -f apps/api/Dockerfile -t acceleratio/api:dev .
docker build -f apps/frontend/Dockerfile -t acceleratio/console:dev .
```

The API expects the same environment as local development: `DATABASE_URL`,
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `CORS_ORIGINS`. The image ships
the Drizzle migrations; apply them before starting a new version (from a
one-off container, a Kubernetes init container, or `make migrate` locally). The
API container does not migrate the database on startup. `KUBECONFIG` may be a file path or inline YAML; inside
Kubernetes the in-cluster service account is used when it is unset.

```bash
docker run --rm \
  -e DATABASE_URL=postgresql://acceleratio:acceleratio@host.docker.internal:5433/acceleratio \
  acceleratio/api:dev node dist/vendor/db/migrate.js

docker run --rm -p 8080:8080 \
  -e DATABASE_URL=postgresql://acceleratio:acceleratio@host.docker.internal:5433/acceleratio \
  -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  -e BETTER_AUTH_URL=http://localhost:8080 \
  -e CORS_ORIGINS=http://localhost:3000 \
  acceleratio/api:dev

docker run --rm -p 3000:3000 -e API_URL=http://localhost:8080 acceleratio/console:dev
```

`host.docker.internal` is built into Docker Desktop; on Linux add
`--add-host=host.docker.internal:host-gateway` or point `DATABASE_URL` at a
reachable database. The console reads `API_URL` (the API address the browser
uses) when the container starts, so one image serves every deployment; set
`API_INTERNAL_URL` as well when server-side calls should use a different
address, such as a cluster-local Service. The console listens on port `3000` and
the API on `8080`; both answer `GET /healthz`, which the image HEALTHCHECKs use.

## Documentation

- [docs/PRODUCT.md](./docs/PRODUCT.md): who the console is for and what is not shipped yet.
- [docs/DESIGN.md](./docs/DESIGN.md): the visual system of the console.
- [docs/FILE_STRUCTURE.md](./docs/FILE_STRUCTURE.md): folder conventions for the frontend and the API.
- [docs/DATABASE.md](./docs/DATABASE.md): the PostgreSQL data model and the migration workflow.
- [deploy/README.md](./deploy/README.md): the server installer, updater and uninstaller.

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](./CONTRIBUTING.md) first, and
follow the [Code of Conduct](./CODE_OF_CONDUCT.md). To report a vulnerability, see
[SECURITY.md](./SECURITY.md).

## License

Acceleratio is licensed under the [Apache License 2.0](./LICENSE).
