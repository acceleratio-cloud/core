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

The API and the console run from source on your machine against a development
server: an Ubuntu or Debian server (VM or bare metal) that only you use. It
runs the whole platform except the API and the console, and publishes
PostgreSQL (port `30432`) and RustFS S3 (port `30900`) for your local API.

**Never point local development at a shared or production cluster.**

On the server ([requirements](./scripts/README.md#requirements)):

```bash
curl -fsSL https://raw.githubusercontent.com/acceleratio-cloud/core/main/scripts/install.sh | sudo bash -s -- --dev
```

It ends by printing the values for `apps/api/.env`. Allow ports `30432`,
`30900` and `6443` from your address only: PostgreSQL and S3 are protected by
their passwords alone. Run the command again to update the server; to test
installer changes, copy your `scripts/install.sh` there and run
`sudo ./install.sh --dev`.

On your machine you need [Bun](https://bun.sh) 1.4 and Node.js 22:

```bash
scp root@<server>:/etc/acceleratio/kubeconfig.yaml ~/.kube/acceleratio-dev.yaml

cp apps/api/.env.example apps/api/.env
# Add the values the installer printed and KUBECONFIG=~/.kube/acceleratio-dev.yaml,
# and set BETTER_AUTH_SECRET and INTEGRATIONS_ENCRYPTION_KEY (openssl rand -base64 32).
cp apps/frontend/.env.example apps/frontend/.env.local

(cd packages/shared && bun install && bun run build)
(cd apps/api && bun install && bun run db:migrate)
(cd apps/frontend && bun install)

# One terminal each
(cd apps/api && bun run start:dev)       # http://localhost:8080
(cd apps/frontend && bun run dev)        # http://localhost:3000
```

Create the first account at <http://localhost:3000/auth/installation>.

To change the API port, update `PORT` and `BETTER_AUTH_URL` in `apps/api/.env`
and `NEXT_PUBLIC_API_URL` in `apps/frontend/.env.local`. For another console
port, run `bun run dev -- --port 3001` and add its origin to `CORS_ORIGINS`.

### GitHub integration

Settings → Integrations creates a GitHub App that works on `localhost`, but
GitHub delivers webhooks (pushes, uninstall, suspend) only over HTTPS. To
receive them, tunnel the API, for example with
`ngrok http --url=<your-static-domain> 8080`, set
`GITHUB_CALLBACK_BASE_URL=https://<your-static-domain>` in `apps/api/.env` and
restart the API before creating the App.

### Container images

Both images build from the repository root, because the apps depend on
`packages/shared`:

```bash
docker build -f apps/api/Dockerfile -t acceleratio/api:dev .
docker build -f apps/frontend/Dockerfile -t acceleratio/console:dev .
```

The API image does not migrate on start; run
`node dist/vendor/db/migrate.js` in it first. The console reads `API_URL` (and
optionally `API_INTERNAL_URL`) at start. Both answer `GET /healthz`.

## Repository layout

- `apps/api` - NestJS API ("core"), Drizzle schema and migrations.
- `apps/frontend` - Next.js console.
- `packages/shared` - the typed contract between the two.
- `scripts` - installer, updater and uninstaller for a k3s server.

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

Changes to `scripts/*.sh` must keep working on a fresh Ubuntu 22.04, Ubuntu
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
