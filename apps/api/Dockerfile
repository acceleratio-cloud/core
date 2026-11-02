# syntax=docker/dockerfile:1

# Build from the repository root, because the API depends on the shared package
# through a file: dependency:
#
#   docker build -f apps/api/Dockerfile -t acceleratio/api:dev .
#
# The image runs the compiled NestJS application with Node.js and production
# dependencies only, as the unprivileged `node` user.

FROM oven/bun:1.4.0-alpine AS build
WORKDIR /app

# The shared package must be installed and built before the API install: bun
# copies file: dependencies into node_modules, and the API build/typecheck
# resolves @acceleratio/shared through that copy.
COPY packages/shared ./packages/shared
RUN cd packages/shared && bun install --frozen-lockfile && bun run build

COPY apps/api/package.json apps/api/bun.lock ./apps/api/
RUN cd apps/api && bun install --frozen-lockfile

COPY apps/api ./apps/api
RUN cd apps/api && bun run build

# Install only production dependencies, after packages/shared has a dist/, so
# the copied @acceleratio/shared package is usable at runtime.
FROM oven/bun:1.4.0-alpine AS production-dependencies
WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/apps/api/package.json /app/apps/api/bun.lock ./apps/api/
RUN cd apps/api && bun install --production --frozen-lockfile

FROM node:22-alpine AS runtime
WORKDIR /app/apps/api

ENV NODE_ENV=production \
    PORT=8080

# Keep the build layout: node_modules/@acceleratio/shared may be a relative
# link to ../../packages/shared.
COPY --from=production-dependencies /app/packages/shared /app/packages/shared
COPY --from=production-dependencies /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./package.json

USER node
EXPOSE 8080

CMD ["node", "dist/main.js"]
