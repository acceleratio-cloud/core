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

Prerequisites on macOS: [OrbStack](https://orbstack.dev) (it provides Docker
with Compose v2 and the Linux machine for the cluster), [Bun](https://bun.sh)
1.2 or newer, and kubectl:

```bash
brew install --cask orbstack
brew install oven-sh/bun/bun kubectl
```

`make dev` also needs `make`; if it is not installed, run `./scripts/dev.sh`
instead. Open OrbStack once so it finishes its setup.

```bash
git clone https://github.com/acceleratio-cloud/core.git
cd core
make dev
```

`make dev` performs the whole fresh-clone setup:

1. creates `apps/api/.env` (with a generated auth secret) and
   `apps/frontend/.env.local` from the committed examples,
2. creates or starts the local cluster in an OrbStack machine (several minutes
   the first time, see [Kubernetes target](#kubernetes-target)),
3. installs dependencies for `packages/shared`, `apps/api` and `apps/frontend`,
4. starts PostgreSQL through Docker Compose,
5. applies the Drizzle migrations, and
6. runs the API and the console in watch mode.

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
workload features read and write the cluster it targets. `make dev` runs the
API and console from source on the Mac and points them at a cluster in an
[OrbStack](https://orbstack.dev) Linux machine named `acceleratio`. The machine
runs `deploy/install.sh` from your checkout (OrbStack shares the Mac filesystem
with its machines), so the cluster is the one a server gets: k3s with embedded
etcd, Cilium as the CNI, SeaweedFS and its CSI driver with the default
StorageClass `seaweedfs-storage`, VictoriaMetrics for the project Observability
tab, and VictoriaLogs with Vector for the Logs tab. The installer also deploys
the released API and console into the cluster; `cluster.sh` scales them to zero
so they do not compete with the copy you are developing.

```bash
make cluster-up     # create the machine and install the cluster; idempotent
make dev            # runs cluster-up itself, then picks up the kubeconfig
make cluster-status # show the machine, nodes, pods and StorageClasses
make cluster-down   # delete the machine and its kubeconfig
```

You rarely need `make cluster-up` on its own: `make dev` and `make setup` call
it, and it returns quickly once the cluster is installed. The first run
downloads and installs everything, which takes several minutes. After a Mac
restart `make dev` starts the machine again.

The kubeconfig is written to `~/.kube/acceleratio-orbstack.yaml` with the
context `orbstack-acceleratio` (`./scripts/cluster.sh kubeconfig` prints the
path), and your default `~/.kube/config` is not touched. `make dev` also reads
the cluster join URL, token and CIDRs from the cluster and passes them to the
API, so the console's add-server flow is configured; a second OrbStack machine
(`orbctl create ubuntu:24.04 worker`) can serve as the server to add (see
[Cluster servers](./deploy/README.md#cluster-servers) for what the wizard needs).

The target is chosen in this order:

1. `KUBECONFIG` from the shell environment or `apps/api/.env` (a path to a
   kubeconfig file or the YAML contents themselves) when you want your own
   cluster. An exported shell value wins, matching dotenv, and `make dev`
   validates whichever value the API will actually use. A leading `~` in a path
   is expanded. `make dev` does not create the OrbStack cluster then,
2. the OrbStack cluster created by `make cluster-up`,
3. the current context in your default kubeconfig (`~/.kube/config`) when you
   run with `CLUSTER=0`, or
4. the in-cluster service account when running inside Kubernetes.

Requirements: OrbStack (`brew install --cask orbstack`) and kubectl (`brew
install kubectl`). The checkout must live under a path OrbStack shares with its
machines (anything under `/Users`, or `/Volumes`). The machine gets the OrbStack
defaults (4 CPUs, up to 8 GiB of memory); the stack idles at about 2 GiB.
Environment variables for `scripts/cluster.sh`:

| Variable | Default | Purpose |
|---|---|---|
| `ACCELERATIO_MACHINE` | `acceleratio` | machine name, also used in the kubeconfig name |
| `MACHINE_IMAGE` | `ubuntu:24.04` | machine image |
| `REINSTALL=1` | unset | run the installer again even if the cluster is ready (after changing `deploy/install.sh`) |

`CLUSTER=0 make dev` skips the cluster entirely. Without any kubeconfig the API
still starts and the console works, but cluster-backed endpoints return 503.

Local development must not point at a shared or production cluster. `make dev`
validates the effective target, including an explicit `KUBECONFIG`, and refuses
to start unless it recognizes a local cluster (`orbstack-*`, `orbstack`,
`minikube`, `kind-*`, `k3d-*`, `docker-desktop`, `rancher-desktop`, `colima`) or
you pass `ALLOW_REMOTE_KUBECONTEXT=1`. Only use that override for an
intentional non-local development cluster.

The machine disables swap (OrbStack machines come with zram swap that the
installer rejects); this affects only the machine. Data in the machine, such as
SeaweedFS volumes and metrics, is deleted with `make cluster-down`. The
PostgreSQL database of `make dev` is separate: it lives in a Docker volume and
survives `make cluster-down`.

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
# use cluster features). Add the join values to the environment too if you
# want to try adding servers: ./scripts/cluster.sh env prints them.
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
