# Travel Optimization — Transfer Partners & Award Planner

Status: **built (2026-11-25, Phase D)**. Source: `backend/src/domain/travel.ts` (pure), `backend/src/strategy/`, UI `/travel` and `/admin/catalog` → Transfer partners, assistant tools `get_transfer_options`, `plan_award` (user data, answered by Pointwise) and `get_transfer_partners` (public catalog). Tests: `backend/test/unit/strategy/travel.spec.ts`, `backend/test/integration/strategy.int-spec.ts`, E2E `strategy-travel`.

## 1. Data
| Entity | Fields |
|---|---|
| `LoyaltyProgram` | code, name, kind (AIRLINE/HOTEL/OTHER), ¢/pt valuation, `householdPooling` |
| `TransferPartner` | currency → program, `ratioFrom:ratioTo`, `transferDays`, `bonusPercent` + `bonusEndsAt` |
| `RewardCurrency` (extended) | `householdPooling` (points can be combined between household members), `transferIncrement` |
| `LoyaltyBalance` | member (profile), currency **or** program (DB check constraint + partial unique indexes), points — entered manually |

Admin-curated (`PUT /admin/loyalty-programs`, `PUT/DELETE /admin/transfer-partners`, audited). Seed: fictional programs (SkyHigh Airlines Miles, AeroLink Rewards, BlueWing Club, StayWell Points, Harbor Hotels Club) and 8 partners, incl. a time-limited 30 % Contoso → AeroLink bonus. No airline/hotel data or award availability is scraped or licensed (see bank-and-bureau-feasibility.md).

## 2. Rules
- program points per currency point = ratioTo ÷ ratioFrom × (1 + active bonus %); an expired bonus is ignored.
- value per point via a partner = that × program valuation; **uplift** = that ÷ the currency's own value. Advice says "redeem directly" when no partner beats the direct value.
- **Award planner** (`POST /travel/plan {program, points, profileId?}`):
  1. the booking member's own program balance (other members' too when the program pools),
  2. transfers in order of lowest opportunity cost (currency ¢ given up per program point), from the booker's balances or other members' when the currency pools,
  3. transfers rounded up to the currency's increment and capped at the balance.
  Output: steps, covered, shortfall, points' value given up, ¢ per program point, slowest transfer time, warnings (transfers are one-way; award may disappear during slow transfers; pooling; shortfall).

## 3. API
`GET /transfer-partners?currency&program` (public), `GET/PUT/DELETE /me/balances`, `GET /travel/transfers` (each balance's best use + totals), `POST /travel/plan`.

## 3a. Transfer-bonus alerts and fine-print search (2026-11-26)
- Job `scan-transfer-bonuses` (daily 13:40 UTC): for every active bonus, households holding that currency get one `TRANSFER_BONUS` notification per bonus (dedupe key = partner + % + end date), linking to `/travel`; opt-out with the `transferBonuses` notification preference.
- `GET /card-terms/search?q&card&limit` (public): PostgreSQL full-text search (`websearch_to_tsquery`, `ts_rank`, `ts_headline`) over public card descriptions, welcome-bonus text, features, earning rules and benefit terms; snippets mark matches with «…» and the UI renders them without HTML. Also the public assistant tool `search_card_terms` ("Does the Northwind Voyager Reserve include lounge access?"). Retrieval runs in the database — no embeddings or external AI service.

## 4. Not covered
Live award availability, dynamic pricing, taxes/surcharges and partner-airline routing (commercial data providers only) — users check availability before transferring, as the UI says.
