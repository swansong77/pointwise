#!/usr/bin/env bash
# Makes a person an administrator. If they do not have an account yet and you give a password, the account is created first.
#
#   bash deploy/make-admin.sh you@example.com                      promote an existing account
#   PW_ADMIN_PASSWORD='a long password' bash deploy/make-admin.sh you@example.com    create it first, then promote
#
# The password is read from the environment, never from the command line, so it does not show in process lists or shell history.
# Sign-up rules: at least 10 characters, with a letter and a non-letter.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

EMAIL="${1:-}"
[ -n "$EMAIL" ] || die "Usage: bash deploy/make-admin.sh you@example.com   (set PW_ADMIN_PASSWORD to create the account first)"
check_docker
[ -f "$PW_ENV_FILE" ] || die "No settings file at $PW_ENV_FILE. Run deploy/install.sh first."

exists() {
  [ "$(printf 'SELECT count(*) FROM "User" WHERE lower(email) = lower(:'"'"'email'"'"');\n' | pw_compose exec -T postgres psql -U pointwise -d pointwise -tA -v email="$EMAIL")" != "0" ]
}

if ! exists; then
  [ -n "${PW_ADMIN_PASSWORD:-}" ] || die "$EMAIL has no account yet. Create one in the web app, or set PW_ADMIN_PASSWORD to create it here."
  say "Creating the account for $EMAIL"
  pw_compose exec -T -e PW_ADMIN_EMAIL="$EMAIL" -e PW_ADMIN_PASSWORD backend node -e '
    fetch("http://127.0.0.1:4000/api/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: process.env.PW_ADMIN_EMAIL, password: process.env.PW_ADMIN_PASSWORD, name: "Administrator" }),
    }).then(async (r) => { if (!r.ok) { console.error(await r.text()); process.exit(1); } }).catch((e) => { console.error(e.message); process.exit(1); });
  ' || die "The account could not be created (the message above says why; the password may be too weak)."
fi

printf 'UPDATE "User" SET role = '"'"'ADMIN'"'"' WHERE lower(email) = lower(:'"'"'email'"'"');\n' | pw_compose exec -T postgres psql -U pointwise -d pointwise -v email="$EMAIL" >/dev/null
[ "$(printf 'SELECT role FROM "User" WHERE lower(email) = lower(:'"'"'email'"'"');\n' | pw_compose exec -T postgres psql -U pointwise -d pointwise -tA -v email="$EMAIL")" = "ADMIN" ] || die "Could not make $EMAIL an administrator."
ok "$EMAIL is an administrator. Sign out and back in if you were already signed in."
