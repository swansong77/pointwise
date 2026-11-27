#!/usr/bin/env bash
# Makes an encrypted backup of the running production stack and copies it to ./backups (mode 600).
#
#   bash deploy/backup.sh                 uses BACKUP_PASSPHRASE from .env
#   bash deploy/backup.sh --env           also carries the secrets that keep members signed in (they are inside the encrypted file)
#
# Run it from cron or a systemd timer for off-schedule copies; the server also makes its own nightly backup inside Docker
# (the volume pointwise-prod_pointwise-backups) when BACKUP_PASSPHRASE is set. Copy ./backups off this machine too.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
check_docker
PASS="$(env_get BACKUP_PASSPHRASE)"
[ -n "$PASS" ] || die "BACKUP_PASSPHRASE is empty in $PW_ENV_FILE."
OUT="$(PW_PASSPHRASE="$PASS" pw_compose exec -T -e PW_PASSPHRASE backend node dist/cli/pointwise-admin.js backup "$@" 2>&1)" || die "Backup failed: $OUT"
FILE="$(printf '%s' "$OUT" | sed -n 's/.*"file": "\(.*\)".*/\1/p')"
[ -n "$FILE" ] || die "The backup ran but its file name was not reported: $OUT"
mkdir -p "$PW_ROOT/backups"
pw_compose cp "backend:$FILE" "$PW_ROOT/backups/$(basename "$FILE")"
chmod 600 "$PW_ROOT/backups/$(basename "$FILE")"

# keep the newest N copies in ./backups (BACKUP_KEEP, default 14)
KEEP="$(env_get BACKUP_KEEP)"; KEEP="${KEEP:-14}"
# shellcheck disable=SC2012
ls -1t "$PW_ROOT"/backups/*.pwbackup 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
ok "Backup saved: $PW_ROOT/backups/$(basename "$FILE")"
