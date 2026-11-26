# Backup, restore, export and import (DT)

| ID | Where | What it checks |
|---|---|---|
| unit | `backend/test/unit/data/*.spec.ts` | the registry against the real schema (every model classified, every secret column listed, scope paths real, insert order), row encoding for every type, the encryption stream (wrong passphrase, tampering, reordering, truncation), the backup format and manifest |
| TC-DT integration | `backend/test/integration/data-transfer.int-spec.ts` | member export has no secrets; import preview, merge, repeat merge, replace, hostile file, bad files, unmatched catalog; backup, verify, tamper, wrong passphrase, version mismatch, rollback, restore under a different TOKEN_ENC_KEY with every secret still decrypting, nightly job, retention, upload, maintenance mode, preflight and environment manifest |
| PW-DT-01..04 | `playwright/tests/data-transfer.spec.ts` | download and import in the UI, replace confirmation, a refused file, admin backup create and verify, migration checklist and checks |
| CY-DT-01..02 | `cypress/cypress/e2e/data-transfer.cy.ts` | export and import over the API, ownership, admin-only routes, backup verify, maintenance 503 |
| frontend | `frontend/test/data-transfer.test.ts` | preview rows and summaries, passphrase rules, checklist |
| rehearsal | `docker/migrate/rehearse.sh` | a restore into a brand-new database with a different TOKEN_ENC_KEY and the post-restore verification |

## Brands and rates (BR, RT)
| ID | Where | What it checks |
|---|---|---|
| unit | `frontend/test/brand-coverage.test.ts` | every issuer, merchant, program and currency in the seed data resolves to a brand |
| unit | `frontend/test/brands.test.ts`, `svg-safe.test.ts` | every served logo is safe and recorded with its source and licence; the cleaner refuses scripts, styles, images, links, text, masks, external references |
| unit | `backend/test/unit/recommendation-rates.spec.ts` | capped rates blended with spend, conditional rates never rank, sub-categories fall back to Travel, verified flag |
| unit | `backend/test/unit/data/reward-audit.spec.ts` | the audit rules and the catalog's own rates (no unknown errors, confirmed cards state a base rate) |
| TC-RT integration | `backend/test/integration/best-card-rates.int-spec.ts` | the category list with sub-categories, portal rates cannot win, caps for light and heavy spenders, unverified marker |
