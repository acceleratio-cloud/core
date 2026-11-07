#!/usr/bin/env bash
#
# Bring a fresh clone to a running local development environment.
#
#   ./scripts/dev.sh           install, start Postgres, migrate, run API + console
#   ./scripts/dev.sh --setup   the same but stop after setup (do not start servers)
#
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SETUP_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --setup)
      SETUP_ONLY=true
      ;;
    -h | --help)
      printf 'Usage: %s [--setup]\n\n' "$0"
      printf '  (no flag)  install, start Postgres, migrate, then run the API and console\n'
      printf '  --setup    run the setup steps and exit without starting the servers\n\n'
      printf 'Environment:\n'
      printf '  WEB_PORT=3001               console port (default 3000)\n'
      printf '  CLUSTER=0                   do not create or start the OrbStack cluster\n'
      printf '  ACCELERATIO_MACHINE=name    OrbStack machine name (see scripts/cluster.sh)\n'
      printf '  KUBECONFIG=...              use your own cluster instead; its context is validated\n'
      printf '  ALLOW_REMOTE_KUBECONTEXT=1  allow a non-local Kubernetes context\n'
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$arg" >&2
      exit 1
      ;;
  esac
done

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_BLUE=$'\033[1;34m'
  C_RED=$'\033[1;31m'
  C_YELLOW=$'\033[1;33m'
  C_RESET=$'\033[0m'
else
  C_BLUE=""
  C_RED=""
  C_YELLOW=""
  C_RESET=""
fi

log() {
  printf '\n%s==> %s%s\n' "$C_BLUE" "$*" "$C_RESET"
}

die() {
  printf '\n%sError: %s%s\n' "$C_RED" "$*" "$C_RESET" >&2
  exit 1
}

warn() {
  printf '\n%sWarning: %s%s\n' "$C_YELLOW" "$*" "$C_RESET" >&2
}

require() {
  command -v "$1" >/dev/null 2>&1 || die "$2"
}

# Read KEY=value from an env file using the subset of dotenv syntax the
# repository documents: an optional `export` prefix, single or double quotes,
# and \n escapes inside double quotes.
dotenv_value() {
  local key="$1" file="$2" line value

  line="$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*=" "$file" 2>/dev/null | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1

  value="${line#*=}"
  value="${value%$'\r'}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"

  case "$value" in
    \"*\")
      value="${value:1:${#value}-2}"
      value="${value//\\n/$'\n'}"
      value="${value//\\r/$'\r'}"
      value="${value//\\\"/\"}"
      ;;
    \'*\')
      value="${value:1:${#value}-2}"
      ;;
    *)
      value="${value%%[[:space:]]#*}"
      value="${value%"${value##*[![:space:]]}"}"
      ;;
  esac

  printf '%s' "$value"
}

require bun "Bun is required. Install it from https://bun.sh and try again."
require docker "Docker is required. Install Docker Desktop or Docker Engine and try again."
docker compose version >/dev/null 2>&1 ||
  die "Docker Compose v2 is required. Update Docker Desktop or install the compose plugin."
docker info >/dev/null 2>&1 ||
  die "The Docker daemon is not running. Start Docker and try again."

generate_secret() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 32 | tr -d '\n'
  else
    head -c 32 /dev/urandom | base64 | tr -d '\n'
  fi
}

if [[ ! -f apps/api/.env ]]; then
  log "Creating apps/api/.env from apps/api/.env.example"
  secret="$(generate_secret)"
  awk -v secret="$secret" '
    /^BETTER_AUTH_SECRET=/ { print "BETTER_AUTH_SECRET=" secret; next }
    { print }
  ' apps/api/.env.example > apps/api/.env
fi

API_PORT="$(dotenv_value PORT apps/api/.env || true)"
if [[ -z "$API_PORT" ]]; then
  die "PORT is missing from apps/api/.env. Set PORT=8080 or delete the file to regenerate it."
fi
WEB_PORT="${WEB_PORT:-3000}"

# scripts/cluster.sh owns the machine name and kubeconfig path; do not repeat
# the literal name here or the two paths will drift apart.
CLUSTER_MACHINE="$(./scripts/cluster.sh name)"
CLUSTER_KUBECONFIG="$(./scripts/cluster.sh kubeconfig)"

if [[ ! -f apps/frontend/.env.local ]]; then
  log "Creating apps/frontend/.env.local with NEXT_PUBLIC_API_URL=http://localhost:${API_PORT}"
  if [[ -f apps/frontend/.env.example ]]; then
    sed "s#^NEXT_PUBLIC_API_URL=.*#NEXT_PUBLIC_API_URL=http://localhost:${API_PORT}#" \
      apps/frontend/.env.example > apps/frontend/.env.local
  else
    printf 'NEXT_PUBLIC_API_URL=http://localhost:%s\n' "$API_PORT" > apps/frontend/.env.local
  fi
fi

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
  fi
}

# The API is a Kubernetes control plane. With no explicit KUBECONFIG it uses
# the ambient ~/.kube/config context, which may be a shared or production
# cluster. Prefer the local OrbStack cluster (scripts/cluster.sh) and refuse any
# other non-local context.
is_local_context() {
  case "$1" in
    minikube | minikube-* | kind-* | k3d-* | docker-desktop | docker-for-desktop | rancher-desktop | orbstack | orbstack-* | colima | colima-*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

kubeconfig_context() {
  local source="$1" context=""

  if [[ "$source" == *$'\n'* ]]; then
    context="$(printf '%s\n' "$source" | awk '
      /^current-context:[[:space:]]*/ {
        sub(/^current-context:[[:space:]]*/, "")
        print
        exit
      }
    ')"
  elif command -v kubectl >/dev/null 2>&1; then
    context="$(KUBECONFIG="$source" kubectl config current-context 2>/dev/null || true)"
  else
    context="$(awk '
      /^current-context:[[:space:]]*/ {
        sub(/^current-context:[[:space:]]*/, "")
        print
        exit
      }
    ' "$source" 2>/dev/null || true)"
  fi

  context="${context%$'\r'}"
  context="${context#\"}"
  context="${context%\"}"
  context="${context#\'}"
  context="${context%\'}"
  printf '%s' "$context"
}

approve_kube_context() {
  local context="$1" origin="$2"

  if [[ -z "$context" ]]; then
    warn "No Kubernetes context found in ${origin}. Cluster-backed endpoints will return 503. Run 'make cluster-up' for the local OrbStack cluster."
    return 0
  fi

  if is_local_context "$context"; then
    log "Kubernetes context: ${context} (${origin})"
    return 0
  fi

  if [[ "${ALLOW_REMOTE_KUBECONTEXT:-0}" = "1" ]]; then
    warn "Using Kubernetes context \"${context}\" (${origin}) because ALLOW_REMOTE_KUBECONTEXT=1. Make sure it is disposable."
    return 0
  fi

  die "Refusing to start: the API would manage Kubernetes context \"${context}\" (${origin}). Remove KUBECONFIG from apps/api/.env and the shell to use the local OrbStack cluster ('make cluster-up'). To allow this context intentionally, run ALLOW_REMOTE_KUBECONTEXT=1 make dev."
}

# True when the shell or apps/api/.env names a kubeconfig, i.e. the developer
# brought their own cluster and the OrbStack one is not needed.
explicit_kubeconfig_set() {
  [[ -n "${KUBECONFIG:-}" ]] || dotenv_value KUBECONFIG apps/api/.env >/dev/null
}

# Create or start the OrbStack cluster. It is idempotent and fast once the
# cluster is installed; the first run installs k3s, Cilium, SeaweedFS and the
# observability stack, which takes a few minutes.
ensure_cluster() {
  [[ "${CLUSTER:-1}" = "0" ]] && return 0
  explicit_kubeconfig_set && return 0

  command -v orbctl >/dev/null 2>&1 ||
    die "OrbStack is required for the local cluster. Install it from https://orbstack.dev (brew install --cask orbstack), or set CLUSTER=0 to run without a cluster, or point KUBECONFIG at your own."

  ./scripts/cluster.sh up
}

# The installer stores the values the console's "add server" flow needs in the
# cluster. Pass them to the API unless the developer set them already.
export_cluster_env() {
  local line key value

  while IFS= read -r line; do
    key="${line%%=*}"
    value="${line#*=}"
    [[ -n "$key" && -n "$value" ]] || continue
    if [[ -z "${!key:-}" ]] && ! dotenv_value "$key" apps/api/.env >/dev/null; then
      export "$key=$value"
    fi
  done < <(./scripts/cluster.sh env 2>/dev/null || true)
}

kube_context_guard() {
  local explicit="" origin="" context=""

  # dotenv does not override an exported shell variable: the shell value wins.
  # Validate that value, because it is the one the API will actually use.
  if [[ -n "${KUBECONFIG:-}" ]]; then
    explicit="$KUBECONFIG"
    origin="the shell environment"
  elif explicit="$(dotenv_value KUBECONFIG apps/api/.env)"; then
    origin="apps/api/.env"
  else
    explicit=""
  fi

  if [[ -n "$explicit" ]]; then
    # Expand ~ here and export the result so the guard validates the exact
    # path the API will use.
    # The literal "~/" prefix is matched on purpose: the shell has not expanded it.
    # shellcheck disable=SC2088
    if [[ "$explicit" == "~/"* ]]; then
      explicit="${HOME}/${explicit#\~/}"
    elif [[ "$explicit" == "~" ]]; then
      explicit="$HOME"
    fi

    if [[ "$explicit" == *$'\n'* ]]; then
      context="$(kubeconfig_context "$explicit")"
      if [[ -z "$context" ]]; then
        die "Could not read a context from the inline KUBECONFIG in ${origin}. Fix the YAML or run 'make cluster-up'."
      fi

      export KUBECONFIG="$explicit"
      approve_kube_context "$context" "inline KUBECONFIG from ${origin}"
      return
    fi

    if [[ ! -e "$explicit" ]]; then
      die "KUBECONFIG from ${origin} points to ${explicit}, which does not exist. Run 'make cluster-up' or fix the path."
    fi
    if [[ ! -f "$explicit" ]]; then
      die "KUBECONFIG from ${origin} points to ${explicit}, which is not a regular file."
    fi

    context="$(kubeconfig_context "$explicit")"
    if [[ -z "$context" ]]; then
      die "Could not read a context from ${explicit} (KUBECONFIG from ${origin})."
    fi

    export KUBECONFIG="$explicit"
    approve_kube_context "$context" "KUBECONFIG from ${origin}"
    return
  fi

  if [[ -f "$CLUSTER_KUBECONFIG" ]]; then
    context="$(kubeconfig_context "$CLUSTER_KUBECONFIG")"

    if [[ "$context" == orbstack-* ]]; then
      export KUBECONFIG="$CLUSTER_KUBECONFIG"
      log "Kubernetes: using the local OrbStack cluster \"${CLUSTER_MACHINE}\" (context ${context})"
      export_cluster_env
      return
    fi

    warn "Ignoring ${CLUSTER_KUBECONFIG}: its context \"${context:-unknown}\" is not an OrbStack context."
  fi

  if command -v kubectl >/dev/null 2>&1; then
    context="$(kubectl config current-context 2>/dev/null || true)"
  elif [[ -f "${HOME}/.kube/config" ]]; then
    context="$(kubeconfig_context "${HOME}/.kube/config")"
  fi

  approve_kube_context "$context" "the ambient kubeconfig"
}

check_port_settings() {
  local auth_url api_url cors

  auth_url="$(dotenv_value BETTER_AUTH_URL apps/api/.env || true)"
  api_url="$(dotenv_value NEXT_PUBLIC_API_URL apps/frontend/.env.local || true)"
  cors="$(dotenv_value CORS_ORIGINS apps/api/.env || true)"

  if [[ -n "$auth_url" && "$auth_url" != *":${API_PORT}"* ]]; then
    warn "BETTER_AUTH_URL is ${auth_url}, but the API listens on ${API_PORT}. Update apps/api/.env or auth callbacks will use the wrong port."
  fi

  if [[ -n "$api_url" && "$api_url" != *":${API_PORT}"* ]]; then
    warn "NEXT_PUBLIC_API_URL is ${api_url}, but the API listens on ${API_PORT}. Update apps/frontend/.env.local or the console will call the wrong port."
  fi

  if [[ -n "$cors" && "$cors" != *":${WEB_PORT}"* ]]; then
    warn "CORS_ORIGINS is ${cors}, but the console listens on ${WEB_PORT}. Update apps/api/.env or the browser will be blocked."
  fi
}

if [[ -n "${PORT:-}" && "$PORT" != "$API_PORT" ]]; then
  warn "Ignoring PORT=${PORT} from the environment; using PORT=${API_PORT} from apps/api/.env."
fi
export PORT="$API_PORT"
check_port_settings

# The local PostgreSQL service (docker compose) is the development database.
# Migrations run against whatever DATABASE_URL names, so say so when it is not it.
DATABASE_URL_VALUE="${DATABASE_URL:-$(dotenv_value DATABASE_URL apps/api/.env || true)}"
case "$DATABASE_URL_VALUE" in
  "" | *@localhost[:/]* | *@127.0.0.1[:/]* | *@\[::1\][:/]*) ;;
  *)
    warn "DATABASE_URL does not point at the local PostgreSQL service; migrations will run against that database. Restore the value from apps/api/.env.example to use the one from docker compose."
    ;;
esac

ensure_cluster

if [ "$SETUP_ONLY" = false ]; then
  kube_context_guard
  if port_in_use "$API_PORT"; then
    die "Port $API_PORT is already in use. Stop that process, or change PORT in apps/api/.env and update BETTER_AUTH_URL there and NEXT_PUBLIC_API_URL in apps/frontend/.env.local."
  fi
  if port_in_use "$WEB_PORT"; then
    die "Port $WEB_PORT is already in use. Stop that process, or run with WEB_PORT=<port> and add the new origin to CORS_ORIGINS in apps/api/.env."
  fi
fi

# apps/api and apps/frontend depend on packages/shared through a file: dependency,
# which bun copies at install time. Build the package first or the copy has no dist.
log "Installing and building the shared package"
(cd packages/shared && bun install --frozen-lockfile && bun run build)

log "Installing dependencies"
for package_dir in apps/api apps/frontend; do
  printf '  - %s\n' "$package_dir"
  (cd "$package_dir" && bun install --frozen-lockfile)
done

log "Starting PostgreSQL"
docker compose up -d --wait postgres

log "Applying database migrations"
(cd apps/api && bun run db:migrate)

if [ "$SETUP_ONLY" = true ]; then
  log "Setup complete. Run 'make dev' (or ./scripts/dev.sh) to start the app."
  exit 0
fi

log "Starting the API on http://localhost:${API_PORT} and console on http://localhost:${WEB_PORT}"
printf '    First run: open http://localhost:%s/auth/installation to create the initial account.\n' "$WEB_PORT"
printf '    Press Ctrl+C to stop both servers.\n'

cleanup() {
  trap - EXIT INT TERM
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
  API_PID=""
  WEB_PID=""
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

is_running() {
  local state
  state="$(ps -o stat= -p "$1" 2>/dev/null | tr -d '[:space:]')"
  [[ -n "$state" && "$state" != Z* ]]
}

(cd apps/api && exec bun run start:dev) &
API_PID=$!

(cd apps/frontend && exec bun run dev -- --port "$WEB_PORT") &
WEB_PID=$!

while is_running "$API_PID" && is_running "$WEB_PID"; do
  sleep 1
done

status=0
# On Ctrl+C the trap has already stopped both children and cleared the PIDs.
# Waiting for an empty PID prints "not a pid or valid job spec" and fails.
if [[ -n "${API_PID:-}" ]]; then
  set +e
  if ! is_running "$API_PID"; then
    wait "$API_PID" 2>/dev/null
    status=$?
  else
    wait "$WEB_PID" 2>/dev/null
    status=$?
  fi
  set -e
fi

exit "$status"
