# Phase 11 — Web Application Architecture (Pointwise)

## 1. Stack (as built)

| Layer | Technology | Version (resolved) |
|---|---|---|
| Frontend | Next.js App Router, React, TypeScript, Tailwind CSS, TanStack Query | Next 15.5, React 19, TS 5.7, Tailwind 3.4, Query 5 |
| Auth (web) | NextAuth v4 — Credentials, Google, Apple (enabled by env) | 4.24 |
| Backend | NestJS, Prisma ORM, class-validator, Swagger | Nest 11, Prisma 6 |
| Database | PostgreSQL | 16.4 |
| Cache / queue | Redis + BullMQ | Redis 7.4, BullMQ 5 |
| Email | Nodemailer → MailHog (dev) / SMTP provider (prod) | |
| Infra | Docker, Docker Compose | Compose v2 |
| Docs | OpenAPI 3 (Swagger UI at `/api/docs`) | |

## 2. System context

```mermaid
graph LR
  U((User<br/>browser)) -->|HTTPS| FE[Next.js frontend<br/>:3000]
  A((Admin)) -->|HTTPS| FE
  FE -->|/api/auth/*| NA[NextAuth route handlers]
  FE -->|rewrite /api/v1/* same-origin| API[NestJS API<br/>:4000]
  NA -->|server-to-server<br/>login / refresh / oauth| API
  NA -->|OAuth 2 / OIDC| G[Google]
  NA -->|Sign in with Apple| AP[Apple]
  API --> PG[(PostgreSQL)]
  API -->|enqueue| R[(Redis / BullMQ)]
  W[Worker<br/>BullMQ processor + scheduler] --> R
  W --> PG
  W -->|SMTP| M[MailHog / SMTP]
  API -->|SMTP password reset| M
  PGA[pgAdmin] --> PG
```

## 3. Container / deployment view

```mermaid
graph TB
  subgraph docker-compose network
    frontend[frontend<br/>node:22 standalone] --> backend
    backend[backend<br/>node:22 · migrate+seed on start] --> postgres[(postgres:16.4)]
    backend --> redis[(redis:7.4)]
    worker[worker<br/>same image, node dist/worker.js] --> redis
    worker --> postgres
    worker --> mailhog
    backend --> mailhog[mailhog :8025]
    pgadmin[pgadmin :5050] --> postgres
  end
  subgraph profiles
    backend-tests[backend-tests · profile test]
    e2e[e2e Playwright · profile e2e]
    cypress[cypress · profile cypress]
  end
```

## 4. Backend module structure

```mermaid
graph TD
  App[AppModule] --> Auth & Catalog & Wallet & Recs[Recommendations] & Offers & Calc[Calculator] & Nearby & Insights[Dashboard/Insights] & Notif[Notifications] & Subs[Subscriptions] & Tx[Transactions] & Users[Users/Me] & Analytics & Admin & Health & JobsApi
  Recs --> Domain
  Calc --> Domain
  Insights --> Domain
  Offers --> Domain
  Nearby --> Domain
  JobsApi --> Domain
  subgraph Domain[src/domain — pure TypeScript, no I/O]
    RE[recommendation.engine]
    CA[calculator]
    IN[insights: 5/24, renewals, bonus]
    OF[offers rules]
    GE[geo]
    EN[entitlements]
  end
  Wallet --> Prisma[(PrismaService)]
  Offers --> Prisma
  Global[Global guards: Throttler → JwtAuth → Roles] -.-> App
```

**Key design choice:** all business rules live in `src/domain/*` as pure functions (100% unit-test line coverage). Nest services only load data, call the domain, and persist.

## 5. Data flow — best card for a merchant

```mermaid
sequenceDiagram
  participant B as Browser (merchant page)
  participant N as Next.js (rewrite)
  participant A as API RecommendationsService
  participant D as domain.rankCards
  participant P as Postgres
  B->>N: GET /api/v1/recommendations/merchants/freshcart (Bearer)
  N->>A: proxy (X-Forwarded-For)
  A->>P: merchant + category; wallet cards + rewards + currency; valuations; pins; fallback category
  A->>D: rankCards(cards, {merchantId, categoryId, parent, fallback}, {valuations, pinned})
  D-->>A: ranked[] (¢/$ = multiplier × cpp)
  A->>P: user's active offers at merchant
  A-->>B: { merchant, ranked, offers }
```

## 6. Sequence — authentication (credentials + refresh)

```mermaid
sequenceDiagram
  participant B as Browser
  participant NA as NextAuth (Next server)
  participant API
  B->>NA: signIn('credentials', email, pw)
  NA->>API: POST /auth/login
  API-->>NA: {accessToken(15m JWT), refreshToken(opaque), user}
  NA-->>B: httpOnly encrypted session cookie (JWT strategy)
  B->>NA: useSession() → accessToken
  B->>API: /api/v1/* Authorization: Bearer
  Note over NA: on jwt() callback when access token is near expiry
  NA->>API: POST /auth/refresh (rotation)
  API-->>NA: new pair (old revoked; reuse → family revoked)
```

OAuth (Google/Apple): NextAuth completes the provider flow, then calls `POST /auth/oauth` with `x-internal-secret`; the API links or creates the user and returns the same token pair.

## 7. Sequence — scheduled notification job

```mermaid
sequenceDiagram
  participant S as JobsScheduler (worker boot)
  participant Q as BullMQ (Redis)
  participant W as JobsProcessor
  participant J as JobsService
  participant DB as Postgres
  S->>Q: upsertJobScheduler('scan-expiring-offers', '0 13 * * *')
  Q->>W: job fires
  W->>J: run('scan-expiring-offers')
  J->>DB: prefs + active user offers
  J->>J: domain.isExpiringSoon(offer, uo, now, prefs.expiringDays)
  J->>DB: notification.upsert(userId, dedupeKey="expiring:<uo>:<date>")
  Note over J,DB: idempotent — reruns never duplicate
```

## 8. ER diagram (summary — full schema in `database/schema.prisma`)

```mermaid
erDiagram
  User ||--o| Wallet : has
  User ||--o{ OAuthAccount : links
  User ||--o{ RefreshToken : sessions
  User ||--o{ Profile : household
  User ||--o| Subscription : plan
  User ||--o{ Notification : receives
  User ||--o| NotificationPreference : prefs
  User ||--o{ Transaction : logs
  User ||--o{ UserValuation : overrides
  User ||--o{ CategoryPin : pins
  User ||--o{ OfferAlert : alerts
  User ||--o{ AnalyticsEvent : emits
  User ||--o{ AuditLog : "acts (admin)"
  Wallet ||--o{ WalletCard : contains
  WalletCard }o--|| CreditCard : "instance of"
  WalletCard }o--o| Profile : "held by"
  WalletCard ||--o{ UserOffer : tracks
  WalletCard ||--o{ Transaction : spend
  CreditCard }o--|| Issuer : "issued by"
  CreditCard }o--|| RewardCurrency : earns
  CreditCard ||--o{ Reward : "earning rules"
  CreditCard ||--o{ CardFeature : features
  Reward }o--o| Category : for
  Reward }o--o| Merchant : at
  Category ||--o{ Merchant : groups
  Category ||--o{ Category : parent
  Merchant ||--o{ Location : stores
  Offer }o--o| Merchant : at
  Offer }o--o| CreditCard : "card-specific"
  Offer }o--o| Issuer : "issuer-wide"
  Offer ||--o{ UserOffer : "added as"
```

## 9. Cross-cutting concerns

| Concern | Approach |
|---|---|
| AuthN | JWT access (15 min) + rotating refresh with reuse detection; argon2id passwords |
| AuthZ | Global `JwtAuthGuard` (opt-out via `@Public`), `RolesGuard` + `@Roles('ADMIN')`, service-level ownership checks (`assertOwned`) |
| Validation | Global `ValidationPipe` (whitelist, forbidNonWhitelisted, transform) |
| Errors | `AllExceptionsFilter` → uniform envelope; Prisma P2002→409, P2025→404, P2003→400; domain rule errors → 422 |
| Rate limiting | `@nestjs/throttler` globally; tighter on `/auth`; `trust proxy` for private networks |
| Security headers | helmet (API); CSP / XFO / nosniff / Referrer-Policy / Permissions-Policy (Next) |
| Observability | Nest logger (JSON in prod recommended), `/health` (DB check), Docker healthchecks |
| Config | 12-factor env vars; `.env.example` files; no secrets baked into images |
| Idempotency | notification dedupe keys; idempotent seed; `upsertJobScheduler` |

## 10. Mapping from the analyzed native app

| Native component | Web equivalent |
|---|---|
| Core Data + seed SQLite | PostgreSQL + Prisma + seed script |
| `WalletStore` delta sync | Stateless REST + TanStack Query cache/invalidation |
| Keychain token | NextAuth encrypted httpOnly cookie (holds backend tokens) |
| BGTaskScheduler / SyncHelper | BullMQ worker with cron schedulers |
| APNs / local notifications | In-app notifications + email digest |
| RevenueCat | Billing provider abstraction (`mock` now, Stripe-ready) |
| MapKit nearby | Browser Geolocation + `Location` table, haversine + bbox |
| Offer Sync bank automation | Not replicated (security/ToS); manual + custom offers |
