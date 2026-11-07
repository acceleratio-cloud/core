# AGENTS.md

Acceleratio — an open-source, self-hosted cloud platform. The console lives in `apps/frontend`.

## Local development

From a fresh clone, `make dev` (or `./scripts/dev.sh`) installs dependencies,
starts PostgreSQL through Docker Compose, applies Drizzle migrations, and runs
the API on <http://localhost:8080> and the console on <http://localhost:3000>.
Create the first account at <http://localhost:3000/auth/installation>. Use
`make setup` to prepare the environment without starting the servers and
`make db-up` / `make db-down` to manage PostgreSQL. The manual sequence is in
[README.md](./README.md).

API unit tests run with `cd apps/api && bun run test`. The private-network
checks against a real cluster run with `KUBECONFIG=$(./scripts/cluster.sh kubeconfig)`
and `cd apps/api && bun run test:cluster` (needs `make cluster-up`).

The API targets the Kubernetes cluster from `KUBECONFIG` (the shell value wins
over `apps/api/.env`; a path or inline YAML), otherwise the k3d cluster created
by `make cluster-up`, otherwise the current kubeconfig context
(`~/.kube/config`). `make dev` validates the effective value and refuses
non-local contexts unless `ALLOW_REMOTE_KUBECONTEXT=1` is set. Use
`make cluster-up` / `make cluster-down` for a disposable local k3d + Cilium
cluster, and never point local development at a shared or production cluster.
The local cluster reads the k3s, Cilium and SeaweedFS chart versions from
`deploy/install.sh` and installs SeaweedFS + CSI (`SEAWEEDFS=0` skips it) and
VictoriaMetrics for the project Observability tab (`VICTORIAMETRICS=0` skips it)
and VictoriaLogs with Vector for the project Logs tab (`VICTORIALOGS=0` skips it).
See the Kubernetes section in [README.md](./README.md).

## Documentation

- [PRODUCT.md](./docs/PRODUCT.md) — who the console is for, what the product is, and what is not shipped yet.
- [DESIGN.md](./docs/DESIGN.md) — the visual system: palette, type, layout, components, and the rules the console is held to.
- [FILE_STRUCTURE.md](./docs/FILE_STRUCTURE.md) — folder conventions for the frontend (routes, API modules, domain modules, styling, accessibility) and the API (submodules, schemas, services, code style).
- [DATABASE.md](./docs/DATABASE.md) — the PostgreSQL data model, table and enum reference, and the Drizzle migration workflow.
- [ILLUSTRATIONS.md](./docs/ILLUSTRATIONS.md) — how to generate the auth datacenter imagery: composition, lighting, prompt recipe, and the asset ledger.
