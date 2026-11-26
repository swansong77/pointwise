# Benefit tracking & alerts — test cases

Code under test: `backend/src/domain/benefits.ts`, `domain/portfolio.ts`, `portfolio/benefits.ts`, `jobs.service.scanBenefitExpirations`, `notifications/delivery.ts`, `/benefits`, `/portfolio`. Automated in `backend/test/unit/benefits/*.spec.ts` (U), INT, PW, CY.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-BEN-01 | POS | Calendar windows | — | periodContaining monthly/quarterly/semi/annual at 2026-11-21 | Nov; Q4; Jul–Dec; 2026 | P0 | Major | ✅ U |
| TC-BEN-02 | POS | Cardmember-year windows | opened 2024-05-10 | annual at 2026-05-09 / 05-10 | 2025-05-10→2026-05-10 / next year | P0 | Major | ✅ U |
| TC-BEN-03 | EDGE | Month-end & leap anchors | anchors Jan 31, Feb 29 | periodContaining | clamped to Feb 28 | P1 | Minor | ✅ U |
| TC-BEN-04 | POS | Multi-year credit (e.g. Global Entry) | 48 months | window | open date + 4 years | P1 | Minor | ✅ U |
| TC-BEN-05 | POS | Credits used / partial / completed | allocation $200 | use 0 / 50 / 250 | UNUSED / PARTIAL / COMPLETED | P0 | Major | ✅ U |
| TC-BEN-06 | POS | Expiration status | ≤ 30 days left; after end | utilization | EXPIRING_SOON; EXPIRED | P0 | Major | ✅ U, CY-BEN-02 |
| TC-BEN-07 | POS | Annual reset | usage in 2025 period | view in 2026 | new period starts at 0 used (computed, no job) | P0 | Major | ✅ U (periodsInBenefitYear) |
| TC-BEN-08 | POS | Missed value | quarterly, Q2 partly / Q3 unused | benefitYearSummary | missed = unused of ended periods | P1 | Major | ✅ U |
| TC-BEN-09 | EDGE | Periods before the card was opened aren't missed | opened mid-year | summary | only periods after opening count | P0 | Major | ✅ U |
| TC-BEN-10 | POS | Templates copied when a card is added | catalog card with 4 benefits | POST /wallet/cards | 4 tracked benefits; re-apply adds 0 | P0 | Major | ✅ INT, services.spec |
| TC-BEN-11 | POS | Custom benefit | — | POST /benefits name/period/amount | 201, annual value computed | P1 | Minor | ✅ INT, PW-BEN-02 |
| TC-BEN-12 | NEG | Custom benefit missing fields / MULTI_YEAR without months / template of another card / duplicate | — | POST | 400 | P1 | Minor | ✅ INT |
| TC-BEN-13 | POS | Log usage | benefit with $300 | log $120 | "$120 of $300 used", totals update | P0 | Critical | ✅ PW-BEN-01, INT |
| TC-BEN-14 | NEG | Usage beyond remaining / in the future | $50 left | log $2 500 / date 2099 | 400 | P0 | Major | ✅ INT, CY-BEN-01 |
| TC-BEN-15 | SEC | IDOR on benefits | two users | B logs usage on A's benefit / creates on A's card | 403 | P0 | Critical | ✅ INT |
| TC-BEN-16 | POS | Delete usage / benefit | — | DELETE | 204; repeat 404 | P2 | Minor | ✅ INT |
| TC-BEN-17 | POS | Alert thresholds scale with period | — | alertThresholds | 7/1; 30/7/1; 60/30/7/1; 90/60/30/7/1 | P0 | Major | ✅ U |
| TC-BEN-18 | POS | Only smallest crossed threshold is due | annual, 41 days left | dueThreshold | 60 | P0 | Major | ✅ U |
| TC-BEN-19 | NEG | No alert when used up or ended | remaining 0 / period ended | dueThreshold | null | P1 | Major | ✅ U |
| TC-BEN-20 | POS | In-app + email alert, idempotent | cardmember year ends in 5 days | run job twice | 1 notification; log rows IN_APP+EMAIL at 7 days; emailedAt pre-set | P0 | Critical | ✅ INT, CY-BEN-02 |
| TC-BEN-21 | NEG | Alerts respect preferences | benefitExpiring = false | run job | no notification | P1 | Major | ✅ INT |
| TC-BEN-22 | SEC | Push endpoint allow-list (SSRF) | — | subscribe internal/http/odd-port URLs | rejected | P0 | Critical | ✅ U (delivery.spec) |
| TC-BEN-23 | POS | Push delivery + expired subscription cleanup | VAPID configured | send; 410 response | delivered; subscription deleted | P1 | Major | ✅ U |
| TC-BEN-24 | POS | Failed email is retried | SMTP down | processor | throws → BullMQ retry (3, exponential) | P1 | Major | ✅ U |
| TC-BEN-25 | POS | Value analytics: net, effective, return on spend, break-even | fee 695, benefits 1 500 face / 600 used, rewards 400 on 10 000 | cardValue | net 805, effective 305, ROS 4 %, break-even $3 800 | P0 | Major | ✅ U (portfolio.spec) |
| TC-BEN-26 | POS | Portfolio groups & per-holder roll-ups | family account | GET /portfolio | 7 active / 2 AU / 1 closed; 3 holders | P0 | Major | ✅ INT, PW-PORT-01 |
| TC-BEN-27 | A11Y | Benefits & portfolio pages pass axe | — | axe | no serious violations | P1 | Major | ✅ PW-PORT-A11Y, PW-SMK-02 |
| TC-BEN-28 | POS | Frequencies: monthly, quarterly, semi-annual, annual | benefit rows | benefitRecord | period windows and reset text per frequency; prior-period usage excluded | P0 | Critical | ✅ U (benefit-roll.spec) |
| TC-BEN-29 | POS | Anniversary, one-time and custom periods | anchor / expiresOn | benefitRecord | anniversary window from opening date; one-time expires; custom repeats every N months | P0 | Critical | ✅ U |
| TC-BEN-30 | POS | Same product, same user (#1001, #1002) | two accounts | rollup account/product | usage separate; product level sums | P0 | Critical | ✅ U, INT, PW-BA-01 |
| TC-BEN-31 | POS | Spouse and household (#1003) | three accounts, two holders | rollup cardholder/household | cardholders separate, household adds all | P0 | Critical | ✅ U, INT |
| TC-BEN-32 | POS | Renewal cycles stay per account | different opening dates | benefitRecord | each account's own anniversary | P0 | Major | ✅ U |
| TC-BEN-33 | POS | Record fields | usage with method/verification/evidence | benefitRecord | detection method, verification, evidence count, last updated | P1 | Major | ✅ U |
