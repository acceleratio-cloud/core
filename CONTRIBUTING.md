# Contributing to Acceleratio

Thanks for your interest in Acceleratio, an open-source, self-hosted cloud
platform. This guide explains how to set up a development environment, what we
expect from a change, and how to get it merged.

By contributing you agree that your contribution is licensed under the
[Apache License 2.0](./LICENSE), the same license as the project.

Please follow the [Code of Conduct](./CODE_OF_CONDUCT.md). To report a
vulnerability, do not open a public issue: follow [SECURITY.md](./SECURITY.md).

## Before you start

- For anything larger than a small fix, open an issue first and describe the
  problem and your proposed approach. It saves you from building something we
  cannot merge.
- Check [docs/PRODUCT.md](./docs/PRODUCT.md) for what the product is and what is
  not shipped yet. We show only what ships: a change must not present planned
  work as a capability.
- Look for existing issues before filing a new one.

## Development setup

Requirements: Docker, [Bun](https://bun.sh) 1.4 and Node.js 22.

```bash
make dev
```

This installs dependencies, starts PostgreSQL through Docker Compose, applies
migrations, and runs the API on <http://localhost:8080> and the console on
<http://localhost:3000>. Create the first account at
<http://localhost:3000/auth/installation>.

Useful targets: `make setup` (prepare without starting servers), `make db-up` /
`make db-down`, `make migrate`, and `make cluster-up` / `make cluster-down` for a
disposable local k3d + Cilium cluster. The manual sequence is in the
[README](./README.md).

**Never point local development at a shared or production cluster.** `make dev`
refuses non-local Kubernetes contexts unless `ALLOW_REMOTE_KUBECONTEXT=1` is
set; do not set it for a cluster you care about.

## Repository layout

- `apps/api` - NestJS API ("core"), Drizzle schema and migrations.
- `apps/frontend` - Next.js console.
- `packages/shared` - the typed contract between the two.
- `deploy` - installer, updater and uninstaller for a k3s server.

Conventions live in [docs/FILE_STRUCTURE.md](./docs/FILE_STRUCTURE.md). Read it
before adding files: for example, tests go in a `tests/` folder and are never
colocated next to the source. Visual decisions follow
[docs/DESIGN.md](./docs/DESIGN.md), and database changes follow
[docs/DATABASE.md](./docs/DATABASE.md).

## Checks to run before opening a PR

CI runs these, so run them locally first.

API:

```bash
cd packages/shared && bun install && bun run build
cd ../../apps/api
bun install
bun x eslint "{src,tests}/**/*.ts"   # report only; `bun run lint` auto-fixes
bun run test
bun run build
```

Console:

```bash
cd apps/frontend
bun install
bun run lint
bun run test
bun run build
```

Format with Prettier (`bun run format` in `apps/api`).

### Database changes

Migrations are generated and forward-only. Edit the Drizzle schema, run
`bun run db:generate` in `apps/api`, commit the generated SQL in
`apps/api/drizzle/`, then apply it with `bun run db:migrate` against a
development database and confirm the app still starts. Never edit or delete an
existing migration, and never reorder or remove enum values. See
[docs/DATABASE.md](./docs/DATABASE.md).

### Deploy scripts

Changes to `deploy/*.sh` must keep working on a fresh Ubuntu 22.04, Ubuntu
24.04 and Debian 12 server. Say in the PR how you tested them (`--dry-run` is
not enough for behavior changes).

## Making a change

1. Fork the repository and create a branch from `main`.
2. Keep the change focused. One concern per pull request; unrelated cleanups go
   in their own PR.
3. Add or update tests for behavior you change.
4. Update the documentation when behavior, configuration or commands change.
5. Write a commit message with a short imperative subject that says what changed,
   for example `Add domains with automatic HTTPS to Docker services`.
6. Open a pull request against `main`. Describe what and why, link the issue,
   and include screenshots for UI changes.

A maintainer will review it. Expect questions and requests for changes; CI must
pass before merge.

## Security and secrets

- Never commit credentials, kubeconfigs, tokens or `.env` files. Only
  `.env.example` files with placeholders belong in the repository.
- Do not paste real hostnames, IP addresses or customer data into issues, logs
  or tests; use documentation values such as `203.0.113.10`.

## Questions

Open a GitHub issue or discussion. Thank you for helping make Acceleratio better.
