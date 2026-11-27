#!/usr/bin/env bash
# One-command PointWise installer for a fresh Linux server (Ubuntu, Debian, Fedora, RHEL family).
#
#   curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/deploy/get.sh | sudo bash -s -- \
#       --domain pointwise.example.com --admin-email you@example.com
#
# It installs what is missing (git, curl, openssl, Docker), downloads PointWise to /opt/pointwise, opens ports 80 and 443 when a
# firewall (ufw) is active, then runs deploy/install.sh as your normal user. Run it again to update the download; your .env is kept.
#
# Options are handed to deploy/install.sh (--domain, --private-address, --admin-email, --yes, --no-start). Without them, and when
# a terminal is attached, you are asked.
#
# Environment
#   PW_REPO        repository to download (default: the one this script came from, else the value below)
#   PW_BRANCH      branch (default main)
#   PW_DIR         where to install (default /opt/pointwise)
#   PW_GIT_TOKEN   a read-only token, for a PRIVATE repository. Used for the download only; it is not stored. For later updates
#                  of a private repository add a read-only deploy key (docs/guides/03-automated-deployment.md, A1).
#   PW_SKIP_DOCKER=1   do not install Docker (it is already there)
#   PW_STAGE_ONLY=1    install prerequisites and download, but do not run the installer
set -euo pipefail

PW_REPO="${PW_REPO:-https://github.com/swansong77/pointwise.git}"
PW_BRANCH="${PW_BRANCH:-main}"
PW_DIR="${PW_DIR:-/opt/pointwise}"

say()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m ok\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarn\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31mfail\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || die "This installer is for Linux servers. On a Mac or Windows PC use Guide 1 (local development)."
[ "$(id -u)" = "0" ] || die "Run it with sudo:  curl -fsSL <address> | sudo bash -s -- --domain ..."

# who will own the files and run PointWise day to day: the person who typed sudo, not root
OWNER="${SUDO_USER:-root}"
[ "$OWNER" = "root" ] && warn "Running as root with no sudo user: PointWise will be owned by root. A normal user with sudo is safer."

# questions need a real terminal; with "curl | sudo bash" stdin is the download, so read from the terminal instead
TTY=""
if [ -r /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then TTY=/dev/tty; fi
ask() { local reply; [ -n "$TTY" ] || return 0; read -r -p "$1: " reply < "$TTY"; printf '%s' "$reply"; }

# ── 1. prerequisites ────────────────────────────────────────────────────────────
pkg_install() {
  if command -v apt-get >/dev/null 2>&1; then DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@" >/dev/null 2>&1
  elif command -v dnf >/dev/null 2>&1; then dnf install -y -q "$@" >/dev/null
  elif command -v yum >/dev/null 2>&1; then yum install -y -q "$@" >/dev/null
  else die "No supported package manager (apt, dnf, yum). Install $* yourself and run again."; fi
}
say "Checking prerequisites"
MISSING=""
for t in git curl openssl; do command -v "$t" >/dev/null 2>&1 || MISSING="$MISSING $t"; done
# shellcheck disable=SC2086
[ -z "$MISSING" ] || { say "Installing:$MISSING"; pkg_install $MISSING; }
ok "git, curl and openssl are present"

if [ "${PW_SKIP_DOCKER:-}" != "1" ]; then
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    ok "Docker is already installed ($(docker --version | sed 's/Docker version //; s/,.*//'))"
  else
    say "Installing Docker (the official script from get.docker.com)"
    curl -fsSL https://get.docker.com | sh
    command -v systemctl >/dev/null 2>&1 && systemctl enable --now docker >/dev/null 2>&1 || true
    docker compose version >/dev/null 2>&1 || die "Docker installed but the Compose plugin is missing. See https://docs.docker.com/compose/install/linux/"
    ok "Docker installed"
  fi
  if [ "$OWNER" != "root" ] && ! id -nG "$OWNER" | tr ' ' '\n' | grep -qx docker; then
    usermod -aG docker "$OWNER"
    ok "Added $OWNER to the docker group (takes effect at your next sign-in; this run handles it)"
  fi
fi

# ── 2. firewall ─────────────────────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  say "Opening ports 80 and 443 in ufw"
  ufw allow 80/tcp >/dev/null && ufw allow 443/tcp >/dev/null && ok "ports 80 and 443 are open"
fi

# ── 3. download ─────────────────────────────────────────────────────────────────
GIT=(git)
if [ -n "${PW_GIT_TOKEN:-}" ]; then
  # sent as a header for this command only: it never lands in .git/config or the process list of later runs
  AUTH="$(printf 'x-access-token:%s' "$PW_GIT_TOKEN" | base64 | tr -d '\n')"
  GIT=(git -c "http.extraHeader=Authorization: Basic $AUTH")
fi
as_owner() { if [ "$OWNER" = "root" ]; then "$@"; else sudo -u "$OWNER" -- "$@"; fi; }

if [ -d "$PW_DIR/.git" ]; then
  say "PointWise is already in $PW_DIR: updating the download"
  chown -R "$OWNER" "$PW_DIR" 2>/dev/null || true
  as_owner "${GIT[@]}" -C "$PW_DIR" fetch --quiet origin "$PW_BRANCH" || die "Could not fetch updates. For a private repository set PW_GIT_TOKEN."
  as_owner git -C "$PW_DIR" checkout --quiet "$PW_BRANCH" 2>/dev/null || true
  as_owner git -C "$PW_DIR" merge --ff-only --quiet "origin/$PW_BRANCH" || warn "Could not fast-forward (local changes?). Continuing with what is there."
else
  [ ! -e "$PW_DIR" ] || [ -z "$(ls -A "$PW_DIR" 2>/dev/null)" ] || die "$PW_DIR exists and is not a PointWise download. Choose another place with PW_DIR=..."
  say "Downloading PointWise to $PW_DIR"
  mkdir -p "$PW_DIR" && chown "$OWNER" "$PW_DIR"
  as_owner "${GIT[@]}" clone --quiet --depth 1 --branch "$PW_BRANCH" "$PW_REPO" "$PW_DIR" \
    || die "Download failed. Is the repository private? Then set PW_GIT_TOKEN to a read-only token, e.g. sudo PW_GIT_TOKEN=... bash get.sh"
fi
[ -f "$PW_DIR/deploy/install.sh" ] || die "$PW_DIR does not look like PointWise (deploy/install.sh is missing)."
ok "PointWise is in $PW_DIR"
[ -z "${PW_GIT_TOKEN:-}" ] || warn "The token was used for this download only. To update a private repository later, add a read-only deploy key (docs/guides/03-automated-deployment.md, A1)."

[ "${PW_STAGE_ONLY:-}" != "1" ] || { ok "Stopping here (PW_STAGE_ONLY=1). Next: cd $PW_DIR && bash deploy/install.sh"; exit 0; }

# ── 4. questions, then hand over to the installer ───────────────────────────────
ARGS=("$@")
has() { local a; for a in "${ARGS[@]:-}"; do [ "$a" = "$1" ] && return 0; done; return 1; }
if ! has --domain && ! has --private-address && ! has --help; then
  [ -n "$TTY" ] || die "Say where PointWise will be reached: --domain pointwise.example.com  or  --private-address http://192.168.1.20"
  echo
  echo "Where will you open PointWise?"
  echo "  A public name with HTTPS (a domain pointing at this server), or a private address on your own network."
  D="$(ask 'Public name, for example pointwise.example.com (press Enter to use a private address instead)')"
  if [ -n "$D" ]; then ARGS+=(--domain "$D")
  else
    GUESS="$(hostname -I 2>/dev/null | awk '{print $1}')"
    P="$(ask "Private address [http://${GUESS:-192.168.1.20}]")"
    ARGS+=(--private-address "${P:-http://${GUESS:-192.168.1.20}}")
  fi
fi
if ! has --admin-email && ! has --help; then
  E="$(ask 'Your e-mail address (you become the administrator)')"
  [ -z "$E" ] || ARGS+=(--admin-email "$E")
fi
has --yes || has --help || ARGS+=(--yes)

say "Starting the installer"
cd "$PW_DIR"
if [ "$OWNER" = "root" ]; then
  exec bash deploy/install.sh "${ARGS[@]}"
fi
# -g docker: the docker group applies at once, without signing out and in again
exec sudo -u "$OWNER" -g docker -- env PW_ADMIN_PASSWORD="${PW_ADMIN_PASSWORD:-}" PW_PUBLIC_URL="${PW_PUBLIC_URL:-}" bash deploy/install.sh "${ARGS[@]}"
