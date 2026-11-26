# Loyalty aggregation research

Retrieved **2026-11-25** from the providers' own pages. **VERIFIED** = read on the page; **UNVERIFIED / NOT CHECKED** = not reached or not read (the fetch budget was 12 pages), so nothing is filled in from memory. Constraint recap: free only (paid options are documented, never enabled), no server-side logins to program sites, no household data to AI providers.

## 1. Official program APIs (airlines, hotels, bank rewards, portals, dining)

| Question | Finding | Status |
|---|---|---|
| Does any airline, hotel, bank-rewards, portal or dining program offer a consumer-balance API? | **None found.** No airline or hotel developer portal was reachable from the homepages read; I did not guess URLs for Marriott, Hilton, Hyatt, IHG, United, Delta or American. | NOT CHECKED per program |
| Related, not balances | AwardWallet's Hotel and Flight Award Search APIs list Hilton, Hyatt, Marriott and IHG, but return **award availability**, not a member's balances. | VERIFIED |

Planning assumption (to be corrected if a program publishes one): there is no consumer-balance API. API availability, authentication, data quality, refresh, rate limits, maintenance and commercial terms are therefore *not applicable*; a per-program check is listed under "To verify" below.

## 2. Aggregation providers

| Provider | What it offers | Auth model | Loyalty balances? | Pricing / limits | Status |
|---|---|---|---|---|---|
| **AwardWallet Account Access API** (`awardwallet.com/api/account`) | Balances, expiration date, elite status, properties, history, redeemables (certificates, vouchers, companion tickets, coupons, store credit) for accounts a consumer **shares with a business account** | `X-Authentication` API key; consumer grants access level 0–3 (0 = numbers and status, 1 = balances and status, 2 = all except passwords, 3 = full control). The `/api` summary page says OAuth2; the account page does not describe that flow, so OAuth2 is UNVERIFIED | **Yes** | **Business partners only** ("you need to have a business account"; admins need AwardWallet Plus); $4.00 per month per managed member; 20 requests per rolling 10 minutes per id; free (non-Plus) connected users hide history, expiry and most properties | VERIFIED (first ~40K of a 184K page verbatim) |
| **AwardWallet Web Parsing API** (`/api/loyalty`) | Balance, expiry, elite level, history, itineraries by logging in to the program site | Caller's AwardWallet credentials **plus the end user's loyalty login and password in every request** | Yes (600+ programs claimed) | "contact us"; no public price | VERIFIED |
| **AwardWallet consumer app** | Balances, expiry, status, certificates for one's own accounts | The user's AwardWallet login; AwardWallet logs in to programs "on your behalf" and stores the encrypted loyalty passwords | Yes (for the user only) | Free (2 updates per account per 24 h); Plus $49.99 per year | VERIFIED |
| **Plaid** | Auth, Identity, Balance, Transactions, Investments, Liabilities, Assets, Income and others | Plaid Link | **No** — Liabilities covers credit cards and mortgages (APRs, loan numbers), Investments covers brokerage, retirement, crypto, 529, HSA; no loyalty product on the homepage list. Transactions, Balance, Auth, Assets not individually checked | Not checked | VERIFIED for the two pages; UNVERIFIED for the rest |
| **MX** | Account aggregation, balance checks, statements (PDF), data access (FDX), investment data | Not checked | **No loyalty product** on the docs homepage (full index not read) | Not checked | PARTIAL |
| **Yodlee** | Aggregation | Not checked | Not verified (products page not read) | Not checked | UNVERIFIED |
| **Finicity** | — | — | Not checked | Not checked | NOT CHECKED |
| **PointsYeah** | Consumer award-flight and hotel **search** and price alerts; developer API for award availability (premium, 1,000 calls/day, API key) | API key | **No** (search results only; a "Family and Friends Points Wallet" feature is shown but not described as an API) | Premium tier | VERIFIED |

## 3. Assessment

| Criterion | AwardWallet (business API) | Banking aggregators | PointsYeah |
|---|---|---|---|
| Capability | Best loyalty coverage | None for loyalty | Search only |
| Coverage | 600+ programs (claimed) | – | 40+ for availability |
| Reliability | Depends on scraping program sites that change; they run it as their core product | – | – |
| Cost | Business account, per-member fee, partner approval | – | Premium |
| Privacy / risk | Web Parsing sends program passwords through a third party; the consumer path stores them; the API page says it does not store credentials but the contracts are not read | – | – |
| Fit with Pointwise rules | **Conflicts**: business-only (not free for a household app), and credential handoff is the exact pattern the project forbids | No data | No data |

**Conclusion.** No free, permitted, consumer-level source returns loyalty balances. Credential-based aggregation is both unavailable to this project (partner/paid) and against its rules. The viable free paths are the ones the user controls: **email**, **statement PDFs**, a **browser extension** in the user's own session, and **manual entry**, merged by a provenance engine. The AwardWallet slot stays in the code as a disabled adapter (documented, never enabled).

## 4. To verify (free)
- AwardWallet terms (`awardwallet.com/page/terms`) and supported-programs list; whether Account Access (the user shares an AwardWallet account with a business) could be offered later by a business-account holder.
- Finicity and Yodlee product lists; MX full docs index; Plaid Transactions/Balance/Statements pages.
- Any program developer portal for consumer data (Marriott, Hilton, Hyatt, IHG, United, Delta, American, Southwest, Alaska and the bank programs).
