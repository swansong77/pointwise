#!/usr/bin/env bash
# Full Docker validation for the portfolio revision. Logs go to docker/logs/.
set -u
cd "$(dirname "$0")/.."
export AUTH_RATE_LIMIT_PER_MIN=2000 RATE_LIMIT_PER_MIN=20000 AI_RATE_LIMIT_PER_MIN=500   # E2E only: all traffic comes from one IP
# E2E must use the deterministic offline model, never a paid provider
export ANTHROPIC_API_KEY= OPENAI_API_KEY= GEMINI_API_KEY= AI_ENABLE_MOCK=true
# E2E fixtures expect the fictional demo catalog
export SEED_CATALOG=demo SEED_RETIRE_DEMO=false POINTWISE_DB=pointwise_e2e   # E2E on its own database, never the app's
# alert-email inbox for E2E (synthetic alerts are posted to the inbound endpoint)
export INBOUND_EMAIL_DOMAIN=in.pointwise.test INBOUND_EMAIL_SECRET=e2e-inbound-secret-0123456789 INBOUND_AUTHSERV_ID=mx.pointwise.test
L=docker/logs
run() { local name=$1; shift; "$@" > "$L/$name.log" 2>&1; echo "$name exit=$?" | tee -a "$L/validate-summary.txt"; }
: > "$L/validate-summary.txt"

run build-final docker compose --profile test --profile e2e --profile cypress build
run up-final docker compose up -d
for i in $(seq 1 60); do
  docker compose ps --format '{{.Service}} {{.Status}}' | grep -q 'frontend.*(healthy)' && break
  sleep 3
done
docker compose ps --format 'table {{.Service}}\t{{.Status}}' > "$L/ps-final.txt"
run backend-tests-final docker compose --profile test run --rm backend-tests
run playwright-final-1 docker compose --profile e2e run --rm e2e
run playwright-final-2 docker compose --profile e2e run --rm e2e
run cypress-final-1 docker compose --profile cypress run --rm cypress
run cypress-final-2 docker compose --profile cypress run --rm cypress
# put the app stack back on its own database (real catalog) with normal settings
env -u POINTWISE_DB -u SEED_CATALOG -u SEED_RETIRE_DEMO -u AUTH_RATE_LIMIT_PER_MIN -u RATE_LIMIT_PER_MIN -u AI_RATE_LIMIT_PER_MIN -u INBOUND_EMAIL_DOMAIN -u INBOUND_EMAIL_SECRET -u INBOUND_AUTHSERV_ID -u AI_ENABLE_MOCK -u ANTHROPIC_API_KEY -u OPENAI_API_KEY -u GEMINI_API_KEY docker compose up -d > "$L/restore-app.log" 2>&1
echo done >> "$L/validate-summary.txt"
