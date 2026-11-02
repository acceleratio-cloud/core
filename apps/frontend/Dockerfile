# syntax=docker/dockerfile:1

# Build from the repository root, because the console depends on the shared
# package through a file: dependency:
#
#   docker build -f apps/frontend/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.example.com \
#     -t acceleratio/console:dev .
#
# next.config.ts enables `output: "standalone"`, so the runtime image contains
# only the traced server files, static assets and the public directory.

FROM oven/bun:1.4.0-alpine AS build
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* variables are inlined by `next build`; they cannot be changed
# when the container starts. Rebuild the image when the public API URL changes.
ARG NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

COPY packages/shared ./packages/shared
RUN cd packages/shared && bun install --frozen-lockfile && bun run build

COPY apps/frontend/package.json apps/frontend/bun.lock ./apps/frontend/
RUN cd apps/frontend && bun install --frozen-lockfile

COPY apps/frontend ./apps/frontend
RUN cd apps/frontend && bun run build

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# --chown is required: Next.js writes its image and incremental caches under
# .next/cache at runtime, and the server runs as the unprivileged `node` user.
COPY --chown=node:node --from=build /app/apps/frontend/.next/standalone ./
COPY --chown=node:node --from=build /app/apps/frontend/.next/static ./.next/static
COPY --chown=node:node --from=build /app/apps/frontend/public ./public

USER node
EXPOSE 3000

CMD ["node", "server.js"]
