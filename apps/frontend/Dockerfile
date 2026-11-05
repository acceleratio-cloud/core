# syntax=docker/dockerfile:1

# Build from the repository root, because the console depends on the shared
# package through a file: dependency:
#
#   docker build -f apps/frontend/Dockerfile -t acceleratio/console:dev .
#
# The API URL is read when the container starts, so one image serves every
# deployment:
#
#   docker run -p 3000:3000 -e API_URL=https://api.example.com acceleratio/console:dev
#
# API_URL must be reachable from the browser. API_INTERNAL_URL (optional) is
# used for server-side calls instead, e.g. http://api.acceleratio.svc:8080.
#
# next.config.ts enables `output: "standalone"`, so the runtime image contains
# only the traced server files, static assets and the public directory.

ARG BUN_VERSION=1.4.0
ARG NODE_VERSION=22.23-alpine

FROM oven/bun:${BUN_VERSION}-alpine AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# Optional build-time fallback for API_URL. Prefer setting API_URL at runtime;
# a value inlined here is only used when API_URL is unset.
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY packages/shared ./packages/shared
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd packages/shared && bun install --frozen-lockfile && bun run build

COPY apps/frontend/package.json apps/frontend/bun.lock ./apps/frontend/
RUN --mount=type=cache,target=/root/.bun/install/cache \
    cd apps/frontend && bun install --frozen-lockfile

COPY apps/frontend ./apps/frontend
RUN --mount=type=cache,target=/app/apps/frontend/.next/cache \
    cd apps/frontend && bun run build

FROM node:${NODE_VERSION} AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    API_URL=http://localhost:8080

# Only .next is writable by `node`: Next.js writes its image and incremental
# caches under .next/cache at runtime. Server code and public assets stay
# root-owned and read-only for the process.
COPY --from=build /app/apps/frontend/.next/standalone ./
COPY --from=build /app/apps/frontend/.next/static ./.next/static
COPY --from=build /app/apps/frontend/public ./public
RUN mkdir -p .next/cache && chown -R node:node .next

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server.js"]
