# Frontend structure

src/
  app/ - Next.js App Router: routes, layouts and route groups
    (dashboard)/ - authenticated console
    auth/ - sign-in and first-run installation
  api/ - HTTP layer, the only place that talks to the API
    index.ts - axios instance (runtime API URL, credentials), getApiBaseUrl and getApiErrorMessage
    [module-name]/
      index.ts - client calls, one exported object per module (projectsApi)
      server.ts - server-only calls for route files (getServerProject), forwards cookies
  modules/ - product domains
    [module-name]/
      containers/ - client components with state, effects and api calls
      components/ - presentational components: props in, markup out
      providers/ - context provider plus its useX hook
      hooks/ - client hooks that own fetching or polling for the domain (useProjectMetrics)
      utils/ - pure helpers for the domain
      layouts/ - domain layouts (auth)
      tests/ - unit tests for this module; never colocate *.spec.ts next to source
  shared/
    components/ui/ - shadcn primitives on @base-ui/react
    components/ - shared app components (canvas-loader)
    layouts/ - console shell: top navbar and user menu
    icons/ - hand-written SVG icons
  lib/utils.ts - cn() re-export

## Components and containers

- `containers/` own state, effects and api calls; they start with `'use client'` when they use hooks or
  browser APIs.
- `components/` are presentational: props in, markup out. No fetching; local state is allowed only when
  it is purely visual.
- Route files in `app/` stay server components. They `await connection()` when they read request data,
  `redirect()` unauthenticated users and `notFound()` missing resources.
- Push `'use client'` down the tree: keep pages and layouts on the server and mark the smallest
  interactive component.
- Route files take the generated `PageProps<"...">` and `LayoutProps<"...">` types instead of
  hand-written prop types.

## Project page

- `/project/[id]` is one route with four tabs (`modules/projects/tabs.ts`): Architecture (the workload
  canvas), Observability, Logs and Settings. They are not routes: `ProjectView` reads `?tab=` through
  `useSearchParams` and writes it with `history.replaceState` (Architecture omits it), so a reload or a
  shared link opens the same tab without a server round trip. The project switcher keeps the tab.
- Panels mount on first visit and then stay mounted while hidden (`hidden` + `inert`), so the canvas
  keeps its viewport and status stream. A shown panel replays a short fade-and-slide entrance whose
  direction follows the tab order; the active tab pill slides between tabs.
- `modules/observability/` is the Observability dashboard. It polls
  `GET /projects/:projectId/metrics?range=` every 15 s only while its tab is active and the page is
  visible, and draws with Recharts. Series colors are the `--chart-1…6` tokens, assigned to services
  in workload order (never cycled; a seventh service folds into a neutral Other) so a service keeps
  its color in every panel. Saturation gauges use the `status-*` colors and always repeat the level
  as a word and an icon.
- `modules/logs/` is the Logs tab: every service of the project in one newest-first list. The
  container (`containers/logs-view.tsx`) owns the filters (service, pod, level, search, window);
  `hooks/use-log-history.ts` loads pages and older pages by cursor, `hooks/use-log-stream.ts` follows
  `GET /projects/:projectId/logs/stream` over `EventSource` (reconnecting by hand with backoff and
  `since` = the newest line, never the browser's own retry), and `hooks/use-log-overview.ts` loads
  the frequency chart and the sidebar facets. The list is virtualized with `@tanstack/react-virtual`;
  live lines land on top only while the reader is at the top, otherwise they wait behind a
  "new lines" button. Services keep their Observability colors (`assignSeriesTones`). A link opens
  the tab filtered: `projectLogsHref` builds `?tab=logs&service=<id>&pod=<name>`, used by
  `ViewLogsLink` in the service header, the instance rows and the Observability services table.
  A plain click goes through `useProjectTabs().openLogs` (`providers/project-tabs-provider.tsx`)
  instead: the tab bar's `replaceState` hides `?tab=` from `useSearchParams`, so only the context
  switches tabs reliably from inside the page. The level counts come from a histogram read without
  the level filter; the chart hides unselected levels itself.
- The console imports only types from `@acceleratio/shared`: the package is not resolvable at
  runtime in the Next bundle, so contract constants the UI needs (metric ranges, the Other series
  key) are mirrored in the module that uses them.

## Data fetching

- Client calls live in `api/[module]/index.ts` as one exported object per module (`projectsApi`,
  `workloadsApi`). Methods resolve to `data` only; errors bubble to the caller.
- Server calls live in `api/[module]/server.ts`, start with `import "server-only"` and forward the
  cookie header from `next/headers`. They return `null` for 400 and 404 and rethrow everything else.
- Nothing outside `api/` imports axios or calls `fetch` directly.

## Providers

- Providers live in `modules/[name]/providers/` and export the component plus a `useX` hook that throws
  when it is used outside the provider.
- Context values are memoized with `useMemo`; actions are wrapped in `useCallback`.
- Fetching effects use an `active` flag and clean up in the returned function, so a late response cannot
  set state after unmount.

## UI primitives

- `shared/components/ui/*` are shadcn components built on `@base-ui/react`. They accept `className` and
  merge it last through `cn`.
- `cn` comes from `@/lib/utils`, which re-exports the `cn` package. Never concatenate class strings by
  hand.
- Primitives expose `data-slot` attributes and derive their props from the base-ui primitive types.
- Do not hand-edit a generated primitive beyond a project wrapper; add a new one from the registry
  instead.

## Styling

- Tailwind only. No CSS modules, no inline `style`, no CSS-in-JS.
- Colors, borders and spacing come from design tokens (`bg-popover`, `text-muted-foreground`,
  `border-border`), never raw hex values.
- Conditional classes go through `cn(...)`; a passed `className` is merged last.
- Animate with `animate-in` and `data-[starting-style]`, and always pair it with
  `motion-reduce:animate-none` or `motion-reduce:transition-none`.
- Long text uses `truncate` with a `title` attribute; aligned numbers use `tabular-nums`.
- Icons come from `lucide-react` or `shared/icons`, use `strokeWidth={1.75}` unless a heavier stroke is
  deliberate, and are `aria-hidden="true"` when decorative.

## Accessibility

- Icon-only buttons carry an `aria-label`.
- Loading regions set `aria-busy="true"` with an `sr-only` description; async feedback such as copying
  uses `role="status"`.
- Decorative icons, separators and spacers are `aria-hidden="true"`.
- The console shell keeps a `Skip to content` link that is `sr-only` until it receives focus.

## Naming and imports

- Files are kebab-case; components are PascalCase; hooks are `useX`; providers are `XProvider`; api
  objects are `xApi`; skeletons are `XSkeleton`.
- snake_case for every field in the API contract and in Drizzle schema keys; camelCase only for local
  frontend variables and function parameters (`projectId`, `dockerImage`).
- Import order: `'use client'`, then react and next, then third-party, then `@acceleratio/shared` types,
  then `@/` aliases, then relative siblings.
- Type-only imports use `import type`.
- Only files in `app/` use a default export; everything else is a named export.

## Formatting

- The repo format comes from the root `.prettierrc` (single quotes, trailing commas) plus Prettier
  defaults (semicolons, 80 columns). The tree still mixes both styles; new and edited files follow the
  config.
- `shared/components/ui/*` keeps the formatting shadcn generates (double quotes, no semicolons) and is
  not reformatted by hand.
- ESLint runs `next/core-web-vitals` and `next/typescript` and does not check formatting, so run
  Prettier before committing.

## Errors

- User-facing text comes from `getApiErrorMessage(error)` in `@/api`; never render a raw axios message.
- Components display the returned string as-is and do not map HTTP status codes themselves.

## Notifications

- `<Toaster />` from `@/shared/components/toaster` is mounted once in the root layout; never mount a
  second one. It wraps sileo, which ships without a `"use client"` directive, and holds the defaults:
  bottom-left, light theme, 4s duration.
- Fire toasts from client components with `sileo.success`, `sileo.error`, `sileo.info`,
  `sileo.warning` or `sileo.promise`; import `sileo` from `sileo` directly.
- Error toasts take their description from `getApiErrorMessage`, like any other error copy.
- State colors are mapped to console tokens in `globals.css` (`--sileo-state-*`), so success and info
  stay achromatic and only errors take Signal Red.

# Shared contract (packages/shared)

`@acceleratio/shared` is the internal library that holds the typed contract between `apps/frontend` and `apps/api`. Both apps depend on it via `file:../../packages/shared`.

packages/shared/
  package.json - package name, types point to src/index.ts
  src/
    index.ts - re-exports every domain module
    types/
      [module-name].ts - request and response types for one domain

Rules:
1) Import types only: `import type { AuthUser } from "@acceleratio/shared"`
2) Define API payloads and responses for a domain in `src/types/[module-name].ts` and re-export them from `src/index.ts`; never duplicate them in the apps
3) Types are resolved from source, so the package needs no build for type sharing; `main`/`dist` are reserved for runtime values and require `bun run build` inside `packages/shared`
4) bun copies `file:` dependencies into node_modules, so run `bun install` in the consuming app after changing the shared package
5) Response fields are snake_case (`created_at`, `project_id`, `email_verified`); request payloads follow the same rule. camelCase stays only for local variables, function parameters and values owned by a vendor library

# Backend structure (apps/api)

apps/api/src/
  main.ts - bootstrap: CORS from CORS_ORIGINS, port from PORT, shutdown hooks
  app.module.ts - root module: VendorModule + ApplicationModule
  common/ - helpers shared by submodules (input validation, DNS naming, exception filters)
  application/ - product features
    application.module.ts - the only Nest module in this layer; registers every submodule
    [submodule]/ - project/, workload/, node/, storage-class/, auth/
      [submodule].controller.ts - HTTP surface only
      [submodule].service.ts - logic, validation, database access
      [type]/ - workload only: one folder per workload type, see "Workload types"
        [type]-workload.service.ts - the full service for this type
        [type]-workload.manifests.ts - pure Kubernetes object builders
        [type]-workload.status.ts - pure cluster state to status mapping
        [type]-workload.deriver.ts - WorkloadStatusDeriver for this type
        [type]-workload.config.ts - config normalization for this type
        tests/ - unit tests for this type
      workload-status-deriver.ts - workload only: type to cluster snapshot interface
      workload-status-deriver.registry.ts - workload only: derivers looked up by type
      observer/ - workload only: cluster observation, see "Workload observer"
        workload-observer.service.ts - supervised informers, debounce and resync
        workload-snapshot.store.ts - in-memory Deployments and Pods by workload id
        workload-status.service.ts - derives a status from the snapshot on read and publishes changes
        workload-events.service.ts - project-scoped SSE fan-out
        tests/ - unit tests for the observer
      schemas/ - Drizzle tables owned by this submodule (optional)
        [submodule].schema.ts
      tests/ - unit tests for this submodule; never colocate *.spec.ts next to source
  vendor/ - infrastructure, exposed globally so application code can inject it anywhere
    vendor.module.ts - imports the db, auth and kubernetes modules
    db/ - pool, DATABASE token, better-auth tables
    auth/ - better-auth instance and its module (global by default)
    kubernetes/ - lazily built API clients and the cluster-wide watch service
    traefik/ - TraefikClient (availability check, IngressRoute/Middleware upsert and delete, HTTPS
      probe) and pure Traefik object builders, shared by the control plane URL and service domains

apps/api/tests/ - end-to-end tests: jest-e2e.json and *.e2e-spec.ts

## Submodules

A submodule is a folder inside `application/` that holds a controller, a service and, when it stores
data, its own Drizzle schemas. It has no `*.module.ts` of its own. Every controller and provider is
registered in `application.module.ts`:

```ts
@Module({
  controllers: [
    AuthController,
    NodeController,
    ProjectController,
    WorkloadController,
  ],
  providers: [
    NodeService,
    ProjectService,
    ProjectIsolationService,
    DockerWorkloadStatusDeriver,
    DockerWorkloadService,
    WorkloadStatusDeriverRegistry,
    WorkloadEventsService,
    WorkloadSnapshotStore,
    WorkloadStatusService,
    WorkloadObserverService,
    WorkloadTypeRegistry,
    WorkloadTypeResolver,
    WorkloadService,
  ],
})
export class ApplicationModule {}
```

The reason is circular dependencies. `WorkloadService` needs `ProjectService` to confirm the parent
project exists before it dispatches `create`; the Docker type service repeats that check on its own
path, and future type services may depend on project-side services too. The moment a project-side
operation needs workloads, two separate Nest modules would form a cycle that the container cannot
resolve: it would force `forwardRef(...)` in both modules and `@Inject(forwardRef(() => ProjectService))`
in the services. With one module the providers share a single injector and the cycle never reaches Nest.

Consequences:

1) Every registered provider shares one injector, so any service can inject any other service with no
   `imports` array anywhere.
2) There is no per-submodule encapsulation. The boundary is maintained by hand: cross-submodule calls
   go service to service, never controller to controller and never service to controller.
3) `ApplicationModule` exports nothing; nothing in this layer is injected outside it.
4) A submodule must not create its own Nest module just to group providers. Infrastructure is injected
   through the global token or service instead: `DATABASE`, `KubernetesService`, `AuthService`.

Adding a submodule:

1) create `application/<name>/<name>.controller.ts`, `<name>.service.ts` and, if it owns tables,
   `schemas/<name>.schema.ts`
2) add the contract types to `packages/shared/src/types/<name>.ts` and re-export them from
   `packages/shared/src/index.ts`
3) register the controller and the service in `application.module.ts`
4) run `bun run db:generate` and `bun run db:migrate` when schemas changed

## Workload types

`workload/` is the one submodule that stores several kinds of resource. Each type owns a folder with a
complete service instead of sharing a runtime adapter: `docker/` holds `DockerWorkloadService`, its
manifests, status derivation, status deriver, config normalization and tests. Common operations (project
existence, external names, row mapping, status persistence) are duplicated per type on purpose: a new
type must be free to diverge without changing another type's code. Each type service scopes its own row
queries to its type (`type = '<type>'`); rows of other types never enter it.

The shared layer stays small:

1) `workload-type-service.ts` declares the full type service: `type`, `list`, `create`, `get`, `update`,
   `deploy`, `start`, `stop`, `restart`, `remove`. Every type implements all of it.
2) `workload-type.registry.ts` holds `Map<WorkloadType, WorkloadTypeService>`, returns the service for
   a type (400 `Unsupported workload type` when missing) and `all()` for list merging.
3) `workload-type.resolver.ts` performs the only shared row query: `select type from workload where id
   and project_id`, with 404 `Workload not found`. It never reads or writes other columns.
4) `workload.service.ts` is a facade. `create` first confirms the project exists, then dispatches by
   `payload.type`; `get`, `update`, `deploy`, `start`, `stop`, `restart` and `remove` resolve the row
   type and delegate. `list` calls every registered service, merges the results and sorts by
   `created_at` with the id as a stable tie-breaker. The facade contains no Drizzle writes and no
   Kubernetes calls.

Adding a workload type:

1) create `workload/<type>/` with `<type>-workload.service.ts` implementing `WorkloadTypeService`, plus
   its manifests, status, deriver, config and `tests/`
2) register the service in `workload-type.registry.ts` and the deriver in
   `workload-status-deriver.registry.ts`; `DockerWorkloadService` and the Docker deriver stay untouched
3) add the type to the shared contract and the Drizzle enum in `schemas/workload.schema.ts`, then
   generate the migration
4) add the service and deriver to `application.module.ts` providers

### Docker service private network

Every project is one private network: its namespace plus the `CiliumNetworkPolicy` from
`ProjectIsolationService`. Every pod of the project reaches every other one on any port; pods of
other projects cannot connect in either direction (`world` covers only addresses outside the
cluster). There are no separate networks inside a project.

- Each Docker service has a private hostname (`workload.internal_hostname`): the slug of its name on
  create (`postgres`, then `postgres-2`), unique in the project and never equal to an
  `external_name` there. It does not follow a rename. `PATCH
  projects/:projectId/workloads/:id/internal-hostname` changes it at once, outside the draft: the new
  Service is written before the old one is deleted. The API returns it as `internal_hostname` and
  `internal_domain` (`postgres.internal`).
- `buildInternalService` in `docker-workload-network.manifests.ts` is a headless Service
  (`clusterIP: None`, no ports) named by that hostname, labeled `acceleratio.io/service-role:
  internal` and selecting the workload's pods. DNS answers with the ready pod IPs, so no port needs
  declaring. `DockerWorkloadNetworkService.ensureInternalService` writes it on every deploy, before
  the Deployment, and never touches the pods. It only manages Services that carry the internal role
  and the workload's id, so it never takes over the domain Service or another workload's name; such a
  clash is logged and the deploy goes on without the private name. It also deletes the workload's
  private Services under any other name (left by a rename), and the workload's removal deletes them
  all. It stays while the service has no domain.
- Renames and the startup pass run in `DockerWorkloadService`'s per-workload write queue, like a
  deploy, so a deploy in flight cannot bring an old name back. The startup pass names Docker rows that
  have no hostname yet (rows from before migration 0019) and writes the Service of deployed ones
  (`WORKLOAD_INTERNAL_BACKFILL=0` disables it); a deploy names such a row too.
- Because the Service is headless, the name follows pod IPs: a client that resolves once and keeps
  the address (nginx `proxy_pass` with a literal host, long-lived pools, the JVM DNS cache) reaches a
  stale IP after the target restarts. CoreDNS also caches answers for up to 30 s. A stable virtual IP
  would need declared ports, which the Docker config does not have yet.
- `<hostname>.internal` resolves through one cluster-wide CoreDNS rule, written by
  `ProjectDnsService` (`project/project-dns.service.ts`) into the `coredns-custom` ConfigMap that
  k3s's Corefile imports (key `acceleratio-internal.override`; other keys are left alone). A pod's
  resolv.conf searches `<namespace>.svc.<cluster domain>` first, so `postgres.internal` is asked as
  `postgres.internal.project-<id>.svc.…` and rewritten to `postgres.project-<id>.svc.…`. The
  namespace comes from the asking pod, so the name never resolves into another project. The short
  name `postgres` works as well. `CLUSTER_DOMAIN` overrides `cluster.local`.
- `ProjectIsolationService.ensure` calls `ProjectDnsService.ensure`, so every deploy path keeps the
  rule in place; after a success it is skipped for 5 minutes, so a ConfigMap deleted by hand comes
  back. If the `coredns` Corefile does not import `/etc/coredns/custom/*.override` (not k3s, or a
  customized Corefile), the API logs once that private names will not resolve.
- `apps/api/tests/cluster/project-network.cluster.test.ts` checks all of it on a real cluster:
  `bun run test:cluster` with `KUBECONFIG` pointing at the `make cluster-up` cluster. It runs on
  Node's test runner, because Jest cannot load the ESM-only Kubernetes client and Bun's fetch drops
  the kubeconfig client certificate.

### Docker service domains

`docker/docker-workload-network.service.ts` owns the domains of a Docker service (table
`workload_domain`, routes under `projects/:projectId/workloads/:id/domains`). Domains are not part of
the draft or of versions: every change writes the Traefik IngressRoutes and the ClusterIP Service named
after the workload's `external_name` at once, and never touches the Deployment, so pods do not roll.

- A generated domain is `<label>-<a-b-c-d>.sslip.io` (one per service) and is routed on creation. The
  IP comes from `ControlPlaneDnsService.expectedIp()`.
- A custom domain is saved in `verification` and writes nothing to the cluster until its A record
  points to the server; then its routes are published and the service waits for a trusted certificate
  (`success`), or marks it `failed` after 10 minutes and removes the routes.
- Each domain targets its own container port. The domain Service (named `external_name`) exposes
  the distinct ports of routed domains and is deleted with the last one; the private-network
  Service is separate and stays.
- The certificate is tracked separately (`certificate_status`): a domain counts as live only after a
  trusted TLS handshake. A generated domain whose certificate is late reports `failed` but keeps its
  routes and keeps being probed.
- A 15-second background pass re-checks pending custom domains and generated domains without a
  certificate (`WORKLOAD_DOMAIN_VERIFIER=0` disables it); `POST …/domains/:domainId/verify` checks
  one immediately.
- The project isolation policy lets Traefik pods (`kube-system`, `app.kubernetes.io/name=traefik`)
  reach project pods; publishing a domain re-applies it, so existing projects need no redeploy.
- The pure parts live in `docker-workload-network.domains.ts` (validation, sslip hostnames, status
  messages) and `docker-workload-network.manifests.ts` (Service, IngressRoutes, redirect Middleware).

## Workload observer

`workload/observer/` keeps the stored status equal to the cluster even when no console is open.
`WorkloadObserverService` starts on bootstrap unless `WORKLOAD_OBSERVER_ENABLED=false` and stops with
the application. `KubernetesWatchService` in `vendor/kubernetes/` owns the cluster-wide paths and list
calls.

### Sources and snapshot

- Two cluster-wide informers: Deployments selected by
  `app.kubernetes.io/managed-by=acceleratio` and Pods selected by the existence of the
  `acceleratio.io/workload-id` label.
- `WorkloadSnapshotStore` keys both kinds by `acceleratio.io/workload-id`; objects without that label
  are ignored. Pods are grouped by UID, or by name when the UID is absent, so updates do not duplicate
  entries. A workload id is accepted only when it is a canonical UUID: malformed objects are ignored
  before the id reaches the store or SQL.
- Add, update and delete events update the snapshot. Status writes are debounced by 250 ms with a
  maximum wait of 1 s.
- A full resync runs at startup and every `WORKLOAD_OBSERVER_RESYNC_MS` (default 60000). The timer is
  `unref`'d. A failed list leaves the previous snapshot and database rows untouched.
- A resync stamps its lists with the moment the requests started, not the moment they returned, and
  merges them into the snapshot instead of rebuilding it: a watch event applied while the lists were in
  flight is newer than what they returned, so a Deployment add, update or delete and any Pod change
  survive the merge. The Deployment part and the Pods are merged against their own timestamps, so a
  Pod event never pins a stale Deployment from the list and the reverse. A workload id the list no
  longer contains keeps an entry with no Deployment and no Pods, which keeps event-driven drift
  detection correct while `reconcileAll()` still covers rows with no entry.
- Each Pod carries its own observation time, so the Pod merge is per key: an event that landed after
  the list started keeps its version for that Pod only, without pinning the sibling Pods the list says
  are gone, and an untouched Pod takes the list value. A Pod delete leaves a tombstone under its key,
  so a list request that started before the delete cannot resurrect it. The full sweep calls
  `retain(liveIds, sweepStartedAt)` so tombstones for rows that no longer exist are dropped while
  entries touched after the sweep began are kept.
- Each informer is supervised: an error stops it and schedules a restart with 1, 2, 4, ... up to 30 s
  backoff. A successful informer start (initial list and watch established) resets the delay, and a
  start that fails or errors during the initial list keeps the growing backoff. Resync runs
  independently of watch health.
- A cluster that is unavailable at startup does not fail bootstrap: the API serves database reads, logs
  the failure and keeps retrying.

### Status is derived, not stored

- `workload` has no status column. The database holds what the operator asked for; what the cluster is
  doing is read from the observer's in-memory snapshot of Deployments and Pods. Nothing in the
  observer writes to PostgreSQL, so there is no second copy to drift and no fence against it.
- `WorkloadStatusService.resolve(row)` is the one read path. `list` and `get` of the Docker type call
  it for every row (`resolveAll`), then the type's deriver turns the snapshot into
  `{ status, status_message }`. `status_observed_at` is the snapshot's Deployment observation time.
- The answer for "there is no Deployment" depends on what the snapshot knows. A row that was never
  deployed (`last_deployed_at` is null) is `draft`. After a resync has listed the cluster
  (`snapshot.isReady()`), or once the workload's own Deployment event was seen, a missing Deployment
  of a deployed row is `failed` with `Deployment is missing from the cluster`. Before that, and
  whenever the observer is disabled (`WORKLOAD_OBSERVER_ENABLED=false`), the service reads the
  Deployment and Pods straight from the cluster; a 404 is the missing case and any other error
  yields `failed` with `The workload could not be read from the cluster` instead of failing the list.
- Actions write through. After a successful Deployment create or replace, the type service calls
  `WorkloadStatusService.applyDeployment()` with the object the API server returned, so the next read
  already shows `deploying` or `stopped`. The snapshot ignores a watch event whose `resourceVersion`
  is lower than the stored one for the same Deployment `uid`, so a late event for the previous
  revision cannot move it back. Deletes and a recreated Deployment (new `uid`) always apply.
- Events come from the same service. `announceChanges(ids)` (after the observer's debounce) and
  `reconcileAll()` (after every resync) derive each affected row and publish a `status` event only when
  `status` or `status_message` differs from the last one announced for that workload. The first sweep
  after a start remembers statuses without announcing them, because the console loaded them with the
  list. Actions call `announce(row)`, which publishes unconditionally. Both paths run through one
  promise queue so events leave in the order they were derived, and `reconcileAll` drops the memory of
  deleted workloads and trims the snapshot (`retain`).
- Event `updated_at` is the row's `updated_at`. A status change no longer touches the row, so it stays
  put; the console accepts an event whose `updated_at` equals its own.
- The S3 bucket type has no Deployment. Its phase lives on the project Secret
  (`acceleratio.io/bucket-phase`, `acceleratio.io/bucket-message`) and the create poller writes the
  outcome there with a replace at the version it read. A Secret without the annotation counts as
  ready, and a bucket whose Secret is missing reads as `failed`.

### Status derivation

- `docker/docker-workload.status.ts` is the pure priority chain: `stopped` when replicas are 0,
  `deploying` for a stale `observedGeneration`, `failed` for a stalled rollout or a failing pod,
  `running` when the rollout is fully available, and `deploying` otherwise.
- Each type supplies a `WorkloadStatusDeriver` (`docker/docker-workload.deriver.ts` for Docker) and
  `WorkloadStatusDeriverRegistry` looks it up by `type`. A row whose type has no deriver is not
  announced by the status service. Adding a type means adding its deriver and registering it, or, for a
  type without a Deployment, deriving the status in its own service as the S3 bucket type does.

### SSE

- `GET /projects/:projectId/workloads/events` is the project-scoped stream (`@Sse`), declared before
  `:id` so the path is not parsed as a UUID. It sets `X-Accel-Buffering: no`.
- Frames are unnamed `data:` messages carrying `WorkloadEvent`: a `WorkloadStatusEvent` with
  `type: 'status'` or a `WorkloadPositionEvent` with `type: 'position'`; a named `heartbeat` event
  follows every 20 s. `WorkloadStatusService` publishes status changes and action states, and
  `update` publishes the new coordinates when a PATCH changes `position`.
- Canvas drags are local while the pointer moves and persist once on drop through
  `PATCH /workloads/:id` with `position`; other sessions receive the position frame and move the node
  after the drop. Concurrent drags are last-write-wins, gated by `updated_at`.
- The console opens an `EventSource` with credentials, ignores events older than the row's `updated_at`,
  and merges the rest by `workload_id`; an event that names an unknown workload refreshes the list. The
  stream carries status and position changes, so the list is also re-read on every stream open
  (including the first, which clears an error from a failed initial load), on a 60 s reconcile, and when
  the tab becomes visible; that reconciliation picks up workloads created or deleted by other clients.
  An HTTP error closes the stream permanently, so the console re-creates the `EventSource` after a
  delay. The list reconciliation is not status polling.
- The controller method is `events()` and the injected service is `workloadEvents`: an instance property
  named `events` would shadow the route handler.

### Instance terminal

- `WorkloadTerminalService` (`workload/terminal/`) owns the API's only WebSocket endpoint,
  `/projects/:projectId/workloads/:id/instances/:pod/terminal?cols=&rows=`, attached to the HTTP
  server's `upgrade` event (Nest's guards do not run there). Before upgrading it checks a trusted
  `Origin`, the better-auth session, a per-user cap of 20 sessions, that the workload is Docker and
  that the Pod carries the workload's `acceleratio.io/workload-id` label and is running; a refusal is a
  plain HTTP status. Other upgrade paths are dropped.
- The session is `KubernetesService.execInPod` into the `main` container with a TTY, running bash or
  falling back to sh. Binary frames carry terminal bytes both ways; text frames are JSON
  (`WorkloadTerminal*Message` in `packages/shared`): `resize` from the browser, `exit` or `error` from
  the API before it closes. The API pings every 30 s and drops an unanswered socket.
- The terminal is project-scoped: the project page mounts `TerminalProvider` inside its keyed
  `ProjectProvider` and draws `TerminalDock` under `ProjectView`, so it shrinks the view rather than
  covering it and every session ends on leaving the page or switching projects — also when Next keeps
  the left page mounted but hidden (React Activity), via an effect cleanup. No other page has it.
  Up to 7 tabs; xterm.js is loaded on demand.

### RBAC

- The observer needs cluster-wide `get`, `list` and `watch` on `deployments` (`apps`) and `pods`
  (core). The direct-read fallback needs `get` on `deployments` and `list` on `pods` in project
  namespaces.
- The workload actions add `get`, `create`, `update` and `delete` on `deployments` (`apps`).
- Project isolation adds `get`, `create` and `delete` on `namespaces` (core), `get` on
  `customresourcedefinitions` (`apiextensions.k8s.io`) and `get`, `create` and `update` on
  `ciliumnetworkpolicies` (`cilium.io/v2`).
- The cluster inventory needs `list` on `nodes` (core). Server management adds `get`, `patch` and
  `delete` on `nodes`, `create` on `pods/eviction`, `list` on `pods` (cluster-wide) and `list` on
  `poddisruptionbudgets` (`policy`) and `persistentvolumes` (core).
- Service domains add `get`, `create`, `patch` and `delete` on `services` (core) and `get`, `create`,
  `update` and `delete` on `ingressroutes` and `middlewares` (`traefik.io/v1alpha1`) in project
  namespaces, and `get` on `services` and `helmchartconfigs` (`helm.cattle.io`) in `kube-system`.
- Storage classes need `get`, `list`, `create`, `patch` and `delete` on `storageclasses` and `get` on
  `csidrivers` (`storage.k8s.io`), `list` on `persistentvolumes` and `persistentvolumeclaims` (core,
  cluster-wide) for the delete guard and volume counts, and `get` on `statefulsets` (`apps`) in the
  SeaweedFS namespace for the volume server count.
- Benchmarks add `get` and `create` on `namespaces`, `create`, `get` and `delete` on
  `persistentvolumeclaims`, `create`, `get` and `delete` on `jobs` (`batch`), `list` on `pods`, `get` on
  `pods/log` in the benchmark namespace, and `patch` on `persistentvolumes`.
- Metrics and logs add `get` on `services/proxy` (core) in the `victoria-metrics` and `victoria-logs`
  namespaces. The API never reads `pods/log`: Vector ships container logs to VictoriaLogs.
- The dev setup uses an admin kubeconfig. An in-cluster installation needs a `ClusterRole` with those
  rules and a `ClusterRoleBinding` to the API service account.

### Limitation

The observer and its snapshot assume one API process. Reads stay correct with several replicas
because each one derives the status from its own snapshot and nothing is written to the database, but
each replica publishes its own status events to the consoles connected to it, and the S3 create
poller can run twice (the Secret replace is versioned, so one loses and retries). A leader lock is
future work.

## Cluster servers

`application/node/` manages the cluster's servers. `NodeService` reads nodes and patches
scheduling, labels and taints; keys owned by Kubernetes, k3s or Cilium (`node-metadata.ts`) are never
edited and always survive an update. `NodeDrainService` builds the drain plan (`node-drain-plan.ts`,
pure functions), evicts pods and removes nodes. `NodeJoinService` runs the preflight and the join over
SSH, with the scripts and requirement checks in `node-join-script.ts`. SSH goes through the
`SshConnector` abstraction (`node-ssh.ts`, `ssh2` underneath), so tests replace it with a fake.

- Long operations run in the API process and report through `node_operation` (see `DATABASE.md`),
  which `NodeOperationStore` reads and writes; the console polls `GET /nodes/:name/operation`. The
  table's unique index allows one running operation per node, which is the concurrency guard.
- SSH keys, passphrases and the join token live only in the closure of a running operation and pass
  through `createRedactor` before reaching a log line or an error message. Secrets reach remote
  commands on stdin, never on a command line.
- Destructive endpoints (`DELETE /nodes/:name`) need `confirm_name` equal to the node name and
  refuse while the drain plan lists `delete_blockers` (last control plane, data only on this node).
- A service's `node_selector` (`DockerWorkloadConfig`) is validated by `normalizeNodeSelector` and
  rendered as the pod `nodeSelector`.
- Frontend: `modules/servers/` has the server list (`ServersView`), the row actions
  (`ServerActions`) and one dialog per action. `useNodeOperation` polls an operation until it ends.

## Storage classes

`storage-class/` manages SeaweedFS-backed StorageClasses (`GET/POST /storage-classes`,
`GET/PATCH/DELETE /storage-classes/:id`, `GET /storage-classes/environment`).

- `storage-class.config.ts` normalizes payloads. Only an allowlist of driver parameters exists, and a
  PATCH that names a locked setting (`parameters`, `reclaim_policy`, `volume_binding_mode`) is a 400,
  because Kubernetes cannot change them in place.
- `storage-class.manifests.ts` builds the StorageClass: provisioner `seaweedfs-csi-driver`, labels
  `app.kubernetes.io/managed-by=acceleratio` and `acceleratio.io/storage-class-id`, and never the
  default-class annotation. The service only patches or deletes objects that carry both labels.
- `storage-class.status.ts` compares the row with the live object: `ready`, `missing`, `drifted`, or
  `unknown` when the cluster is unreachable. Reads degrade to `unknown` instead of failing.
- The platform class (`kind = 'platform'`) is read-only: update and delete return 403.
- Delete counts PersistentVolumes and unbound claims of the class and returns 409 while any exist,
  then deletes the row and the object in one transaction, so a database reference or a failed
  cluster delete keeps both.
- The console calls these "storage profiles" and leads with presets; driver terms sit under
  Advanced.
- `benchmark/` runs fio on a temporary 2 GiB claim of a profile in `BENCHMARK_NAMESPACE` (default
  `acceleratio-benchmarks`) with `BENCHMARK_IMAGE` (default: Alpine pinned by digest, which installs
  fio from the Alpine mirror, so the cluster needs outbound access). `POST/GET
  /storage-classes/:id/benchmarks` start a run and list a profile's recent runs; `GET
  /storage-benchmarks?storage_class_id=&before=&limit=` pages the history of all runs, newest first
  (25 by default, at most 100, `next_before` as the cursor), including runs of deleted profiles;
  `GET /storage-benchmarks/:id` is the full report (per-test detail and series, profile snapshot,
  cluster context and the previous successful run of the profile). Each test runs as its own fio
  invocation between `---TEST-START`/`---TEST-END` markers, with 1 s averaged bandwidth, IOPS and
  latency logs, so every poll of a running Job records finished tests and the running one. The
  console shows the report at `/settings/storage/benchmarks/[id]` with hand-rolled SVG charts (one
  series, one axis, crosshair, keyboard and a per-second table); `/settings?tab=storage` opens
  the Storage tab. The API polls the Job every 5 s, resumes active runs on bootstrap,
  parses fio's JSON from the pod log and then deletes the Job and claim, switching the volume to
  `Delete` first so `Retain` profiles leave no data. Write tests are bounded by bytes because
  SeaweedFS is append-only and overwrites would exhaust the claim's quota.
- `SEAWEEDFS_NAMESPACE` (default `seaweedfs`) and `SEAWEEDFS_VOLUME_STATEFULSET` (default
  `seaweedfs-volume`) locate the volume servers; `PLATFORM_STORAGE_CLASS_NAME` names the platform
  class.

## Metrics

- `application/metrics/` serves `GET /projects/:projectId/metrics?range=15m|1h|6h|24h|7d` (default
  `1h`). Data comes from a single-node VictoriaMetrics that scrapes kubelet and cAdvisor metrics;
  `deploy/install.sh` and `scripts/cluster.sh` install it in the `victoria-metrics` namespace with
  its TSDB on hostPath.
- `vendor/victoriametrics/victoriametrics.client.ts` queries the Prometheus API through the API
  server's service proxy (`KubernetesService.proxyServiceRequest`, shared with the SeaweedFS filer
  client), so it works with the API inside or outside the cluster. `VICTORIAMETRICS_ADDRESS`
  (default `victoria-metrics.victoria-metrics:8428`) names the Service.
- `metrics-query.ts` holds the pure parts: range → step and `rate()` window, the PromQL (summed
  `by (pod)` in the project namespace), folding per-pod series into per-workload series and a
  project total, and Kubernetes quantity parsing. Live pods map to workloads by the
  `acceleratio.io/workload-id` label; pods that no longer exist are matched on the longest
  `<external_name>-` prefix; anything else is an `other` series.
- Readiness, restarts and container limits come from the live pod list, PVC capacity from the
  claims, and cluster capacity from node allocatable. VictoriaMetrics being unreachable is a 503
  that the console shows as "Metrics backend unavailable".

## Shutdown

- `common/http-shutdown.service.ts` gives in-flight requests 5 s once the app stops, then closes
  the connections still open. `server.close()` waits for every connection, and the console's
  server-sent event streams stay open for as long as a tab does, so without it a rollout or a watch
  rebuild would wait on browsers indefinitely.

## Logs

- `application/logs/` serves `GET /projects/:projectId/logs` (history, newest first, `limit` up to
  500 and `cursor` = the `next_cursor` of the previous page: `<time>~<skip>`, the last line's time
  and how many lines at exactly that time were already returned, so lines that share a timestamp
  are never lost between pages), `GET .../logs/histogram` (lines per level
  in about 60 buckets), `GET .../logs/sources` (services and pods with line counts, plus live pods) and
  `GET .../logs/stream` (server-sent events). Every endpoint takes `range=15m|1h|6h|24h|7d` or
  `start` + `end` (RFC 3339, at most 31 days) and the filters `workload`, `pod`, `level`
  (`error|warn|info|debug|unknown`, comma separated or repeated) and `q`.
- Storage is a single-node VictoriaLogs; Vector runs as a DaemonSet from the same chart and reads
  container logs only from namespaces labelled `app.kubernetes.io/managed-by=acceleratio` (plus a
  `project-` guard in its VRL). It writes flat fields (`namespace`, `pod`, `container`,
  `workload_id`, `level`, `stream`, `_msg`) and detects `level` once at ingestion: JSON
  `level`/`severity`, logfmt `level=`, glog prefixes, upper-case keywords. Logs outlive pods, so
  history spans restarts and deploys. `deploy/install.sh` (`victorialogs_values`) is the single source
  of the chart values; `scripts/cluster.sh` reads that function.
- `vendor/victorialogs/victorialogs.client.ts` calls `/select/logsql/query`, `/hits` and `/tail`
  through the API server's service proxy. `VICTORIALOGS_ADDRESS` (default
  `victoria-logs.victoria-logs:9428`) names the Service.
- `logs-query.ts` builds LogsQL only from validated, structured filters. Every query starts with the
  `{namespace="project-<id>"}` stream filter, which is the project isolation; user text only appears
  JSON-quoted (search is an escaped, case-insensitive substring regexp). Unknown service ids are
  allowed so deleted services stay filterable.
- The live stream reads `/select/logsql/tail` from the store, not from pods, so new pods after a
  deploy appear without reconnecting. It batches lines into unnamed SSE frames
  (`{ type: 'entries' | 'dropped' | 'error' }`), forwards at most 500 lines/s (the rest are counted
  as `dropped`), allows 5 open streams per user (checked again at subscription, where concurrent opens cannot
  race) and completes on shutdown. VictoriaLogs being unreachable is a 503 ("Log storage unavailable" in the console).

## Platform updates

- `application/platform-update/` serves `GET /system/platform` (installed version, components,
  newer releases, the active and the last update), `POST /system/platform/check`,
  `POST /system/platform/updates` (`{ version }`), `GET /system/platform/updates` and
  `GET /system/platform/updates/:id` (with the log).
- `platform-version.service.ts` reads the running release (`ACCELERATIO_VERSION` baked into the API
  image by the release workflow, otherwise the tag of the API Deployment's image) and the
  components: the console and PostgreSQL images, the kubelet version of the installation node and
  every deployed Helm release (decoded from its `sh.helm.release.v1` Secret in
  `platform-version.helm.ts`).
- `platform-release.service.ts` lists GitHub Releases (`ACCELERATIO_RELEASE_REPOSITORY`, default
  `acceleratio-cloud/core`) 30 s after start, then every `PLATFORM_UPDATE_CHECK_INTERVAL_MS`
  (default 6 h, `0` disables), and on demand. It stores the result in `platform_release_check`.
  `platform-release.parse.ts` keeps stable releases that ship `update.sh`, `install.sh` and
  `SHA256SUMS`.
- `platform-update.service.ts` starts an update: it checks that the target is a listed release
  newer than the running one, reads the two hashes from `SHA256SUMS` and inserts a
  `platform_update` row (one active row, enforced by a partial unique index). Then it creates the
  launcher Job from `platform-update.manifests.ts`: privileged, `hostPID`, pinned to the node of
  `postgres-0` and running the API's own image.
- `scripts/launcher.sh` (in the Job) uses `nsenter` to start `scripts/runner.sh` on the host as
  `acceleratio-update.service` through `systemd-run`. The runner verifies and runs the release's
  `update.sh` and publishes `status` and `log` to the ConfigMap named after the update. Both
  scripts are copied to `dist/` as Nest assets (`nest-cli.json`).
- The service polls that ConfigMap every 3 s and copies stage, log and outcome into the row
  (`platform-update.status.ts` parses the status). It resumes active rows on bootstrap and gives
  up after 10 minutes without a start or 45 minutes without a report. Updates are refused for a
  development build, for an API outside the cluster and when `PLATFORM_UPDATES_ENABLED=0`.
- `deploy/update.sh` reports its stage through `ACCELERATIO_UPDATE_STAGE_FILE` when it is set.

## Controllers

- Thin: routing, param parsing, status codes. No validation, no try/catch, no database calls.
- `@Controller('plural')`. Nested resources keep the full path: `@Controller('projects/:projectId/workloads')`.
- Path params are parsed by a pipe: `@Param('id', ParseUUIDPipe) id: string`.
- Every handler declares its return type (`Promise<Project[]>`) and returns the service call directly
  when nothing else happens.
- `DELETE` returns `Promise<void>` with `@HttpCode(HttpStatus.NO_CONTENT)`.
- Request bodies use the shared payload interfaces (`CreateProjectPayload`); there are no DTO classes.
- The auth controller is the one exception: it holds logic because it forwards to better-auth and
  enforces the single-account bootstrap rule.

## Services

- `@Injectable()`, class name `<name>Service`, one per submodule. The workload submodule additionally
  has one full service per type, wrapped by the facade, registry and resolver described above.
- Database access through the symbol token: `@Inject(DATABASE) private readonly db: Database`.
  Collaborators arrive as plain constructor parameters.
- Queries go through Drizzle only; no raw SQL strings.
- Validation lives here: rules shared by several submodules come from `src/common/validation.ts`
  (`normalizeName`), submodule-specific ones are private `normalize*` helpers that accept `unknown` and
  narrow it. No `class-validator` and no DTO layer.
- Failures throw Nest exceptions: `BadRequestException` for bad input, `NotFoundException` for missing
  rows. Messages are sentence case without a trailing period: `'Project not found'`.
- Child resources scope every query by the parent id in the `where` clause. Only `create` needs an
  existence check (`projectService.exists(projectId)`), because the insert relies on a foreign key and
  a missing project would otherwise surface as a database error instead of a 404. Never call
  `projectService.get()` just to validate the parent — that adds a second query to every request.
- Rows are mapped to contract objects by a private `to<Name>(row)` helper; timestamps become ISO
  strings there.
- Updates build a partial `updates` object and skip the query entirely when nothing changed.
- Named constants at module scope instead of inline literals: `NAME_MAX_LENGTH`, `POSITION_STEP_X`.

## Schemas

- The Drizzle table lives in `schemas/<name>.schema.ts` inside the submodule, never in `vendor/db`.
- Export the inferred row type: `export type ProjectRow = typeof project.$inferSelect`.
- Table names are singular (`project`, `workload`); columns and TypeScript keys are snake_case
  (`project_id`, `created_at`), so a row maps to the contract without renaming fields.
- Indexes are named `<table>_<column>_idx`; enums use `pgEnum('<name>_type', [...])`.
- Timestamps use `defaultNow().notNull()`, with `$onUpdate` returning SQL on `updated_at` that picks
  the greater of `now()::timestamp` and the stored value plus one microsecond. The SQL clock matches
  the insert default's timezone, and the guard keeps `updated_at` monotonic for legacy rows written
  when a JavaScript `Date` was bound as UTC.
- Foreign keys declare the delete behavior: `.references(() => project.id, { onDelete: 'cascade' })`.
- `drizzle.config.ts` picks up `src/application/**/schemas/*.schema.ts` automatically. The better-auth
  tables stay in `vendor/db/schema.ts` and keep better-auth's camelCase keys (`emailVerified`,
  `expiresAt`) deliberately: the library owns those tables and reads them by those names. The
  snake_case rule stops at that file; do not "fix" it.
- Migrations are generated into `apps/api/drizzle` with `bun run db:generate` and applied with
  `bun run db:migrate`. `bun run db:check` verifies the journal, snapshots and SQL files agree without
  a database. Commit the schema edit, the SQL file, the new snapshot and `_journal.json` together; the
  table reference and data-model invariants live in [DATABASE.md](./DATABASE.md). Migration `0005_*`
  adds `status_observed_at` to `workload`; `0006_*` backfills existing origin positions into the
  canvas grid; `0021_*` drops `status`, `status_message`, `status_observed_at` and the
  `workload_status` enum again.

## Code style

- `@/*` maps to `src/*` (`tsconfig.json`). Imports outside the current folder use the alias; relative
  paths stay for same-folder files. `workload.schema.ts` still reaches the project schema relatively —
  the alias form is preferred.
- tsc does not rewrite aliases, so `scripts/dev.js` runs `tsc-alias` before boot and `bun run build` is
  `nest build && tsc-alias`. A new alias needs both paths.
- Import order: `@nestjs/*`, then third-party packages, then `@acceleratio/shared` types, then `@/...`,
  then relative imports.
- Type-only imports use `import type`.
- Files are kebab-case with a role suffix: `project.service.ts`, `auth-exception.filter.ts`,
  `database.constants.ts`.
- Formatting is Prettier through ESLint. The root `.prettierrc` sets single quotes and trailing
  commas; Prettier defaults add semicolons, 80 columns, 2 spaces. `bun run lint` fixes in place.
- ESLint lints `src/` and `tests/`; generated `dist/`, `coverage/` and the CommonJS `scripts/`
  launcher are ignored in `eslint.config.mjs`. Do not add generated output to the lint scope.
- ESLint runs the `typescript-eslint` type-checked rules. `no-explicit-any` is off, floating promises
  and unsafe arguments warn, Prettier violations are errors.
- Async functions declare `Promise<T>`; fire-and-forget at the top level is explicit: `void bootstrap()`.
- `strict` is on in `apps/api/tsconfig.json`. Keep it on: catch clauses take `unknown`, optional fields
  are checked, and new code must satisfy the compiler instead of widening a type.
- snake_case for every field in the API contract and in Drizzle schema keys. camelCase is for local
  TypeScript (variables, parameters, class members) and for vendor-owned tables (`vendor/db/schema.ts`).
- Tests live in `tests/` folders, never as `*.spec.ts` next to production source. Unit tests sit in
  `src/**/tests/` inside the submodule they cover; e2e tests sit in `apps/api/tests` with
  `jest-e2e.json`. `bun run test` runs `*.spec.ts` under `src`, `bun run test:e2e` runs
  `tests/*.e2e-spec.ts`. `better-auth` and `@thallesp/nestjs-better-auth` ship ESM only, which Jest
  cannot load from a CommonJS test, so auth specs stub both with `jest.mock`. Jest maps `@/*` through
  `moduleNameMapper`.

## Configuration and environment

- `import 'dotenv/config'` sits in the entrypoints (`main.ts`, `vendor/db/client.ts`,
  `vendor/auth/auth.ts`). There is no `@nestjs/config`; read `process.env` directly.
- Variables: `PORT`, `DATABASE_URL` (required, thrown at startup), `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`,
  `CORS_ORIGINS` (comma separated), `KUBECONFIG` (YAML contents or a path to an
  existing kubeconfig file; an exported shell value wins over `.env`, a leading
  `~` is expanded, and the default or in-cluster config is used when unset),
  `WORKLOAD_OBSERVER_ENABLED` (`false` disables the observer) and
  `WORKLOAD_OBSERVER_RESYNC_MS` (full resync interval, default 60000), `VICTORIAMETRICS_ADDRESS`
  (`service.namespace:port` of VictoriaMetrics, default `victoria-metrics.victoria-metrics:8428`) and
  `VICTORIALOGS_ADDRESS` (`service.namespace:port` of VictoriaLogs, default
  `victoria-logs.victoria-logs:9428`).
  Platform updates read `ACCELERATIO_VERSION`, `PLATFORM_UPDATES_ENABLED`,
  `PLATFORM_UPDATE_CHECK_INTERVAL_MS`, `ACCELERATIO_RELEASE_REPOSITORY`, `ACCELERATIO_CONFIG_DIR`
  (default `/etc/acceleratio`) and `PLATFORM_UPDATE_ROOT` (default `/var/lib/acceleratio/updates`).
- Every new variable is listed in `apps/api/.env.example`.

## Auth and errors

- better-auth is configured in `vendor/auth/auth.ts`; the module mounts it with `disableControllers: true`
  so this app's controllers own the routes.
- Decorators from `@thallesp/nestjs-better-auth`: `@AllowAnonymous()` for public routes, `@OptionalAuth()`
  for routes that work signed in or out, `@Session()` to read the session.
- `AuthExceptionFilter` is controller-scoped and converts a better-auth `APIError` into
  `{ status_code, message, code? }`, which matches `ApiErrorResponse` in the shared package.
- `HttpExceptionFilter` in `common/http-exception.filter.ts` is registered globally in `main.ts` and
  turns every other failure into the same shape; unknown exceptions become a 500 with a generic
  message and a log entry. Controller-scoped filters run first, so better-auth errors keep their
  specific messages.
- better-auth responses are camelCase with Date objects (`emailVerified`, `createdAt`, `userId`). The
  auth controller maps them with private `toAuthUser`/`toAuthSession` serializers before returning, so
  the API surface stays snake_case. Keep vendor fields the caller needs (`token`, `url`) untouched.
- Account endpoints (all behind the session guard, a user changes only themselves): `PATCH /auth/profile`
  (name), `POST /auth/change-password` (`current_password`, `new_password`, `revoke_other_sessions`,
  default true), `GET /auth/sessions`, `DELETE /auth/sessions/:id` and `DELETE /auth/sessions/others`.
  They forward to better-auth (`updateUser`, `changePassword`, `listSessions`, `revokeSession`,
  `revokeOtherSessions`). Session lists never include the token; revoking by id resolves the token
  from the caller's own sessions. better-auth rate limits only requests through its HTTP handler, so
  `PasswordAttemptLimiter` caps wrong current passwords at 5 per 15 minutes per user (429). Passwords
  are never logged or returned. The email is read-only until a mail server exists for confirmation.
- The console's `/settings?tab=profile` holds three sections: Profile (name), Password and Sessions
  (`modules/settings/containers/profile-details-form.tsx`, `password-form.tsx`, `sessions-list.tsx`).
- Successful responses return the shared contract type directly, without an envelope.
