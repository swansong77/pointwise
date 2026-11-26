# Next-Card Recommendation Scorer

Status: **built (2026-11-25, Phase D)**. Source: `backend/src/domain/card-scorer.ts` (pure), `backend/src/strategy/` (service + API), UI `/next-card`, assistant tool `recommend_next_card`. Tests: `backend/test/unit/strategy/card-scorer.spec.ts`, `backend/test/integration/strategy.int-spec.ts`, `playwright/tests/strategy-travel.spec.ts`, `cypress/cypress/e2e/strategy-travel.cy.ts`, `tests/strategy/`.

## 1. What it answers
- "What card should Riley open next, and why?" — ranked catalog cards for one household member.
- "Who in the household should apply for card X?" — eligibility and 5/24 cost per member.
- "What should we do next as a household?" — the best (card, member) pair overall.

Everything is deterministic and computed by PointWise. Because of the privacy rule (no user card data to AI providers), the explanation is also written by the scorer (`reasons`, `warnings`, `why`) — the AI model never sees or rewrites it.

## 2. Formula (integer cents)

| Term | Definition |
|---|---|
| Welcome bonus | curated `bonusValuationCents`, else bonus points × the user's (or default) ¢/pt. **0** when the user's usual spend over the bonus window can't reach the minimum spend, or the offer has expired |
| Extra earning / yr | Σ over spend categories of max(0, candidate ¢/$ − household's current best ¢/$) × annual spend. Uses the existing best-card engine (`rankCards`); a household with no cards is compared with a no-fee 1.5 % card |
| Credits / yr | Σ annual value of the card's CREDIT benefit templates × expected use rate (default 50 %, user-adjustable 0–100 %) |
| First-year value | bonus + extra earning + credits − first-year fee |
| Long-term value / yr | extra earning + credits − annual fee |
| Return on fee | (extra earning + credits) ÷ annual fee (null for no-fee cards) |
| 5/24 slot cost | $150 per slot used while under 5/24 (×2 when it uses the last slot); 0 if the member is already over 5/24 or the card doesn't count |
| **Score** | first-year value + max(0, long-term value) − slot cost |

Ranking: eligible cards first by score; ineligible cards last with their blockers.

## 3. Eligibility and 5/24
- **Blockers:** minor (birth year → under 18: authorized-user cards only); already holds the card as primary cardholder; issuer enforces 5/24 (`Issuer.enforcesFive24`) and the member is at or over 5/24 — the message includes the date they are under the limit again.
- **Counts toward 5/24:** personal cards, and business cards from issuers that report to personal bureaus (same rule as the 5/24 engine).
- **Last slot warning:** opening the card brings the member to 5/24 → "cards from issuers that enforce 5/24 are out of reach until <date>" (from the drop-off dates of the cards that count).
- **Same product family** (e.g. holding another Voyager card): warning that the welcome bonus may be restricted, confidence −0.2.
- **Household choice:** the same card is scored for every member; the classic strategy falls out of the score — a 5/24-enforcing issuer's card goes to a member under 5/24, while other issuers' cards go to a member already over 5/24 (no slot used).

## 4. Confidence (0.1–0.95)
Starts at 0.9; −0.3 when spend is a typical-household estimate, −0.05 for a user-entered spend profile (transactions: no penalty), −0.05 when the bonus is valued at the default valuation, −0.1 when cards without an open date may understate 5/24, −0.2 for product-family bonus restrictions. Each deduction is listed in `confidenceNotes`.

## 4a. Approval odds from a self-reported credit band (2026-11-26)
Members can set an optional credit band (`Profile.creditBand`: excellent 800+, very good 740–799, good 670–739, fair 580–669, poor < 580) on `/next-card`; catalog cards carry the band they usually need (`CreditCard.recommendedCredit`, admin-entered). Odds: at or above → **likely**, one band below → **possible**, two or more → **unlikely**, missing either → **unknown**. The score is multiplied by 1 / 0.75 / 0.4 / 1 (expected value of applying); a warning explains the gap; odds never block a card. The band is user data: stored on the member, used only by the scorer, never sent to an AI provider or a bureau.

## 5. Spend profile
Source order: user-entered `SpendProfileEntry` rows (`PUT /me/spend-profile`) → 12 months of logged transactions (≥ 10 transactions, averaged per month since the first one) → a typical household (groceries $600, dining $400, gas $150, travel $200, online $250, streaming $30, everything else $1,200 per month).

## 6. API

| Route | Purpose |
|---|---|
| `GET /recommendations/next-card?profileId&benefitUseRate&slotValueCents&limit` | ranked cards for a member (default primary) |
| `GET /recommendations/who-should-apply/:card` | per-member ranking for one card + `why` |
| `GET /household/next-card` | top cards per member + overall pick |
| `GET/PUT /me/spend-profile` | spend source, lines and monthly total |

## 7. Data (migration `20261125000000_recommendations_travel`)
`Issuer.enforcesFive24`, `SpendProfileEntry`. Seed: Northwind Bank enforces 5/24; product families Voyager / Contoso Charge / Contoso Everyday; the demo family has a spend profile.

## 8. Limits
Catalog terms are as good as the admin-reviewed card data (Phase C). Issuer approval rules beyond 5/24 (velocity limits, "once per lifetime" bonus rules, credit score) are not modelled — the disclaimer says approval is up to the issuer.


## Smart recommendation (v2, 2026-11-25)
`domain/recommendation-intel.ts` (`recommendation/2`) enriches the scorer's result with inputs it does not model: **goals** (travel, cash back, hotel, airline, low fee), **recent applications** (velocity), **business eligibility**, **points balances** (pooling), **measured benefit utilization** (replaces the assumed 50 % use rate), and **offer timing**. It returns an adjusted score, an **application probability (an estimate)** banded from the self-reported credit band and multiplied by velocity, business and issuer-difficulty factors, **risks**, up to three **alternatives**, expiry **advice**, and a confidence that is reduced, with named reasons, for every missing input. All weights live in `REC_WEIGHTS` and are stored with each result. `GET /recommendations/smart` stores the top picks as `Recommendation` + `RecommendationFactor` rows (inputs snapshot of counts and flags — no card numbers); `GET /recommendations/audit/:id` returns inputs, weights, every factor and the final numbers to the owner. Goals and `hasBusiness` are set per household member (`PATCH /household/members/:id`) and are never sent to an AI provider.
