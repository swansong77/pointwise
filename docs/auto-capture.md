# Automatic Transaction Capture

Status: **built (2026-12-01, Phase H)**. Goal: no monthly statement downloads — every card's transactions arrive by themselves and keep the benefit tracker current (see [spend-tracking.md](spend-tracking.md)).
Source: `backend/src/capture/` (inbox + status), `backend/src/domain/email-alerts.ts` (pure alert parsing), `backend/src/portfolio/connections.ts` (Plaid webhook, re-link), `backend/src/spend/spend.service.ts` (cross-source merge); UI: **Automatic import** panel on `/spending`, Plaid Link on `/import`. Tests: `backend/test/unit/spend/email-alerts.spec.ts`, `backend/test/unit/imports/connections.spec.ts`, `backend/test/integration/capture.int-spec.ts`, `frontend/test/spend.test.ts`, `playwright/tests/auto-capture.spec.ts`, `tests/spend/` (TC-AC-*).

## 1. Options (what is and is not automated)
| Channel | Effort for the user | Cost / requirement | Coverage |
|---|---|---|---|
| **Bank connection** (Plaid) | sign in once per issuer in Plaid Link | Plaid production account with the *transactions* product (paid per connected account); sandbox is free | posted transactions, all cards at that issuer; real-time via webhook + daily sync |
| **Forwarded alert emails** | turn on "every transaction" alerts per card + one Gmail/Outlook forwarding rule | an inbound-mail provider (Cloudflare Email Routing / Workers, Amazon SES, Mailgun, Postmark …) and a domain | each purchase / statement credit as it happens; statement PDFs attached to emails |
| **Bulk statement drop** | download statements, drop them all at once (any cards, ≤ 24 files) | none | each file matched to its card by the account digits it shows (§8) |
| Statement PDF / CSV upload with review | per statement | none | fallback with a row-by-row preview |
| ~~Plaid Statements~~ | — | — | **not usable**: Plaid's Statements product "currently supports only bank depository accounts (e.g. checking and savings accounts)" — not credit cards (plaid.com/docs/statements, read 2026-11-22) |
| ~~Logging in to bank websites with the user's password~~ | — | — | **not built**: credential sharing, issuer ToS, MFA, and security risk (project rule) |

No issuer or aggregator offers an API that hands out **credit-card statement PDFs**, so statements cannot be downloaded automatically without the user's bank password. They are not needed for the data, though: a statement is the month's posted transactions, which the bank connection imports automatically (and alert emails as they happen). Statements matter only for cards without either feed — the status panel flags those (*Statement due*).

Both automatic channels can be on at once; duplicates are merged (§4).

## 2. Bank connections, fully automatic
- **Connect:** `/import` → *Connect a bank* opens **Plaid Link** (loaded on demand from `cdn.plaid.com`; CSP allows only that script, frame and Plaid's API hosts). Sandbox: *Connect a sandbox test bank*.
- **New transactions without waiting:** Link tokens carry `PLAID_WEBHOOK_URL`; Plaid calls `POST /api/v1/connections/plaid/webhook`. The webhook is verified: `Plaid-Verification` JWT must be **ES256**, signed by the key from `/webhook_verification_key/get` (cached 1 h), **≤ 5 minutes old**, and its `request_body_sha256` must equal the SHA-256 of the raw body. `TRANSACTIONS/*` → transactions sync for that item; `ITEM/ERROR` (e.g. `ITEM_LOGIN_REQUIRED`), `PENDING_EXPIRATION`, `PENDING_DISCONNECT` → connection marked **sign-in needed**; `LOGIN_REPAIRED` clears it. The daily `sync-bank-connections` job remains the fallback.
- **Repair:** *Sign in again* → `POST /connections/:id/relink-token` (Link update mode with the item's access token) → `POST /connections/:id/relinked` (clears the flag, syncs).
- Sync errors are stored (`lastError`); login errors set `needsReauth` so the UI asks the user.

## 3. Forwarded alert emails
1. Each user gets a private address `u-<24 hex>@INBOUND_EMAIL_DOMAIN` (*Copy address*; *New address* rotates it; *Pause*).
2. User turns on alerts for every transaction (and statement credits) at each issuer, and adds a forwarding rule. Gmail sends a confirmation email to the address — Pointwise shows the **confirmation code / link** on the panel. The panel gives a ready Gmail filter: `from:(chase.com OR americanexpress.com OR …)`.
3. The inbound provider POSTs each message (raw MIME) to `POST /api/v1/inbound/email` with `X-Inbound-Secret: INBOUND_EMAIL_SECRET` (constant-time check) and the envelope recipient in `X-Envelope-To` (or `?to=`; otherwise `Delivered-To` / `X-Original-To` / `To`). Unknown or paused addresses are dropped silently (`{accepted: false}`).

Processing (`CaptureService.receive`, deterministic — no AI):
| Step | Rule |
|---|---|
| Sender | Gmail forwarding confirmations (google.com) → stored code/link. Otherwise the From domain must be a card issuer (issuer allow-list + `INBOUND_EXTRA_SENDER_DOMAINS`) → else REJECTED. |
| Authentication | Only the **first `Authentication-Results` header stamped by our receiver** (`INBOUND_AUTHSERV_ID`) is trusted (anyone can write such a header inside a message). DKIM pass aligned with the sender (survives forwarding) or DMARC pass → *verified*; DKIM/DMARC fail → REJECTED; unknown → accepted, not marked verified. |
| Statement PDF attached | sandboxed PDF extractor → statement parser; the card is found from the account number's last digits on the statement → imported (source PDF). |
| Alert | amount, merchant, card's last digits, date (from the text, else the email date), credit/refund wording. Declines, payment confirmations, "statement ready" notices and mail without amount or merchant are IGNORED. |
| Card | the user's one open card whose last digits match (4 or 5 digits, Amex-style) → transaction (source EMAIL, dedupe by Message-ID) → benefit auto-tracking. No or ambiguous match → **Which card?** list: the user picks the card (and can save the digits on it so the next alert matches). |

Stored: per email only the parsed facts (sender domain, subject, kind, status, amount, merchant, digits, date, verification, linked transaction) for 90 days. **Email bodies and attachments are never stored**, and nothing is sent to an AI provider.

## 4. One transaction, many sources
An alert arrives the day of the purchase; the posted version comes later from the bank sync or a statement. `SpendService.ingest` merges them: same card, same amount, same direction (debit vs credit), dates within **4 days** → the alert row is **updated** to the posted data (description, date, source, dedupe id) and keeps its benefit match; an alert arriving after the posted row is a duplicate. Two identical purchases pair up one-to-one.

Posted rows from different sources are also one purchase: a statement row (CSV / PDF) for a purchase the bank sync already recorded — or the other way round — is counted as a duplicate (same amount and direction, dates within 4 days, one-to-one).

## 5. Status
`GET /capture/status` / *Automatic import* panel: per card — *Bank connection*, *Alert emails* (an alert in the last 21 days) or *Not automated* — with the last transaction date, the statements imported (`statements: {statements, through, lastImportAt}`), **Statement due** (not automated and no statement covering the last 35 days) and a hint (add last 4 digits, sign in again, set up alerts or a connection); the inbox address, Gmail filter and confirmation; *Which card?* items; recent alert emails with their outcome.

## 6. Configuration
| Variable | Purpose |
|---|---|
| `INBOUND_EMAIL_DOMAIN` | domain of the forwarding addresses (MX → your inbound provider) |
| `INBOUND_EMAIL_SECRET` | shared secret the provider sends in `X-Inbound-Secret` (≥ 24 random chars) |
| `INBOUND_AUTHSERV_ID` | authserv-id your provider writes in `Authentication-Results` (to trust its DKIM/DMARC verdict) |
| `INBOUND_EXTRA_SENDER_DOMAINS` | extra issuer sender domains (credit unions …) |
| `PLAID_WEBHOOK_URL` | public HTTPS URL of `/api/v1/connections/plaid/webhook` |

Inbound provider examples: **Cloudflare Email Routing** → Email Worker `fetch(API, {method:'POST', headers:{'x-inbound-secret':…, 'x-envelope-to': message.to}, body: message.raw})`; **Amazon SES** receipt rule → SNS/HTTPS or S3 + Lambda posting the raw message; **Mailgun / Postmark** inbound routes with "raw MIME" / "store and notify" forwarding. Local testing: POST a `.eml` file with curl and the secret header.

## 7. Limits
- Alert wording differs by issuer and changes over time; unknown wording falls back to *IGNORED* (visible in *Recent alert emails*) — the parser is rule-based and unit-tested per wording.
- Alerts report authorisations; amounts can change on posting (tips) — the posted row replaces the alert only when the amount matches; otherwise both appear until the user removes one.
- Plaid production access and pricing are outside the app; without it, alert forwarding is the free automatic path.

## 8. Bulk statement drop
`POST /api/v1/spending/statements/bulk` (multipart `files[]`, ≤ 24, ≤ 10 MB each; optional `assignments` JSON `{file name: walletCardId}`, `purchasesAre`) / *Import all your statements* panel on `/spending` (drag and drop or choose files).
- **Card detection:** PDFs — the account number ending printed on the statement (`statementDigits`: "Account Number: XXXX XXXX XXXX 1234", "ending in 1234", Amex 5 digits); CSVs — digits in the file name (e.g. `Chase1234_Activity20261101.CSV`; 8-digit dates are ignored). The user's one open card with those last digits is used; none or several → **NEEDS_CARD**, the user picks a card and only those files are sent again with `assignments`.
- **Never twice:** each imported file is recorded in `StatementImport` (SHA-256 of the file, card, period, counts — **not the file**); the same file for the same card returns **ALREADY_IMPORTED** and changes nothing. Emailed statement PDFs (§3) and single uploads are recorded the same way.
- Per file result: `IMPORTED` (card, matched by digits or choice, period, new / already recorded, benefit updates), `ALREADY_IMPORTED`, `NEEDS_CARD` (digits seen), `ERROR` (scanned PDF, unreadable file, someone else's card).
- Statement coverage per card feeds *Statement due* on the status panel.
- Migration `20261206000000_statement_imports`. Tests: `backend/test/integration/statements-bulk.int-spec.ts`, `frontend/test/spend.test.ts` (file picking), `playwright/tests/spending.spec.ts` (PW-SP-03), `tests/spend/` (TC-AC-12…16).


## 9. Connected mailboxes (2026-11-25)
Besides forwarding, a user can connect a mailbox read-only over **IMAP** (`POST /mailboxes`; Gmail, Outlook.com, Yahoo, iCloud or any IMAP host, app password). A worker job (`sync-mailboxes`, every 15 minutes) reads only new mail: it lists UIDs, checks the **sender from the envelope**, and fetches full messages only from allow-listed issuer domains, then runs them through the same pipeline as forwarded mail (`CaptureService.receiveFromMailbox`: sender allow-list, Authentication-Results check where the provider is known, statement PDFs, alerts, "Which card?" queue, dedupe by Message-ID). The password is encrypted with `TOKEN_ENC_KEY` and never returned; bodies are processed in memory and never stored; the cursor (`UIDVALIDITY:UID`) only advances after a successful run. Hosts on private networks are refused (SSRF). Messages that cannot be imported are still labelled for the user (statement, transaction alert, travel credit, offer credit, account alert, purchase confirmation) via `domain/mail-classify.ts`. **Gmail** and **Outlook/Microsoft 365** sign-in (`GET /mailboxes/oauth/:google|microsoft/start`, callback `/mailboxes/oauth/callback`) use read-only OAuth with the owner's own free app registration; setup and verified limits are in `email-ingestion-research.md` §7. Revoked or expired access shows **Reconnect needed**.
