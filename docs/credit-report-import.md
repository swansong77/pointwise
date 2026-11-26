# Credit Report Import (Experian, Equifax, TransUnion, Credit Karma)

Status: **built (2026-12-02)**. Source: `backend/src/domain/credit-report.ts` (pure parser), `backend/src/portfolio/credit-reports.ts` (preview / import), UI `/import` → *Credit report (Credit Karma)*. Tests: `backend/test/unit/portfolio/credit-report.spec.ts`, `backend/test/integration/credit-report.int-spec.ts`, `frontend/test/credit-report.test.ts`, `playwright/tests/credit-report.spec.ts`, `tests/imports/` (TC-CRK-*).

## Three bureaus (2026-12-03)
Up to **three reports at once** — one per bureau — from **annualcreditreport.com** (free weekly reports from all three), the bureaus' own sites (**Experian**, **myEquifax**, **TransUnion**) or **Credit Karma** (TransUnion, Equifax). The parser knows each bureau's layout:

| Bureau | Layout specifics handled |
|---|---|
| TransUnion | creditor heading with a masked number (`JPMCB CARD #426684******` — first digits, not last); both *Account Type* (Revolving) and *Loan Type* (CREDIT CARD); *Pay Status*; *Remarks* (CLOSED BY CONSUMER) |
| Equifax | *Owner* (Individual / Authorized User), *Loan Type*, *Account Status* (PAYS_AS_AGREED, CLOSED), month-only *Date Opened*, *Account Number* `xxxx…4321` |
| Experian | *Account name* blocks, *Account number* `426684XXXXXX` (first digits — ignored), *Status* (Open/Never late, Closed), *Responsibility* |

Fields every bureau prints but Pointwise does not need (balance, payment history, date reported, terms, past due …) are recognised and ignored, so they never split an account or swallow the next creditor heading. The bureau is the one named most often in the file; the provider (Credit Karma vs bureau) is recorded as the source.

**Merging:** the same account on several reports (same issuer — or creditor name if the issuer is unknown —, open dates within 45 days, last digits compatible, never two accounts from one bureau) becomes one row: the most precise and then earliest open date, last digits from any bureau, the highest limit, closed if any bureau says closed. Bureaus that disagree on the open **month** are shown (`TransUnion 2025-04-02 · Experian 2025-05-02`, earliest used). The imported account keeps `reportedBy` (the bureaus) and is updated — not duplicated — when imported again from another bureau.

## Why a file import
None of the bureaus nor Credit Karma offer consumers an API, and automated access is not allowed, so Pointwise never logs in to them. The user opens the credit report page that lists accounts with *Date opened*, **prints it to PDF** (browser → Print → Save as PDF) or **copies the text**, and imports it. Repeat per bureau for completeness.

## Flow
1. **Read** (`POST /credit-reports/import/preview`, multipart `files` — up to 3 PDF/TXT — and/or `text`, `profileId` = whose report): PDFs go through the sandboxed extractor (same as statements). Nothing is saved; the file and text are discarded.
2. **Parse** (deterministic, no AI): accounts as label/value blocks (value after a colon, after spaces, or on the next line) or summary rows (`NAME  03/15/2019  Open  $5,000`). Fields: creditor (heading in capitals or *Account name*), type, date opened (*03/15/2019* → day precision; *Mar 2019* / *03/2019* → month), status / date closed, account number → last 4–5 digits, responsibility (authorized user), credit limit. Mortgages, auto/student/personal loans and other non-card accounts are skipped with a reason; duplicates (summary + detail) collapse. Bureau names map to issuers (JPMCB → Chase, CBNA → Citi, SYNCB → Synchrony, …).
3. **Match** each card account to a wallet card of that household member and issuer: last digits → open month → the only undated card of that issuer; each wallet card at most once (strongest evidence first). Proposal: **LINK** (set the open date on that card), **ADD** (not in the wallet and opened in the last 24 months → a private card so 5/24 counts it), **SKIP** (older and unmatched). The preview shows the card's current date and whether it differs.
4. **Import** (`POST /credit-reports/import`, the confirmed rows): LINK → open date + precision, authorized-user, closed status/date, credit limit, last digits (if missing) on the card. A month-level date never replaces a day-level date in the same month, and a different date is replaced only with *overwrite*. ADD → private card (issuer, "… card ··digits", source CREDIT_REPORT) within the plan's card limit. Each imported account is kept as a `CreditReportAccount` (updated, not duplicated, on re-import). 5/24 updates immediately.

## Privacy
Credit report data is sensitive: only the card accounts' facts above are stored (owner-scoped, included in data export, deleted with the account); report files and full text are never stored or logged, and nothing is sent to an AI provider or bureau.

## Limits
Layouts change; unknown layouts yield "No accounts were found" — paste the text of the accounts list instead. Scanned/photographed PDFs have no text layer. Business cards that do not appear on personal reports will not be found (by design of the report).
