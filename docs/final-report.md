# Final Report — CardPointers Analysis & PointWise Web Recreation

Date: 2026-11-21 (portfolio revision 2026-11-22, AI platform 2026-11-23, privacy boundary + card knowledge base 2026-11-24, recommendations/travel/streaming/evals/operations 2026-11-25) · Target: CardPointers 8.1.4 (build 20261019), Mac Catalyst, `com.getcardpointers.app`

## 1. Executive summary

The CardPointers macOS app was analyzed statically: entitlements, binaries, 3,262 Swift types, Codable models, the Core Data store, resources, and network endpoints. It is a SwiftUI Catalyst app backed by a REST API at `api.cardpointers.com`. A 24-entity Core Data model is seeded with an offline card catalog. Its core value is a simple, recoverable rule: **best card = max(multiplier × cents-per-point)** per category or merchant, layered with offer tracking, welcome-bonus and renewal tracking, and heavy Apple-platform integration (Siri/App Intents, widgets, Watch, CarPlay, AR, Apple Intelligence). Its "Offer Sync" feature automates the user's bank websites on-device.

A functionally equivalent, original web product, **PointWise**, was designed and built: NestJS + Prisma + PostgreSQL API, BullMQ worker, and a Next.js 15 + TanStack Query + NextAuth frontend, all dockerized. The whole stack was validated in Docker: backend unit 155/155, backend integration 34/34, frontend unit 28/28, Playwright E2E 36/36 (5 consecutive green runs) and Cypress 22/22. Running the full stack uncovered and fixed 5 application bugs (see §8).

**AI platform.** PointWise now has a provider-agnostic AI layer (Claude, OpenAI, Azure OpenAI, Gemini, Grok, Mistral, DeepSeek, OpenRouter, Ollama, plus an offline demo model) with failover, a circuit breaker, per-user budgets and a usage/cost ledger. An assistant with 10 specialised agent profiles answers questions such as "What is my current 5/24 status?" by calling 12 tools over the deterministic engines, so the numbers come from PointWise data, not the model. Changes the assistant proposes run only after the user confirms. PointWise is also an MCP server, so users' own AI apps can read their portfolio with a personal access token. Admins can register external MCP servers; a tool is usable only after approval, and approval lapses if the tool's definition changes. **Privacy rule (2026-11-24): no AI provider receives users' card data.** Tools are classed PUBLIC (catalog) or USER; when a question needs the user's cards, benefits, 5/24 or household, PointWise runs the tool and writes the answer itself, and that turn is never sent to the model. The MCP server serves only the public catalog. **Card knowledge base (Phase C):** admin-registered issuer pages are fetched politely (allow-list, robots.txt, conditional GET), fields are extracted deterministically and, when a model is configured, by AI with verbatim evidence quotes that are checked against the page; every change is a proposal an admin approves, and approvals write a versioned offer history (e.g. "40K → 50K → 60K") with elevated-offer alerts. **Phases D and E:** a deterministic next-card scorer ranks catalog cards per household member by first-year and ongoing value, 5/24 impact and confidence, and answers "who should apply" (a 5/24-enforcing issuer's card goes to a member under 5/24; other cards to a member already over it, so no slot is used); the explanation is written by PointWise, not the AI. Travel adds transfer partners with bonuses, member balances, the best use of each balance and an award planner that respects household pooling. The assistant streams its answers; a 15-question grounding eval set gates CI (real models are opt-in), live provider smoke tests are opt-in, and admins get an operations page. Phase F added approval odds from an optional self-reported credit band, transfer-bonus alerts, and fine-print search over public card terms (database full-text search, no AI). Validated in Docker: backend unit 428, integration 116, frontend 53, Playwright 61, Cypress 37, evals 16/16.

**Portfolio & benefits revision.** PointWise was then extended into a card-portfolio and benefits tracker: households (members, separate and combined portfolios, children limited to authorized-user cards), a benefit tracker with period-aware credits (monthly to every-4-years, calendar or cardmember year), period-scaled expiry alerts over in-app, email and web push, a full per-person Chase 5/24 engine (AU cards, business cards from issuers that report them, month-precision dates, next-slot date, projection), portfolio value analytics (net, effective value, return on spend, break-even spend), spreadsheet/CSV import with preview and duplicate/closed/AU detection, a Plaid sandbox bank connector, and credit-report open-date entry. Direct issuer APIs and Credit Karma are not available to third parties, and Experian requires a partnership; this is documented in docs/bank-and-bureau-feasibility.md. Validated in Docker with 9 services: backend unit 296, integration 51, frontend 38, Playwright 44, Cypress 28. Review and decisions: docs/portfolio-revision-review.md.

## 2. Key findings

1. **Architecture:** SwiftUI + `ObservableObject` stores (`WalletStore`, `OffersStore`, `PointersStore`…), a shared `CardPointersShared` module (models + Core Data) used by 3 extensions and 2 login-item helpers through app groups.
2. **Data model:** CardParent→{Card, Inventory}, OfferParent→{Offer, OfferInventory}, PointerParent→{Pointer, Merchant, Subcategory}, PointerCard (earn rates), BonusPlan/BonusCategoryGroup (rotating categories), UserProfile (household), OfferSync* (bank automation).
3. **Business rule recovered from data:** `total_value = points × card.value` (e.g. 4X × 2.0¢ = 8.0).
4. **API:** ~48 REST paths (Bearer token, serialized 401→refresh→retry, `since` / `since_id` delta sync). Auth options: passkeys (default), Sign in with Apple, and email code. No GraphQL or WebSockets.
5. **Third parties:** RevenueCat (subscriptions), PostHog (analytics/session replay, crash reporting).
6. **Security posture (binary):** Hardened Runtime, sandbox, no debug artifacts. The bank-automation scripts are obfuscated JS; bank credentials are stored in the Keychain on-device.

## 3. Reverse-engineering results (deliverables)

| Artifact | Location |
|---|---|
| Environment audit | docs/environment-audit.md |
| Inventory, signing, entitlements | docs/application-inventory.md |
| Static & Swift analysis (+ parsers, UML) | docs/static-analysis.md, docs/swift-analysis.md |
| Resources | docs/resources.md |
| Network + observed OpenAPI (48 paths, 42 schemas) | docs/networking.md, api/cardpointers-observed.openapi.json |
| Storage + ER | docs/storage.md |
| Features (30) + flows (9) + PRD | docs/features.md, docs/user-flows.md, docs/prd.md |
| Raw evidence | raw/ (strings, dylibs, entitlements, swift-types.tsv, swift-fields.tsv, coredata-model.txt, seed-schema.sql) |

Limits: static only. No runtime instrumentation (App Store signing blocks attach), no live traffic capture (would require a real account), and the obfuscated bank JS was characterized only at the behavior level.

## 4. Architecture overview (PointWise)

Browser → Next.js (pages, NextAuth, same-origin `/api/v1` proxy) → NestJS API (guards, validation, domain services) → PostgreSQL. API and worker share Redis (BullMQ) for scheduled jobs; email goes through SMTP (MailHog in dev). See docs/web-architecture.md for system, container, sequence, data-flow and ER diagrams (29 Mermaid diagrams also exported to diagrams/). Since the revision, background work runs in three processes of the backend image: `worker` (jobs), `scheduler` (cron registration) and `notification-service` (email/push delivery with retries). Compose runs 9 services: frontend, backend, worker, scheduler, notification-service, postgres, redis, mailhog, pgadmin.

## 5. Feature inventory (web)

Auth (email/password, Google, Apple, reset) · card catalog search · wallet (status, dates, last 4 only, nickname, rotating category activation, pins, valuations) · best card per category/merchant · nearby stores (geolocation) · offers (eligible, custom, partial use, redeem, snooze, favorite, sorting) · reward calculator + new-card comparison · dashboard (stats, best cards, expiring, bonuses, renewals, 5/24) · notifications (in-app + email digest, preferences) · subscriptions (Free/Pro, mock billing provider) · household profiles · keyword offer alerts · admin portal (stats, users/roles, catalog CRUD with audit log, job runner) · GDPR export and delete.
Portfolio revision: card portfolio (active/AU/closed) with value analytics per card, cardholder and household · benefit tracker (templates, custom, usage log, available/expiring/completed/missed) · benefit expiry alerts (in-app, email, web push) · per-person 5/24 with timeline · households · spreadsheet/CSV import · Plaid sandbox connector · credit-report tradelines.
Deliberately **not** replicated: bank Offer Sync automation, plus native-only features (widgets, Watch, CarPlay, AR, Siri).

## 6. API inventory

192 operations across 154 paths after Phase F (`api/openapi.json`; plus the MCP endpoint `/mcp`, Swagger UI `/api/docs`). Contract details, error model, permission matrix and a CardPointers→PointWise endpoint mapping are in docs/api-spec.md.

## 7. Database design

27 Prisma models (User, OAuthAccount, RefreshToken, PasswordResetToken, Profile, Issuer, RewardCurrency, CreditCard, CardFeature, Category, Merchant, Location, Reward, Wallet, WalletCard, UserValuation, CategoryPin, Offer, UserOffer, OfferAlert, Transaction, Subscription, Notification, NotificationPreference, AnalyticsEvent, AuditLog, …). Initial SQL migration: 26 tables, 42 indexes. The portfolio revision migration adds 12 tables: Household, BenefitCategory, Benefit, UserBenefit, BenefitUsage, BenefitNotification, PushSubscription, CardImportJob, ImportRow, BankConnection, CreditReportAccount and FiveTwentyFourSnapshot. It also extends WalletCard (open-date precision, credit limit, 5/24 exclusion, source), Issuer, Profile and CreditCard (private `ownerId`), for 38 models in total. Seed: a fictional demo catalog (5 issuers, 12 cards, 16 categories, 15 merchants, 10 locations, 8 offers) plus demo and admin users.

## 8. Test coverage

| Suite | Tests | Result | Coverage |
|---|---|---|---|
| Backend unit (Jest) | 354 | ✅ pass (in Docker) | domain **99.4 % lines** overall; new engines (5/24, benefits, portfolio, import) **97–100 %** (≥ 95 % gate) |
| Backend integration (Jest + Supertest + Postgres) | 78 | ✅ pass (in Docker) | **88.2 % lines** of the backend (provider code without keys is covered by unit tests with fakes) |
| Frontend unit (Vitest) | 42 | ✅ pass | **96.6 % lines** of unit-scope modules |
| Playwright E2E (+ axe a11y, mobile smoke) | 50 | ✅ pass, 2 consecutive runs after fixes | P0 journeys incl. 5/24, portfolio, benefits, household, import |
| Cypress E2E | 31 | ✅ pass, 2 consecutive runs | + 5/24, households, benefits, import |
| Test-case catalog | 261 cases | 253 mapped to automation | tests/test-cases, tests/{524,benefits,households,imports} |

**Docker validation (docs/docker-validation.md):** passed after relocating Docker Desktop's disk image off the full internal disk. Bugs found by the full-stack run and fixed: (1) pages that queried before the session existed spun forever; (2) invalid list markup on the category page (axe); (3) 429 responses were never retried; (4) NextAuth's server-to-server login/refresh shared one global rate-limit bucket for all users (would sign users out at ~500 active users), now limited per real client IP via a trusted-header guard; (5) stale unread badge after "mark all read". Password reset was verified end to end through MailHog (link works once, then 401; expired tokens 401).

**Revision validation:** two more bugs were found and fixed. Benefits on a card opened mid-year counted earlier months as "missed". New accounts' primary member was created with relationship OTHER instead of SELF. Two test-design issues were fixed: integration-test jobs leaked into the running stack's queue (now isolated on Redis DB 1), and a date-dependent Cypress assertion. Axe findings on the new pages were also fixed (low-contrast grey text, a non-focusable scroll region).

## 9. Security findings

0 open High. Fixed during the review and validation: the shared rate-limit bucket for NextAuth server calls (per-client-IP guard, integration-tested); 3 dependency vulnerability groups (nodemailer, Prisma transitive, postcss in Next) are now at 0 `npm audit` findings; the admin partial-update bug; the internal OAuth exchange was exposed through the public proxy (now excluded). Open Medium items: OAuth exchange relies on a shared secret, and the API port is published in dev compose (M-1, partial); no email verification (M-2); CSP `unsafe-inline` (M-3); no per-account lockout, MFA or passkeys (M-4). Details: docs/security-review.md. The revision added these controls: upload limits; refusal of full card numbers (never stored or echoed); private user-created cards hidden from the catalog; AES-256-GCM encryption of bank tokens; an SSRF allow-list for web-push endpoints; owner scoping on every new resource; an atomic import commit; and a GDPR export extended to the new data. New dependencies have 0 audit findings. New low residuals: L-7 (Plaid Link CSP and production review) and L-8 (tradeline data handling). The AI platform added controls aligned with the OWASP Top 10 for LLM applications: consent before any provider call, data minimisation, confirmation before any write, write-only encrypted keys, budgets and rate limits, an SSRF policy and approval pinning for MCP, and token-scoped MCP access. New residuals: L-9 and L-10; M-5 (third-party LLM processing of user data) is closed because no user card data reaches an AI provider. Phase C fetches only allow-listed https issuer domains, honours robots.txt, re-validates every redirect hop, caps page size, treats page text as untrusted data (a prompt-injection fixture is tested) and publishes nothing without admin approval.

## 10. Recreation feasibility

| Area | Feasibility | Notes |
|---|---|---|
| Core value (best card, offers, bonuses, renewals, 5/24, calculator) | **High** — done | Pure, tested domain engine |
| Catalog breadth (5,000+ cards) | **Medium** | The main ongoing cost is curation. Must be sourced independently, never copied from CardPointers' bundled database. |
| Nearby | High | Needs a places provider for real POIs |
| Notifications | High — done | In-app, email, web push (VAPID) via notification-service |
| Portfolio, benefits, 5/24, households, spreadsheet import | **High — done** | Pure tested engines + API + UI |
| AI assistant, multi-provider, MCP | **High — done** | Tools over deterministic engines; offline demo model for keyless installs |
| Live card/offer database | **Medium** | No issuer APIs; admin-reviewed AI extraction built (Phase C) — data freshness depends on registered sources and admin review |
| Bank discovery (15 issuers) | **Medium** | Only through an aggregator (Plaid adapter built, sandbox); production needs a contract; open dates/fees not provided |
| Credit Karma / Experian | **Low / partnership-only** | No public API (Credit Karma); FCRA + business agreement (Experian). Manual tradeline entry implemented |
| Subscriptions | High | Stripe replaces RevenueCat |
| Offer Sync (bank automation) | **Low / not recommended** | Credential handling and bank ToS risk; offer manual + CSV + browser extension instead |
| Siri/Widgets/Watch/CarPlay/AR | N/A on web | PWA + browser extension partially compensate |

## 11. Estimated effort

≈ **44 engineer-weeks** total (≈ 6 months, 2 engineers), plus the portfolio revision (≈ 6–8 ew of product scope, delivered here as a working vertical slice) and its follow-ups (≈ 11–13 ew: Plaid production, curated benefit catalog, bureau partnership, push polish, benefit auto-detection). Phase 1 MVP ≈ 8 ew, of which ~60 % is delivered as working code in this project. See docs/roadmap.md.

## 12. Risks and constraints

Catalog accuracy and upkeep; user expectation of automatic offer sync; legal/trademark care around issuer programs; web location accuracy; payments compliance; security of finance-adjacent PII. Environment constraint observed: the host disk is near full.

## 13. Recommendations / implementation order

1. ~~Unblock Docker, run the containerized test plan~~ (done). Import your own tracker workbook through `/import` and check the preview against the sheet totals.
2. Close M-1 (don't publish the API port in prod; verify id_tokens) and M-2 (email verification); add the CI pipeline.
3. Build catalog curation tooling and curate the first 500 cards **with benefit templates** (feeds the benefit tracker automatically).
3a. Apply for Plaid production and embed Link; decide on a credit-bureau partnership.
4. Stripe billing; then a places provider for Nearby.
5. Redis caching + k6 load tests before beta.
6. Passkeys, nonce CSP, PWA push, browser extension.
7. Scale work (PostGIS, partitioning, replicas) as metrics demand.

## 14. Future enhancements

Ask-my-wallet assistant (LLM with tool calls over the recommendations API) · statement CSV import with automatic category spend profiles · issuer-approved offer APIs · international catalogs · benefit usage auto-detection from transactions · public SEO card pages.
