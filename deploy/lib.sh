#!/usr/bin/env bash
# Shared by install.sh, deploy.sh and make-admin.sh. Source it; do not run it.
#   PW_ENV_FILE          the settings file (default: .env in the project folder)
#   COMPOSE_PROJECT_NAME the Docker project name (default: pointwise)

PW_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PW_ENV_FILE="${PW_ENV_FILE:-$PW_ROOT/.env}"
PW_COMPOSE_FILE="$PW_ROOT/docker-compose.prod.yml"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mfail\033[0m %s\n' "$*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required but was not found. $2"; }

# docker compose against the production file and settings, from any folder
pw_compose() { docker compose --project-directory "$PW_ROOT" --env-file "$PW_ENV_FILE" -f "$PW_COMPOSE_FILE" "$@"; }

# the value of KEY in the settings file ("" when absent); quotes are removed
env_get() {
  [ -f "$PW_ENV_FILE" ] || return 0
  grep -E "^$1=" "$PW_ENV_FILE" | tail -n 1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'
}

# set KEY to VALUE in the settings file (replaces the line, or adds it). The value is passed through the environment so it
# can hold any character.
env_set() {
  local key=$1 tmp
  tmp="$(mktemp)"
  KEY="$key" VAL="$2" awk 'BEGIN{k=ENVIRON["KEY"]; v=ENVIRON["VAL"]; done=0}
    $0 ~ "^" k "=" { print k "=" v; done=1; next } { print }
    END{ if(!done) print k "=" v }' "$PW_ENV_FILE" > "$tmp"
  cat "$tmp" > "$PW_ENV_FILE"
  rm -f "$tmp"
}

rand_hex() { openssl rand -hex "${1:-32}"; }

# a password that satisfies the sign-up rules (10+ characters, a letter and a non-letter), easy to read aloud
rand_password() { printf '%s-%s' "$(openssl rand -base64 24 | tr -dc 'a-zA-Z' | cut -c1-12)" "$(openssl rand -hex 3)"; }

# wait until a service's container reports healthy (or give up after $2 seconds)
wait_healthy() {
  local svc=$1 timeout=${2:-240} waited=0 id status
  while [ "$waited" -lt "$timeout" ]; do
    id="$(pw_compose ps -q "$svc" 2>/dev/null || true)"
    if [ -n "$id" ]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || echo missing)"
      [ "$status" = "healthy" ] || [ "$status" = "running" ] && { ok "$svc is $status"; return 0; }
      [ "$status" = "exited" ] || [ "$status" = "dead" ] && return 1
    fi
    sleep 3
    waited=$((waited + 3))
  done
  return 1
}

check_docker() {
  need docker "Install Docker Engine: https://docs.docker.com/engine/install/"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required (the 'docker compose' command). https://docs.docker.com/compose/install/"
  docker info >/dev/null 2>&1 || die "Docker is installed but this user cannot use it. Add the user to the docker group (sudo usermod -aG docker \$USER) and sign in again."
}
