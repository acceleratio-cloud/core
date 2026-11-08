# Database

Acceleratio keeps control-plane state in PostgreSQL. The database belongs to the API: only
`apps/api` opens a connection, owns Drizzle table definitions, and runs migrations. The console in
`apps/frontend` is a browser application with no database of its own; it reads and writes through the
HTTP API and shares types through `packages/shared`. A query belongs in the API, never in the console.

## Where the schema lives

- `apps/api/src/vendor/db/schema.ts` — better-auth tables (`user`, `session`, `account`,
  `verification`). The library owns them, so they keep their camelCase keys and are not part of the
  domain modules.
- `apps/api/src/application/<module>/schemas/<name>.schema.ts` — domain tables, one file per module
  (`project.schema.ts`, `workload.schema.ts`). The module that serves a table owns its definition.
- `apps/api/drizzle.config.ts` — dialect, schema globs, and the output directory. It loads
  `src/vendor/db/schema.ts` plus `src/application/**/schemas/*.schema.ts`, so a new module schema is
  picked up automatically.
- `apps/api/drizzle/*.sql` — generated, forward-only migrations.
- `apps/api/drizzle/meta/` — Drizzle snapshots and `_journal.json`. These are generated; never edit
  them by hand.

Table conventions (naming, timestamps, indexes, delete behavior) are in
[FILE_STRUCTURE.md#schemas](./FILE_STRUCTURE.md#schemas). This document describes the model itself.

## Data model

```mermaid
erDiagram
    user ||--o{ session : "has"
    user ||--o{ account : "has"
    project ||--o{ workload : "contains"
    workload ||--o{ workload_version : "has history"
    workload |o--o| workload_version : "runs"
    workload ||--o{ workload_domain : "is served on"

    user {
        text id PK
        text name
        text email UK
        boolean email_verified
        text image
        timestamp created_at
        timestamp updated_at
    }
    session {
        text id PK
        text token UK
        timestamp expires_at
        text ip_address
        text user_agent
        text user_id FK
        timestamp created_at
        timestamp updated_at
    }
    account {
        text id PK
        text account_id
        text provider_id
        text user_id FK
        text access_token
        text refresh_token
        text id_token
        timestamp access_token_expires_at
        timestamp refresh_token_expires_at
        text scope
        text password
        timestamp created_at
        timestamp updated_at
    }
    verification {
        text id PK
        text identifier
        text value
        timestamp expires_at
        timestamp created_at
        timestamp updated_at
    }
    project {
        uuid id PK
        varchar name
        timestamp created_at
        timestamp updated_at
    }
    workload {
        uuid id PK
        uuid project_id FK
        varchar name
        workload_type type
        uuid active_version_id FK
        jsonb draft_config
        jsonb position
        varchar external_name
        varchar internal_hostname
        timestamp last_deployed_at
        timestamp created_at
        timestamp updated_at
    }
    workload_version {
        uuid id PK
        uuid workload_id FK
        integer number
        jsonb config
        uuid source_version_id FK
        timestamp created_at
    }
    workload_domain {
        uuid id PK
        uuid workload_id FK
        varchar hostname UK
        workload_domain_kind kind
        integer port
        workload_domain_status status
        text status_message
        boolean routed
        timestamp verified_at
        workload_domain_certificate_status certificate_status
        timestamp created_at
        timestamp updated_at
    }    storage_class {
        uuid id PK
        storage_class_kind kind
        varchar name
        text description
        varchar external_name UK
        jsonb parameters
        storage_class_reclaim_policy reclaim_policy
        storage_class_volume_binding_mode volume_binding_mode
        boolean allow_volume_expansion
        timestamp created_at
        timestamp updated_at
    }
    storage_class ||--o{ storage_benchmark : "measured by"
    storage_benchmark {
        uuid id PK
        uuid storage_class_id FK
        varchar storage_class_name
        storage_benchmark_status status
        jsonb results
        jsonb tests
        varchar current_test
        varchar failed_step
        jsonb profile_snapshot
        jsonb environment
        varchar external_name
        timestamp started_at
        timestamp finished_at
    }
    platform_update {
        uuid id PK
        varchar from_version
        varchar to_version
        platform_update_status status
        varchar stage
        text message
        text log
        varchar external_name
        varchar actor
        timestamp started_at
        timestamp reported_at
        timestamp finished_at
    }
    platform_release_check {
        smallint id PK
        varchar latest_version
        jsonb releases
        timestamp checked_at
        text error
    }
    node_operation {
        uuid id PK
        varchar node_name
        node_operation_type type
        node_operation_status status
        varchar step
        text message
        integer evicted
        integer remaining
        jsonb stuck
        jsonb log
        varchar actor
        timestamp started_at
        timestamp finished_at
    }
```

## Tables

### `project`

One row per project. `id` is a server-generated UUID used in URLs and as the Kubernetes namespace
suffix. `name` is operator-visible and not unique. Deleting a project cascades to its workloads.

Columns: `id`, `name`, `created_at`, `updated_at`.

### `workload`

One row per deployable node on the project canvas. `project_id` scopes every read and write.

Columns: `id`, `project_id`, `name`, `type`, `active_version_id`, `draft_config`, `position`,
`external_name`, `internal_hostname`, `storage_class_id`, `last_deployed_at`, `created_at`,
`updated_at`.

Invariants:

- `(project_id, external_name)` is unique. `external_name` becomes the Kubernetes Deployment name,
  is generated once on create, and never changes.
- `auto_deploy` (migration `0025`, default true) lets a push to the followed branch deploy a `github`
  workload that was deployed before. It applies at once and is not part of versions; other types
  ignore it.
- `internal_hostname` is the private DNS label of a `docker` workload (`<label>.internal` inside the
  project) and names its headless Service. `(project_id, internal_hostname)` is unique; the API also
  keeps it apart from every `external_name` of the project, since that is the name of the domain
  Service. It is the slug of the name on create (`postgres`, then `postgres-2`), does not follow a
  rename and can be changed on its own. Rows of other types leave it null. Migration
  `0019_workload_internal_hostname` leaves existing Docker rows null; the API names them on startup
  and on their next deploy, never with their `external_name`.
- `type` selects the shape of every config of the workload (`draft_config` and its versions). The
  values are `docker`, `s3_bucket` and `github`. A `github` config is a `docker` config plus `github_app_id`, `repository` and `branch` (the App and repository are fixed after creation; the branch can be changed, and the API checks that it exists on GitHub); its `docker_image` and `commit_sha` are written only by a successful build (`workload_build`) and are absent until the first one. A `docker` config carries the image reference (`docker_image`) and optional
  `cpu_max` (vCPU, default 1), `ram_max` (MiB, default 1024), `entrypoint` and `command` (string
  arrays that replace the image's ENTRYPOINT and CMD). An absent limit means the default and a null
  limit means no limit. New services are created with both limits null; configs stored before that
  keep their 1 vCPU / 1 GiB default. `env` is an ordered list of `{ key, value }` environment
  variables (POSIX names, unique, at most 256 and 512 KiB in total). Values are stored in plain text
  in the config and its versions; on deploy the API writes the applied version's variables to the
  Secret `<external_name>-env` and loads it with `envFrom`, and deletes the Secret when the version
  has none. Empty entrypoint/command/env lists are omitted, so older configs need no migration. Adding a type means adding an enum value and a config
  schema together.
- An `s3_bucket` workload is a SeaweedFS bucket. Its `name` and `external_name` are both the bucket
  name, which is unique across all projects (partial unique index `workload_s3_bucket_name_unique`,
  because SeaweedFS has one bucket namespace). Its config is `{ "storage_class_id": uuid }`, recorded
  once as version 1 and never changed; `storage_class_id` repeats it as a column so the storage
  profile cannot be deleted while a bucket uses it. It has no draft and no Deployment: the API sets
  its status from the provisioning Job (`deploying` until the bucket exists, then `running` or
  `failed`) and keeps it on the project Secret as the annotations `acceleratio.io/bucket-phase`
  (`provisioning`, `ready`, `failed`) and `acceleratio.io/bucket-message`; a Secret without the
  annotation predates it and counts as ready. The access keys live in the Secret `s3-<bucket>` in the project namespace, never in the
  database. For other types `storage_class_id` is null.
- The config lives in versions, not on the row. `active_version_id` points at the
  `workload_version` the cluster runs and is null until the first deploy. `draft_config` holds edits
  the next deploy applies and is null when there are none. At least one of the two is set: a new
  workload starts with a draft and no version. An edit back to the active config clears the draft.
- `position` is the canvas coordinate `{ "x": number, "y": number }`; both keys are required. The
  column default is `{ "x": 0, "y": 0 }`, while the API places new workloads in the first free slot of
  the project's four-column canvas grid. Existing rows that still sat at the origin were backfilled
  into the same grid.
- There is no status column. A workload's `status` (`draft`, `deploying`, `running`, `stopped`,
  `failed`), `status_message` and `status_observed_at` are derived from the cluster on every read, so
  the database never holds a second copy that can disagree with it (see
  [FILE_STRUCTURE.md#status-is-derived-not-stored](./FILE_STRUCTURE.md#status-is-derived-not-stored)).
  `last_deployed_at` records when a deploy action last ran, not when the deployment finished rolling
  out; it is also what separates a `draft` (never deployed) from a deployed workload whose Deployment
  has vanished. Migration `0021_drop_workload_status` removed the three columns and the
  `workload_status` enum.
- `workload_project_id_idx` covers lookups by project. The unique constraint doubles as the index for
  the project plus deployment name pair.

### `workload_version`

An immutable snapshot of a config that was applied to the cluster. A row is written only after the
cluster accepted the Deployment and is never updated; deleting a workload cascades to its versions.

Columns: `id`, `workload_id`, `number`, `config`, `source_version_id`, `created_at`.

Invariants:

- `(workload_id, number)` is unique. Numbers start at 1 and grow by one; the deploy locks the
  workload row while it takes the next number.
- A deploy with a draft writes a new version; a deploy without one reapplies the active version and
  writes nothing. A rollback writes a new version with the old config and sets `source_version_id`
  to the version it copied, so history only grows.
- `created_at` is when the version was applied. The pod template carries the version id in the
  `acceleratio.io/workload-version-id` annotation, so the cluster shows which version runs.
- Workloads that were deployed before versions existed were backfilled with v1 holding their config at
  `last_deployed_at`; workloads never deployed got that config as their draft (migration `0007`).
  Migration `0008` then dropped `workload.config`.

### `workload_build`

One image build of a `github` workload (migration `0024`). A deploy inserts a row with the branch head
`commit_sha` when the current image was not built from it, and starts a BuildKit Job named
`external_name` in the builds namespace (`acceleratio-builds`). The API polls `building` rows, also
after a restart: on success it stores `image` (the registry reference by digest), writes it with
`commit_sha` into the workload's draft and deploys it as `author` (the deploying user, kept so a build
finishing after a restart still credits them). `log` keeps the last 64 KiB of the builder output once
the build ends, because the Job and its pod are deleted an hour later. A build cancelled from the
console or superseded by a newer push ends as `cancelled` (migration `0025`) and is never deployed,
even when its Job finished first. Rows go with their workload.

### `workload_domain`

A hostname that sends HTTPS traffic to a Docker service. Domains are not part of the versioned config:
adding, changing or removing one writes the Traefik routes and the service's Kubernetes Service at once
and never touches the Deployment. Deleting a workload cascades to its domains (the service deletes
their routes first).

Columns: `id`, `workload_id`, `hostname`, `kind`, `port`, `status`, `status_message`, `routed`,
`verified_at`, `certificate_status`, `created_at`, `updated_at`.

Invariants:

- `hostname` is lowercase without a trailing dot and unique across all workloads
  (`workload_domain_hostname_unique`), because Traefik matches routes by host cluster-wide. The
  console URL in `system_setting` is rejected too.
- `kind = 'generated'` is `<label>-<a-b-c-d>.sslip.io` and at most one per workload
  (`workload_domain_generated_unique`, a partial unique index). It is created routed, with status
  `generated`, and `verified_at` set to its creation.
- `certificate_status` tracks HTTPS separately from routing: `pending` until the hostname completes a
  trusted TLS handshake through Traefik, then `issued`. `verified_at` (when the routes were published)
  bounds the wait: after 10 minutes it becomes `failed`. A generated domain keeps its routes and is
  still re-checked, since Traefik keeps retrying; a custom domain also moves to `status = 'failed'`
  and loses its routes. The console shows a domain as live only when this is `issued`.
- `kind = 'custom'` starts in `verification` with `routed = false`, and nothing is written to the
  cluster. Once its A record points to the server the routes are published, `routed` becomes true and
  `verified_at` is set; `success` follows when the hostname serves a trusted certificate. After
  10 minutes without one it becomes `failed`, its routes are removed and `routed` is false again. A
  workload has at most 20 custom domains (checked by the service).
- `port` is the container port, 1 to 65535 (`workload_domain_port_range`). The Service exposes the
  distinct ports of the routed domains.
- `status_message` explains the current step of a custom domain (waiting for the record, issuing the
  certificate, why it failed).

### `storage_class`

One row per SeaweedFS-backed Kubernetes StorageClass the console knows about. The row is the stable
identity other resources reference; the StorageClass object in the cluster is what Kubernetes uses.

Columns: `id`, `kind`, `name`, `description`, `external_name`, `parameters`, `reclaim_policy`,
`volume_binding_mode`, `allow_volume_expansion`, `created_at`, `updated_at`.

Invariants:

- `kind` is `platform` for the installer's class and `custom` for classes created in the console. At
  most one platform row exists (`storage_class_platform_unique`, a partial unique index). The API
  inserts it idempotently on the first read, named after `PLATFORM_STORAGE_CLASS_NAME` (default
  `seaweedfs-storage`). Its settings columns stay null: the installer owns the object, so its
  settings are read from the cluster, and the API refuses to update or delete it.
- `external_name` is the StorageClass name, unique, generated once as `sc-<slug>-<id prefix>` and
  never changed.
- `parameters` (the SeaweedFS CSI tuning: `replication`, `disk_type`, `collection`, `ttl`,
  `cache_capacity_mb`, `concurrent_writers`, `chunk_size_limit_mb`, `writeback_cache`),
  `reclaim_policy` and `volume_binding_mode` are written on create and never updated. Kubernetes
  forbids changing them on an existing StorageClass, so the console duplicates a class instead.
  `name`, `description` and `allow_volume_expansion` can change; the last one is patched on the live
  object.
- Resources that pick a class (volumes, buckets) reference it with
  `storage_class_id uuid references storage_class(id) on delete restrict`. The restriction is the
  database half of the delete guard; the API also refuses to delete a class that PersistentVolumes,
  claims in the cluster or S3 buckets still use.

### `storage_benchmark`

One fio run against a temporary volume of a storage profile. Runs are the benchmark history and
outlive their profile: `storage_class_id` references `storage_class` with `ON DELETE SET NULL`, and
`storage_class_name` keeps the profile name from when the run started (migration `0011` backfilled
it). `status` follows `pending` → `running` → `succeeded` or `failed`; `results` holds random
read/write IOPS, sequential read/write MB/s and random latencies when it succeeded, and
`status_message` explains a failure. `external_name` is the Job and claim name in the benchmark
namespace. `tests` holds one entry per finished test (parameters, IOPS, bandwidth, latency
percentiles, errors and a per-second series capped at 120 points, about 2 KB per run), written as
each test finishes so a running benchmark shows progress; `current_test` names the test running now.
`failed_step` is `install`, `provision`, `start`, `results` or a test name. `profile_snapshot`
copies the profile's settings and `environment` the node count, storage servers and Kubernetes
version when the run started (migration `0012`; older runs leave them null). The partial unique
index `storage_benchmark_active_unique` allows only one `pending` or
`running` row, so one benchmark runs across the cluster at a time. The newest 200 finished runs are
kept; older ones are pruned when a run finishes.

### `node_operation`

One change to a cluster server (`add`, `drain` or `remove`), so it is both the progress the console
polls and the audit trail. `node_name` is the Kubernetes Node name; it has no foreign key because the
Node lives in the cluster and a removed node's history must stay. `actor` is the email (or id) of the
account that started the operation. `step` is the phase now running (`connect`, `preflight`,
`install`, `wait_ready`, `cordon`, `evict`, `delete`, `uninstall`), `message` the current or final
status text, `evicted`/`remaining` count pods during a drain, and `stuck` lists the
`namespace/name` of pods that did not leave in time. `log` keeps the last 200 lines of progress and
command output, each cut to 500 characters. SSH keys, passphrases and the cluster join token are
never saved: log lines are redacted first. The partial unique index `node_operation_running_unique`
allows one `running` row per node. Operations run inside the API process, so rows still `running`
at startup are marked `failed` ("Interrupted by an API restart").

### `platform_update`

One platform update started from the console (Settings → System → Platform version). It holds both
the progress the console polls and the history. `from_version` and `to_version` are release versions
without the leading v. `stage` is where the update stands: `launch`, `download`, `prepare`, `backup`,
`install`, `verify`, `cleanup`, and `rollback` after a failure. It is `done` after a success.
`message` is the outcome or the reason of a failure, and `log` keeps the last 128 KiB of the update
log with terminal escapes removed. `external_name` names both the launcher Job and the status
ConfigMap (`platform-update-<12 hex>`). `actor` is the email (or id) of the account that started the
update. The update runs on the server as a systemd unit, not in the API. The server publishes
progress to the ConfigMap, and every API process copies it into the row (`reported_at` is the
server's last report). An update therefore survives the API being replaced: rows still `pending` or
`running` at startup are polled again. The partial unique index `platform_update_active_unique`
allows one `pending` or `running` row.

### `platform_release_check`

The last release check in a single row (`id` 1, kept there by the check
`platform_release_check_singleton`). `releases` lists every stable release found on GitHub, newest
first, with its name, notes, page and `checksums_url` (its `SHA256SUMS`); `latest_version` is the
first one. `checked_at` is the last check, successful or not, and `error` why it failed. A failed
check keeps the releases of the last successful one.

### `system_setting`

Installation-wide settings in a single row: the primary key `id` defaults to `1`, and the check
`system_setting_singleton` keeps it there. The row is created on first write. `control_plane_url`
is the applied root URL (`https://host`) that the console is served at through Traefik; it is null
until someone changes it, and the installer's IP:NodePort address keeps working either way. A change
in progress lives in `pending_control_plane_url` with `pending_status` going `awaiting_dns` →
`provisioning` → promoted into `control_plane_url` (pending columns cleared), or `failed` with
`pending_error`. `pending_applied_at` is when `provisioning` started and bounds the wait for the
HTTPS certificate to ten minutes. The URL lives in the database rather than the installer's
environment so a re-run of the installer does not undo it.

### `github_app`

A GitHub App created from Settings → Integrations; several can exist so access can later be granted
per App. `id` is generated before GitHub creates the App because the webhook and setup URLs in the
manifest contain it. `github_app_id` is GitHub's own id. `client_secret_enc`, `webhook_secret_enc`
and `private_key_enc` are AES-256-GCM ciphertext (`v1:<iv>:<tag>:<data>`) made with
`INTEGRATIONS_ENCRYPTION_KEY`, which lives in the API's environment and never in the database; losing
it makes them unreadable, and the App must be created again. `created_by` is the better-auth user id,
without a foreign key.

### `github_installation`

One install of a `github_app` on a GitHub account or organization. `installation_id` is GitHub's id and
unique across Apps. Rows are removed with their App (`ON DELETE CASCADE`) and kept in step by the
App's `installation` and `installation_repositories` webhooks. Repositories are not stored: they are
read from GitHub on demand.

### better-auth tables

`user`, `session`, `account`, and `verification` are written by better-auth, not by application code.
`user.email` and `session.token` are unique. `session.user_id` and `account.user_id` reference
`user.id` with `ON DELETE CASCADE`, and both columns have an index. `verification.identifier` is
indexed because lookups happen by identifier. Timestamps named `expires_at` are compared by the
library; do not repurpose them.

## Enums

| Enum | Values | Used by |
| --- | --- | --- |
| `workload_type` | `docker`, `s3_bucket`, `github` | `workload.type` |
| `storage_class_kind` | `platform`, `custom` | `storage_class.kind` |
| `storage_class_reclaim_policy` | `Delete`, `Retain` | `storage_class.reclaim_policy` |
| `node_operation_type` | `add`, `drain`, `remove` | `node_operation.type` |
| `node_operation_status` | `running`, `succeeded`, `failed` | `node_operation.status` |
| `platform_update_status` | `pending`, `running`, `succeeded`, `failed`, `rolled_back` | `platform_update.status` |
| `storage_benchmark_status` | `pending`, `running`, `succeeded`, `failed` | `storage_benchmark.status` |
| `storage_class_volume_binding_mode` | `Immediate`, `WaitForFirstConsumer` | `storage_class.volume_binding_mode` |
| `control_plane_change_status` | `awaiting_dns`, `provisioning`, `failed` | `system_setting.pending_status` |
| `workload_build_status` | `building`, `succeeded`, `failed`, `cancelled` | `workload_build.status` |
| `workload_domain_kind` | `generated`, `custom` | `workload_domain.kind` |
| `workload_domain_status` | `generated`, `verification`, `success`, `failed` | `workload_domain.status` |
| `workload_domain_certificate_status` | `pending`, `issued`, `failed` | `workload_domain.certificate_status` |

Enum values are part of the database contract. Add a value with a migration; never reorder or remove
one that has shipped.

## Migrations

Migrations are generated from the Drizzle schema and applied in order. The journal and snapshots
record what a database has seen, so the three artifacts move together.

After changing a schema file:

1. Run `bun run db:generate` in `apps/api`. Review the generated SQL: a dropped column or an
   unrequested type change means the schema edit was wrong.
2. Read the new `drizzle/000N_*.sql`, `drizzle/meta/000N_snapshot.json`, and the updated
   `drizzle/meta/_journal.json`. Commit all three in the same change as the schema edit.
3. Run `bun run db:check` to verify the journal, snapshots, and SQL files form one consistent chain.
   It does not need a database.
4. Run `bun run db:migrate` against a development database and confirm the application still starts.

Rules:

- Migrations are forward-only. Never edit a migration that has been applied anywhere; add a new one.
- Backfills must be idempotent and safe to rerun. Migration `0004` is the reference: it adds nullable
  columns, fills `external_name`, then sets `NOT NULL` and adds the unique constraint.
- `db:push` mutates a database without writing a migration. Use it only for a throwaway local
  database; never against a shared or deployed one.
- A migration that changes or drops data needs a rollback note in the pull request.

## Verifying a schema change

```bash
cd apps/api

# 1. The generated migration set matches the schema files.
bun run db:check

# 2. Migrations apply cleanly to an empty database.
createdb readiness_check
DATABASE_URL=postgresql://acceleratio@localhost:5432/readiness_check bun run db:migrate
psql -d readiness_check -c '\dt'

# 3. The application compiles against the new row types.
bun run build

# Clean up the scratch database.
dropdb readiness_check
```

`db:check` prints `Everything's fine` when the files are consistent. On drift it names the mismatch;
regenerate the affected migration rather than editing snapshots.

## Changing the model

- A new domain table goes in the owning module's `schemas/` folder, is exported with its inferred row
  type, and gets a migration in the same change.
- A new column on an existing table follows the same path; keep it nullable until the backfill has
  run when the table may already contain rows.
- Read paths return rows through the module's service and map them to the `packages/shared` contract.
  The console imports those types; it never imports Drizzle.
- The API contract and the database model are related but not identical: the contract is the public
  surface, the schema is storage. Change both deliberately.

## Frontend data model

The console has no database, no ORM, and no migrations. Its data model is the API contract in
`packages/shared/src/types/`, and every read or write goes through `apps/frontend/src/api/`. When a
table changes, update the contract and the console mapping; no database work happens in
`apps/frontend`.
