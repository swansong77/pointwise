#!/usr/bin/env bash
# First install of PointWise on a server you run yourself. Safe to run again: it keeps an existing .env.
#
#   bash deploy/install.sh                                   asks what it needs
#   bash deploy/install.sh --domain pointwise.example.com --admin-email you@example.com --yes
#   bash deploy/install.sh --private-address http://192.168.1.20 --admin-email you@example.com --yes
#
# Options
#   --domain HOST            a public name that points at this server; HTTPS certificates are automatic
#   --private-address URL    an address that is not on the internet, e.g. http://192.168.1.20 (no HTTPS)
#   --admin-email EMAIL      the person who will administer this server (created if they have no account yet)
#   --yes                    do not ask questions; use the options and defaults
#   --no-start               write .env and check it, but do not start anything
#
# Environment (instead of options, handy for scripts and tests; passwords are never read from the command line)
#   PW_ADMIN_PASSWORD        the administrator's password (a strong one is generated and shown once when this is unset)
#   SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_SECURE MAIL_FROM    turn on e-mail
#   PW_PUBLIC_URL PW_SITE_ADDRESS PW_HTTP_PORT PW_HTTPS_PORT             set the address and ports directly
#   PW_ENV_FILE COMPOSE_PROJECT_NAME                         use another settings file or Docker project
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

DOMAIN="" PRIVATE="" ADMIN_EMAIL="" YES=0 START=1
while [ $# -gt 0 ]; do
  case "$1" in
    --domain) DOMAIN="${2:?--domain needs a value}"; shift 2 ;;
    --private-address) PRIVATE="${2:?--private-address needs a value}"; shift 2 ;;
    --admin-email) ADMIN_EMAIL="${2:?--admin-email needs a value}"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --no-start) START=0; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) die "Unknown option: $1 (try --help)" ;;
  esac
done
interactive() { [ "$YES" = "0" ] && [ -t 0 ]; }
ask() { local prompt=$1 default=${2:-} reply; read -r -p "$prompt${default:+ [$default]}: " reply; printf '%s' "${reply:-$default}"; }

say "Checking this machine"
check_docker
need openssl "Install it with your package manager (apt install openssl)."
ok "Docker $(docker --version | sed 's/Docker version //; s/,.*//') and Compose are ready"

# ── settings file ───────────────────────────────────────────────────────────────
NEW_ENV=0
if [ -f "$PW_ENV_FILE" ]; then
  ok "Using the existing settings file ($PW_ENV_FILE). Delete it to start over."
else
  NEW_ENV=1
  say "Creating $PW_ENV_FILE with fresh secrets"
  umask 077
  cp "$PW_ROOT/deploy/production.env.example" "$PW_ENV_FILE"
  for k in POSTGRES_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET INTERNAL_API_SECRET NEXTAUTH_SECRET TOKEN_ENC_KEY; do env_set "$k" "$(rand_hex 32)"; done
  BACKUP_PASSPHRASE_NEW="$(rand_hex 16)"
  env_set BACKUP_PASSPHRASE "$BACKUP_PASSPHRASE_NEW"
  chmod 600 "$PW_ENV_FILE"

  # the address
  if [ -n "${PW_PUBLIC_URL:-}" ]; then
    env_set PW_PUBLIC_URL "$PW_PUBLIC_URL"
    env_set PW_SITE_ADDRESS "${PW_SITE_ADDRESS:-$(printf '%s' "$PW_PUBLIC_URL" | sed -E 's#^https?://##; s#/.*$##')}"
  else
    [ -n "$DOMAIN$PRIVATE" ] || { interactive && DOMAIN="$(ask 'Public name for PointWise (for example pointwise.example.com), or press Enter to use a private address')"; }
    if [ -z "$DOMAIN" ] && [ -z "$PRIVATE" ]; then
      interactive && PRIVATE="$(ask 'Private address (for example http://192.168.1.20)')"
    fi
    if [ -n "$DOMAIN" ]; then
      DOMAIN="$(printf '%s' "$DOMAIN" | sed -E 's#^https?://##; s#/.*$##')"
      env_set PW_PUBLIC_URL "https://$DOMAIN"
      env_set PW_SITE_ADDRESS "$DOMAIN"
    elif [ -n "$PRIVATE" ]; then
      case "$PRIVATE" in http://*|https://*) ;; *) PRIVATE="http://$PRIVATE" ;; esac
      env_set PW_PUBLIC_URL "${PRIVATE%/}"
      # Caddy listens on port 80 inside its container; a port in the address is mapped on the host instead (PW_HTTP_PORT)
      env_set PW_SITE_ADDRESS "$(printf '%s' "${PRIVATE%/}" | sed -E 's#:[0-9]+$##')"
      PRIVATE_PORT="$(printf '%s' "${PRIVATE%/}" | sed -nE 's#^https?://[^/:]+:([0-9]+)$#\1#p')"
      [ -n "$PRIVATE_PORT" ] && [ -z "${PW_HTTP_PORT:-}" ] && PW_HTTP_PORT="$PRIVATE_PORT"
    else
      die "Say where PointWise will be reached: --domain pointwise.example.com, or --private-address http://192.168.1.20"
    fi
  fi
  [ -n "${PW_HTTP_PORT:-}" ] && env_set PW_HTTP_PORT "$PW_HTTP_PORT"
  [ -n "${PW_HTTPS_PORT:-}" ] && env_set PW_HTTPS_PORT "$PW_HTTPS_PORT"

  # e-mail (optional)
  if [ -n "${SMTP_HOST:-}" ]; then
    env_set MAIL_DISABLED false
    for k in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_SECURE; do [ -n "${!k:-}" ] && env_set "$k" "${!k}"; done
    [ -n "${MAIL_FROM:-}" ] && env_set MAIL_FROM "\"$MAIL_FROM\""
  fi
fi

[ -n "$(env_get PW_PUBLIC_URL)" ] || die "PW_PUBLIC_URL is empty in $PW_ENV_FILE."
case "$(env_get PW_PUBLIC_URL)" in https://pointwise.example.com) die "$PW_ENV_FILE still has the example address. Set PW_PUBLIC_URL and PW_SITE_ADDRESS to your own." ;; esac
grep -v '^#' "$PW_ENV_FILE" | grep -q CHANGE_ME && die "$PW_ENV_FILE still has CHANGE_ME values. Replace them (or delete the file and run the installer again)."
pw_compose config -q || die "The settings are not valid (see the message above)."
ok "Settings are valid: $(env_get PW_PUBLIC_URL)"

[ "$START" = "1" ] || { say "Not starting (--no-start). Run: bash deploy/deploy.sh"; exit 0; }

# ── start ───────────────────────────────────────────────────────────────────────
say "Building and starting PointWise (the first build takes several minutes)"
if [ -n "$(env_get PW_BACKEND_IMAGE)" ] || [ -n "${PW_BACKEND_IMAGE:-}" ]; then pw_compose pull; pw_compose up -d; else pw_compose up -d --build; fi
say "Waiting for the database, API and web app"
wait_healthy postgres 120 || die "The database did not become healthy. See: docker compose -f docker-compose.prod.yml logs postgres"
wait_healthy backend 300 || die "The API did not become healthy. See: docker compose -f docker-compose.prod.yml logs backend"
wait_healthy frontend 180 || die "The web app did not become healthy. See: docker compose -f docker-compose.prod.yml logs frontend"
wait_healthy caddy 60 || die "The web server did not start. See: docker compose -f docker-compose.prod.yml logs caddy"

# ── administrator ───────────────────────────────────────────────────────────────
ADMIN_PASSWORD_SHOWN=""
if [ -z "$ADMIN_EMAIL" ] && interactive; then ADMIN_EMAIL="$(ask 'Your e-mail address (you will be the administrator)')"; fi
if [ -n "$ADMIN_EMAIL" ]; then
  if [ -z "${PW_ADMIN_PASSWORD:-}" ]; then PW_ADMIN_PASSWORD="$(rand_password)"; ADMIN_PASSWORD_SHOWN="$PW_ADMIN_PASSWORD"; fi
  export PW_ADMIN_PASSWORD
  bash "$PW_ROOT/deploy/make-admin.sh" "$ADMIN_EMAIL"
fi

# ── done ────────────────────────────────────────────────────────────────────────
echo
ok "PointWise is running at $(env_get PW_PUBLIC_URL)"
if [ -n "$ADMIN_EMAIL" ]; then
  echo "   Administrator:  $ADMIN_EMAIL"
  [ -n "$ADMIN_PASSWORD_SHOWN" ] && echo "   Password:       $ADMIN_PASSWORD_SHOWN   (shown once: change it after signing in, Settings, and store it in a password manager)"
fi
if [ "$NEW_ENV" = "1" ]; then
  echo
  warn "Save these now. They cannot be recovered if lost:"
  echo "   $PW_ENV_FILE   holds every secret (copy it to a password manager or an encrypted drive)"
  echo "   Backup passphrase: $BACKUP_PASSPHRASE_NEW   (without it a backup file cannot be read)"
fi
echo
echo "Next: open the address above and follow docs/guides/02-self-host-install.md, part 5 (first sign-in)."
