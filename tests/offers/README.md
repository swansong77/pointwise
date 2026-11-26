# Offer intelligence — test cases

Code: `domain/offer-intel.ts`, `catalog-refresh/card-refresh.service.ts` (`welcomeBonuses`, `autoPublish`), `offer-market.service.ts`, `/offers/market`. Fictional catalog only.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-OFF-01 | POS | Best-ever, median, percentile, days at current | 60K → 75K → 90K → 100K history | offerStats | best ever = current; verdict BEST_EVER; percentile > 0.8 | P0 | Major | ✅ U (offer-intel.spec), INT |
| TC-OFF-02 | POS | Verdicts | near-high / typical / below-typical / elevated | offerStats, verdictFor | NEAR_HIGH ≥ 90 % of best; BELOW_TYPICAL < 0.9× median | P0 | Major | ✅ U |
| TC-OFF-03 | NEG | No history, no valuation (nights), single version |  | offerStats | UNKNOWN / TYPICAL, never an error | P1 | Minor | ✅ U |
| TC-OFF-04 | POS | Expiry advice | elevated offer ends in 9 days; best-ever; below typical | offerAdvice | "Apply within 9 days…", "near its historic high", "Wait for a better offer…"; expired → only "expired" | P0 | Major | ✅ U, INT |
| TC-OFF-05 | POS | Move to another member | applicant blocked, spouse eligible | offerAdvice | "Move the application to Spouse." | P1 | Major | ✅ U |
| TC-OFF-06 | POS | Application difficulty | Chase at 5/24, one slot left, issuer-only rules, holds product | applicationDifficulty | HARD / MODERATE / EASY; unverified rules never BLOCKED; reasons say community-reported | P0 | Major | ✅ U |
| TC-OFF-07 | SEC | Auto-publish policy | other domain, lookalike host, low confidence, out of bounds, big jump, unknown card | autoPublishDecision | REVIEW with reasons; only issuer-domain, plausible, bounded changes PUBLISH | P0 | Critical | ✅ U |
| TC-OFF-08 | POS | Scheduled refresh auto-publishes; admin refresh only proposes | source on allow-listed host | refreshSource with/without autoPublish | card updated, one open version, audit entry auto:true; admin path leaves PENDING; OFFER_AUTO_PUBLISH=false disables | P0 | Critical | ✅ INT |
| TC-OFF-09 | POS | Market dashboard | signed-in user | GET /offers/market | offers with verdict, difficulty, your values; expiring soon; historical highs; 401 when signed out | P0 | Major | ✅ INT, PW-INT-01, CY-INT-01 |

## Merchant offer intelligence (2026-11-25)

Code: `domain/{merchant-resolve,offer-import,offer-engine,spend-behavior,opportunity-score,merchant-timeline,offer-stack,purchase-plan}.ts`, `offers/offer-{intel,analysis,core,jobs}.service.ts`. Synthetic data only.

| ID | Type | Objective | Expected result | Priority | Automation |
|---|---|---|---|---|---|
| TC-MER-01 | POS | Amazon / Uber / hotel-brand descriptor variants resolve to one canonical merchant | AMZN MKTPLACE, AMZN DIGITAL → Amazon; UBR TECHNOLOGIES → Uber; Uber Eats stays separate; parent company carried | P0 | ✅ U (merchants/merchant-resolve) |
| TC-MER-02 | NEG | Unknown merchants are not guessed; a bare host word and a conflicting MCC are never "trusted" | null / confidence < 0.8 | P0 | ✅ U |
| TC-OFFI-01 | POS | Source reliability 100/90/75/50/25 and confidence cap (verified lifts to 90, disputed 0) | as stated | P0 | ✅ U, INT, PW-OI-01, CY-OI-01 |
| TC-OFFI-02 | POS | Parse pasted offers (spend-get, percent with cap, points, coupon, dates); reject unreadable lines with a reason; dedupe | as stated | P0 | ✅ U, INT |
| TC-ELIG-01 | POS | Eligibility states ELIGIBLE → ACTIVATED → PARTIAL → PENDING_CREDIT → COMPLETED / EXPIRED | as stated | P0 | ✅ U |
| TC-MISS-01 | POS | Missed-offer root causes NOT_ADDED, NOT_ACTIVATED, WRONG_CARD, BELOW_MIN_SPEND, EXPIRED_BEFORE_PURCHASE with evidence and transaction ids | as stated; lost value capped; confidence ≤ source cap | P0 | ✅ U, INT |
| TC-MISS-02 | NEG | No transactions, other merchant, refunds, no eligible card, disputed offer → no finding | [] | P0 | ✅ U |
| TC-BEH-01 | POS | Per-merchant frequency, seasonality, subscription detection, household members | as stated | P1 | ✅ U |
| TC-SCORE-01 | POS | Score 0–100, nine factors each with a reason, weights sum to 100, deterministic, confidence capped by source and data | as stated | P0 | ✅ U, INT, PW-OI-01, CY-OI-01 |
| TC-TIME-01 | POS | Merchant timeline: count, best, average, seasonality, percentile rank | as stated | P1 | ✅ U, INT |
| TC-STACK-01 | POS | Compatible sources add; RISK pair risk-weighted; CONFLICT drops the smaller side; rules flagged unverified | as stated | P0 | ✅ U |
| TC-PLAN-01 | POS | Ranked plans by net return; activated offer can beat a better earner; needs-activation yields an action with the link | as stated | P0 | ✅ U, INT, PW-OI-02 |
| TC-PLAN-02 | POS | Split spend only when it wins by ≥ $1; not when the minimum equals the purchase | as stated | P0 | ✅ U |
| TC-PLAN-03 | NEG | Expired, not-started, redeemed, disputed offers ignored; below-minimum purchase earns nothing from the offer and says so | as stated | P0 | ✅ U, INT |
| TC-PLAN-04 | POS | No recommendation without evidence; each plan stores a RECOMMENDED event with evidence | as stated | P0 | ✅ INT |
| TC-ACT-01 | POS | Assisted activation: queue, mark activated, event written; other user 403 | as stated | P0 | ✅ INT, PW-OI-01 |
| TC-VERIFY-01 | POS | Statement credit verifies an activation (idempotent); terms met + no credit after 14 days → FAILED with evidence | as stated | P0 | ✅ INT |
| TC-WF-01 | POS | `purchase-plan` and `offer-review` workflows record steps and agents; missing inputs fail cleanly | as stated | P0 | ✅ U, INT |


## Offer automation (OA)
| ID | Where | What it checks |
|---|---|---|
| unit | `backend/test/unit/offers/offer-automation-*.spec.ts` | snapshot diff, rules, scoring and decisions, schedule across daylight saving, retry and lock, vault, connector registry, mock issuer |
| TC-OA integration | `backend/test/integration/offer-automation.int-spec.ts` | accounts and vault, sync, diff, modes, rules, verification outcomes, MFA, failures and retries, household separation, extension and email intake, tools, audit |
| PW-OA-01..04 | `playwright/tests/offer-automation.spec.ts` | Sync Now with progress, inbox with scores and reasons, adding offers, rules and mode, accounts and the risk note |
| CY-OA-01..02 | `cypress/cypress/e2e/offer-automation.cy.ts` | API flow, ownership, rules validation, extension token |
| frontend | `frontend/test/offer-automation.test.ts` | client helpers and the extension's page logic |
