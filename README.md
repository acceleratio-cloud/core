# Acceleratio

Open-source, self-hosted cloud platform. Your cloud, your data, your control.

## Run locally

Prerequisites: [Bun](https://bun.sh) 1.2 or newer and Docker with Compose v2.
`make dev` also needs `make`; if it is not installed, run `./scripts/dev.sh`
instead. Cluster-backed features additionally need k3d 5.9 or newer, Helm, and
kubectl (`brew install k3d helm kubectl` on macOS).

```bash
git clone https://github.com/acceleratio-dev/core.git
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
make cluster-up     # create k3d + k3s + Cilium; idempotent
make dev            # picks up the k3d kubeconfig automatically
make cluster-status # show nodes and Cilium pods
make cluster-down   # delete the cluster and its kubeconfig
```

The cluster disables flannel and the k3s network policy controller, then installs
Cilium. That matches the production CNI closely enough for workloads and for the
`CiliumNetworkPolicy` resources created by project isolation. k3d 5.9 or newer
is required because older releases cannot start the current k3s images. The
first `make cluster-up` pulls the k3s and Cilium images.

The local cluster reads the k3s and Cilium versions from `deploy/install.sh`, so
local development and the VPS installer move together. Override them with
`K3S_VERSION`, `K3S_IMAGE`, or `CILIUM_VERSION` if needed.

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

## Install on a VPS

The installer provisions a single-node Kubernetes cluster with k3s, embedded
etcd, Cilium, SeaweedFS and a default SeaweedFS StorageClass. The application
itself is not installed by this version.

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-dev/core/main/deploy/install.sh | sudo bash
```

To remove the cluster, Cilium and SeaweedFS data later:

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-dev/core/main/deploy/uninstall.sh | sudo bash -s -- --yes
```

Requirements, configuration, verification and uninstall details live in
[deploy/README.md](./deploy/README.md).
