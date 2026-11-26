# 5/24 engine — test cases

Code under test: `backend/src/domain/five24.ts`, `GET /api/v1/five24`, `/five24` page. Automated in `backend/test/unit/524/five24.spec.ts` (U), `backend/test/integration/portfolio.int-spec.ts` (INT), `playwright/tests/portfolio-benefits.spec.ts` (PW), `cypress/cypress/e2e/portfolio-benefits.cy.ts` (CY).

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-524-01 | POS | Personal card in window counts | Card opened 2025-06-01 | evaluate at 2026-11-21 | counts, reason PERSONAL, drops off 2027-06-01 | P0 | Critical | ✅ U |
| TC-524-02 | POS | Closed personal card still counts | Closed, opened in window | evaluate | counts | P0 | Major | ✅ U |
| TC-524-03 | POS | Authorized-user card counts | AU card in window | evaluate | counts, AUTHORIZED_USER | P0 | Major | ✅ U, INT (Riley 3/24) |
| TC-524-04 | POS | Business card from a reporting issuer counts | Issuer.businessReportsToPersonal = true | evaluate | counts, BUSINESS_REPORTS_TO_PERSONAL | P0 | Major | ✅ U, INT, PW-524-01 |
| TC-524-05 | NEG | Business card from other issuers excluded | businessReportsToPersonal = false | evaluate | excluded, BUSINESS_NOT_REPORTED | P0 | Major | ✅ U |
| TC-524-06 | NEG | Applications / denials don't count | status APPLIED / DENIED | evaluate | NOT_OPENED | P1 | Major | ✅ U |
| TC-524-07 | NEG | Manual exclusion with reason | excludeFrom524 + reason | evaluate | MANUAL_EXCLUSION, note shown | P1 | Minor | ✅ U |
| TC-524-08 | EDGE | No open date | approvedAt null | status | listed in `unknown`; UI warning | P1 | Major | ✅ U, CY-524-02 |
| TC-524-09 | EDGE | Future open date | opened 2027 | evaluate | FUTURE_DATE | P3 | Minor | ✅ U |
| TC-524-10 | BND | Exactly 24 months ago | opened = now − 24 mo | evaluate | not counted (OUTSIDE_WINDOW) | P0 | Major | ✅ U |
| TC-524-11 | BND | 24 months minus a day | opened = now − 24 mo + 1 d | evaluate | counted | P0 | Major | ✅ U |
| TC-524-12 | BND | Month precision | opened "2024-11" (MONTH) | evaluate 2026-11-21 | counts until 2026-12-01 | P0 | Major | ✅ U |
| TC-524-13 | EDGE | Leap day | opened 2024-02-29 | dropOffDate | 2026-02-28 | P2 | Minor | ✅ U |
| TC-524-14 | POS | Labels 0/24 … 5/24, 6/24+ | counts 0,1,5,6,9 | five24Label | "0/24","1/24","5/24","6/24+","6/24+" | P1 | Minor | ✅ U |
| TC-524-15 | POS | Next slot when over the limit | 6 counted | status | nextSlotAt = 2nd drop date | P0 | Major | ✅ U |
| TC-524-16 | POS | Next slot when exactly 5 | 5 counted | status | nextSlotAt = 1st drop | P0 | Major | ✅ U |
| TC-524-17 | POS | Under the limit | 2 counted | status | underLimit, slotsAvailable 3, nextSlotAt null | P1 | Minor | ✅ U |
| TC-524-18 | POS | Timeline projection merges same-day drops | 4 cards, 2 same day | five24Timeline | NOW 4 → 3 → 1 → 0 | P1 | Minor | ✅ U |
| TC-524-19 | POS | Per-member counts | Family demo account | GET /five24 | Jordan 5, Riley 3, Sam 1 | P0 | Critical | ✅ INT, PW-524-01, CY-524-01 |
| TC-524-20 | POS | Filter by member / horizon validation | — | `?profileId=&horizonMonths=12`; `horizonMonths=999` | 1 member; 400 | P2 | Minor | ✅ INT |
| TC-524-21 | POS | Credit-report date feeds 5/24 | card without date, matching tradeline | add tradeline → Use this date | 0/24 → 1/24 | P0 | Major | ✅ CY-524-02, INT credit-reports |
| TC-524-22 | POS | Daily snapshot is idempotent | households exist | run snapshot-524 twice | one row per member per day | P2 | Minor | ✅ INT |
| TC-524-23 | A11Y | 5/24 page passes axe; gauge has accessible name | family account | axe | no serious violations | P1 | Major | ✅ PW-PORT-A11Y |
