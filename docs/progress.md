# Progress Log

| Phase | Status | Output | Notes |
|---|---|---|---|
| 1 Environment validation | ✅ | docs/environment-audit.md | class-dump, Frida, Objection, r2, IDA, BN missing; not required |
| 2 Application inventory | ✅ | docs/application-inventory.md | Catalyst app 8.1.4 (20261019), 3 appex + 2 login items |
| 3 Binary analysis | ✅ | docs/static-analysis.md | 3,262 Swift types parsed; REA exposure audit clean |
| 4 Swift analysis | ✅ | docs/swift-analysis.md | Custom `__swift5_types`/`__swift5_fieldmd` parsers |
| 5 Resource analysis | ✅ | docs/resources.md | 127 renditions; seed DB catalog counts |
| 6 Network analysis | ✅ | docs/networking.md, api/cardpointers-observed.openapi.json | 48 paths, 42 schemas (static) |
| 7 Data storage | ✅ | docs/storage.md | 24 Core Data entities, ER diagram |
| 8 Functional analysis | ✅ | docs/features.md | 30 features w/ traceability |
| 9 User flows | ✅ | docs/user-flows.md | 9 flows |
| 10 PRD | ✅ | docs/prd.md | Web product "Pointwise" |
| 11 Web architecture | ✅ | docs/web-architecture.md | system/container/sequence/data-flow/ER diagrams |
| 12 Database design | ✅ | database/schema.prisma, backend/prisma/migrations/20261121000000_init | 27 models, 26 tables, 42 indexes |
| 13 Frontend design + build | ✅ | docs/frontend-spec.md, frontend/ | Next.js 15, 18 routes, build green |
| 14 Backend design + build | ✅ | docs/backend-spec.md, backend/ | NestJS API + worker, 6 scheduled jobs |
| 15 API design | ✅ | docs/api-spec.md, api/openapi.json | 79 operations / 65 paths (exported from code) |
| 16 Roadmap | ✅ | docs/roadmap.md | ≈44 ew |
| 17 Test strategy | ✅ | docs/test-strategy.md | |
| 18 Test cases | ✅ | tests/test-cases/ | 134 cases + CSV |
| 19 Cypress | ✅ authored | cypress/ | 22 tests — not yet executed (Docker) |
| 20 Playwright | ✅ authored | playwright/ | 32 tests + axe — not yet executed (Docker) |
| 21 Security review | ✅ | docs/security-review.md | 3 High dep CVEs fixed → 0; OAuth proxy exposure fixed; 4 Medium open |
| 22 Performance review | ✅ | docs/performance-review.md | ranking 0.106 ms/dashboard |
| 23 Dockerization | ✅ | docker-compose.yml, */Dockerfile | backend + frontend images built |
| 24 Docker validation | ✅ PASSED | docs/docker-validation.md | 7 services up; backend 155+34, Playwright 36/36, Cypress 22/22, frontend 28; 5 app bugs fixed |
| 25 Final report | ✅ (to be refreshed after 24) | final-report/final-report.md | |

Test results so far: backend unit 149 ✓ (domain 100 % lines) · integration 31 ✓ (91 % lines) · frontend 27 ✓ (94.5 % lines).

## Portfolio & benefits revision (2026-11-22)

| Item | Status | Artifact |
|---|---|---|
| Review of the revised requirements | ✅ | docs/portfolio-revision-review.md |
| Excel import design + importer | ✅ | docs/excel-import-design.md, backend/src/domain/import.ts, portfolio/imports.ts |
| Bank & bureau feasibility + Plaid sandbox connector + tradelines | ✅ (production needs contracts) | docs/bank-and-bureau-feasibility.md |
| Chase 5/24 engine | ✅ | docs/chase-524-engine.md, domain/five24.ts |
| Household management | ✅ | docs/household-management.md |
| Benefit tracker + utilization | ✅ | docs/benefits-data-model.md |
| Benefit notification system (in-app, email, push) | ✅ | docs/benefit-notification-system.md |
| Rewards analytics + dashboards (portfolio, benefits, 5/24, household, import) | ✅ | frontend/src/app/(app)/* |
| Database additions | ✅ | migration 20261122000000_portfolio_benefits (38 models) |
| Tests | ✅ | tests/{524,benefits,households,imports}/ (93 cases) |
| Docker: 9 services incl. scheduler + notification-service; validation | ✅ PASSED | docs/docker-validation.md §0 |

Results: backend unit 296 · integration 51 · frontend 38 · Playwright 44 · Cypress 28 — all green in Docker.

## AI platform & MCP (2026-11-23)

Review decisions: build Phase A (AI core) + B (MCP) now; card knowledge base via **admin-reviewed AI extraction** (Phase C, designed); MCP **restricted** (user chats get only Pointwise tools; filesystem/DB/Git/browser MCP are operator tooling).

| Item | Status | Artifact |
|---|---|---|
| Provider-agnostic AI layer (Anthropic, OpenAI/Azure/compatible incl. Grok, Mistral, DeepSeek, OpenRouter, Ollama, Gemini, offline demo) | ✅ | backend/src/ai/providers, docs/ai-platform.md |
| Model registry, failover, circuit breaker, budgets, usage & cost | ✅ | ai/router.ts, admin /admin/ai |
| Assistant + 10 agent profiles + 12 tools; confirm-before-write | ✅ | ai/ai.service.ts, ai/tools.ts, /assistant |
| Pointwise MCP server (PAT) + admin MCP registry with approval pinning | ✅ | ai/mcp-server.ts, ai/mcp-client.ts, docs/mcp-architecture.md, docs/mcp-registry.md |
| Card refresh engine, offer history | ✅ Phase C (below) | docs/card-refresh-engine.md, docs/card-offer-history.md |
| Recommendation scorer, travel optimisation | ⏭ next round | docs/roadmap.md |
| Tests | ✅ | tests/ai/ (34 cases) |
| Docker validation | ✅ PASSED | docs/docker-validation.md §00 |

Results: backend unit 354 · integration 78 · frontend 42 · Playwright 50 · Cypress 31 — all green in Docker.

## Privacy boundary + Phase C — card knowledge base (2026-11-24)

Owner rule: **no AI provider (LLM or MCP client) may receive users' card data.**

| Item | Status | Artifact |
|---|---|---|
| Tool data classes PUBLIC / USER; USER tool results answered server-side, never sent to the model; private turns excluded from model history; card-number/email redaction | ✅ | ai/tools.ts, ai/ai.service.ts, ai/privacy.ts, docs/ai-platform.md §0 |
| MCP server exposes public catalog tools only (search, compare, offer history) | ✅ | ai/mcp-server.ts, docs/mcp-architecture.md |
| Card master fields + CardDataSource / CardChangeProposal / CardOffer (SCD2) / RetentionOfferReport | ✅ | migration 20261124000000_card_knowledge_base |
| Refresh engine: allow-listed issuer fetcher (robots.txt, politeness, conditional GET, redirect re-validation), deterministic + evidence-validated AI extraction, proposals, admin review, daily job | ✅ | backend/src/catalog-refresh/, docs/card-refresh-engine.md |
| Offer history, elevated-offer alerts, welcome-bonus / annual-fee / retention APIs | ✅ | docs/card-offer-history.md |
| Admin UI `/admin/catalog` | ✅ | frontend/src/app/(app)/admin/catalog |
| Tests | ✅ | tests/catalog/ (27), tests/ai/ (36); 290 cases total |
| Docker validation | ✅ PASSED | docs/docker-validation.md §000 |

Results: backend unit 384 · integration 89 · frontend 43 · Playwright 52 (×3) · Cypress 33 (×2) — all green in Docker. Next: Phase D (recommendation scorer, travel/transfer partners), Phase E (streaming, evals, ops page).

## Phases D + E — recommendations, travel, streaming, evals, operations (2026-11-25)

| Item | Status | Artifact |
|---|---|---|
| Next-card scorer: first-year / long-term value, return on fee, 5/24 impact and slot cost, eligibility (minors, held cards, 5/24-enforcing issuers, product family), confidence, Pointwise-written reasons | ✅ | backend/src/domain/card-scorer.ts, docs/recommendation-scorer.md |
| Who should apply (per card) and household plan; spend profile (entered → transactions → typical) | ✅ | backend/src/strategy/, /next-card |
| Travel: loyalty programs, transfer partners with bonuses, member balances, best transfer per balance, award planner with household pooling | ✅ | backend/src/domain/travel.ts, docs/travel-optimization.md, /travel, admin Transfer partners tab |
| Assistant tools `recommend_next_card`, `get_transfer_options`, `plan_award` (user data, never sent to a model) and `get_transfer_partners` (public) | ✅ | ai/tools.ts, agents updated |
| Streaming answers (SSE) with failover reset; Claude eager tool input; OpenAI chunk accumulation | ✅ | POST /ai/chat/stream, docs/ai-evals.md |
| Grounding eval set (15 cases, CI gate), `npm run eval` (real models opt-in), opt-in live provider smoke tests | ✅ | backend/test/evals, scripts/run-evals.ts, test/live |
| Admin operations page (health, queue, schedules, AI circuits, MCP, card sources, events) | ✅ | backend/src/ops, /admin/ops |
| Tests | ✅ | tests/strategy/ (38 cases); 328 cases total |
| Docker validation | ✅ PASSED | docs/docker-validation.md §0000 |

Results: backend unit 424 · integration 111 · frontend 51 · Playwright 59 (×3) · Cypress 36 (×2) · eval set 15/15 — all green in Docker. All five phases of the AI plan are delivered.

## Phase F — credit band, fine print, transfer-bonus alerts (2026-11-26)

| Item | Status | Artifact |
|---|---|---|
| Self-reported credit band per member → approval odds (likely / possible / unlikely) scaling the next-card score; card credit requirements in the catalog | ✅ | domain/card-scorer.ts, /next-card, docs/recommendation-scorer.md §4a |
| Fine-print search over public card terms (PostgreSQL full-text, no AI) + public assistant tool `search_card_terms` | ✅ | strategy/terms.service.ts, /travel, docs/travel-optimization.md §3a |
| Transfer-bonus alerts (daily job, once per bonus, opt-out preference) | ✅ | jobs.service.ts `scan-transfer-bonuses`, /settings |
| Streaming verified through the web proxy | ✅ | docs/docker-validation.md §F |
| Tests | ✅ | 7 new cases (335 total); eval set 16 |
| Docker validation | ✅ PASSED | docs/docker-validation.md §F |

Results: backend unit 428 · integration 116 · frontend 53 · Playwright 61 (×3) · Cypress 37 (×2) · evals 16/16.
