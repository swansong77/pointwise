#!/usr/bin/env bash
# A dry run of moving PointWise to another server, on this machine, touching nothing that exists:
#   1. back up the running system into the backup folder (passphrase below),
#   2. create a brand-new empty database "pointwise_rehearsal" in the same Postgres,
#   3. start the backend image against it with a DIFFERENT TOKEN_ENC_KEY (as a new server would have),
#      apply migrations, restore the backup, and run the post-restore verification,
#   4. drop the rehearsal database.
# Prints "REHEARSAL VERIFIED" when every check passes. Do this before any real cutover.
set -uo pipefail
cd "$(dirname "$0")/../.."
export PW_PASSPHRASE=${PW_PASSPHRASE:-rehearsal-passphrase-not-a-secret-0123}
DB=pointwise_rehearsal
NEWKEY=rehearsal-new-server-encryption-key-0123456789
PGUSER=pointwise
SRC_DB=${POINTWISE_DB:-pointwise}
cleanup() { docker compose exec -T postgres psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1; }
trap cleanup EXIT
echo "== 1. backup of the running system ($SRC_DB)"
out=$(docker compose exec -T -e PW_PASSPHRASE backend node dist/cli/pointwise-admin.js backup) || { echo "$out"; echo "REHEARSAL FAILED (backup)"; exit 1; }
file=$(printf '%s' "$out" | sed -n 's/.*"file": "\(.*\)".*/\1/p'); name=$(basename "$file")
echo "   $name"
echo "== 2. new empty database $DB"
cleanup
docker compose exec -T postgres psql -U "$PGUSER" -d postgres -c "CREATE DATABASE $DB OWNER $PGUSER" >/dev/null || { echo "REHEARSAL FAILED (create database)"; exit 1; }
echo "== 3. new server: migrate, restore with another TOKEN_ENC_KEY, verify"
pw=${POSTGRES_PASSWORD:-pointwise}
docker compose run --rm --no-deps -T \
  -e DATABASE_URL="postgresql://$PGUSER:$pw@postgres:5432/$DB?schema=public" \
  -e TOKEN_ENC_KEY="$NEWKEY" -e RUN_MIGRATIONS=true -e RUN_SEED=false -e PW_PASSPHRASE \
  -v pointwise_pointwise-backups:/var/backups/pointwise \
  backend sh -c "node dist/cli/pointwise-admin.js preflight; node dist/cli/pointwise-admin.js verify '$name' && node dist/cli/pointwise-admin.js restore '$name' --yes && node dist/cli/pointwise-admin.js verify-restored"
rc=$?
if [ $rc -eq 0 ]; then echo "REHEARSAL VERIFIED"; else echo "REHEARSAL FAILED (exit $rc)"; fi
exit $rc
