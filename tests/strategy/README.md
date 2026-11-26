# Next-card scorer, travel, streaming, evals & operations — test cases (Phases D and E)

Code under test: `backend/src/domain/{card-scorer,travel}.ts`, `backend/src/strategy/**`, `backend/src/ai/{evals.ts,providers/*,router.ts,ai.service.ts}` (streaming), `backend/src/ops/**`, pages `/next-card`, `/travel`, `/assistant`, `/admin/ops`, `/admin/catalog` (Transfer partners). Seed: family account (Jordan 5/24, Riley 3/24, Sam 16 years old), fictional programs and partners. Automation: U unit · INT integration · PW Playwright · CY Cypress · EV eval set · LIVE opt-in live test.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-NC-01 | POS | First-year and long-term value | candidate card, household cards, spend | scoreCard | bonus + extra earning + credits × use − fee; long-term without bonus; reasons explain each number | P0 | Major | ✅ U |
| TC-NC-02 | POS | Extra earning vs current best card | household 2 % card | categoryGains | only categories where the candidate beats the household's best; 1.5 % baseline when no cards | P0 | Major | ✅ U |
| TC-NC-03 | NEG | Bonus not counted when spend can't reach it | $300/month, $6,000 in 6 months | score | bonus 0 + warning | P1 | Major | ✅ U |
| TC-NC-04 | POS | Curated bonus value, user valuation, waived fee, elevated offer, use rate clamp | — | score | curated value wins; overrides applied; first-year fee 0; elevated reason; use rate ≤ 100 % | P2 | Minor | ✅ U |
| TC-NC-05 | NEG | 5/24-enforcing issuer at 5/24 | Jordan 5/24, Northwind card | score | ineligible; blocker names the date under 5/24 again | P0 | Critical | ✅ U, INT, PW-NC-01 |
| TC-NC-06 | POS | No slot cost when already over 5/24 | Jordan, Contoso card | score | eligible; slot cost 0; reason says no slot used | P1 | Major | ✅ U, INT |
| TC-NC-07 | BND | Last 5/24 slot | member 4/24 | score | slot cost ×2; warning with the date enforcing issuers are reachable again | P1 | Major | ✅ U |
| TC-NC-08 | EDGE | Business card not on personal report | Litware-style business card | score | does not count; 5/24 unchanged | P1 | Minor | ✅ U |
| TC-NC-09 | NEG | Minor / held card / same family | Sam; Riley holds Voyager | score | under-18 blocker; "already has this card"; family warning + lower confidence | P0 | Major | ✅ U, INT |
| TC-NC-10 | POS | Confidence reflects data quality | default / profile / transactions spend; unknown open dates | score | 0.6 / 0.85 / 0.9 base deductions listed in notes; floor 0.1 | P2 | Minor | ✅ U |
| TC-NC-11 | POS | Who should apply for a card | family | GET /recommendations/who-should-apply/northwind-shopper and contoso-everyday | Riley (3/24→4/24) / Jordan (no slot used); others' blockers listed | P0 | Major | ✅ U, INT, CY-NC-01, EV-08 |
| TC-NC-12 | POS | Household plan | family | GET /household/next-card | Jordan, Riley, Sam; Sam empty; one eligible overall pick with why | P1 | Major | ✅ U, INT, PW-NC-01 |
| TC-NC-13 | POS | Spend source order | new user; transactions; profile | GET/PUT /me/spend-profile | DEFAULT → TRANSACTIONS (≥ 10 tx) → PROFILE; confidence follows | P1 | Major | ✅ INT, PW-NC-02 |
| TC-NC-14 | NEG | Spend profile validation | — | duplicate / unknown category / negative | 400 | P2 | Minor | ✅ INT |
| TC-NC-15 | SEC | Member scoping | another user's member id | next-card / plan | 404 | P0 | Critical | ✅ INT |
| TC-NC-16 | POS | Next card page | family | /next-card, switch member | household pick, ranked cards, blockers, values; axe clean | P1 | Major | ✅ PW-NC-01, PW-SMK-02 |
| TC-TR-01 | POS | Transfer rate with active / expired bonus | partners | transferRate / options | active bonus applied, expired ignored; best value first; uplift vs direct | P0 | Major | ✅ U, INT |
| TC-TR-02 | POS | Balance advice | balances | adviseBalances / GET /travel/transfers | best partner per balance; "redeem directly" when no uplift; no-partner message; totals | P1 | Major | ✅ U, INT, PW-TR-01 |
| TC-TR-03 | POS | Award plan: own program balance then cheapest transfers | Jordan SKY 12.5k, CT, NW | planAward / POST /travel/plan | steps in cost order, increments respected, covered ≥ needed, cost per point | P0 | Major | ✅ U, INT, PW-TR-01, EV-10 |
| TC-TR-04 | POS | Household pooling | Riley NW (pooled), CT (not) | plan 200,000 SKY | Riley's NW used with pooling warning; CT and non-pooled program not used | P0 | Major | ✅ U, INT, CY-TR-01 |
| TC-TR-05 | NEG | Shortfall / unknown program / zero points | — | plan | shortfall + warning / 404 / 400 | P1 | Minor | ✅ U, INT |
| TC-TR-06 | POS | Balances CRUD | new user | PUT twice, PUT 0, DELETE | upsert, zero removes, delete; others' rows 404; cash and unknown codes 400 | P1 | Major | ✅ INT, PW-TR-02 |
| TC-TR-07 | POS | Admin curates programs and partners | admin | PUT program, PUT partner with bonus, DELETE | visible in public partners; audited; cash/unknown 400; non-admin 403 | P1 | Major | ✅ INT |
| TC-TR-08 | POS | Travel page | family | /travel, plan 60k SkyHigh | 5 balances, advice with 30 % bonus, plan steps and warnings; axe clean | P1 | Major | ✅ PW-TR-01, PW-SMK-02 |
| TC-TR-09 | SEC | Transfer partners are public catalog data | — | GET /transfer-partners without token; MCP tools/list | 200; MCP lists get_transfer_partners only among Phase D tools | P1 | Major | ✅ INT |
| TC-AIE-01 | POS | Streamed answer events | family, consent | POST /ai/chat/stream (5/24) | start → tool running/done → reset → delta → done; done.answer = streamed text; private | P0 | Major | ✅ INT, U, PW-AI-07, CY-OPS-01 |
| TC-AIE-02 | POS | Model text streamed in chunks | catalog question | stream | several deltas; concatenation = final answer | P1 | Minor | ✅ INT, U |
| TC-AIE-03 | NEG | Stream errors | no consent / empty / no token | stream | error event 403 / 400 / 401 | P1 | Major | ✅ INT, U (frontend) |
| TC-AIE-04 | EDGE | Failover mid-stream | model drops after partial text | router | reset, then the next model's text | P1 | Major | ✅ U |
| TC-AIE-05 | SEC | Truncated tool call never runs | stop_reason max_tokens with tool_use | run | tools not executed; "cut off" answer | P0 | Critical | ✅ U |
| TC-AIE-06 | POS | Provider streaming adapters | fake SDK clients | Claude stream + eager tool input; OpenAI chunks; mock words | deltas, final message, tool fragments by index, usage | P1 | Major | ✅ U |
| TC-AIE-07 | POS | Grounding eval set | demo model | 15 cases | 100 % pass (tool, facts, exclusions, privacy) | P0 | Major | ✅ INT (EV-01…15), `npm run eval` |
| TC-AIE-08 | SEC | Paid models are opt-in for evals and smoke tests | EVAL_MODEL_ID without EVAL_LIVE; no LIVE_AI_SMOKE | run | refused / skipped | P0 | Critical | ✅ LIVE (skipped by default), script guard |
| TC-AIE-09 | POS | Live provider smoke test | key + LIVE_AI_SMOKE=1 | npm run test:live | one-word reply; streamed tool call | P3 | Minor | 🟡 manual opt-in |
| TC-OPS-01 | POS | Operations health | admin | GET /admin/ops/health | status, DB/Redis ok, queue counts, schedulers with last run, AI circuits, MCP, card sources; no secrets | P1 | Major | ✅ INT, PW-OPS-01, CY-OPS-01 |
| TC-OPS-02 | POS | Operations events | admin | GET /admin/ops/logs?limit | ≤ limit events, newest first; limit 0 → 400 | P2 | Minor | ✅ INT |
| TC-OPS-03 | SEC | Operations is admin-only | user / anonymous | health, logs, /admin/ops page | 403 / 401 / redirected | P0 | Critical | ✅ INT, PW-OPS-02, CY-OPS-01 |
| TC-OPS-04 | POS | Circuit breaker snapshot | failures | snapshot | open with openUntil; recent failures counted | P2 | Minor | ✅ U |
| TC-NC-17 | POS | Approval odds from the credit band | card needs excellent | score with excellent / very good / fair / none | likely / possible (×0.75) / unlikely (×0.4) / unknown (note); never a blocker | P1 | Major | ✅ U, INT, PW-NC-03 |
| TC-NC-18 | NEG | Credit band validation and reset | own member | PATCH creditBand SUPER; then null | 400; null clears the band | P2 | Minor | ✅ INT |
| TC-NC-19 | SEC | Credit band stays private | family | assistant next-card question with provider spy | band and odds never in provider requests (USER tool) | P0 | Critical | ✅ INT (provider spy) |
| TC-TR-10 | POS | Fine-print search | catalog | GET /card-terms/search?q=lounge access; card filter | Reserve first with «lounge» «access»; filter limits to one card; no match → [] | P1 | Major | ✅ INT, PW-TR-03, CY-TR-02, EV-16 |
| TC-TR-11 | SEC | Fine-print search input handling | — | q = "lounge' OR 1=1 --"; q = 'x' | 200 without error (bound parameters); 400 for < 2 chars; snippets rendered as text | P0 | Critical | ✅ INT, U |
| TC-TR-12 | POS | Transfer-bonus alerts | holder + opted-out user hold CONTOSO_PTS | run scan-transfer-bonuses twice | holder: one TRANSFER_BONUS notification (30 % → AeroLink, link /travel); opted-out: none | P1 | Major | ✅ INT |
| TC-AIE-10 | POS | Assistant answers fine-print questions from public terms | demo model | "Does the Northwind Voyager Reserve include lounge access?" | search_card_terms quoted snippet; catalog-only (not private) | P1 | Major | ✅ INT, U, EV-16 |
