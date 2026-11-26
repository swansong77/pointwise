# Phase 10 — Product Requirements Document: **PointWise** (web)

> Working name **PointWise**. This is an original web product inspired by the *functional category* the analyzed app belongs to (credit-card rewards optimization). It must not reuse CardPointers' name, branding, assets, card catalog data, scripts, or backend APIs. Its catalog is curated independently.

## 1. Vision

Help everyone use the right card every time: one place to track the cards you hold, see the best card for any store or category, and never let a card-linked offer, credit, or welcome bonus expire unused.

**North-star metric:** dollars of value captured per active user per month (bonus value + offer savings).

## 2. Personas

| Persona | Description | Needs |
|---|---|---|
| **Newcomer Nora** | 2–3 cards, cash-back focused | Simple "which card here?", no jargon |
| **Optimizer Omar** | 10–25 cards, travel points | Rotating categories, 5/24, welcome bonus deadlines, offer tracking at scale |
| **Household Hana** | Manages cards for self + partner (P2) | Profiles, combined dashboard, per-person offers |
| **Small-biz Sam** | Business + personal cards | Business card filtering, spend categories |
| **Admin Ada** | Internal catalog editor | Fast CRUD for cards, earnings, offers, merchants; audit trail |

## 3. Use cases

1. UC-01 Sign up / log in (email+password, Google, Apple) and recover account.
2. UC-02 Add cards to wallet from catalog search; add a custom card when missing.
3. UC-03 Ask "which card for groceries / at Costco?" and get a ranked answer with value in ¢/$.
4. UC-04 See nearby stores with the best card for each (browser location).
5. UC-05 Track offers per card: add, mark used/redeemed, snooze, favorite, see expirations.
6. UC-06 Track welcome bonus progress and deadline; annual-fee renewal reminders.
7. UC-07 Compute wallet value and compare a new card with the reward calculator.
8. UC-08 Receive notifications (in-app + email) for expiring offers, renewals, alerts.
9. UC-09 Subscribe to Pro; manage/cancel subscription.
10. UC-10 Admin maintains catalog and views analytics.

## 4. Features (prioritized)

| ID | Feature | Priority | Release |
|---|---|---|---|
| W-AUTH | Email/password + Google + Apple OAuth, JWT sessions, password reset | P0 | MVP |
| W-CAT | Card catalog with search & filters (issuer, network, type, fee) | P0 | MVP |
| W-WAL | Wallet CRUD (status, dates, nickname, notes, cardholder, profile) | P0 | MVP |
| W-BEST | Best-card engine for categories & merchants | P0 | MVP |
| W-OFF | Offer tracking (catalog + custom), redeem/partial use, snooze, favorite | P0 | MVP |
| W-DASH | Dashboard: best cards, expiring offers, renewals, bonus progress, wallet value | P0 | MVP |
| W-CALC | Reward calculator (spend profile × cards) | P0 | MVP |
| W-NEAR | Nearby offers via geolocation | P1 | Beta |
| W-NOTIF | Notifications (in-app, email digests) & preferences | P1 | Beta |
| W-SUB | Subscription (Free/Pro), Stripe-ready provider abstraction | P1 | Beta |
| W-524 | Chase-style 5/24 counter | P1 | Beta |
| W-ALERT | Offer keyword alerts | P2 | Launch |
| W-PROF | Household profiles | P2 | Launch |
| W-ADMIN | Admin portal (catalog CRUD, users, analytics) | P0 | MVP (basic) |
| W-EXT | Browser extension: best card on merchant sites | P3 | Scale |
| W-AI | Natural-language "ask my wallet" | P3 | Scale |
| **Portfolio revision (2026-11-22)** | | | |
| W-PORT | Card portfolio: active / AU / closed, value per card / holder / household (fees, benefit value, net, effective, return on spend, break-even) | P0 | delivered |
| W-BEN | Benefit tracker: catalog templates + custom, monthly→multi-year periods, usage log, utilization status, missed value | P0 | delivered |
| W-BENALERT | Benefit expiry alerts (period-scaled 90/60/30/7/1), in-app + email + web push | P0 | delivered |
| W-524+ | Full 5/24 engine per person: AU, business-reporting issuers, month precision, exclusions, next-slot date, timeline | P0 | delivered |
| W-HH | Households: members with relationships, separate/combined portfolios, child = AU-only | P1 | delivered |
| W-IMP | Spreadsheet/CSV import with preview, dedupe, closed/AU detection, YTD usage | P0 | delivered |
| W-BANK | Bank discovery via aggregator (Plaid sandbox adapter; production needs contract + Link UI) | P2 | partial |
| **AI platform (2026-11-23)** | | | |
| W-AI-CORE | Provider-agnostic AI layer (Claude, OpenAI, Gemini, Azure, Grok, Mistral, DeepSeek, OpenRouter, Ollama) with failover, budgets, usage & cost | P0 | delivered |
| W-AI-ASSIST | Assistant + 10 agent profiles answering from PointWise data via tools; confirm-before-write | P0 | delivered |
| W-MCP | PointWise MCP server (PAT) + admin MCP client registry with approval pinning | P1 | delivered |
| W-CARDDB | Card master database, admin-reviewed AI extraction refresh, offer history | P1 | delivered |
| W-AI-PRIV | No AI provider (LLM or MCP client) receives user card data; user-data answers composed server-side | P0 | delivered |
| W-RECO | Deterministic next-card scorer (first-year / long-term value, 5/24 impact, confidence, who should apply) with PointWise-written explanations; travel transfer partners, balances and award planner | P1 | delivered |
| W-CREDIT-REPORT | Import card open dates from Experian, Equifax and TransUnion reports (bureau / annualcreditreport.com / Credit Karma PDFs or text), merged across bureaus, for 5/24 | P1 | delivered |
| W-AUTO | Transactions arrive automatically: bank connection (webhook) or forwarded card alert emails; no statement downloads; never bank passwords | P1 | delivered |
| W-SPEND | Track card spending (statements, bank sync, manual) and update each card's benefit tracker automatically from matching purchases and statement credits | P1 | delivered |
| W-RESEARCH | Admin card-research agent (issuer websites only, evidence-checked, approval required) and a real-card catalog marked unverified until confirmed | P1 | delivered |
| W-FINE | Fine-print search over public card terms; transfer-bonus alerts; credit-band approval odds | P2 | delivered |
| W-AI-OPS | Streaming answers, grounding eval set, opt-in live provider smoke tests, admin operations page | P1 | delivered |
| W-BUREAU | Credit-report open dates (manual tradelines + auto-match); bureau APIs need partnerships | P2 | partial |

Details: [portfolio-revision-review.md](portfolio-revision-review.md), [chase-524-engine.md](chase-524-engine.md), [benefits-data-model.md](benefits-data-model.md), [benefit-notification-system.md](benefit-notification-system.md), [household-management.md](household-management.md), [excel-import-design.md](excel-import-design.md), [bank-and-bureau-feasibility.md](bank-and-bureau-feasibility.md).

**Explicit non-goals:** automated login to bank websites / server-side scraping of bank offers (security & ToS risk); storing bank credentials; payment card numbers (PANs) of any kind.

## 5. Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | Users register with email + password (≥ 10 chars, breached-password check optional) or OAuth (Google, Apple). |
| FR-2 | Sessions use short-lived access JWT (15 min) + rotating refresh token (30 days, httpOnly cookie). |
| FR-3 | Catalog search returns results in < 300 ms p95 for 10k cards, supports issuer/network/type/country filters. |
| FR-4 | A user can add the same catalog card multiple times (different holders/profiles). |
| FR-5 | Card status ∈ {APPLIED, APPROVED, DENIED, CLOSED}; only APPROVED cards participate in ranking. |
| FR-6 | Best card = max(effective multiplier × point value ¢). Precedence: user pin > merchant rate > category rate (incl. active rotating/selected bonus within date range) > base "everywhere" rate. |
| FR-7 | User may override a currency's point valuation (¢/pt). |
| FR-8 | Offers have amount type (cash/points/percent), value, min spend, start/end, repeatable (max times), and per-user progress (amountUsed, timesUsed, redeemedAt, snoozedUntil, favorite). |
| FR-9 | Expiring = end date within N days (default 7, configurable). |
| FR-10 | Welcome bonus deadline = approvedAt + bonusMonths; progress = recorded spend / required spend. |
| FR-11 | Renewal date = next anniversary of approvedAt; reminder 30 days prior if annual fee > 0. |
| FR-12 | 5/24 = count of personal cards (any issuer) approved within the last 24 months; show the date the count next drops. |
| FR-13 | Reward calculator: annual value = Σ(category spend × best multiplier × cpp) − Σ annual fees + credits. |
| FR-14 | Nearby: given lat/lng, return merchants within radius r with best card + active offers. |
| FR-15 | Notifications created by scheduled jobs; delivered in-app and via email per preferences. |
| FR-16 | Free tier: up to 5 cards & 20 tracked offers; Pro: unlimited + alerts + profiles + calculator compare. |
| FR-17 | Admins (role ADMIN) can CRUD catalog entities; every change is audit-logged. |
| FR-18 | Users can export their data (JSON) and delete their account (hard delete within 30 days). |

## 6. Non-functional requirements

| Area | Target |
|---|---|
| Availability | 99.9 % monthly (Launch), 99.95 % (Scale) |
| Latency | API p95 < 200 ms for reads, < 400 ms for writes; best-card < 100 ms |
| Frontend | LCP < 2.5 s on 4G, CLS < 0.1, INP < 200 ms |
| Accessibility | WCAG 2.2 AA |
| Browser support | Last 2 versions of Chrome, Safari, Firefox, Edge; iOS Safari 17+ |
| Responsiveness | 360 px → 1920 px |
| Observability | Structured JSON logs, request IDs, metrics (Prometheus), traces (OTel) |
| Test coverage | ≥ 95 % lines on domain services; 100 % critical-path E2E |

## 7. Security requirements

- OWASP ASVS L2. Argon2id password hashing. JWT signed HS256/RS256 with rotation.
- Refresh tokens hashed at rest, rotation with reuse detection.
- RBAC (USER, ADMIN). Object-level authorization on every user-owned resource.
- Rate limiting (auth: 5/min/IP; API: 100/min/user).
- Input validation (class-validator, whitelist), output encoding, CSP, HSTS, secure cookies (SameSite=Lax).
- Secrets from env/secret manager only; no secrets in images.
- Dependency scanning (npm audit/Snyk) and container scanning (Trivy) in CI.

## 8. Privacy requirements

- Collect minimal PII: email, name (optional). **Never** store card numbers, CVV, or bank credentials.
- Location is used per-request and **not stored** server-side (only an optional coarse "home city").
- GDPR/CCPA: data export, deletion, consent for marketing email, cookie consent for analytics.
- Analytics are first-party and pseudonymous; opt-out honored.

## 9. Scalability targets

| Stage | Users | RPS (peak) | Data |
|---|---|---|---|
| MVP | 1k | 20 | 10k cards, 50k offers |
| Launch | 100k | 500 | 1M user offers |
| Scale | 1M | 5k | 50M user offers; read replicas; Redis cache; queue workers horizontally scaled |

## 10. Acceptance criteria (MVP)

- A new user can sign up, add 3 cards, and see the correct best card for 5 categories.
- Offer tracking supports redeem, partial use, snooze; expiring list is correct across time zones.
- Docker Compose brings up the full stack; all unit, integration, and E2E suites pass.
