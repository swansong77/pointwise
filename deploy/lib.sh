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

# ── ports ──────────────────────────────────────────────────────────────────────

# is something on this machine already listening on this TCP port? (lsof sees this user's listeners; connecting sees everyone's)
port_busy() {
  local p=$1
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then return 0; fi
  (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null
}

# the name of the program using a port, when it can be told (best effort, for the message)
port_user() {
  command -v lsof >/dev/null 2>&1 || return 0
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR==2 {print $1}'
}

# the first free port from $1 up to $2
free_port_from() {
  local p=$1 end=$2
  while [ "$p" -le "$end" ]; do
    port_busy "$p" || { echo "$p"; return 0; }
    p=$((p + 1))
  done
  return 1
}

# Makes sure the web server can bind its ports, before anything is started.
#   an http:// address never uses HTTPS, so a busy HTTPS port is moved out of the way instead of stopping the install
#   an https address needs 80 and 443 (certificates): a busy one stops the install with what to do
#   the HTTP port is needed either way
# Skipped when this stack's own web server is already running (its ports are "busy" because they are ours).
prepare_ports() {
  [ -z "$(pw_compose ps -q --status running caddy 2>/dev/null || true)" ] || return 0
  local hp sp new who
  hp="$(env_get PW_HTTP_PORT)"; hp="${hp:-80}"
  sp="$(env_get PW_HTTPS_PORT)"; sp="${sp:-443}"
  case "$(env_get PW_PUBLIC_URL)" in
    http://*)
      if port_busy "$sp"; then
        new="$(free_port_from 8443 8499)" || die "Port $sp is in use and no free port was found between 8443 and 8499. Set PW_HTTPS_PORT in $PW_ENV_FILE to a free port."
        env_set PW_HTTPS_PORT "$new"
        ok "Port $sp is in use on this machine. An http:// address does not use HTTPS, so the HTTPS port is set to $new instead."
      fi
      ;;
    *)
      for p in "$sp"; do
        if port_busy "$p"; then
          who="$(port_user "$p")"
          die "Port $p is already in use${who:+ by $who}. A public https address needs ports 80 and 443 for its certificate. Stop what uses it, or use a private address instead (--private-address http://...)."
        fi
      done
      ;;
  esac
  if port_busy "$hp"; then
    who="$(port_user "$hp")"
    die "Port $hp is already in use${who:+ by $who}. Pick another: set PW_HTTP_PORT to a free port (for example 8080) and put the same port in PW_PUBLIC_URL (for example http://192.168.1.20:8080) in $PW_ENV_FILE, then run this again."
  fi
}
