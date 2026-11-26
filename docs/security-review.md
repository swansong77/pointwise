# Phase 21 — Security Review (OWASP Top 10:2021)

Scope: (A) the **PointWise** web application built in this project, reviewed against the source and the test evidence; (B) brief observations on the **analyzed CardPointers binary** from static analysis.
Review date: 2026-11-21. Method: code review, automated tests (unit, integration, E2E security cases), `npm audit`, REA release-exposure audit.

## Summary

| Severity | Open | Fixed during review |
|---|---|---|
| High | 0 | 3 (dependency CVEs: nodemailer; Prisma transitive deepmerge-ts/effect; postcss via Next) |
| Medium | 4 | 3 (admin PATCH accepted only full objects → partial DTOs; all users shared one auth rate-limit bucket via NextAuth server calls → per-client-IP guard) |
| Low | 10 | — |

## A. PointWise — OWASP Top 10

| # | Category | Controls in place | Evidence | Residual risk |
|---|---|---|---|---|
| A01 | Broken Access Control | Global JWT guard (deny by default, `@Public` opt-out); `RolesGuard` on `/admin/*`; ownership checks on every user-owned row (`assertOwned`, `ownedUserOffer`, `userId` filters); Next middleware blocks `/admin` for non-admins | INT: IDOR wallet/offers/filters → 403; admin 403; PW-AUTH-08 | **M-1** (below) |
| A02 | Cryptographic Failures | argon2id passwords; refresh tokens 384-bit random, stored as SHA-256; reset tokens hashed, 1 h, single use; JWT HS256 with ≥ 32-char secrets; HTTPS required in prod (HSTS via helmet) | auth.service.spec | **L-1** HS256 shared secret → move to RS256/EdDSA with key rotation (KMS) |
| A03 | Injection | Prisma parameterized queries (one `$queryRaw` tagged template: `SELECT 1`); class-validator whitelist; URL fields restricted to http(s) | INT: `javascript:` URL → 400 | — |
| A04 | Insecure Design | Business rules centralized in pure domain code; plan limits server-enforced; no storage of PANs (only `lastFour`, regex-validated) or bank credentials; location never persisted | unit + INT + PW-WAL-02 | **M-2** no email verification for password sign-ups |
| A05 | Security Misconfiguration | helmet (API); CSP, XFO DENY, nosniff, Referrer-Policy, Permissions-Policy (web); `poweredByHeader:false`; Swagger toggle; non-root containers; healthchecks | PW-SMK-03 | **M-3** CSP allows `'unsafe-inline'` scripts (Next.js inline bootstrap) → nonce-based CSP. **L-2** compose ships dev default secrets (must be overridden; `.env.example` says so) |
| A06 | Vulnerable Components | `npm audit --omit=dev`: **0** after fixes (nodemailer 6→10; Prisma pinned 6.12.0; postcss override ^8.5.33 for Next 15) | audit output in docker-validation.md | **L-3** keep Renovate/Dependabot + CI audit gate |
| A07 | Identification & Auth Failures | Generic login errors; dummy-hash verify for unknown users; rate limiting (10/min/IP on `/auth`); refresh rotation with **reuse detection → family revocation**; logout revokes family; password reset revokes all sessions; NextAuth cookie httpOnly + encrypted | INT refresh reuse; unit | **M-4** no per-account lockout or MFA/passkeys (IP-based limits only; credential stuffing from many IPs). **L-4** access token readable by browser JS via `useSession()` (needed for client fetches) |
| A08 | Software & Data Integrity | Lockfiles + `npm ci`; pinned base images; migrations reviewed SQL; admin changes audit-logged | AuditLog INT | **L-5** no image signing / SBOM yet |
| A09 | Logging & Monitoring Failures | Exceptions logged server-side (no stack traces in responses); refresh-reuse warnings; audit log; analytics events | filter + INT | **L-6** no central log shipping/alerting (Scale phase: OTel + alerts on reuse and 401/403 spikes) |
| A10 | SSRF | No server-side fetches of user-supplied URLs (offer `url` stored only; OAuth endpoints fixed by NextAuth providers) | code review | — |

### Open findings

| ID | Sev | Finding | Recommendation |
|---|---|---|---|
| M-1 | Medium (partially mitigated) | `POST /auth/oauth` trusts the caller after checking a shared secret. If `INTERNAL_API_SECRET` leaks, anyone who can reach the API can mint tokens for any email. **Mitigated during review:** the Next.js rewrite now excludes `auth/oauth`, so browsers get 404 through the public origin (regex verified; E2E PW-SMK-04). Still open: in the dev compose file the API is also published directly on :4000. | In production, do not publish the API port (only the frontend/edge is public); additionally verify the provider `id_token` signature server-side instead of relying on a shared secret alone. |
| M-2 | Medium | Password sign-ups are not email-verified, so a user can register someone else's email (that address is later linked by OAuth email matching). | Require email verification before OAuth-by-email linking; send a verification mail on register. |
| M-3 | Medium | CSP `script-src 'unsafe-inline'`. | Next.js middleware nonce + `strict-dynamic`. |
| M-4 | Medium | No account-level throttling, MFA or passkeys (the analyzed app defaults to passkeys). | Exponential backoff per account (Redis), WebAuthn passkeys (roadmap Phase 3). |
| L-1…L-6 | Low | See table above. | — |

### Fixed during review
0. **Shared rate-limit bucket (Medium, found during Docker validation):** NextAuth calls `/auth/login` and `/auth/refresh` from the frontend server, so every user shared that server's IP bucket — a global login/refresh denial of service at modest load. `ClientIpThrottlerGuard` now tracks trusted calls (`x-internal-secret`, constant-time compared) by the forwarded `x-client-ip`; `x-client-ip` from untrusted callers is ignored (no spoofing); only refresh/logout without a client IP are exempt (login never). Covered by `throttler.guard.spec.ts` and `rate-limit.int-spec.ts`. Requirement: the edge proxy must overwrite `X-Forwarded-For`.
1. **Dependency CVEs (High):** nodemailer ≤ 10.1.3 (interpretation conflict) → 10.6.1; `@prisma/config` → deepmerge-ts / effect (DoS) → Prisma CLI + client pinned to 6.12.0 (outside the affected range); postcss < 8.5.23 bundled in Next 15 (XSS in stringify) → `overrides` to ^8.5.33 (verified `npm ls`, build and tests green).
2. **Admin partial updates (Medium):** PATCH routes validated against full create DTOs, so admins sent full objects and risked overwriting fields. Now use `PartialType` (integration test added).

### Portfolio revision (2026-11-22)

| Area | Control | Evidence |
|---|---|---|
| Uploads | ≤ 5 MB (multer limit → 413), 1 file, `.xlsx`/`.csv` only, ≤ 20 sheets / 5 000 rows; formulas never evaluated (cached values); CSV parser is linear-time | INT import rejection cases, unit `readUpload` |
| Card numbers | "last digits" > 5 digits → row error, value discarded, never echoed back | INT (`not.toContain('4111…')`), CY-IMP-01 |
| Personal data in imports | processed at runtime only; the owner's workbook is not in seed/fixtures/logs/docs | excel-import-design.md |
| Private cards | user-created cards carry `CreditCard.ownerId`; catalog search and detail exclude them | INT (search 0 results, detail 404) |
| Bank tokens | AES-256-GCM, random IV, auth tag, key from `TOKEN_ENC_KEY`; never returned by the API; provider errors → 502 with code only | unit `connections.spec` |
| SSRF (web push) | server POSTs only to HTTPS browser push services (FCM, Mozilla, WNS, Apple), no custom ports | unit allow-list table |
| Object-level access | households, members, benefits, usage, imports, tradelines, connections all owner-scoped | INT IDOR cases |
| Concurrency | import commit claims the job inside one transaction (double-commit → 409); SELF member creation uses an advisory lock | INT |
| Queues | test jobs isolated on Redis DB 1 | docker-compose.yml |
| Dependencies | `exceljs` 4.4.0 (uuid override → 11.1.1), `web-push` 3.6.7; `npm audit --omit=dev`: 0 | audit run |

New residual risks: **L-7** Plaid production needs the Link widget (CSP exception for `cdn.plaid.com`) and a data-handling review; **L-8** credit-report tradelines are consumer-report-like data — keep them out of analytics/logs (GDPR export now includes household, benefits, imports, tradelines and connection metadata; delete cascades).

### AI platform & MCP (2026-11-23)

| Risk (OWASP LLM Top 10 / API) | Control | Evidence |
|---|---|---|
| LLM01 Prompt injection (offer text, MCP results) | tool results labelled as data in the system policy; external MCP output prefixed "untrusted"; only read-only external tools attachable; writes become pending actions confirmed by the user | U runtime, INT actions |
| LLM02 Sensitive information disclosure | **policy: no AI provider receives user card data** — user-data tool results answered server-side and never sent to the model, private turns never replayed, card numbers/emails redacted from questions, MCP server limited to public catalog; plus opt-in consent | INT provider-spy test, U privacy/runtime |
| LLM03/LLM05 Supply chain & tool poisoning | admin-only MCP registry; tools disabled by default; approval pinned to a SHA-256 of name+description+schema — changes require re-approval | INT approval/changed, U hash |
| LLM06 Excessive agency | per-agent tool allow-lists (validated on update); max steps and tokens; no autonomous writes | INT agent validation, U maxSteps |
| LLM10 Unbounded consumption | per-user monthly token budget (429), per-IP AI rate limit, usage + cost ledger and admin dashboard | INT budget, admin usage |
| SSRF via MCP / provider URLs | MCP: https or `MCP_ALLOWED_HOSTS`, metadata/link-local blocked, no credentials in URL, no redirects; provider base URLs admin-only | U URL policy, INT |
| Secrets | provider keys and MCP secrets AES-256-GCM, write-only, excluded from audit diffs; or env vars; tests delete provider keys | INT key handling |
| Broken object-level auth | conversations, pending actions, tokens owner-scoped; MCP tools run as the token's user | INT IDOR, MCP scope |
| MCP authentication | personal access tokens: 256-bit, SHA-256 at rest, scope `mcp:read`, expiry, revocation, session JWTs rejected | U tokens, INT 401 cases |

New residual risks: **L-9** a malicious approved MCP server can still return misleading data (mitigated by labelling and read-only; keep the registry small); **L-10** model answers can be wrong even with grounded tools — answers show the data used and a disclaimer; **M-5 (closed 2026-11-23)** — user card data is no longer sent to LLM providers; only the user's (redacted) question and public catalog data are.

### Phases D/E (2026-11-25)

| Area | Control | Evidence |
|---|---|---|
| Next-card scorer and travel (user data) | member ids checked against the caller's household (404 otherwise); balances owner-scoped; assistant tools `recommend_next_card`, `get_transfer_options`, `plan_award` are USER data — answered by PointWise, never sent to a model; only `get_transfer_partners` (public catalog) may reach a model or the MCP server | INT scoping, provider-spy test incl. the new tools, MCP tool list |
| Balance integrity | one target per row (DB check constraint) + partial unique indexes per member and currency/program; points 0–100 M validated | migration, INT |
| Admin curation | programs and partners admin-only, validated codes, audited; cash back cannot be a transfer source | INT |
| Streaming endpoint | same guards as `/ai/chat` (JWT, consent, budget, AI rate limit, validation); errors are events without internals; truncated tool calls (`max_tokens`) are never executed; streamed Claude tool inputs are validated by the tool handlers | INT stream cases, U runtime |
| Eval / live tests | real models only with `EVAL_LIVE=1` / `LIVE_AI_SMOKE=1`; live smoke sends synthetic text only | script guard, skipped suite |
| Credit report import | owner/member-scoped; report PDF parsed only in the sandboxed extractor; file/text discarded; only card-account facts stored; no AI, no Credit Karma login or scraping | INT ownership, validation |
| Inbound alert email (Phase H) | public endpoint needs `X-Inbound-Secret` (constant-time); unguessable per-user address (96 bits), rotatable, pausable; issuer sender allow-list; DKIM/DMARC verdict trusted only from our own receiver's Authentication-Results; bodies/attachments never stored (parsed facts 90 days); PDFs via sandboxed extractor; no AI | U parser/auth, INT secret, forged/failed sender, rotation |
| Plaid webhook | ES256 JWT verified with Plaid's key (cached), ≤ 5 min, SHA-256 of raw body must match; unknown items ignored; CSP allows only cdn.plaid.com script/frame + Plaid API hosts (closes L-7 CSP part) | U forged / stale / wrong alg / body mismatch |
| PDF statements (Phase H) | untrusted PDFs parsed only in a child process (pdfjs eval disabled, 256 MB heap, 20 s timeout, output cap, empty env, 40 pages, 10 MB upload); file and text discarded; only parsed rows stored; digit runs ≥ 8 removed; no AI | U extractor limits, INT broken / scanned PDFs |
| Spend tracking (Phase H) | owner-scoped (wallet card ownership on every route; other users 404); statement upload ≤ 2 MB, .csv only, parsed as data (no formulas), 5,000 rows; dedupe by bank id / content hash; transactions never sent to AI providers; Plaid access token stays encrypted, transactions product only adds read access | INT ownership + validation, U parser |
| Research lead sites (Phase G) | Doctor of Credit / The Points Guy / MileMoa readable for discovery only (`CARD_RESEARCH_LEAD_DOMAINS`); never accepted as product URL or evidence; only link + title stored (no third-party text); facts still checked on issuer pages | U lead filtering, INT lead fact dropped and no lead text stored |
| Card-research agent (Phase G) | admin-only; Claude server tools restricted with `allowed_domains` to the issuer's domain / issuer allow-list; product URLs re-validated; PointWise re-fetches pages (robots.txt) and drops facts whose quote is not on the page or does not state the value; page text treated as data, agent has no write tools; approval required (atomic claim, audit log); only issuer/card names sent to the model; bounded searches/fetches/turns per run | U normalise/verify, INT off-domain drop, injection text, override needed |
| Fine-print search (Phase F) | public catalog only (private/inactive cards excluded); `$queryRaw` tagged template with bound parameters (`websearch_to_tsquery` never raises on user syntax); query ≤ 200 chars; snippets rendered as text (no HTML) | INT injection-shaped query, U `highlightParts` |
| Credit band (Phase F) | self-reported, optional, owner-scoped, used only by the scorer; never sent to an AI provider or bureau | INT, privacy rule |
| Operations endpoints | admin-only; return no keys, secrets or user identities; job failure reasons truncated | INT (no `apiKeyEnc`/password in body), PW-OPS-02 |

### Session security details

| Property | Value |
|---|---|
| Web session cookie | NextAuth `__Secure-next-auth.session-token` (prod), httpOnly, SameSite=Lax, encrypted JWE |
| Access token | 15 min JWT `{sub,email,role,typ:'access'}`; `typ` checked to prevent refresh/other-token confusion |
| Refresh token | 30 days, opaque, rotation + reuse detection, revoked on logout/password reset |
| CSRF | API uses Bearer headers (no ambient cookies) → not CSRF-able; NextAuth endpoints use its CSRF token |

### Secrets management
Env vars only; `.env` files git-ignored via `.dockerignore`; nothing baked into images (verified Dockerfiles). Production: inject from a secret manager (AWS Secrets Manager / Doppler / Vault), rotate the JWT and internal secrets quarterly, and use separate secrets per environment.

### API security checklist
✅ input validation (whitelist) · ✅ output envelope without internals · ✅ pagination caps (≤100) · ✅ body size defaults (Express 100 KB) · ✅ rate limits · ✅ CORS allowlist · ✅ authZ on every route · ✅ IDs are UUIDv4 (non-enumerable) · ⏳ request IDs / tracing · ⏳ WAF.

## B. Observations on the analyzed CardPointers binary (static)

| Observation | Assessment |
|---|---|
| Hardened Runtime, App Sandbox, `get-task-allow=false`, App Store signature | Good. Blocks debugger attachment. |
| ATS: `NSAllowsArbitraryLoads=false`; exception for `localhost` with TLS 1.1 minimum and insecure HTTP | Low risk (localhost only), but probably a leftover development exception. |
| Bank credentials stored on-device in the Keychain for Offer Sync; automation via injected, obfuscated JS in WKWebView | Keeps credentials off the server, but the design depends on scraping bank UIs (fragile, and against bank ToS). Obfuscation is not a security control. |
| Analytics SDK (PostHog) with session-replay capability in a finance app | Privacy review recommended: ensure replay masks financial data. |
| Build path containing the developer's home directory embedded via a vendored C file | Minor information disclosure. |
| REA release-exposure audit: no debug companions or source maps, no credential markers found | No exposure observed in assessed checks (does not prove security). |
