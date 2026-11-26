# Offer automation

PointWise finds the merchant offers on every card in your household, scores them, adds the valuable ones by your rules, and keeps a record of everything. Open **Offer Automation** in the menu.

## What is real and what is not
- **Verified end to end:** discovery, snapshot diff, scoring, rules, the three enrollment modes, verification, MFA pause and resume, retries, notifications, audit trail, extension and email intake, household separation. All of it is exercised against a **mock issuer** in the test suite.
- **Not verified:** the six issuer flows (American Express, Chase, Citi, Bank of America, Capital One, Wells Fargo). No real account was available, so they have **never run against a real site**. They are flagged "Unverified Flow", are inert without an optional browser add-on, and need `OFFER_CONNECTORS_ENABLED=true` on the server **and** a per-account opt-in after you acknowledge the terms risk. Chase's terms list "agents, including AI agents or agentic AI, robots, spiders, scripts" as unauthorized use.
- **Passkeys** cannot be completed by a server. Approve them in your own browser.

## Where offers come from
| Source | How | Needs credentials | Removes offers by absence |
|---|---|---|---|
| Browser extension | You click Capture on your issuer's offers page | No | Yes (full page) |
| Offer emails | Forward or sync the issuer's offer-alert emails | No | No (partial) |
| Manual paste | Paste the offers text on an account | No | Yes |
| Server-side login (opt-in) | Daily at 2 AM local (configurable), or Sync Now | Yes, encrypted | Yes |

## The pipeline
login (or intake) → read the inventory and the enrollments → compare with the previous snapshot → score and decide → apply your mode and rules → verify → notify. Each step is an `OfferEvent`; account, rule, policy and token changes are in the audit log.

## Modes
- **Recommend Only** (default): nothing is added.
- **Bulk Approval**: you approve the recommended offers in one click.
- **Automatic Enrollment**: offers that match your filter (all, categories, minimum value, preferred merchants, spend history, minimum score) or an always-rule are added.
A never-rule beats everything.

## Scores
Six sub-scores from 0 to 100: value, expiration, merchant preference, travel relevance, household relevance, likelihood of use (weights 40, 10, 15, 10, 5, 20), overall 0-100. 85 and up: prioritize; 60 and up: add; 35 and up: review; below: ignore. A $250 Hilton offer from a preferred travel merchant scores in the 90s; a $2 coffee offer scores in the teens or twenties.

## Household
Every offer is tied to the card it is on. The same offer on a spouse's card and yours is two items and two enrollments; the inbox flags "Same offer on 2 cards" and never merges them.

## Failure handling
Three bad logins lock the account until you unlock it. Network failures and ended sessions retry with backoff (5 minutes, 30 minutes, 2 hours; 3 attempts). A session the issuer ended is replaced by one fresh login. A run that never finishes is closed after 30 minutes. A page that suddenly shows over 40 percent fewer offers is a warning and removes nothing.

## Jobs
`offer-sync-due` (hourly, runs the accounts whose local time has come), `offer-sync-recover` (every 10 minutes), `offer-digest` (daily), `offer-audit-monthly`. Manual: Sync Now, per account or for the household.

## Savings
Realized savings are statement credits matched to an offer (the existing activation check), so the figure is conservative; "Enrolled and Waiting" is the value of offers you are enrolled in that have not ended.

## API
`/api/v1/offer-automation`: `accounts`, `sync`, `inbox?tab=`, `counts`, `approve`, `ignore`, `items/:id/mark-enrolled`, `history`, `attempts`, `savings`, `rules`, `policy`, `tokens`, and the extension endpoints `extension/snapshot`, `extension/queue`, `extension/enroll-results`.

## Security
Logins, sessions and device-trust markers are AES-256-GCM encrypted with a key from `TOKEN_ENC_KEY`, are write-only through the API, and are redacted from audit rows, events, notifications and AI tools. The Merchant Offer Agent's tools never see them.
