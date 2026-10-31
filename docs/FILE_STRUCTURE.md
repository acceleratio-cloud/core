# Frontend structure

src/
  app/ - general folder with page and routes
  api/ - axios requests to backend
    /index.ts - base axios instance to send requests
    [module-name] - folder with api requests to specific module
      /index.ts - object with methods as keys to send request
  modules/ - main logic of the app separated to domains ( modules )
    [module-name] - logical domain
      containers/ - components with logic, api requests
      components/ - "silly" components with just ui and some handles or simple states

Additional instructions:
1) Use only tailwindcss for styles
2) Use camelCase for frontend only variables and snake_case for variables to/from backend

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
