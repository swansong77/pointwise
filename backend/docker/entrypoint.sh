#!/bin/sh
# Backend container entrypoint.
#   RUN_MIGRATIONS=true  -> prisma migrate deploy before start (default true)
#   RUN_SEED=true        -> idempotent seed of fictional demo catalog + demo users (default false)
set -e
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] applying migrations"
  npx prisma migrate deploy
fi
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] seeding"
  node dist/seed/seed.js
fi
exec "$@"
