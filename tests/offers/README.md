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
