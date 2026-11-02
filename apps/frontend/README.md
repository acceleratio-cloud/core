# Console

The operator console for Acceleratio. It is a Next.js App Router application that signs operators in,
bootstraps the first account, and renders projects, workloads, servers and settings.

## Data access

The console has no database, ORM, or migrations. It is a client of the API in `apps/api`; every read
and write goes through `src/api/`, which forwards the session cookie and talks to
`NEXT_PUBLIC_API_URL`. Types for requests and responses come from `packages/shared`.

Server components use the `server.ts` modules under `src/api/` and forward cookies explicitly. Client
components use the `index.ts` modules. Keep the HTTP boundary in `src/api/`; do not call the database
directly from a route, a component, or a server action.

The storage model and migration workflow are documented in
[`docs/DATABASE.md`](../../docs/DATABASE.md).

## Routes

- `/auth` — sign-in.
- `/auth/installation` — first-run account creation, available only while the platform is
  uninitialized.
- `/` — dashboard shell with projects.
- `/project/[id]` — project workspace and workload canvas.
- `/servers`, `/settings` — cluster nodes and operator settings.

## Commands

```bash
bun install
bun run dev     # next dev
bun run build   # next build, includes type checking
bun run lint    # eslint
```

Set `NEXT_PUBLIC_API_URL` to the API origin in `.env.local` before running. The file is ignored by
git; see `apps/api/.env.example` for the API side.
