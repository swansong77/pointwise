# Loyalty asset management platform

Branch `pw-2026-feature-loyalty-mngt`. Decisions: ADR-013 to ADR-016 in `architecture-decisions.md`. Standing rules still apply: no AI provider receives the household's data (the new tools are USER-class), no logins to program sites, free solutions only.

**Principle.** Deterministic engines compute every date, risk and value; models only narrate. Each prediction carries a **confidence** and a **source** (`entered by member`, `program policy`, `balance`), and anything not verified says so.

## 1. What it tracks

| Asset | Table | Notes |
|---|---|---|
| Loyalty accounts (airline, hotel, bank, shopping, dining, cruise, rental car, casino, retail, **custom/future programs**) | `LoyaltyAccount` | per household member; account number encrypted (AES-GCM, `TOKEN_ENC_KEY`) and only the last 4 shown; balance, pending, lifetime, status level and deadline, expiry override, last activity, source, refresh date, transferability, notes |
| Balance history | `LoyaltyEvent` | every change (earn, bonus, purchase, redeem, expire, transfer in/out, adjust, snapshot) with `balanceAfter`; monthly snapshot job |
| Free night, companion, upgrade certificates | `LoyaltyCertificate` | number, issue/expiry, quantity, point cap, restrictions, eligible hotels/routes, blackout, fare classes, transferability, status, potential value, usage |
| Elite status | `EliteStatus` | one row per qualification period; earlier rows are the qualification history; progress, requirement, renewal text, benefits, annual value |
| Memberships | `Membership` | CLEAR, TSA PreCheck, Global Entry, Priority Pass, DragonPass, airline clubs, hotel; member number encrypted; renewal cost and method, auto-renew, linked card |
| Transfer routes | `TransferPartner` (existing) + `TransferBonusRecord` | ratio, current bonus, observed history |
| Award trips | `AwardTrip` | destination, dates, cabin, preferences, latest evaluation |
| Registry | `LoyaltyProgram`, `RewardCurrency` | 15 airlines, 8 hotels, shopping/dining/cruise/rental/casino/retail placeholders, 8 bank currencies, ~55 transfer routes (`seed/loyalty-registry.ts`) |

Existing Travel-page balances (`LoyaltyBalance`) still count in award planning when no account covers them.

## 2. Expiration engine (`domain/loyalty-expiration.ts`)

Policy per program: NEVER · ACTIVITY (N months since last qualifying activity) · FIXED (N months after each point is earned, computed FIFO from the event log) · WHILE_CARD_OPEN · UNKNOWN, with reset conditions (EARN, CARD_SPEND, PORTAL, DINING, PARTNER, PURCHASE, TRANSFER, STAY). A date the member entered always wins (confidence 90).

Output: expiry date, days left, points at risk, **risk score 0–100** (by days left, +10 when ≥ $500 is at stake), level (NONE / LOW / MEDIUM / HIGH / EXPIRED), **confidence** (verified policy 80–85, unverified 50–60, unknown 15–20, member-entered 90), reason, source.

**Alerts** at 365 / 180 / 90 / 60 / 30 / 14 / 7 / 1 days (`alertThreshold`): daily job `scan-loyalty-expirations` sends one notification per asset, expiry date and threshold (deduplicated; moving the date re-arms it), for points, certificates, memberships and at-risk status. Members can turn them off (`NotificationPreference.loyaltyExpiring`). Wording follows the brief: "120,000 miles at risk of expiration…", "Marriott points expire in 90 days…".

**Activity preservation:** methods ranked by cost and effort, with whether the activity posts before the deadline (earn 1 point, card spend, shopping portal, dining, transfer a small block, buy points, partner purchase, stay/flight). When the program lists its reset conditions, only matching methods are returned, marked confirmed.

**Policy data is not verified.** The registry stores general-knowledge policies with `policyVerified=false`, a source note and low confidence; where I was unsure the policy is UNKNOWN rather than guessed. Admins can correct a program, and members enter the date they see on the program's site.

## 3. Other engines

| Engine | File | Output |
|---|---|---|
| Tracking | `loyalty-tracking.ts` | totals (earned, bonus, purchased, redeemed, expired, transferred), 12-month balance series, growth, best/worst month |
| Certificates | `loyalty-assets.ts` | state (available / expiring / expired / used), **redemption check** (cap, eligible hotels, blackout ranges, expiry before stay, quantity, status), opportunities with the best qualifying hotel and "Potential value: $480." |
| Elite status | same | percent, remaining, pace-based renewal likelihood, risk, headline ("Marriott Platinum: 76% there, needs 12 nights"), actions |
| Memberships | same | expiry wording ("Global Entry expires in 6 months."), renewal window per kind, card credit that can pay for renewal |
| Transfer bonuses | `transfer-bonus.ts` | history stats (count, average, max, interval, seasonality), advice: transfer now (at or above average) / wait (below average, or one is due) / none expected / no data; effective ¢ per point |
| Valuation | `loyalty-valuation.ts` | **current, potential, at-risk, expired, recovered, net annual** by asset type and by member (definitions in the file header) |
| Forecast | same | next 30 / 90 / 180 days / year / two years across points, certificates, status, memberships, travel credits; past-due listed separately |
| Award trip | `award-trip.ts` | coarse price estimate (flagged), ranking of programs by coverage, cost, expiring points used, preferences, active bonus, transfer time vs departure; certificate matching |

## 4. API (`/loyalty/*`)

`GET programs` · `GET/POST accounts`, `PATCH/DELETE accounts/:id`, `POST accounts/:id/events`, `GET accounts/:id/history` · `GET expirations` · certificates: `GET/POST certificates`, `GET/POST certificates/opportunities`, `POST certificates/:id/check`, `PATCH/DELETE certificates/:id` · `GET/POST/PATCH/DELETE status` · `GET/POST/PATCH/DELETE memberships`, `GET memberships/:id/number` · `GET valuation|forecast|household|dashboard` · `GET transfers` · `POST/GET award-trips`, `DELETE award-trips/:id` · admin `PUT /admin/loyalty/bonus-records`. Workflows `loyalty-review` and `award-trip`; eight agents (Point Expiration, Certificates, Elite Status, Transfer Bonus, Award Travel, Memberships, Redemption, Loyalty Valuation) and seven tools, all USER-class.

## 5. UI

`/loyalty` with the eight dashboards as tabs: Loyalty dashboard, Points (accounts, history chart, activity), Certificates, Status & memberships, Expirations (risk, preservation, forecast), Asset valuation, Household, Award travel (trip evaluation, transfer bonuses).

## 6. Limits

- **No automatic balance refresh.** Balances come from the member (or later from an email or import); Pointwise never logs in to a program. `refreshedAt` and `source` record how fresh a balance is.
- Program policies, transfer ratios and valuations (¢ per point) are unverified planning data.
- Award prices are a coarse estimate unless the member enters the exact points; award availability is not known.
- Transfer-bonus history is only what Pointwise has observed (or an admin recorded); it starts empty, so early advice has low confidence.
- Hotel cash prices for certificate valuation are entered by the member; there is no live hotel search.

## 7. Automation (branch pw-2026-feature-loyalty-automation)
Sources, provenance and conflicts: `loyalty-architecture-review.md`, `email-loyalty-imports.md`, `loyalty-extension.md`. Research: `loyalty-aggregation-research.md`, `awardwallet-comparison.md`.

| Part | Where |
|---|---|
| Provenance and conflict rules (source scale 100/90/80/75/70/50/25) | `domain/loyalty-provenance.ts` |
| Ingestion funnel, observations, conflict resolution | `loyalty/loyalty-ingest.service.ts` |
| Email / page parser (33 programs), statement parser | `domain/loyalty-email.ts`, `domain/loyalty-statement.ts` |
| Certificate condition engine ("Valid up to 40,000 points.", "Valid for Category 1-4 hotels.", …) | `domain/loyalty-conditions.ts` |
| Refresh priority, schedule, staleness, refresh plan | `domain/loyalty-refresh.ts`, `loyalty/loyalty-automation.service.ts` |
| Health score 0–100 (account, program, household) | `domain/loyalty-health.ts` |
| Weekly audit (the eight questions), recent changes | `loyalty-automation.service.ts`, workflow `loyalty-audit` |
| Jobs | `refresh-loyalty` (hourly, syncs mailboxes for urgent due accounts, flags stale data), `loyalty-audit` (weekly) |
| Expiration alerts | 365 / 180 / 120 / 90 / 60 / 30 / 14 / 7 / 1 days and on expiry; prevention methods carry cost, effort and expected success |
| UI | Loyalty → Miles, Points, Transfer bonuses, Refresh health, Imports & conflicts; source badges, reliability and refresh confidence on every account |
| Extension | `extension/` |

What "automatic" means: an account updates itself when the member's own mail, statements or browser session supply the data. Stale accounts say exactly what to do. Pointwise never signs in to a program.
