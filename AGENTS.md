# AGENTS.md

Acceleratio — an open-source, self-hosted cloud platform. The console lives in `apps/frontend`.

## Local development

From a fresh clone, `make dev` (or `./scripts/dev.sh`) installs dependencies,
creates the OrbStack cluster, starts PostgreSQL through Docker Compose, applies Drizzle migrations, and runs
the API on <http://localhost:8080> and the console on <http://localhost:3000>.
Create the first account at <http://localhost:3000/auth/installation>. Use
`make setup` to prepare the environment without starting the servers and
`make db-up` / `make db-down` to manage PostgreSQL. The manual sequence is in
[README.md](./README.md).

API unit tests run with `cd apps/api && bun run test`. The private-network
checks against a real cluster run with `KUBECONFIG=$(./scripts/cluster.sh kubeconfig)`
and `cd apps/api && bun run test:cluster` (needs `make cluster-up`).

The API targets the Kubernetes cluster from `KUBECONFIG` (the shell value wins
over `apps/api/.env`; a path or inline YAML), otherwise the local OrbStack
cluster, otherwise (with `CLUSTER=0`) the current kubeconfig context
(`~/.kube/config`). The local cluster is an OrbStack Linux machine named
`acceleratio` that runs `deploy/install.sh` from this checkout, so it matches a
server: k3s with embedded etcd, Cilium, RustFS for S3, VictoriaMetrics for the
project Observability tab and VictoriaLogs with Vector for the Logs tab. Storage
differs: servers use Longhorn, the OrbStack machine (LXC, no iSCSI) uses the k3s
local-path provisioner (`STORAGE_BACKEND=local-path`), so storage profiles are
unavailable in development and Longhorn-specific behaviour is checked on a VM.
`make dev` port-forwards RustFS for the API (`RUSTFS_S3_API_ENDPOINT`). `make dev`
and `make setup` create or start it through `scripts/cluster.sh up` (idempotent;
the released API and console the installer deploys are scaled to zero), write
`~/.kube/acceleratio-orbstack.yaml` (context `orbstack-acceleratio`) and pass the
cluster's join values to the API. `make cluster-down` deletes the machine. `make dev`
validates the effective kubeconfig and refuses non-local contexts unless
`ALLOW_REMOTE_KUBECONTEXT=1` is set; never point local development at a shared or
production cluster.
See the Kubernetes section in [README.md](./README.md).

## Documentation

- [PRODUCT.md](./docs/PRODUCT.md) — who the console is for, what the product is, and what is not shipped yet.
- [DESIGN.md](./docs/DESIGN.md) — the visual system: palette, type, layout, components, and the rules the console is held to.
- [FILE_STRUCTURE.md](./docs/FILE_STRUCTURE.md) — folder conventions for the frontend (routes, API modules, domain modules, styling, accessibility) and the API (submodules, schemas, services, code style).
- [DATABASE.md](./docs/DATABASE.md) — the PostgreSQL data model, table and enum reference, and the Drizzle migration workflow.
- [ILLUSTRATIONS.md](./docs/ILLUSTRATIONS.md) — how to generate the auth datacenter imagery: composition, lighting, prompt recipe, and the asset ledger.
