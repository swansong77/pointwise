#!/usr/bin/env bash
# Writes an encrypted backup inside the backend container and copies it into ./docker/backups/ on this machine.
#   PW_PASSPHRASE='a long passphrase' bash docker/backup.sh [--ephemeral] [--env]
# Without the passphrase a backup cannot be read, and PointWise never stores it. See docs/backup-restore.md.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PW_PASSPHRASE:?Set PW_PASSPHRASE (at least 12 characters) in the environment}"
out=$(docker compose exec -T -e PW_PASSPHRASE backend node dist/cli/pointwise-admin.js backup "$@")
echo "$out"
file=$(printf '%s' "$out" | sed -n 's/.*"file": "\(.*\)".*/\1/p')
mkdir -p docker/backups
docker compose cp "backend:${file}" "docker/backups/$(basename "$file")"
chmod 600 "docker/backups/$(basename "$file")"
echo "Copied to docker/backups/$(basename "$file") (this folder is not committed to git)."
