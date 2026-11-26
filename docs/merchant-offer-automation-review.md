# Merchant offer automation: research and architecture review

Retrieved **2026-11-26** from the issuers' own pages. **VERIFIED** = read on the page. **NOT CHECKED** = not reached or not readable (JS-rendered, or the fetch failed); nothing is filled in from memory. Earlier verified findings are in `offer-activation-research.md` (Chase and Rakuten terms) and `offer-sources-research.md`.

Standing constraints: free only; no card data to AI providers; no real personal data in git. **Decision for this feature (the user's):** build opt-in server-side login connectors, disabled by default, alongside the extension, email and manual sources. This knowingly overrides the earlier "restricted, not built" position for this feature only.

## 1. Per-issuer findings

| Issuer | Offer product | Official public API | Authentication and MFA seen | Enrollment | Automation / credential clause | Status |
|---|---|---|---|---|---|---|
| American Express | Amex Offers | Not seen on the homepage | Not read | Homepage tile "Explore Amex Offers"; the add step is not read | Terms page failed to load ("Parse Error: Header overflow"), so **NOT CHECKED** | Homepage VERIFIED; terms NOT CHECKED |
| Chase | Chase Offers | None seen on the Terms or Security pages | "2-step verification"; "our chase.com website is passkey and password manager enabled"; "mobile app notifications or a one-time code to authenticate you" | Not read (help page not reachable) | "the use of agents, including AI agents or agentic AI, robots, spiders, scripts," is unauthorized entry; "AI Agents must clearly and deterministically label all agentic traffic"; third-party apps must "connect directly with us so you don't give them your Chase password" | Terms and Security VERIFIED; offers help NOT CHECKED |
| Citi | Merchant Offers | NOT CHECKED (homepage is script-rendered, 102 characters returned) | NOT CHECKED | NOT CHECKED | NOT CHECKED | NOT CHECKED |
| Bank of America | BankAmeriDeals | NOT CHECKED | NOT CHECKED | NOT CHECKED | NOT CHECKED | NOT CHECKED |
| Capital One | Capital One Offers | NOT CHECKED | NOT CHECKED | NOT CHECKED | Website terms (07/14/2026) have no bot clause found, per the earlier review | Partial |
| Wells Fargo | Merchant Offers | NOT CHECKED | NOT CHECKED | NOT CHECKED | NOT CHECKED | NOT CHECKED |

Planning assumptions, to be corrected when verified: no issuer publishes a consumer offers API; enrollment is a button on the logged-in offers page; every issuer uses MFA (SMS, app push, authenticator, passkey) on new devices.

## 2. Options

| | Advantages | Disadvantages | Security risk | Maintenance | Automation | Verdict |
|---|---|---|---|---|---|---|
| A. Official API | Permitted, stable | None exist (none found) | Low | Low | High | Adapter slot kept |
| B. Aggregator | Broad | Offers are not in banking aggregators; credential handoff to a third party; paid | High | Low | High | Not used |
| C. Email | Free, no credentials, DKIM-checked | Only what issuers email | Low | Medium | Medium | **Built** (offer-alert mail) |
| D. Extension in the user's own session | No credentials leave the browser; user click | Selectors break; scripted reading may breach terms | Medium | High (selectors as data) | Medium (user-initiated) | **Built** (capture, and user-clicked adds) |
| E. Server-side login connector | Highest automation; household-wide, scheduled | Needs stored credentials; MFA and passkeys cannot be fully automated; terms and detection risk (Chase forbids scripts and requires labelled agent traffic); account-lock risk | **High** | **High** | High | **Built, opt-in, disabled by default** (the user's decision) |
| F. Hybrid | Each source covers the others' gaps; one snapshot and diff pipeline | More parts | Medium | Medium | Highest achievable | **Chosen** |

## 3. Cross-cutting topics

| Topic | Design |
|---|---|
| Authentication | Username and password supplied by the member, encrypted with AES-256-GCM (`common/crypto.ts`, key from `TOKEN_ENC_KEY`), write-only through the API, never logged, never in audit rows, notifications or AI tools. |
| MFA | SMS code, app code and authenticator code are entered by the member when a sync pauses (`NEEDS_MFA`), then the run resumes. Passkeys and device-bound approvals cannot be completed by a server: they are user-assisted (member approves in their own browser or the extension). |
| Session handling | Session and device-trust blobs are stored encrypted with a TTL and are refreshed or discarded on timeout. Repeated failures lock the account's automation until the member re-enables it. |
| Detection risk | Labelled traffic, one account at a time, jittered pacing, a daily cap per account, no parallel logins, backoff on challenges. The risk of an account lock or a terms breach remains and is shown to the member before opting in. |
| Maintenance | Issuer flows are data (entry URL, step selectors) flagged UNVERIFIED; a failing health check marks the account DEGRADED instead of guessing. |
| Offer enrollment | Connector adds, extension click on the user's own click, or a deep-link checklist; every result is re-verified from the next inventory and later from statement credits. |

## 4. Risk register

| Risk | Likelihood | Impact | Control |
|---|---|---|---|
| Issuer terms forbid scripted access (Chase verified) | High | Account action, loss of access | Disabled by default; per-account acknowledgement; labelled traffic; extension and email paths work without it |
| Credential compromise | Low | Severe | Encryption at rest, write-only API, redaction, revoke on disconnect, key from the environment |
| MFA or passkey blocks the run | High | Sync fails | NEEDS_MFA state, user-assisted completion, clear message |
| Selectors change | High | Wrong data | Health check, snapshot sanity checks (count drop > 60% = warning, not applied) |
| Enrolling unwanted offers | Medium | Annoyance | Default mode is recommend only; never-rules win; audit trail |

## 5. Decision

**Hybrid (F).** One snapshot, diff, score, decide and enroll pipeline fed by the extension, email, manual paste and the opt-in connectors. Real issuer connectors are shipped as UNVERIFIED data flows behind `OFFER_CONNECTORS_ENABLED` and a per-account opt-in; everything is exercised end to end against a mock issuer. See ADR-021 to ADR-024.
