# Loyalty asset management — test cases

Code: `domain/{loyalty-expiration,loyalty-tracking,loyalty-assets,loyalty-valuation,transfer-bonus,award-trip}.ts`, `loyalty/loyalty.{service,module,dto}.ts`, `seed/loyalty-registry.ts`. Synthetic data only.

| ID | Type | Objective | Expected result | Priority | Automation |
|---|---|---|---|---|---|
| TC-EXP-01 | POS | Activity policy predicts expiry N months after last activity; member date overrides | date, days left, HIGH risk, confidence 50/80/90 | P0 | ✅ U, INT |
| TC-EXP-02 | POS | FIXED policy from earning lots (FIFO); trimmed when history over-explains the balance | oldest points expire first; tranches listed | P0 | ✅ U |
| TC-EXP-03 | NEG | NEVER / WHILE_CARD_OPEN / UNKNOWN / missing inputs never invent a date | no date; reason explains | P0 | ✅ U |
| TC-EXP-04 | POS | Alert thresholds 365/180/90/60/30/14/7/1 and wording | smallest threshold ≥ days left; messages as specified | P0 | ✅ U |
| TC-EXP-05 | POS | Daily scan alerts once per asset/date/threshold; new date re-arms; preference off silences | notification count as stated | P0 | ✅ INT |
| TC-EXP-06 | POS | Activity preservation ranks by fit, cost, effort; only policy-confirmed methods when listed | as stated | P1 | ✅ U, INT |
| TC-PTS-01 | POS | Totals by category and monthly history, carry-forward, growth, best/worst month | as stated | P0 | ✅ U, INT |
| TC-CERT-01 | POS | Certificate states incl. lapsed-but-unmarked; redemption rules: cap, eligible list, blackout, expiry before stay | reasons name the blocking rule | P0 | ✅ U, INT |
| TC-CERT-02 | POS | Opportunities: best qualifying hotel, "Potential value: $480." wording, soonest first | as stated | P0 | ✅ U, INT, LY-02 |
| TC-ELITE-01 | POS | Progress, pace-based renewal likelihood, risk, actions, maintained, expired | headline "76% there, needs 12 nights" | P0 | ✅ U, INT, LY-03 |
| TC-MEMB-01 | POS | Expiry wording, renewal window per kind, card credit suggestion; number encrypted, last 4 only | as stated | P0 | ✅ U, INT, LY-03 |
| TC-XFER-01 | POS | Bonus stats; transfer now vs wait vs none expected; stale history ignored | as stated | P0 | ✅ U, INT |
| TC-VAL-01 | POS | Current / potential / at-risk / expired / recovered / net annual by type and member | as stated | P0 | ✅ U, INT, LY-02 |
| TC-FCST-01 | POS | Timeline windows; overdue first; each item once | as stated | P0 | ✅ U, INT, LY-04 |
| TC-AWARD-01 | POS | Rank by coverage, cost, expiring points, preferences, bonus; late transfers penalised; estimate flagged | as stated | P0 | ✅ U, INT, LY-04 |
| TC-LOY-01 | SEC | Owner-only access; foreign member 404; unauthenticated 401; validation 400 | as stated | P0 | ✅ INT, CY-LY-01/02 |
| TC-WF-02 | POS | `loyalty-review` and `award-trip` workflows audited; missing inputs fail cleanly | as stated | P0 | ✅ U, INT |

## Automation (branch pw-2026-feature-loyalty-automation)

| ID | Type | Objective | Expected result | Priority | Automation |
|---|---|---|---|---|---|
| TC-PROV-01 | POS | Source scale 100/90/80/75/70/50/25; higher reliability replaces lower | accepted | P0 | ✅ U, INT |
| TC-PROV-02 | SEC | A lower-reliability observation never overwrites a higher one; manual `force` is explicit | kept + logged; forced override recorded | P0 | ✅ U, INT |
| TC-PROV-03 | POS | Same value from another source cross-confirms; different values within 10 points conflict; stale stored value makes the newer lower value pending; older observations are history; one-second tolerance | as stated | P0 | ✅ U, INT |
| TC-PROV-04 | POS | The member settles a conflict (accept / reject); settled ones are no-ops; foreign ids 404 | as stated | P0 | ✅ INT |
| TC-MAIL-01 | POS | Balance, pending, status with deadline, expiry notice, activity and certificate emails parse; unrelated mail yields nothing; unknown domains parsed by none | as stated | P0 | ✅ U |
| TC-MAIL-02 | POS | Inbound email updates the matching account (source EMAIL), DKIM failure rejected, unknown program reported, repeated email is a no-op, certificate gets conditions, no body stored | as stated | P0 | ✅ INT |
| TC-STMT-01 | POS | Statement parse reconciles opening + activity = closing and printed totals; mismatches WARN; dollar card statements never read as points | as stated | P0 | ✅ U, INT |
| TC-COND-01 | POS | Condition engine structures and explains cap, award-only, category range, paid companion, origin, blackout, transfer, cancellation, expiration; evaluates a booking; unreadable rules warn | as stated | P0 | ✅ U |
| TC-REFRESH-01 | POS | Priority tiers, intervals, due-ness, freshness, plan (automated vs member actions), run summary; hourly job nudges once per week | as stated | P0 | ✅ U, INT |
| TC-HEALTH-01 | POS | Health 0–100 with eight explained factors; program and household aggregation | as stated | P0 | ✅ U, INT, LA-01 |
| TC-EXT-01 | SEC | Extension token: scope-limited, hashed, shown once, revocable; wrong-scope/revoked/missing → 401; cannot call user endpoints; page text not stored; idempotent | as stated | P0 | ✅ INT, CY-LA-01, LA-03 |
| TC-EXT-02 | POS | Extension helpers: domain match, https-only, server URL rules, token shape, text cap, page-side script drops form fields; program list matches the backend | as stated | P0 | ✅ U (skips in the backend container) |
| TC-AUDIT-01 | POS | Audit answers the eight questions; `loyalty-audit` workflow audited; recent changes list sources | as stated | P0 | ✅ U, INT, CY-LA-02 |
