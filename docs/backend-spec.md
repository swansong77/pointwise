# Phase 14 — Backend Specification (NestJS)

Source: `backend/src`. Entry points: `main.ts` (HTTP API), `worker.ts` (BullMQ job worker), `scheduler.ts` (registers the cron schedule), `notification.ts` (notification-service: email + web push), `seed/seed.ts`.

## 1. Controllers & routes

| Controller | Prefix | Routes (see api-spec.md for contracts) |
|---|---|---|
| `AuthController` | `/auth` | register, login, refresh, logout, oauth, forgot-password, reset-password |
| `CatalogController` | `/` | `GET cards`, `cards/:idOrSlug`, `issuers`, `categories`, `categories/:idOrSlug`, `merchants`, `merchants/by-host`, `merchants/:idOrSlug` |
| `WalletController` | `/wallet` | `GET/POST cards`, `PATCH/DELETE cards/:id`, `PUT order`, `POST/DELETE pins`, `PUT valuations` |
| `RecommendationsController` | `/recommendations` | `categories`, `categories/:idOrSlug`, `merchants/:idOrSlug` |
| `OffersController` | `/offers` | `GET /` (catalog), `eligible`, `GET/POST mine`, `PATCH/DELETE mine/:id`, `POST custom` |
| `CalculatorController` | `/calculator` | `POST /` |
| `NearbyController` | `/nearby` | `GET /` |
| `InsightsController` | `/dashboard` | `GET /` |
| `NotificationsController` | `/notifications` | list, unread-count, `:id/read`, read-all, `GET/PUT preferences` |
| `SubscriptionsController` | `/subscription` | plans, get, checkout, cancel, resume |
| `TransactionsController` | `/transactions` | list, create, delete |
| `UsersController` | `/me` | get, patch, export, delete; profiles CRUD; alerts CRUD |
| `AnalyticsController` | `/analytics` | `POST events` |
| `AdminController` | `/admin` | stats, users, users/:id/role, audit, cards/categories/merchants/offers CRUD |
| `JobsController` | `/admin/jobs` | `POST :name` (enqueue), `POST :name/run` (sync) |
| `HealthController` | `/health` | DB ping |
| `HouseholdsController` | `/household` | `GET/PATCH /`, `GET/POST members`, `PATCH/DELETE members/:id` |
| `PortfolioController` | `/` | `GET five24`, `GET portfolio`, `GET household/dashboard` |
| `BenefitsController` | `/benefits` | `GET /`, `summary`, `catalog`, `categories`; `POST /`, `apply-templates/:walletCardId`, `:id/usage`; `PATCH/DELETE :id`; `DELETE :id/usage/:usageId` |
| `ImportsController` | `/imports` | `GET template.csv` (public), `POST /` (multipart), `GET /`, `GET :id`, `POST :id/commit`, `DELETE :id` |
| `ConnectionsController` | `/connections` | `status`, list, `plaid/link-token`, `plaid/exchange`, `plaid/sandbox`, `:id/sync`, `DELETE :id` |
| `CreditReportsController` | `/credit-reports` | `providers`, `accounts` CRUD, `accounts/:id/apply` |
| `PushController` | `/notifications/push` | `key`, `POST/DELETE subscriptions` |
| `AiController` | `/ai` | `models`, `agents`, `GET/PUT settings`, `usage`, `POST chat`, `POST chat/stream` (SSE), `POST :task` (analyze, recommend, card-comparison, travel-strategy, portfolio-review), `conversations`, `actions/:id/confirm|reject` |
| `TokensController` | `/me/tokens` | personal access tokens for MCP |
| `AiAdminController` | `/admin/ai`, `/admin/mcp` | providers (+ write-only keys, test), models, agents, tools, usage; MCP servers, check, tool approval |
| `CardRefreshAdminController` | `/admin/card-sources`, `/admin/cards/:id/refresh\|extract`, `/admin/card-proposals` | issuer-page sources CRUD + refresh; paste-text extraction; review proposals (`approve` with optional correction, `reject`) |
| `CardKnowledgeController` | `/cards/:idOrSlug/offer-history`, `/welcome-bonuses`, `/annual-fees` (public); `/cards/:idOrSlug/retention-offers`, `POST /me/retention-offers` (Bearer) | offer timelines, current offers vs 24-month median, fee changes, anonymised retention reports |
| `StrategyController` | `/recommendations/next-card`, `/recommendations/who-should-apply/:card`, `/household/next-card`, `/me/spend-profile` | next-card scorer (Phase D) |
| `TravelController` / `TransferPartnersController` | `/me/balances`, `/travel/transfers`, `/travel/plan`; public `/transfer-partners` | balances, transfer advice, award planner |
| `TravelAdminController` | `/admin/loyalty-programs`, `/admin/transfer-partners` | curate programs and partners (audited) |
| `CardTermsController` | `/card-terms/search` (public) | fine-print full-text search (`TermsService`) |
| `CreditReportsController` | `/credit-reports/import/preview`, `/credit-reports/import`, `/credit-reports/accounts*` | Credit Karma report (printed PDF / copied text) → open dates on wallet cards, new cards for 5/24 (see credit-report-import.md) |
| `CaptureController` | `POST /inbound/email` (public, shared secret), `/capture/status`, `/capture/inbox`, `/capture/inbox/rotate`, `/capture/items/:id/assign`, `DELETE /capture/items/:id` | forwarded alert emails → transactions; per-card automation status (`CaptureService`, see auto-capture.md) |
| `SpendController` | `/spending/*`, `PUT /benefits/:id/auto-tracking`, `POST /benefits/usages/:id/dismiss` | statement CSV preview/import, transactions with benefit updates, summary, rescan, rules (`SpendService`, see spend-tracking.md) |
| `CardResearchController` | `/admin/card-research*` (incl. `discover-all`, `coverage`), `/admin/card-candidates*` (ADMIN) | card-research agent: Claude web search on issuer domains → evidence-checked candidates → admin approval (`CardResearchService`, see card-research-agent.md) |
| `OpsController` | `/admin/ops/health`, `/admin/ops/logs` | operations page (Phase E) |
| `McpServerController` | `/mcp` (no `/api/v1` prefix) | MCP Streamable HTTP server (PAT auth) |
| `PortfolioController` (aliases) | `/524-status`, `/family-dashboard` | spec aliases |

## 2. Services

| Service | Responsibilities | Domain functions used |
|---|---|---|
| `AuthService` | register (argon2id), login (timing-safe-ish), token issue/rotate/revoke, OAuth exchange, password reset | — |
| `CatalogService` | search/paginate cards & merchants, detail lookups, host lookup | — |
| `WalletService` | wallet CRUD, ownership assertion, plan card limit, pins, valuations, domain mapping | `limitsFor` |
| `RecommendationsService` | build `PurchaseTarget`, apply pins/valuations | `rankCards` |
| `OffersService` | catalog, eligible offers, my offers (enriched), add/custom/update/remove, plan offer limit | `applyUsage`, `snooze`, `sortOffers`, `effectiveStatus`, `remainingCents`, `daysLeft` |
| `CalculatorService` | spend → value; candidate comparison (Pro) | `calculateWalletValue`, `compareCandidate` |
| `NearbyService` | bbox pre-filter → haversine → rank per location | `boundingBox`, `haversineMeters`, `rankForMerchant` |
| `InsightsService` | dashboard aggregate | `fiveTwentyFour`, `upcomingRenewals`, `bonusProgress`, `isExpiringSoon` |
| `NotificationsService` | list/read, idempotent `notify` (dedupe key), preferences | — |
| `SubscriptionsService` | provider abstraction (`mock`), checkout/cancel/resume | `effectivePlan`, `periodEndFor` |
| `TransactionsService` | spend log; maintains `bonusSpendCents` atomically | — |
| `UsersService` | profile, GDPR export/delete, household profiles, offer alerts | `limitsFor` |
| `AnalyticsService` | event ingest (2 KB cap), 30-day summary | — |
| `AdminService` | catalog CRUD + audit log, roles, stats | — |
| `JobsService` | job bodies (see §5) | `isExpiringSoon`, `upcomingRenewals`, `bonusProgress`, `matchesAlert` |
| `MailService` | SMTP send (no-throw; returns success) | — |
| `HouseholdsService` | household + members, SELF member (advisory-locked first use), child = AU-only rule | `limitsFor` |
| `PortfolioService` | per-member 5/24, portfolio value analytics, household dashboard, rewards from logged spend | `five24Status`, `five24Timeline`, `cardValue`, `rollupByHolder`, `bestRuleForCard` |
| `BenefitsService` | templates, tracked benefits, usage per period, summary buckets | `periodContaining`, `utilization`, `benefitYearSummary` |
| `ImportsService` | xlsx/csv upload → preview job → transactional commit | `parseWorkbook`, `matchExisting`, `matchCatalog`, `distributeUsage` |
| `ConnectionsService` | BankConnector (Plaid), encrypted tokens, account sync | `matchExisting` |
| `CreditReportsService` | tradelines, auto-match, apply open month | `matchExisting` |
| `AiService` | consent, budget, agent runtime (tool loop), conversations, pending actions | — |
| `ModelRouter` | model chain resolution, failover, circuit breaker, usage & cost ledger | — |
| `ToolRegistry` | 18 tools (13 user-data, 5 public catalog) over the services above | engines |
| `StrategyService` | spend profile, next-card scoring per member / household / card, travel balances, transfer advice, award planner, admin programs & partners | `rankCandidates`, `whoShouldApply`, `householdNextCards`, `adviseBalances`, `planAward` |
| `OpsService` | admin health (DB, Redis, queue, schedulers, last runs, AI circuits, MCP, card sources) and event log | — |
| `McpClientService` / `TokensService` | admin MCP registry (discovery, health, approval) / PATs | — |
| `PushService` / `DeliveryService` / `NotificationDispatcher` | web push (VAPID, SSRF allow-list), email/push delivery, queueing | — |

## 3. Repositories

Prisma Client is the repository layer (`PrismaService` global provider). Patterns:
- **Includes as constants** (`walletCardInclude`, `cardListSelect`, `userOfferInclude`) keep query shapes consistent and typed (`Prisma.*GetPayload`).
- **Mappers** (`common/mappers.ts`) convert Prisma rows (Decimal) to domain types (number).
- **Transactions** for multi-row invariants: reorder, transaction create/delete + bonus spend, password reset, admin reward replacement, paginated count+list.

## 4. Event handlers

| Event | Producer | Handling |
|---|---|---|
| `user_registered`, `user_logged_in` | AuthService | AnalyticsEvent row |
| `offer_added`, `offer_redeemed` | OffersService | AnalyticsEvent row |
| `subscription_started`, `subscription_canceled` | SubscriptionsService | AnalyticsEvent row |
| Catalog mutations | AdminService | AuditLog row (actor, action, entity, diff) |
| Client events | `POST /analytics/events` | AnalyticsEvent (name `^[a-z][a-z0-9_]{1,63}$`) |

(Scale phase: move to an outbox table + consumer so analytics/audit writes don't share the request transaction.)

## 5. Background jobs & schedulers

Queues (BullMQ/Redis): `pointwise-jobs` (consumed by `worker`) and `pointwise-notifications` (consumed by `notification-service`, 3 attempts, exponential backoff). The `scheduler` process registers job schedulers (`upsertJobScheduler`, idempotent), removes obsolete ones and re-asserts the schedule hourly. Integration tests use Redis DB 1 so test jobs never reach the running stack (DB 0).

| Job | Cron (UTC) | Purpose | Idempotency |
|---|---|---|---|
| `expire-offers` | `5 0 * * *` | ACTIVE user offers past `endsAt` → EXPIRED | set-based update |
| `scan-expiring-offers` | `0 13 * * *` | Notify offers ending within each user's `expiringDays` (not snoozed) | dedupe `expiring:<uo>:<endDate>` |
| `scan-renewals` | `10 13 * * *` | Annual fee within 30 days | dedupe `renewal:<wc>:<date>` |
| `scan-bonus-deadlines` | `20 13 * * *` | Bonus at risk (≤30 days, <75%) | dedupe `bonus:<wc>:<deadline>` |
| `match-offer-alerts` | `0 * * * *` | Catalog offers created in the last 24h vs keyword alerts | dedupe `alert:<alert>:<offer>` |
| `email-digest` | `0 14 * * *` | Email unread, un-emailed notifications; stamps `emailedAt` only on success | `emailedAt` |
| `scan-benefit-expirations` | `30 13 * * *` | Benefit alerts at period-scaled thresholds; in-app + queued email/push | unique `BenefitNotification(benefit, periodEnd, threshold, channel)` |
| `snapshot-524` | `15 0 * * *` | Daily 5/24 count per household member | unique `(profileId, takenOn)` |
| `check-mcp-servers` | `*/15 * * * *` | Refresh tool lists and health of active MCP servers | upsert by (server, tool name) |
| `scan-transfer-bonuses` | `40 13 * * *` | Notify households holding a currency with an active transfer bonus (preference `transferBonuses`) | dedupe key partner + % + end date |
| `research-cards` | `*/2 * * * *` | Execute queued card-research runs (admin-started; marks runs stuck > 30 min FAILED) | runs claimed QUEUED → RUNNING atomically; no queued run → no model call |
| `refresh-card-sources` | `0 5 * * *` | Fetch active issuer-page sources (robots.txt, per-host politeness, conditional GET) → extraction → change proposals for admin review | content hash / 304 skip; pending proposal per field superseded |
| `sync-bank-connections` | `0 6 * * *` | Re-sync aggregator connections (no-op unless configured) | match by provider account id / mask |

Retries: BullMQ default (job fails → retained for inspection, `removeOnFail: 500`). Admins can run jobs on demand.

## 6. Caching strategy

| Data | Strategy (current) | Scale-phase plan |
|---|---|---|
| Catalog (cards, categories, merchants) | Client: TanStack Query `staleTime` 30 s (categories 5 min); HTTP responses are public | Redis read-through cache keyed by query, 10 min TTL, invalidated on admin writes; CDN `Cache-Control: public, s-maxage=300` |
| Recommendations | Computed per request (pure, < 1 ms for 50 cards) | Cache wallet domain snapshot in Redis per user (invalidate on wallet/valuation/pin writes) |
| Dashboard | Per request | 30 s per-user Redis cache |
| Sessions | Stateless JWT; refresh tokens in Postgres | — |
| Rate-limit counters | In-memory throttler storage | Redis throttler storage for multi-instance |

## 7. Rate limits

| Scope | Limit | Config |
|---|---|---|
| All routes (per IP) | 100 / min | `RATE_LIMIT_PER_MIN` |
| `/auth/*` (per IP) | 10 / min (compose default 30) | `AUTH_RATE_LIMIT_PER_MIN` |
| `/health` | unlimited | `@SkipThrottle` |
| Login brute force | argon2id cost + rate limit; generic error message | |
| Server-to-server calls from NextAuth | Tracked per **end-user IP** forwarded in `x-client-ip` (trusted only with a valid `x-internal-secret`); background `refresh`/`logout` without a client IP are exempt, `login` never is | `ClientIpThrottlerGuard` (`common/throttler.guard.ts`) |

## 8. Configuration (env)

`PORT, DATABASE_URL, REDIS_URL, TOKEN_ENC_KEY, AI_ENABLE_MOCK, AI_MONTHLY_TOKEN_BUDGET, AI_RATE_LIMIT_PER_MIN, ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, AZURE_OPENAI_API_KEY, XAI_API_KEY, MISTRAL_API_KEY, DEEPSEEK_API_KEY, OPENROUTER_API_KEY, OLLAMA_BASE_URL, MCP_ALLOWED_HOSTS, CARD_SOURCE_ALLOWED_DOMAINS, CARD_SOURCE_HTTP_HOSTS (tests only), CARD_SOURCE_MIN_INTERVAL_MS, BANK_PROVIDER, PLAID_ENV, PLAID_CLIENT_ID, PLAID_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, JWT_ACCESS_TTL, JWT_REFRESH_TTL_DAYS, INTERNAL_API_SECRET, CORS_ORIGINS, SMTP_HOST, SMTP_PORT, MAIL_FROM, MAIL_DISABLED, APP_URL, BILLING_PROVIDER, RATE_LIMIT_PER_MIN, AUTH_RATE_LIMIT_PER_MIN, TRUST_PROXY, SWAGGER_ENABLED, RUN_MIGRATIONS, RUN_SEED`.

## 9. Migrations

- Canonical schema: `database/schema.prisma` → synced to `backend/prisma/schema.prisma` (`npm run prisma:sync`).
- Initial migration: `backend/prisma/migrations/20261121000000_init/migration.sql` (26 tables, 42 indexes), generated with `prisma migrate diff --from-empty`.
- Portfolio revision: `20261122000000_portfolio_benefits` (12 new tables, 10 enums, new WalletCard/Issuer/Profile/NotificationPreference/CreditCard columns, `lastFour` widened to 5) + data backfill (households for existing profile owners; primary profiles → SELF). Generated with `prisma migrate diff --from-migrations … --shadow-database-url`.
- AI platform: `20261123000000_ai_platform` (11 tables: AiProvider, AiModel, AgentProfile, AiSettings, AiConversation, AiMessage, AiUsage, AiPendingAction, PersonalAccessToken, McpServer, McpTool).
- Card knowledge base: `20261124000000_card_knowledge_base` (CardDataSource, CardChangeProposal, CardOffer, RetentionOfferReport; partial unique index `CardOffer_one_open_version` on (cardId, kind) WHERE validTo IS NULL; CreditCard gains description, productFamily, productStatus, launchDate, authorizedUserFeeCents, bonusType, bonusValuationCents, offerExpiresAt).
- Recommendations & travel: `20261125000000_recommendations_travel` (SpendProfileEntry, LoyaltyProgram, TransferPartner, LoyaltyBalance with a one-target check constraint and partial unique indexes; Issuer.enforcesFive24; RewardCurrency.householdPooling / transferIncrement).
- Credit band, terms, alerts: `20261126000000_credit_band_terms_alerts` (enum CreditBand; Profile.creditBand; CreditCard.recommendedCredit; NotificationType TRANSFER_BONUS; NotificationPreference.transferBonuses).
- Card research & real catalog: `20261127000000_card_research` (enums CatalogSource, CardResearchKind/Status, CardCandidateStatus; CreditCard.catalogSource/dataAsOf/lastVerifiedAt; CardResearchRun; CardCandidate). Seed: `SEED_CATALOG=demo|real|both`; `npm run catalog:import`.
- Spend & automatic benefits: `20261129000000_spend_auto_benefits` (Transaction kind/source/externalId/bankCategory + category/merchant FKs; UserBenefit autoTrack/autoRules; Benefit autoRules; BenefitUsage source/status/transactionId/creditTransactionId; BankConnection txCursor).
- Automatic capture: `20261201000000_auto_capture` (TransactionSource EMAIL; EmailInbox; InboundEmail; BankConnection needsReauth/lastError/lastTxSyncAt). Plaid webhook `POST /connections/plaid/webhook` (ES256 JWT + body hash), `POST /connections/:id/relink-token`, `/relinked`.
- Credit report import: `20261202000000_credit_report_import` (CreditReportAccount openedPrecision, closedOn, accountType, source).
- Issuer registry: `20261204000000_issuer_registry` (IssuerKind enum; Issuer.kind, lastResearchedAt). Credit reports from three bureaus: `20261203000000_credit_report_bureaus` (CreditReportAccount.reportedBy).
- New migration workflow: edit the schema → `npx prisma migrate dev --name <change>` against a dev DB → commit SQL → containers apply it with `prisma migrate deploy` on start (`RUN_MIGRATIONS=true`).
- Zero-downtime rule: expand → deploy → backfill → contract. Never drop or rename in the same release that stops writing.
