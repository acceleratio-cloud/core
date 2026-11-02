#!/usr/bin/env bash
#
# Prepare a fresh dev container: wait for the docker-in-docker daemon, then run
# the same setup as a native checkout (dependencies, env files, PostgreSQL and
# migrations). Start the app afterwards with `make dev`.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# The docker-in-docker feature starts its daemon from the container entrypoint.
# It is normally ready before postCreateCommand, but wait briefly if it is not.
for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

if ! docker info >/dev/null 2>&1; then
  printf 'Docker is not available in the dev container. Run ./scripts/dev.sh --setup manually after fixing it.\n' >&2
  exit 1
fi

exec ./scripts/dev.sh --setup
