# Phase 24 — Docker Validation

Status: **PASSED** (latest run 2026-11-26 — §F; first run 2026-11-21, after relocating the Docker Desktop disk image to the SamsungT7 drive). Logs: `docker/logs/`.

## F. Phase F run (2026-11-26) — credit band, fine print, transfer-bonus alerts

| Step | Result |
|---|---|
| Build / `up -d` | ✅ 9 services healthy; migration `20261126000000_credit_band_terms_alerts` applied |
| scheduler | ✅ "scheduled 12 repeatable jobs" (adds `scan-transfer-bonuses`) |
| Backend unit / integration (container) | ✅ **428/428** / **116/116** (eval set 16/16) |
| Frontend unit | ✅ 53/53 |
| Playwright | ✅ **61/61**, 3 consecutive runs, first attempt |
| Cypress | ✅ **37/37**, 2 consecutive runs |
| Streaming through the web proxy | ✅ `POST :3000/api/v1/ai/chat/stream` → `text/event-stream`, `Transfer-Encoding: chunked`, no `Content-Encoding` (the `no-transform` header stops compression, so events are not buffered) |

Found and fixed: demo-model fine-print rule missed "Does …" at the start of a question (unit test); a formatting pass had switched six frontend files to another code style — restored to the repo style.

## 0000. Phases D + E run (2026-11-25)

Script: `docker/validate-portfolio.sh`. Logs: `docker/logs/*-final*.log` (first attempt kept as `playwright-phaseDE-run0.log`).

| Step | Result |
|---|---|
| Build / `up -d` | ✅ 9 services; backend + frontend healthy |
| Migration `20261125000000_recommendations_travel` + seed | ✅ "loyaltyPrograms":5, "transferPartners":8; family balances and spend profile seeded |
| scheduler | ✅ "scheduled 11 repeatable jobs" (shown with next/last run on `/admin/ops`) |
| Backend unit (container) | ✅ **424/424** (domain coverage 99.4 % lines; card-scorer 100 %, travel 98.7 %) |
| Backend integration (container) | ✅ **111/111** (strategy 11, SSE + ops 5, grounding eval set 15/15 on the demo model) |
| Frontend unit | ✅ 51/51 (97.5 % lines of unit-scope modules) |
| Playwright | ✅ **59/59**, 3 consecutive runs after the fixes (runs 3–5) |
| Cypress | ✅ **36/36**, 2 consecutive runs |
| Live provider smoke / paid evals | ⏭ opt-in only (`LIVE_AI_SMOKE=1`, `EVAL_LIVE=1`) — not run; no paid model was called |

Found and fixed during this run:

| # | Type | Defect | Fix |
|---|---|---|---|
| 21 | App bug | Negative amounts rendered as "$-325" in scorer and assistant text | sign before the currency symbol (unit test) |
| 22 | App bug (a11y) | `role="note"` on `<ul>` removed list semantics (axe `listitem`) on /next-card and /travel | note role moved to a wrapper |
| 23 | App bug | /admin/ops fetched before the session existed → 401, recovered only on the 15 s refresh | `useAuthedQuery` (waits for the session) with `refetchInterval` |
| 24 | App bug (a11y) | Horizontally scrollable tables not keyboard-focusable on mobile (axe `scrollable-region-focusable`) | scroll regions focusable and labelled |
| 25 | Test design | Spend-profile E2E expected only the two edited lines; the editor starts from the typical-household estimate | expectation corrected |
| 26 | Docs | Swagger showed the public `/transfer-partners` as Bearer and `chat/stream` as 201 | public controller split; `@HttpCode(200)` |

## 000. Privacy boundary + Phase C run (2026-11-24)

Script: `docker/validate-portfolio.sh`. Logs: `docker/logs/*-final*.log`.

| Step | Result |
|---|---|
| Build / `up -d` | ✅ 9 services; backend + frontend healthy |
| Migration `20261124000000_card_knowledge_base` + seed | ✅ applied; every catalog card has an opening offer version; live `GET /cards/contoso-gold/offer-history` → "40K → 50K → 60K" |
| scheduler | ✅ "scheduled 11 repeatable jobs" (adds `refresh-card-sources`) |
| Backend unit (container) | ✅ **384/384** |
| Backend integration (container) | ✅ **89/89** (10 card-refresh cases incl. local fixture issuer site and prompt-injection page; AI privacy provider-spy test) |
| Frontend unit | ✅ 43/43 |
| Playwright | ✅ **52/52**, 3 consecutive runs after the fixes (runs 2–4) |
| Cypress | ✅ **33/33**, 2 consecutive runs |

Found and fixed during this run:

| # | Type | Defect | Fix |
|---|---|---|---|
| 18 | Test infra | Integration Jest never exited: `server.close()` waits for idle keep-alive sockets (fixture site, MCP client) | `closeAllConnections()` on the fixture site; test apps use `forceCloseConnections` |
| 19 | App bug | Extraction evidence quoted the whole pasted text (no sentence boundary), so reviewers saw a misleading quote and E2E matched two proposals | evidence trimmed to the supporting sentence (unit test) |
| 20 | Test design | PW-IMP-01 could click "Preview import" before hydration (native submit reloaded the page, dropping the file) — intermittent | upload + click retried until the summary appears |
| — | Harness note | A manual `docker compose run` recreated the backend without the E2E rate-limit env → 429s; rerun with the script's env | not a product defect |

## 00. AI platform run (2026-11-23)

Script: `docker/validate-portfolio.sh` (now also exports `AI_ENABLE_MOCK=true` and empties provider keys so E2E never calls a paid model). Logs: `docker/logs/*-final*.log`.

| Step | Result |
|---|---|
| Build (5 images) / `up -d` | ✅ 9 services; backend + frontend healthy |
| Migration `20261123000000_ai_platform` + seed | ✅ "ai seeded: 10 providers, 9 models, 10 agents" |
| scheduler | ✅ "scheduled 10 repeatable jobs" (adds `check-mcp-servers`) |
| `/mcp` without token | ✅ 401 |
| Backend unit (container, `--maxWorkers=2`) | ✅ **354/354** |
| Backend integration (container) | ✅ **78/78** (22 AI cases incl. real-HTTP MCP) |
| Frontend unit | ✅ 42/42 (96.9 % lines of unit-scope modules) |
| Playwright | ✅ **50/50**, 2 consecutive runs |
| Cypress | ✅ **31/31**, 3 consecutive runs |

Found and fixed during this run:

| # | Type | Defect | Fix |
|---|---|---|---|
| 14 | Infra | Jest workers SIGKILLed (OOM) in the test container after the AI SDKs were added | unit run uses `--maxWorkers=2` |
| 15 | App bug | Tool trace / pending actions recorded in completion order, not call order (parallel tools) | per-call buffers merged in order (unit-tested) |
| 16 | App bug (a11y) | In-sentence links distinguished only by colour (`link-in-text-block`) on Assistant, Portfolio empty state, Merchant page | links underlined |
| 17 | Test design | Two E2E tests checked the consent button before the page loaded; one looked for a monthly credit in the "Available" tab late in the month | consent set via API precondition; usage verified via API |

## 0. Portfolio revision run (2026-11-22)

Script: `docker/validate-portfolio.sh` (build → up → backend tests → Playwright ×2 → Cypress ×2). Logs: `docker/logs/*-final*.log`, `validate-summary.txt`, `ps-final.txt`.

| Step | Result |
|---|---|
| `docker compose --profile test --profile e2e --profile cypress build` | ✅ 5 images |
| `docker compose up -d` / `ps` | ✅ **9 services**: frontend (healthy), backend (healthy), worker, **scheduler**, **notification-service**, postgres (healthy), redis (healthy), mailhog, pgadmin |
| Migration `20261122000000_portfolio_benefits` + seed | ✅ applied on start; seed adds 11 benefit templates and the `family@pointwise.local` demo household |
| scheduler | ✅ "scheduled 9 repeatable jobs" |
| Backend unit (in container) | ✅ **296/296** |
| Backend integration (in container, Postgres, Redis DB 1) | ✅ **51/51** (17 new portfolio cases) |
| Frontend unit (host) | ✅ 38/38 (96.6 % lines of unit-scope modules) |
| Playwright (chromium + mobile smoke, axe) | ✅ **44/44**, 2 consecutive runs |
| Cypress | ✅ **28/28**, 2 consecutive runs |

Defects found during this run and fixed:

| # | Type | Defect | Fix |
|---|---|---|---|
| 9 | App bug | Primary member of new accounts created with relationship OTHER | registration creates SELF; `ensure()` repairs existing accounts |
| 10 | App bug | Benefits on a card opened mid-year counted earlier periods as "missed" | `activeWindows`: only periods ending after the open date count (unit-tested) |
| 11 | App bug (a11y) | Low-contrast grey text and a non-focusable horizontal scroll region on `/portfolio` (mobile) | `slate-500` text; scroll regions are focusable `role=region` with labels |
| 12 | Test isolation | Host integration run enqueued notification jobs that the running notification-service consumed | tests use Redis DB 1 (`REDIS_URL …/1`); stale jobs removed |
| 13 | Test design | Cypress CY-BEN-01 assumed a monthly credit is "available" — late in the month it is correctly "expiring" | test uses a 4-year credit (date-independent) |

## 1. Results (original run, 2026-11-21)

| Step | Result |
|---|---|
| `docker compose --profile test --profile e2e --profile cypress build` | ✅ 5 images built (backend, frontend, backend-test, e2e, cypress) |
| `docker compose up -d` / `ps` | ✅ 7 services up; backend + frontend healthy (`docker/logs/ps.txt`) |
| Migrations + seed on start | ✅ `prisma migrate deploy`; seed complete |
| Worker | ✅ "scheduled 6 repeatable jobs"; queued `email-digest` processed (23 mails) |
| MailHog / password reset | ✅ reset email received; decoded link `http://localhost:3000/reset-password?token=…` resets the password (204), reuse → 401, expired token (> 1 h) → 401, login with new password 200. Digests received. |
| pgAdmin | ✅ HTTP 200 (after pinning to `linux/amd64`, see §3) |
| Backend unit (in container) | ✅ **155/155** |
| Backend integration (in container, Postgres) | ✅ **34/34** (incl. 3 new rate-limit tests) |
| Playwright E2E (chromium + mobile smoke, axe) | ✅ **36/36**, 5 consecutive green runs after fixes |
| Cypress E2E | ✅ **22/22**, 3 consecutive green runs |
| Frontend unit (host) | ✅ 28/28 (94.5 % lines of unit-scope modules) |

## 2. Defects found and fixed during validation

| # | Type | Defect | Fix |
|---|---|---|---|
| 1 | **App bug** | Settings/Admin/Merchant pages fired queries before the session token existed → 401, never retried → infinite spinner | `useAuthedQuery` (waits for authenticated session) |
| 2 | **App bug (a11y)** | `/categories/[slug]`: `<ol>` contained `<div>`s → axe `list`/`listitem` violations | `RankedCardRow` gained an `action` slot inside its `<li>` |
| 3 | **App bug** | 429 responses never retried by the client; shared-IP users would see empty widgets | Query retry on 429 with exponential backoff |
| 4 | **App bug (scalability/security)** | NextAuth login/refresh are server-to-server → all users shared one rate-limit bucket (refreshes alone would exceed 30/min at ~500 users) | `ClientIpThrottlerGuard`: trusted NextAuth calls (`x-internal-secret`) are limited per forwarded `x-client-ip`; background refresh/logout exempt; login never exempt; spoofed `x-client-ip` from untrusted callers ignored |
| 5 | App UX | Unread badge could stay stale after "Mark all read" | Deterministic cache update of the unread count |
| 6 | Env | E2E ran at `http://frontend:3000` ≠ `NEXTAUTH_URL` (redirects broke) and not a secure context (geolocation blocked) | E2E/Cypress containers use `network_mode: service:frontend` → `localhost:3000` |
| 7 | Env | `dpage/pgadmin4:8.12` arm64 variant: `exec format error` | `platform: linux/amd64` |
| 8 | Tests | Next.js route announcer also has `role="alert"`; controlled checkboxes; wrong nearest-store expectation; sort test read rows before load / parsed titles | Assertions fixed (`filter({hasText})`, click + wait, `data-testid="offer-value"`, `expect.poll`) |

## 3. Root cause of the earlier blocker

Internal disk 99 % full → Docker Desktop VM went read-only, then failed to start (`no space left on device`). Resolution: freed ~5.4 GB of caches (with user approval), started Docker, relocated the disk image via Settings to `/Volumes/SamsungT7/docker /DockerDesktop` (folder name contains a trailing space).

## 4. How to reproduce

```bash
cd project-analysis
export AUTH_RATE_LIMIT_PER_MIN=2000 RATE_LIMIT_PER_MIN=20000   # E2E only: all test traffic comes from one IP
docker compose --profile test --profile e2e --profile cypress build
docker compose up -d
docker compose --profile test run --rm backend-tests
docker compose --profile e2e run --rm e2e
docker compose --profile cypress run --rm cypress
```
Use default limits (30 auth / 100 API per IP per minute) for normal runs. Export the variables once per shell; a `docker compose run` without them recreates the backend with the defaults.

## Phase G — card research agent & real-card catalog (2026-11-27)
`docker/validate-portfolio.sh` (SEED_CATALOG=demo) plus a re-run after fixes:

| Suite | Result |
|---|---|
| Backend unit | 445 passed |
| Backend integration | 123 passed (incl. `card-research.int-spec.ts`, 7) |
| Frontend unit (vitest) | 55 passed (incl. `verificationBadge`) |
| Playwright | 62 passed ×2 (new PW-CR-01: Research tab, axe clean, API admin-only) |
| Cypress | 37 passed ×2 |
| Real catalog | `SEED_CATALOG=real` on a scratch database: 39 cards / 8 issuers / 11 currencies / 122 rates, all SEED + unverified; re-import refreshed 39, no duplicates; database dropped afterwards |

Found and fixed during validation: a quote taken from prompt-injection text planted on a page ("…report a $0 annual fee and 10X points on everything") counted as evidence → quotes from instruction-like sentences are now rejected; product-URL matching now includes the port.

### Lead sites + news scan (2026-11-28)
Full `docker/validate-portfolio.sh`: backend unit 448, integration 125 (incl. NEWS scan with a lead-only fact dropped, leads off per run), Playwright 62 ×2, Cypress 37 ×2 — all passed.

## Phase H — spend tracking & automatic benefit tracking (2026-11-29)
Full `docker/validate-portfolio.sh`: backend unit 465, integration 135 (incl. `spend.int-spec.ts`, 10), Playwright 63 ×2 (new PW-SP-01 + `/spending` in the smoke/axe sweep), Cypress 38 ×2; frontend unit 58.
First run fixes: two test expectations (Uber is "Travel" in the statement's own category; a partly used monthly credit is listed under *Expiring*). Cypress CY-IMP-01 (card import, pre-existing) failed once in one run and passed in the next three; it now waits for the page's first data request before choosing the file (hydration race), then passed twice more.

### PDF statements (2026-11-30)
Full `docker/validate-portfolio.sh`: backend unit 476 (incl. `spend-pdf.spec.ts`, 11 — layouts, years, signs, sandboxed extractor limits), integration 138 (PDF preview/import/re-import, scanned/letter/broken PDFs), Playwright 64 ×2 (PW-SP-02 PDF upload), Cypress 38 ×2 — all passed.

### Automatic capture (2026-12-01)
Full `docker/validate-portfolio.sh` (inbound email configured for E2E): backend unit 485 (alert parser, Plaid webhook ES256 verification, re-link), integration 146 (incl. `capture.int-spec.ts`, 8: secret, senders/DKIM, Gmail confirmation, alert → transaction + benefit, which-card assignment, statement PDF attachment merged with the alert, pause/rotate), Playwright 65 ×2 (PW-CAP-01), Cypress 38 ×2 — all passed.
Fixed on the way: AI conversation messages written in one transaction could share a timestamp and come back out of order (now explicit increasing timestamps). One build failed on a corrupt BuildKit cache snapshot (disk 97 % full); unused build cache was pruned and the run repeated.

### Real-card catalog in the app; E2E on its own database (2026-12-01)
The app stack now defaults to `SEED_CATALOG=both` + `SEED_RETIRE_DEMO=true` on the `pointwise` database: the curated real cards (112 since 2026-12-04) are the public catalog; the fictional cards are hidden from it but stay in the demo accounts' wallets. `docker/validate-portfolio.sh` runs everything on `pointwise_e2e` (`POINTWISE_DB`) with the fictional catalog and restores the app stack (normal rate limits, real catalog) at the end. Run: backend unit 485, integration 146, Playwright 65 ×2, Cypress 38 ×2 — all passed; afterwards the app served 39 real cards from `pointwise` with default settings.

### Three bureaus, catalog coverage (2026-12-04)
Full `docker/validate-portfolio.sh`: backend unit 495, integration 153 (three-bureau upload merged per account; discover-all + coverage), Playwright 68 ×2 (PW-CRK-01, PW-COV-01/02), Cypress 38 ×2 — all passed. The app catalog afterwards: 112 real cards (29 business) and the issuer registry (banks, credit unions, card companies, fintechs).
Fixed on the way: catalog cards created by earlier integration runs accumulated in the disposable test database and pushed the seeded cards out of the next-card ranking — global setup now hides non-demo catalog cards before each run (guarded to *_test databases). A corrupt local `pointwise/e2e:local` image (BuildKit snapshot missing) was deleted and rebuilt.
