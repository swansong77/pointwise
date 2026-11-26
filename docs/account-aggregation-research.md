# Account aggregation research (free-only)

Retrieved **2026-11-25** from each vendor's own site. **VERIFIED** = stated on an official page that was read; **UNVERIFIED** = not found on pages read. Vendor claims (uptime, SOC 2) are marketing statements. Existing context: `bank-and-bureau-feasibility.md` (Plaid is implemented, disabled by default).

**Product rule (user decision):** free solutions only. Anything paid is documented for comparison and never enabled.

## 1. Findings

| Vendor | Free access | Pricing model | Credit-card support | Security claims |
|---|---|---|---|---|
| **Plaid** | VERIFIED: sandbox always free; **Trial** plan = free production access limited to **10 Production Items** (US/Canada, teams created on or after 2026-04-15), includes Liabilities, Transactions, Statements [plaid.com/pricing, /docs/account/billing] | Pay-as-you-go $0/month, no minimum; Liabilities/Transactions billed **per Item per month** while a valid token exists, even in error, until `/item/remove`; rates unpublished until Production access | VERIFIED: Liabilities returns card APRs, last statement balance, minimum payment, due date; card **transactions** come from Transactions; **Statements (PDF) supports depository accounts only** [/docs/liabilities, /docs/statements]. Per-issuer card coverage UNVERIFIED (coverage explorer needs JavaScript) | Trust page not read: UNVERIFIED |
| **Teller** | VERIFIED: developer tier free, **100 live connections** [teller.io] | VERIFIED: Transactions $0.30/enrollment/month, Balance $0.10/call, Verify $1.50/account, Identity $1.75/call; Enterprise custom | **UNVERIFIED**: site says "the API for your bank account", no card mention | SOC 2 Type 2 listed (vendor claim) |
| **Akoya** | VERIFIED: free self-service **sandbox only**; production limits and rates unpublished | Standard (<10,000 monthly connections) vs Enterprise; "set-up or implementation fee may apply" | UNVERIFIED for cards; transaction and PDF-statement APIs exist | "login credentials aren't copied or stored"; OAuth-based; SOC 2 not stated |
| **MX** | UNVERIFIED (sales-led "Get a Demo") | UNVERIFIED | UNVERIFIED | SOC 2 Type II, PCI DSS listed (homepage claim) |
| **Yodlee** | UNVERIFIED (developer sign-up exists) | UNVERIFIED | UNVERIFIED | UNVERIFIED |
| **Finicity** (Mastercard Open Finance) | Pages returned HTTP 403 — nothing verified | – | – | – |
| **Salt Edge** | UNVERIFIED; EU/UK focus | UNVERIFIED | US cards not addressed | UNVERIFIED |

## 2. Industry standards and best practice
- Consumer-permissioned data access is moving to OAuth/tokenised flows (FDX); credential-sharing aggregators are riskier and brittle. Never store bank passwords (project rule).
- Data minimisation: store only masks, balances and transactions; encrypt access tokens at rest (existing AES-256-GCM `TOKEN_ENC_KEY`).
- Webhooks plus a nightly sync for freshness; handle re-authentication states.

## 3. Options

| | A. Email + PDF/CSV only (no aggregator) | B. Plaid Trial (≤10 Items), never upgraded | C. Teller developer tier | D. Paid aggregator (Plaid Pay-as-you-go/Growth, MX, Yodlee, Akoya prod) |
|---|---|---|---|---|
| Cost | $0 | $0 until Items exceed 10; billing continues per Item until removed | $0 up to 100 connections | recurring, per Item/connection |
| Coverage | any issuer that emails alerts/statements; every PDF/CSV | card transactions + liabilities; per-issuer coverage unverified | card support **unverified** | broad |
| Effort | built | built (flag-gated) | low if card support exists | built for Plaid |
| Reliability | depends on parser upkeep (validated against printed totals) | vendor-run | unknown | SLA on paid plans |
| Security | no bank credentials ever | OAuth to most big issuers | credential-based Connect (UNVERIFIED for issuers) | vendor-run |
| Maintenance | parser fixes per layout | webhook + re-auth | unknown | contract |
| **Verdict** | **Chosen (primary)** | Optional, off by default; a free way to try live sync for ≤10 accounts; **never upgrade** | Evaluate in sandbox only; not adopted until card support is verified | **Not used** |

## 4. Recommendation (by tier, as requested)

| Tier | Choice | Monthly cost | Maintenance | Coverage | Reliability | Risk |
|---|---|---|---|---|---|---|
| **Best Free** | **Email ingestion + PDF/CSV** (IMAP/Gmail/Graph read-only), optionally Plaid Trial for ≤10 Items | $0 | parser upkeep; token refresh | issuer alert/statement emails and every downloadable statement | validated: every statement is reconciled against its printed totals | email formats change; Plaid billing continues per Item if Trial limit is exceeded |
| Best Low-Cost *(not used)* | Teller | ≈$0.30/enrollment/month beyond free | UNVERIFIED | UNVERIFIED for cards | UNVERIFIED | card support may not exist |
| Best Enterprise *(not used)* | Plaid Custom | negotiated | webhooks, daily refresh | card transactions + liabilities, no card statement PDFs | SLA-backed | contract, per-Item fees |

## 5. Implementation plan
1. Keep Plaid behind `BANK_PROVIDER` (default off) and refactor to a `BankProvider` interface so another provider is a drop-in (ADR-001).
2. Make email + PDF/CSV the documented primary path (see `email-ingestion-research.md`).
3. Do not add Teller until a sandbox test proves card transactions for the target issuers.

## 6. Gaps to verify later (none required now)
Plaid per-issuer card coverage (CSV at `plaid.com/documents/us_institution_coverage.csv` not fetched), Teller card support, MX/Yodlee/Akoya pricing, Finicity (403).
