#!/usr/bin/env bash
# Rebuild and rerun every suite (backend unit+integration, Playwright x2, Cypress x2) on the E2E database,
# then put the app stack back on its own database. Progress: docker/logs/revalidate-summary.txt ("done" when finished).
set -u
cd "$(dirname "$0")/.."
export AUTH_RATE_LIMIT_PER_MIN=2000 RATE_LIMIT_PER_MIN=20000 AI_RATE_LIMIT_PER_MIN=500
# E2E must use the deterministic offline model, never a paid provider
export ANTHROPIC_API_KEY= OPENAI_API_KEY= GEMINI_API_KEY= AI_ENABLE_MOCK=true
export SEED_CATALOG=demo SEED_RETIRE_DEMO=false POINTWISE_DB=pointwise_e2e
export INBOUND_EMAIL_DOMAIN=in.pointwise.test INBOUND_EMAIL_SECRET=e2e-inbound-secret-0123456789 INBOUND_AUTHSERV_ID=mx.pointwise.test
L=docker/logs
S=$L/revalidate-summary.txt
: > "$S"
r() { local n=$1; shift; "$@" > "$L/$n.log" 2>&1; echo "$n exit=$?" >> "$S"; }
r rv-build docker compose --profile test --profile e2e --profile cypress build
r rv-backend docker compose --profile test run --rm backend-tests
r rv-pw1 docker compose --profile e2e run --rm e2e
r rv-pw2 docker compose --profile e2e run --rm e2e
r rv-cy1 docker compose --profile cypress run --rm cypress
r rv-cy2 docker compose --profile cypress run --rm cypress
env -u POINTWISE_DB -u SEED_CATALOG -u SEED_RETIRE_DEMO -u AUTH_RATE_LIMIT_PER_MIN -u RATE_LIMIT_PER_MIN -u AI_RATE_LIMIT_PER_MIN -u INBOUND_EMAIL_DOMAIN -u INBOUND_EMAIL_SECRET -u INBOUND_AUTHSERV_ID -u AI_ENABLE_MOCK -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GEMINI_API_KEY docker compose up -d > "$L/rv-restore.log" 2>&1
echo done >> "$S"
