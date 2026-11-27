#!/usr/bin/env bash
# Restores a backup file into the running production stack. THIS REPLACES ALL DATA (a pre-restore backup is made first).
#
#   bash deploy/restore.sh backups/pointwise-20261127-085829.pwbackup
#
# The passphrase comes from PW_PASSPHRASE if set, else BACKUP_PASSPHRASE in .env. Use PW_PASSPHRASE for a backup that was made
# with a different passphrase (for example one from another server).
# The restore checks the file first (passphrase, checksums, version), restores in one transaction, and rolls back on any mismatch.
set -euo pipefail
# shellcheck source=deploy/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
check_docker
FILE="${1:-}"
[ -f "$FILE" ] || die "Usage: bash deploy/restore.sh <backup file>   (file not found: ${FILE:-none given})"
shift
PASS="${PW_PASSPHRASE:-$(env_get BACKUP_PASSPHRASE)}"
[ -n "$PASS" ] || die "Set PW_PASSPHRASE, or BACKUP_PASSPHRASE in $PW_ENV_FILE."
NAME="$(basename "$FILE")"
if [ -t 0 ] && [ -z "${PW_YES:-}" ]; then
  read -r -p "This REPLACES everything in PointWise with $NAME. Type yes to continue: " reply
  [ "$reply" = "yes" ] || die "Cancelled. Nothing was changed."
fi
pw_compose cp "$FILE" "backend:/var/backups/pointwise/$NAME"
# the copy arrives owned by root; the API runs as the node user
pw_compose exec -T -u root backend chown node:node "/var/backups/pointwise/$NAME"
PW_PASSPHRASE="$PASS" pw_compose exec -T -e PW_PASSPHRASE backend node dist/cli/pointwise-admin.js verify "$NAME"
PW_PASSPHRASE="$PASS" pw_compose exec -T -e PW_PASSPHRASE backend node dist/cli/pointwise-admin.js restore "$NAME" --yes "$@"
pw_compose exec -T backend node dist/cli/pointwise-admin.js verify-restored
ok "Restored from $NAME"
