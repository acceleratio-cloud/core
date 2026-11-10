# syntax=docker/dockerfile:1

# Build from the repository root, because the API depends on the shared package
# through a file: dependency:
#
#   docker build -f apps/api/Dockerfile -t acceleratio/api:dev .
#
# The image runs the compiled NestJS application with Node.js and production
# dependencies only, as the unprivileged `node` user.
#
# The image also carries the Drizzle migrations. Apply them before starting a
# new version (for example from a Kubernetes init container or a one-off job):
#
#   docker run --rm -e DATABASE_URL=... acceleratio/api:dev \
#     node dist/vendor/db/migrate.js

ARG BUN_VERSION=1.4.0
ARG NODE_VERSION=22.23-alpine

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

# The shared package must be installed and built before the API install: bun
# copies file: dependencies into node_modules, and the API build/typecheck
# resolves @acceleratio/shared through that copy.
COPY packages/shared ./packages/shared
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd packages/shared && bun install --frozen-lockfile && bun run build

COPY apps/api/package.json apps/api/bun.lock ./apps/api/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd apps/api && bun install --frozen-lockfile

COPY apps/api ./apps/api
RUN cd apps/api && bun run build

# Install only production dependencies, after packages/shared has a dist/, so
# the copied @acceleratio/shared package is usable at runtime.
FROM oven/bun:${BUN_VERSION}-alpine AS production-dependencies
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/bun.lock ./apps/api/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd apps/api && bun install --production --frozen-lockfile

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app/apps/api

# The release this image belongs to (set by the release workflow). The console
# shows it and compares it with the published releases; empty for local
# builds, which then report the tag of the running image instead.
ARG ACCELERATIO_VERSION=""

ENV NODE_ENV=production \
    PORT=8080 \
    ACCELERATIO_VERSION=${ACCELERATIO_VERSION}

# Keep the build layout: node_modules/@acceleratio/shared may be a relative
# link to ../../packages/shared. Files stay root-owned: the API writes nothing
# to its own directory, so the `node` user only needs to read them.
COPY --from=production-dependencies /app/packages/shared /app/packages/shared
COPY --from=production-dependencies /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/drizzle ./drizzle
COPY --from=build /app/apps/api/package.json ./package.json
# Marketplace templates, read from ../../templates (MARKETPLACE_TEMPLATES_DIR overrides).
COPY templates /app/templates

# The build runs under Bun but production runs under Node: fail the build if
# the runtime dependencies do not resolve under Node.
RUN node -e "require.resolve('@acceleratio/shared'); require('drizzle-orm/node-postgres/migrator')"

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "dist/main.js"]
