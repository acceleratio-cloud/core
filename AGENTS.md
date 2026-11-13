# AGENTS.md

Acceleratio — an open-source, self-hosted cloud platform. The console lives in `apps/frontend`, the public documentation site (Fumadocs) in `apps/docs`.

## Local development

The API and console run from source against a personal development server: a
remote Ubuntu/Debian server installed with `sudo ./scripts/install.sh --dev`.
It gets the full platform (k3s with embedded etcd, Cilium, Longhorn, RustFS,
VictoriaMetrics, VictoriaLogs with Vector, CloudNativePG, PostgreSQL, the image
registry) without the API and console, and publishes PostgreSQL (node port
30432) and RustFS S3 (30900). The installer prints the `apps/api/.env` values
(`DATABASE_URL`, `RUSTFS_S3_API_ENDPOINT`, join values, `ACCELERATIO_PUBLIC_IP`);
`KUBECONFIG` is `/etc/acceleratio/kubeconfig.yaml` copied from the server (the
shell value wins over `apps/api/.env`; a path or inline YAML). Then
`bun run db:migrate` and `bun run start:dev` in `apps/api`, `bun run dev` in
`apps/frontend`; the API is on <http://localhost:8080>, the console on
<http://localhost:3000>, and the first account is created at
<http://localhost:3000/auth/installation>. Never point local development at a
shared or production cluster. The full sequence is in [CONTRIBUTING.md](./CONTRIBUTING.md#development-setup).

API unit tests run with `cd apps/api && bun run test`. The private-network
checks against a real cluster run with `cd apps/api && bun run test:cluster`
and `KUBECONFIG` set to the development server's kubeconfig.

## Documentation

- [PRODUCT.md](./docs/PRODUCT.md) — who the console is for, what the product is, and what is not shipped yet.
- [DESIGN.md](./docs/DESIGN.md) — the visual system: palette, type, layout, components, and the rules the console is held to.
- [FILE_STRUCTURE.md](./docs/FILE_STRUCTURE.md) — folder conventions for the frontend (routes, API modules, domain modules, styling, accessibility) and the API (submodules, schemas, services, code style).
- [DATABASE.md](./docs/DATABASE.md) — the PostgreSQL data model, table and enum reference, and the Drizzle migration workflow.
