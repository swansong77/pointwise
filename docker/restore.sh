#!/usr/bin/env bash
# Restores a backup file into the running stack. THIS REPLACES ALL DATA (a pre-restore backup is made first).
#   PW_PASSPHRASE='...' bash docker/restore.sh path/to/pointwise-YYYYMMDD-HHMMSS.pwbackup [--keep-maintenance]
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PW_PASSPHRASE:?Set PW_PASSPHRASE in the environment}"
file=${1:?usage: restore.sh <backup file> [--keep-maintenance]}
shift || true
name=$(basename "$file")
docker compose cp "$file" "backend:/var/backups/pointwise/$name"
docker compose exec -T -e PW_PASSPHRASE backend node dist/cli/pointwise-admin.js verify "$name"
docker compose exec -T -e PW_PASSPHRASE backend node dist/cli/pointwise-admin.js restore "$name" --yes "$@"
docker compose exec -T backend node dist/cli/pointwise-admin.js verify-restored
