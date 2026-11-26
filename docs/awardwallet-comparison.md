# AwardWallet comparison

Source: AwardWallet's own pages, retrieved 2026-11-25 (`/api`, `/api/account`, `/api/loyalty`, `/faqs`; see `loyalty-aggregation-research.md`). PointWise columns describe this branch after the automation work. Nothing here was tested against AwardWallet itself.

## How each gets its data
| | AwardWallet | PointWise |
|---|---|---|
| Balance updates | Logs in to the program site "on your behalf" with stored (encrypted) credentials; also email parsing | The user's own mail, statements and browser session; manual entry. **No credentials, ever.** |
| Auto-refresh | Yes, on a schedule (free: 2 updates per account per 24 h) | Only where the user's data arrives (email, statement, extension click); stale accounts get a clear "needs refresh" action |
| Coverage | 600+ programs claimed | ~45 programs seeded (15 airlines, 8 hotels, 8 bank currencies and others); any custom program; email rules and extension extractors are data and **unverified** until real samples are supplied |
| Cost | Free; Plus $49.99 per year; business API $4 per managed member per month | Free |

## Feature by feature
| Feature | AwardWallet | PointWise | Verdict |
|---|---|---|---|
| Balance monitoring | Yes, automatic | Yes, automatic from email/statement/extension; per-update source, reliability, confidence; history by refresh | Equal on tracking and audit; **behind** on unattended coverage |
| Expiration monitoring | Expiry date from the program, alerts | Policy-based prediction with risk score and confidence, member-entered date wins, alerts at 365/180/120/90/60/30/14/7/1 days and on expiry, **prevention actions with cost, complexity and expected success** | **Superior** on prevention and honesty about confidence |
| Certificates | Redeemables (certificates, vouchers, companion tickets, coupons, store credit) | Free night, companion, upgrade certificates with structured **conditions** and a redemption-rule checker (cap, categories, award-only, paid companion, origin, blackout) | **Superior** on rule checking |
| Elite status | Status property, progress | Progress, pace-based renewal likelihood, risk, actions, full qualification history | Equal or better |
| Travel credits | Via properties | Card credits from the benefit tracker with expiry in the forecast | Equal |
| Trip tracking | Itineraries | Award-trip planner (balances, transfers, bonuses, certificates); no itinerary import | **Behind** on itineraries, **ahead** on award planning |
| Redemption / activity tracking | History where the program shows it | Event log (earn, bonus, redeem, expire, transfer) from statements and balance changes | Equal where data exists |
| Household | Family members | Members, combined value, expirations, certificates, status, health | Equal |
| Valuation | Limited | Current, potential, at-risk, expired, recovered, net annual value | **Superior** |
| Health scoring and audit | No | 0–100 health at account, program and household level; deterministic AI audit | **Superior** |
| Data quality | Not exposed | Every value carries source, timestamp, reliability, verification, confidence; high-confidence values are never overwritten | **Superior** (auditable) |
| Privacy | Stores program passwords | No program credentials; account numbers encrypted; nothing sent to an AI provider | **Superior** |

## Where AwardWallet is stronger (be honest)
- It refreshes unattended for hundreds of programs because it holds the user's credentials. PointWise deliberately does not, so freshness depends on the user's mail, statements and browser visits.
- Its parsers have years of real-world tuning; ours start generic and are flagged unverified.
- It imports itineraries.
