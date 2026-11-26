# Email ingestion research (free-only)

**Evidence status (updated 2026-11-25).** Gmail and Microsoft Graph facts in §7 were read from Google's and Microsoft's official documentation on 2026-11-25 (URLs listed there) and the Gmail and Outlook connectors are built on them. IMAP, Exchange and the older table in §2 are still background knowledge marked ⚠ (UNVERIFIED).

## 1. Sources to ingest
Statement emails (with PDF attachment), transaction alerts, account alerts, travel credits, offer credits, purchase confirmations. Existing: forwarded-alert inbox (`capture/`), `domain/email-alerts.ts`, PDF import. Missing: reading a mailbox directly.

## 2. Providers and constraints

| Provider | Free? | Read-only access | Notes (⚠ unverified) |
|---|---|---|---|
| **IMAP** (any host) | yes | read-only folder `EXAMINE` | Large providers have disabled basic username/password IMAP for some accounts and require OAuth2 (XOAUTH2) or an app password ⚠ |
| **Gmail API** | yes | `gmail.readonly` (restricted scope) ⚠ | Restricted scopes need Google verification for public apps; an app used only by its owner can stay in "Testing" mode, where refresh tokens expire after about 7 days ⚠; push via Pub/Sub or polling |
| **Microsoft Graph** (Outlook.com / M365) | yes | `Mail.Read` delegated ⚠ | personal accounts can consent themselves; delta queries for incremental sync ⚠ |
| **Exchange Web Services** | n/a | – | being retired by Microsoft in favour of Graph ⚠ — **not adopted** |
| **Gmail forwarding filter** (existing) | yes | forwards matching mail to the private inbound address | no OAuth needed; user controls the filter; already built |

Sender authenticity: use DKIM/SPF/DMARC results (`Authentication-Results`) and an issuer allow-list before trusting any financial email (already implemented for the inbound webhook).

## 3. Options

| | A. Forwarding filters only (built) | B. IMAP connector (app password / OAuth) | C. Gmail + Graph OAuth connectors | D. Hosted email-parsing SaaS |
|---|---|---|---|---|
| Cost | $0 | $0 | $0 | paid |
| Effort for the user | set a filter once | enter host + app password | click-through consent (Testing-mode token refresh ⚠) | sign-up |
| Privacy | email never leaves user's control except the matched alerts | full mailbox read access | full read scope | third party reads mail |
| Reliability | depends on filter rules | polling | polling/push | vendor |
| Maintenance | none | low | moderate (token expiry, API changes) | vendor |

## 4. Recommendation
- **Best free:** B (IMAP, read-only, polling) as the first connector because it works with any mailbox, needs no cloud console setup, and the credential is an app password the user can revoke; keep A as the zero-setup path. Add C (Gmail, Graph) behind the same `MailboxConnector` interface once the ⚠ items are verified. D is **not used** (paid, third-party mail access).
- **Low-cost / enterprise:** none adopted.

## 5. Design (implemented in Phase 4)
- `MailboxConnector { listSince(cursor), fetch(id), close() }` with adapters per provider; secrets encrypted with `common/crypto.ts`; one `Mailbox` row per connection with a cursor (UID or delta token).
- Fetch only messages from the issuer allow-list (`SEARCH FROM`), headers first; fetch bodies/attachments only for matches; process in memory and **never store bodies** (existing rule); statement PDFs go to the existing sandboxed PDF extractor and validation.
- Idempotency by `Message-ID`; failures leave the cursor unchanged. Nothing is sent to an AI provider.
- Revocation: delete the mailbox row and stored secret; the user also revokes the app password.

## 6. Verification tasks (free)
Confirm for Gmail, Outlook.com and Exchange Online: current status of basic-auth IMAP, XOAUTH2, Testing-mode token lifetime, Graph `Mail.Read` consent for personal accounts.


## 7. Gmail and Outlook connectors (built; facts verified 2026-11-25)

### Gmail (Google) — `GmailConnector`
- **Scope:** `gmail.readonly`. All of `gmail.readonly`, `gmail.metadata`, `gmail.modify` and `mail.google.com` are *Restricted*; `gmail.metadata` cannot use the `q` search parameter, so `gmail.readonly` is the narrowest scope that allows sender search and raw fetch (https://developers.google.com/gmail/api/auth/scopes, …/users.messages/list).
- **Endpoints:** auth `https://accounts.google.com/o/oauth2/v2/auth`, token `https://oauth2.googleapis.com/token`, revoke `https://oauth2.googleapis.com/revoke`; `users.messages.list` with `q=from:(…) after:YYYY/MM/DD` (day granularity), `users.messages.get?format=raw` (base64url RFC 2822) (https://developers.google.com/identity/protocols/oauth2/web-server).
- **Refresh tokens:** returned only with `access_type=offline` and only on first consent, so Pointwise sends `prompt=consent`. `invalid_grant` means revoked/expired → the mailbox shows **Reconnect needed**.
- **Which publishing mode to use (free):** *Personal* user type = only the Google account that created the app; no verification, no user cap, no 7-day token expiry (https://support.google.com/cloud/answer/15549945). A *Testing* app allows up to 100 test users but **refresh tokens expire after 7 days**. An unverified production app shows a warning and is capped at 100 new users for the project's lifetime. Verification (and an annual security assessment for restricted-scope data stored on servers) applies to public apps; apps used by a few known users are excused from review (…/restricted-scope-verification). Choose **Personal** if only one account will connect.
- **Quota:** 6,000 units/user/minute; list 5 units, get raw ≈ 60 units (Gmail quota page). Pointwise reads at most 60 messages per 15-minute run.

### Outlook / Microsoft 365 — `GraphConnector`
- **Permission:** delegated `Mail.Read` (+ `offline_access`, `User.Read`): no admin consent required, valid for personal Microsoft accounts and work/school accounts (https://learn.microsoft.com/en-us/graph/permissions-reference). `Mail.ReadBasic` excludes bodies, so it cannot supply MIME.
- **Endpoints:** `https://login.microsoftonline.com/common/oauth2/v2.0/authorize` and `/token` (PKCE S256 recommended for all app types; client secret required for web apps); refresh tokens only with `offline_access`, no fixed lifetime (https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow). `GET /me/messages?$filter=receivedDateTime gt …&$orderby=receivedDateTime asc&$select=id,receivedDateTime,from&$top=50` (order-by property first in the filter; follow `@odata.nextLink`) and `GET /me/messages/{id}/$value` for the MIME (https://learn.microsoft.com/en-us/graph/api/user-list-messages, …/message-get).
- **App registration:** supported account types "Any Entra ID Tenant + Personal Microsoft accounts" (`AzureADandPersonalMicrosoftAccount`, max two client secrets). Free.
- **Not verified:** `$filter` on sender address on the list endpoint (Pointwise filters by sender client-side after reading only the envelope), the well-known `inbox` folder name, delta-query behaviour for personal accounts (not used), client-secret lifetime options, and tenant policies that can block user consent in some work accounts. Microsoft has no token-revocation endpoint for this flow: remove access at account.microsoft.com.

### Setup (all free)
1. **Redirect URI** to register with both providers: `<APP_URL>/api/v1/mailboxes/oauth/callback` (shown on the Spending page; for local use `http://localhost:3000/api/v1/mailboxes/oauth/callback`).
2. **Google:** Google Cloud console → new project → enable the Gmail API → OAuth consent screen (user type *External*; publishing status per above, add yourself as a test user for *Testing*) → Credentials → OAuth client ID, type *Web application* → add the redirect URI → copy the client id and secret to `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
3. **Microsoft:** Entra admin center → App registrations → New registration, accounts "any tenant + personal", platform *Web* with the redirect URI → Certificates & secrets → new client secret → `MICROSOFT_OAUTH_CLIENT_ID` / `MICROSOFT_OAUTH_CLIENT_SECRET`; API permissions: delegated `Mail.Read`, `offline_access`, `User.Read`.
4. Restart the stack; the Spending page then enables **Connect Gmail** / **Connect Outlook**.

### Security design
The consent `state` is AES-GCM sealed (user id, provider, PKCE verifier, 10-minute expiry), so a callback cannot be forged, replayed for another user, or used after it expires. Only the refresh token is stored (encrypted with `TOKEN_ENC_KEY`); access tokens are requested per sync and never saved; rotated refresh tokens replace the stored one. Messages are read-only, senders are filtered before any body is read where the API allows (Graph reads the envelope first; Gmail filters server-side with `from:`), bodies are processed in memory and never stored, and nothing is sent to an AI provider.
