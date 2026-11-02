# Frontend structure

src/
  app/ - Next.js App Router: routes, layouts and route groups
    (dashboard)/ - authenticated console
    auth/ - sign-in and first-run installation
  api/ - HTTP layer, the only place that talks to the API
    index.ts - axios instance (NEXT_PUBLIC_API_URL, credentials) and getApiErrorMessage
    [module-name]/
      index.ts - client calls, one exported object per module (projectsApi)
      server.ts - server-only calls for route files (getServerProject), forwards cookies
  modules/ - product domains
    [module-name]/
      containers/ - client components with state, effects and api calls
      components/ - presentational components: props in, markup out
      providers/ - context provider plus its useX hook
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
  main.ts - bootstrap: CORS from CORS_ORIGINS, port from PORT
  app.module.ts - root module: VendorModule + ApplicationModule
  common/ - helpers shared by submodules (input validation, DNS naming, exception filters)
  application/ - product features
    application.module.ts - the only Nest module in this layer; registers every submodule
    [submodule]/ - project/, workload/, node/, auth/
      [submodule].controller.ts - HTTP surface only
      [submodule].service.ts - logic, validation, database access
      [type]/ - workload only: one folder per workload type, see "Workload types"
        [type]-workload.service.ts - the full service for this type
        [type]-workload.manifests.ts - pure Kubernetes object builders
        [type]-workload.status.ts - pure cluster state to status mapping
        [type]-workload.config.ts - config normalization for this type
        tests/ - unit tests for this type
      schemas/ - Drizzle tables owned by this submodule (optional)
        [submodule].schema.ts
      tests/ - unit tests for this submodule; never colocate *.spec.ts next to source
  vendor/ - infrastructure, exposed globally so application code can inject it anywhere
    vendor.module.ts - imports the db, auth and kubernetes modules
    db/ - pool, DATABASE token, better-auth tables
    auth/ - better-auth instance and its module (global by default)
    kubernetes/ - lazily built API clients

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
    DockerWorkloadService,
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
manifests, status derivation, config normalization and tests. Common operations (project existence,
external names, row mapping, status persistence) are duplicated per type on purpose: a new type must be
free to diverge without changing another type's code. Each type service scopes its own row queries to
its type (`type = '<type>'`); rows of other types never enter it.

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
   its manifests, status, config and `tests/`
2) register the service in `workload-type.registry.ts`; `DockerWorkloadService` stays untouched
3) add the type to the shared contract and the Drizzle enum in `schemas/workload.schema.ts`, then
   generate the migration
4) add the service to `application.module.ts` providers

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
- Named constants at module scope instead of inline literals: `NAME_MAX_LENGTH`, `DEFAULT_POSITION`.

## Schemas

- The Drizzle table lives in `schemas/<name>.schema.ts` inside the submodule, never in `vendor/db`.
- Export the inferred row type: `export type ProjectRow = typeof project.$inferSelect`.
- Table names are singular (`project`, `workload`); columns and TypeScript keys are snake_case
  (`project_id`, `created_at`), so a row maps to the contract without renaming fields.
- Indexes are named `<table>_<column>_idx`; enums use `pgEnum('<name>_type', [...])`.
- Timestamps use `defaultNow().notNull()`, with `$onUpdate(() => new Date())` on `updated_at`.
- Foreign keys declare the delete behavior: `.references(() => project.id, { onDelete: 'cascade' })`.
- `drizzle.config.ts` picks up `src/application/**/schemas/*.schema.ts` automatically. The better-auth
  tables stay in `vendor/db/schema.ts` and keep better-auth's camelCase keys (`emailVerified`,
  `expiresAt`) deliberately: the library owns those tables and reads them by those names. The
  snake_case rule stops at that file; do not "fix" it.
- Migrations are generated into `apps/api/drizzle` with `bun run db:generate` and applied with
  `bun run db:migrate`.

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
  `CORS_ORIGINS` (comma separated), `KUBECONFIG` (YAML contents, not a path; the default or in-cluster
  config is used when unset).
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
- Successful responses return the shared contract type directly, without an envelope.
