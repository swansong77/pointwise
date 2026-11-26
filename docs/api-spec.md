# Phase 15 — API Specification (Pointwise)

- **Machine-readable spec:** [`../api/openapi.json`](../api/openapi.json), exported from the running code (`backend/scripts/export-openapi.ts`). Live Swagger UI: `http://localhost:4000/api/docs` (also proxied at `http://localhost:3000/api/docs`).
- **Base URL:** `/api/v1` (health is at `/health`).
- **Format:** JSON (UTF-8). **All money values are integer cents.** Dates are ISO-8601 strings (UTC).
- **Auth:** `Authorization: Bearer <accessToken>` (JWT HS256, 15 min). Refresh tokens are opaque (48 random bytes), rotated on every use, stored as SHA-256 hashes.
- **Validation:** `class-validator` with `whitelist + forbidNonWhitelisted`. Unknown properties → **400**.
- **Rate limits:** 100 req/min/IP for the API (env `RATE_LIMIT_PER_MIN`); 10 req/min/IP for `/auth/*` (env `AUTH_RATE_LIMIT_PER_MIN`). Exceeding them → **429**.

## 1. Error envelope

```json
{ "statusCode": 422, "error": "UNPROCESSABLE_ENTITY", "message": "amountUsedCents cannot exceed the offer value", "path": "/api/v1/offers/mine/…", "timestamp": "2026-11-21T08:00:00.000Z" }
```

| Status | Meaning | Typical causes |
|---|---|---|
| 400 | Validation failed | bad email/UUID/enum, unknown field, `lastFour` not 4 digits, invalid dates |
| 401 | Not authenticated | missing/expired access token; bad credentials; refresh token reuse |
| 403 | Forbidden | not your resource (IDOR guard), role ≠ ADMIN, free-plan limit, bad internal secret |
| 404 | Not found | unknown id/slug |
| 409 | Conflict | duplicate email; offer already on card (unique constraint) |
| 422 | Business rule violated | offer expired / over-used / not started; snooze in the past; calculator range |
| 429 | Rate limited | throttler |
| 500 | Unexpected | logged server-side; message is generic |

## 2. Permissions model

| Role / state | Access |
|---|---|
| Anonymous | `/health`, `/auth/*`, catalog reads (`/cards`, `/issuers`, `/categories`, `/merchants`, `GET /offers`), `/subscription/plans` |
| USER | Own wallet, offers, transactions, notifications, profiles, alerts, subscription, dashboard, recommendations, nearby, calculator. Every user-owned row is checked against `wallet.userId` / `userId` (object-level authorization). |
| USER + FREE plan | ≤ 5 cards, ≤ 20 active tracked offers; no offer alerts, extra profiles, or calculator comparison → 403 with upgrade message |
| USER + PRO plan | Unlimited; alerts; profiles (≤ 10); compare |
| ADMIN | Everything + `/admin/*` (catalog CRUD with audit log, users, roles, stats, jobs) |
| Internal (NextAuth server) | `POST /auth/oauth` with `x-internal-secret` |

## 3. Operation inventory (generated from openapi.json)

| Tag | Method | Route | Auth | Body DTO | Query | Success |
|---|---|---|---|---|---|---|
| admin | DELETE | /api/v1/admin/ai/models/{id} | Bearer + ADMIN | — | — | 204 |
| admin | DELETE | /api/v1/admin/ai/providers/{id} | Bearer + ADMIN | — | — | 204 |
| admin | DELETE | /api/v1/admin/ai/providers/{id}/key | Bearer + ADMIN | — | — | 204 |
| admin | DELETE | /api/v1/admin/card-sources/{id} | Bearer + ADMIN | — | — | 204 |
| admin | DELETE | /api/v1/admin/cards/{id} | Bearer + ADMIN | — | — | 204 |
| admin | DELETE | /api/v1/admin/mcp/servers/{id} | Bearer + ADMIN | — | — | 204 |
| admin | DELETE | /api/v1/admin/offers/{id} | Bearer + ADMIN | — | — | 204 |
| admin | DELETE | /api/v1/admin/transfer-partners/{id} | Bearer + ADMIN | — | — | 204 |
| admin | GET | /api/v1/admin/ai/agents | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/ai/models | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/ai/providers | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/ai/tools | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/ai/usage | Bearer + ADMIN | — | days | 200 |
| admin | GET | /api/v1/admin/audit | Bearer + ADMIN | — | page, pageSize, q | 200 |
| admin | GET | /api/v1/admin/card-candidates | Bearer + ADMIN | — | status | 200 |
| admin | GET | /api/v1/admin/card-proposals | Bearer + ADMIN | — | status, cardId | 200 |
| admin | GET | /api/v1/admin/card-research | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/card-research/coverage | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/card-research/status | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/card-research/{id} | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/card-sources | Bearer + ADMIN | — | cardId | 200 |
| admin | GET | /api/v1/admin/mcp/servers | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/ops/health | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/ops/logs | Bearer + ADMIN | — | limit | 200 |
| admin | GET | /api/v1/admin/stats | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/transfer-partners | Bearer + ADMIN | — | — | 200 |
| admin | GET | /api/v1/admin/users | Bearer + ADMIN | — | page, pageSize, q | 200 |
| admin | PATCH | /api/v1/admin/ai/agents/{key} | Bearer + ADMIN | AgentUpdateDto | — | 200 |
| admin | PATCH | /api/v1/admin/ai/models/{id} | Bearer + ADMIN | UpdateModelDto | — | 200 |
| admin | PATCH | /api/v1/admin/ai/providers/{id} | Bearer + ADMIN | UpdateProviderDto | — | 200 |
| admin | PATCH | /api/v1/admin/card-sources/{id} | Bearer + ADMIN | SourceUpdateDto | — | 200 |
| admin | PATCH | /api/v1/admin/cards/{id} | Bearer + ADMIN | UpdateCardInput | — | 200 |
| admin | PATCH | /api/v1/admin/categories/{id} | Bearer + ADMIN | UpdateCategoryInput | — | 200 |
| admin | PATCH | /api/v1/admin/mcp/servers/{id} | Bearer + ADMIN | UpdateMcpServerDto | — | 200 |
| admin | PATCH | /api/v1/admin/mcp/tools/{id} | Bearer + ADMIN | McpToolDto | — | 200 |
| admin | PATCH | /api/v1/admin/merchants/{id} | Bearer + ADMIN | UpdateMerchantInput | — | 200 |
| admin | PATCH | /api/v1/admin/offers/{id} | Bearer + ADMIN | UpdateOfferInput | — | 200 |
| admin | PATCH | /api/v1/admin/users/{id}/role | Bearer + ADMIN | RoleInput | — | 200 |
| admin | POST | /api/v1/admin/ai/models | Bearer + ADMIN | ModelDto | — | 201 |
| admin | POST | /api/v1/admin/ai/models/{id}/test | Bearer + ADMIN | — | — | 200 |
| admin | POST | /api/v1/admin/ai/providers | Bearer + ADMIN | ProviderDto | — | 201 |
| admin | POST | /api/v1/admin/card-candidates/{id}/approve | Bearer + ADMIN | ApproveCandidateDto | — | 200 |
| admin | POST | /api/v1/admin/card-candidates/{id}/reject | Bearer + ADMIN | RejectCandidateDto | — | 200 |
| admin | POST | /api/v1/admin/card-proposals/{id}/approve | Bearer + ADMIN | DecideDto | — | 200 |
| admin | POST | /api/v1/admin/card-proposals/{id}/reject | Bearer + ADMIN | — | — | 200 |
| admin | POST | /api/v1/admin/card-research | Bearer + ADMIN | StartResearchDto | — | 202 |
| admin | POST | /api/v1/admin/card-research/discover-all | Bearer + ADMIN | DiscoverAllDto | — | 202 |
| admin | POST | /api/v1/admin/card-research/verify-unverified | Bearer + ADMIN | VerifyAllDto | — | 202 |
| admin | POST | /api/v1/admin/card-sources | Bearer + ADMIN | SourceDto | — | 201 |
| admin | POST | /api/v1/admin/card-sources/{id}/refresh | Bearer + ADMIN | — | force | 200 |
| admin | POST | /api/v1/admin/cards | Bearer + ADMIN | CardInput | — | 201 |
| admin | POST | /api/v1/admin/cards/{id}/extract | Bearer + ADMIN | PasteDto | — | 200 |
| admin | POST | /api/v1/admin/cards/{id}/refresh | Bearer + ADMIN | — | force | 200 |
| admin | POST | /api/v1/admin/categories | Bearer + ADMIN | CategoryInput | — | 201 |
| admin | POST | /api/v1/admin/jobs/{name} | Bearer + ADMIN | — | — | 202 |
| admin | POST | /api/v1/admin/jobs/{name}/run | Bearer + ADMIN | — | — | 201 |
| admin | POST | /api/v1/admin/mcp/servers | Bearer + ADMIN | McpServerDto | — | 201 |
| admin | POST | /api/v1/admin/mcp/servers/{id}/check | Bearer + ADMIN | — | — | 200 |
| admin | POST | /api/v1/admin/merchants | Bearer + ADMIN | MerchantInput | — | 201 |
| admin | POST | /api/v1/admin/offers | Bearer + ADMIN | OfferInput | — | 201 |
| admin | PUT | /api/v1/admin/ai/providers/{id}/key | Bearer + ADMIN | ProviderKeyDto | — | 204 |
| admin | PUT | /api/v1/admin/loyalty-programs | Bearer + ADMIN | ProgramDto | — | 200 |
| admin | PUT | /api/v1/admin/transfer-partners | Bearer + ADMIN | PartnerDto | — | 200 |
| ai | DELETE | /api/v1/ai/conversations/{id} | Bearer | — | — | 204 |
| ai | DELETE | /api/v1/me/tokens/{id} | Bearer | — | — | 204 |
| ai | GET | /api/v1/ai/actions | Bearer | — | — | 200 |
| ai | GET | /api/v1/ai/agents | Bearer | — | — | 200 |
| ai | GET | /api/v1/ai/conversations | Bearer | — | — | 200 |
| ai | GET | /api/v1/ai/conversations/{id} | Bearer | — | — | 200 |
| ai | GET | /api/v1/ai/models | Bearer | — | — | 200 |
| ai | GET | /api/v1/ai/settings | Bearer | — | — | 200 |
| ai | GET | /api/v1/ai/usage | Bearer | — | — | 200 |
| ai | GET | /api/v1/me/tokens | Bearer | — | — | 200 |
| ai | POST | /api/v1/ai/actions/{id}/confirm | Bearer | — | — | 200 |
| ai | POST | /api/v1/ai/actions/{id}/reject | Bearer | — | — | 200 |
| ai | POST | /api/v1/ai/chat | Bearer | ChatDto | — | 200 |
| ai | POST | /api/v1/ai/chat/stream | Bearer | ChatDto | — | 200 |
| ai | POST | /api/v1/ai/{task} | Bearer | TaskDto | — | 200 |
| ai | POST | /api/v1/me/tokens | Bearer | CreateTokenDto | — | 201 |
| ai | PUT | /api/v1/ai/settings | Bearer | AiSettingsDto | — | 200 |
| analytics | POST | /api/v1/analytics/events | Bearer | TrackDto | — | 202 |
| auth | POST | /api/v1/auth/forgot-password | Public | ForgotPasswordDto | — | 202 |
| auth | POST | /api/v1/auth/login | Public | LoginDto | — | 200 |
| auth | POST | /api/v1/auth/logout | Public | RefreshDto | — | 204 |
| auth | POST | /api/v1/auth/oauth | Public | OAuthExchangeDto | — | 200 |
| auth | POST | /api/v1/auth/refresh | Public | RefreshDto | — | 200 |
| auth | POST | /api/v1/auth/register | Public | RegisterDto | — | 200 |
| auth | POST | /api/v1/auth/reset-password | Public | ResetPasswordDto | — | 204 |
| benefits | DELETE | /api/v1/benefits/{id} | Bearer | — | — | 204 |
| benefits | DELETE | /api/v1/benefits/{id}/usage/{usageId} | Bearer | — | — | 204 |
| benefits | GET | /api/v1/benefits | Bearer | — | profileId, walletCardId, status, expiringDays | 200 |
| benefits | GET | /api/v1/benefits/catalog | Bearer | — | cardId | 200 |
| benefits | GET | /api/v1/benefits/categories | Bearer | — | — | 200 |
| benefits | GET | /api/v1/benefits/summary | Bearer | — | profileId, walletCardId, status, expiringDays | 200 |
| benefits | PATCH | /api/v1/benefits/{id} | Bearer | UpdateBenefitDto | — | 200 |
| benefits | POST | /api/v1/benefits | Bearer | CreateBenefitDto | — | 201 |
| benefits | POST | /api/v1/benefits/apply-templates/{walletCardId} | Bearer | — | — | 201 |
| benefits | POST | /api/v1/benefits/{id}/usage | Bearer | UsageDto | — | 201 |
| calculator | POST | /api/v1/calculator | Bearer | CalculateDto | — | 201 |
| capture | DELETE | /api/v1/capture/items/{id} | Bearer | — | — | 204 |
| capture | GET | /api/v1/capture/status | Bearer | — | — | 200 |
| capture | PATCH | /api/v1/capture/inbox | Bearer | InboxDto | — | 200 |
| capture | POST | /api/v1/capture/inbox/rotate | Bearer | — | — | 200 |
| capture | POST | /api/v1/capture/items/{id}/assign | Bearer | AssignDto | — | 200 |
| catalog | GET | /api/v1/annual-fees | Public | — | — | 200 |
| catalog | GET | /api/v1/card-terms/search | Public | — | q, card, limit | 200 |
| catalog | GET | /api/v1/cards | Public | — | page, pageSize, q, network, type, issuerId, maxFeeCents, country | 200 |
| catalog | GET | /api/v1/cards/{idOrSlug} | Public | — | — | 200 |
| catalog | GET | /api/v1/cards/{idOrSlug}/offer-history | Public | — | — | 200 |
| catalog | GET | /api/v1/cards/{idOrSlug}/retention-offers | Bearer | — | — | 200 |
| catalog | GET | /api/v1/categories | Public | — | — | 200 |
| catalog | GET | /api/v1/categories/{idOrSlug} | Public | — | — | 200 |
| catalog | GET | /api/v1/issuers | Public | — | — | 200 |
| catalog | GET | /api/v1/merchants | Public | — | page, pageSize, q, categoryId | 200 |
| catalog | GET | /api/v1/merchants/by-host | Public | — | host | 200 |
| catalog | GET | /api/v1/merchants/{idOrSlug} | Public | — | — | 200 |
| catalog | GET | /api/v1/welcome-bonuses | Public | — | elevated | 200 |
| catalog | POST | /api/v1/me/retention-offers | Bearer | RetentionDto | — | 201 |
| connections | DELETE | /api/v1/connections/{id} | Bearer | — | — | 204 |
| connections | GET | /api/v1/connections | Bearer | — | — | 200 |
| connections | GET | /api/v1/connections/status | Bearer | — | — | 200 |
| connections | POST | /api/v1/connections/plaid/exchange | Bearer | ExchangeDto | — | 201 |
| connections | POST | /api/v1/connections/plaid/link-token | Bearer | — | — | 201 |
| connections | POST | /api/v1/connections/plaid/sandbox | Bearer | — | — | 201 |
| connections | POST | /api/v1/connections/{id}/relink-token | Bearer | — | — | 200 |
| connections | POST | /api/v1/connections/{id}/relinked | Bearer | — | — | 200 |
| connections | POST | /api/v1/connections/{id}/sync | Bearer | — | — | 201 |
| credit-reports | DELETE | /api/v1/credit-reports/accounts/{id} | Bearer | — | — | 204 |
| credit-reports | GET | /api/v1/credit-reports/accounts | Bearer | — | — | 200 |
| credit-reports | GET | /api/v1/credit-reports/providers | Bearer | — | — | 200 |
| credit-reports | POST | /api/v1/credit-reports/accounts | Bearer | CreditReportAccountDto | — | 201 |
| credit-reports | POST | /api/v1/credit-reports/accounts/{id}/apply | Bearer | — | — | 201 |
| credit-reports | POST | /api/v1/credit-reports/import | Bearer | ReportImportDto | — | 200 |
| credit-reports | POST | /api/v1/credit-reports/import/preview | Bearer | — | — | 200 |
| dashboard | GET | /api/v1/dashboard | Bearer | — | — | 200 |
| health | GET | /health | Public | — | — | 200 |
| household | DELETE | /api/v1/household/members/{id} | Bearer | — | — | 204 |
| household | GET | /api/v1/household | Bearer | — | — | 200 |
| household | GET | /api/v1/household/members | Bearer | — | — | 200 |
| household | PATCH | /api/v1/household | Bearer | HouseholdDto | — | 200 |
| household | PATCH | /api/v1/household/members/{id} | Bearer | UpdateMemberDto | — | 200 |
| household | POST | /api/v1/household/members | Bearer | MemberDto | — | 201 |
| imports | DELETE | /api/v1/imports/{id} | Bearer | — | — | 204 |
| imports | GET | /api/v1/imports | Bearer | — | — | 200 |
| imports | GET | /api/v1/imports/template.csv | Bearer | — | — | 200 |
| imports | GET | /api/v1/imports/{id} | Bearer | — | — | 200 |
| imports | POST | /api/v1/imports | Bearer | multipart file | — | 201 |
| imports | POST | /api/v1/imports/{id}/commit | Bearer | — | — | 201 |
| me | DELETE | /api/v1/me | Bearer | — | — | 204 |
| me | DELETE | /api/v1/me/alerts/{id} | Bearer | — | — | 204 |
| me | DELETE | /api/v1/me/profiles/{id} | Bearer | — | — | 204 |
| me | GET | /api/v1/me | Bearer | — | — | 200 |
| me | GET | /api/v1/me/alerts | Bearer | — | — | 200 |
| me | GET | /api/v1/me/export | Bearer | — | — | 200 |
| me | GET | /api/v1/me/profiles | Bearer | — | — | 200 |
| me | PATCH | /api/v1/me | Bearer | UpdateMeDto | — | 200 |
| me | PATCH | /api/v1/me/alerts/{id} | Bearer | UpdateOfferAlertDto | — | 200 |
| me | POST | /api/v1/me/alerts | Bearer | OfferAlertDto | — | 201 |
| me | POST | /api/v1/me/profiles | Bearer | ProfileDto | — | 201 |
| nearby | GET | /api/v1/nearby | Bearer | — | lat, lng, radius, limit | 200 |
| notifications | DELETE | /api/v1/notifications/push/subscriptions | Bearer | PushUnsubscribeDto | — | 204 |
| notifications | GET | /api/v1/notifications | Bearer | — | unreadOnly, limit | 200 |
| notifications | GET | /api/v1/notifications/preferences | Bearer | — | — | 200 |
| notifications | GET | /api/v1/notifications/push/key | Bearer | — | — | 200 |
| notifications | GET | /api/v1/notifications/unread-count | Bearer | — | — | 200 |
| notifications | POST | /api/v1/notifications/push/subscriptions | Bearer | PushSubscriptionDto | — | 201 |
| notifications | POST | /api/v1/notifications/read-all | Bearer | — | — | 204 |
| notifications | POST | /api/v1/notifications/{id}/read | Bearer | — | — | 204 |
| notifications | PUT | /api/v1/notifications/preferences | Bearer | PreferencesDto | — | 200 |
| offers | DELETE | /api/v1/offers/mine/{id} | Bearer | — | — | 204 |
| offers | GET | /api/v1/offers | Bearer | — | page, pageSize, q, merchantId, cardId, issuerId | 200 |
| offers | GET | /api/v1/offers/eligible | Bearer | — | — | 200 |
| offers | GET | /api/v1/offers/mine | Bearer | — | status, walletCardId, sort, q, favoritesOnly, includeSnoozed | 200 |
| offers | PATCH | /api/v1/offers/mine/{id} | Bearer | UpdateUserOfferDto | — | 200 |
| offers | POST | /api/v1/offers/custom | Bearer | CustomOfferDto | — | 201 |
| offers | POST | /api/v1/offers/mine | Bearer | AddOfferToCardDto | — | 201 |
| portfolio | GET | /api/v1/524-status | Bearer | — | profileId, horizonMonths | 200 |
| portfolio | GET | /api/v1/family-dashboard | Bearer | — | — | 200 |
| portfolio | GET | /api/v1/five24 | Bearer | — | profileId, horizonMonths | 200 |
| portfolio | GET | /api/v1/household/dashboard | Bearer | — | — | 200 |
| portfolio | GET | /api/v1/portfolio | Bearer | — | profileId | 200 |
| recommendations | GET | /api/v1/household/next-card | Bearer | — | profileId, benefitUseRate, slotValueCents, limit | 200 |
| recommendations | GET | /api/v1/me/spend-profile | Bearer | — | — | 200 |
| recommendations | GET | /api/v1/recommendations/categories | Bearer | — | — | 200 |
| recommendations | GET | /api/v1/recommendations/categories/{idOrSlug} | Bearer | — | — | 200 |
| recommendations | GET | /api/v1/recommendations/merchants/{idOrSlug} | Bearer | — | — | 200 |
| recommendations | GET | /api/v1/recommendations/next-card | Bearer | — | profileId, benefitUseRate, slotValueCents, limit | 200 |
| recommendations | GET | /api/v1/recommendations/who-should-apply/{card} | Bearer | — | profileId, benefitUseRate, slotValueCents, limit | 200 |
| recommendations | PUT | /api/v1/me/spend-profile | Bearer | SpendProfileDto | — | 200 |
| spending | GET | /api/v1/spending/summary | Bearer | — | days | 200 |
| spending | GET | /api/v1/spending/transactions | Bearer | — | walletCardId, kind, matched, limit | 200 |
| spending | POST | /api/v1/benefits/usages/{usageId}/dismiss | Bearer | — | — | 200 |
| spending | POST | /api/v1/spending/rescan | Bearer | RescanDto | — | 200 |
| spending | POST | /api/v1/spending/statements | Bearer | — | — | 201 |
| spending | POST | /api/v1/spending/statements/bulk | Bearer | — | — | 200 |
| spending | POST | /api/v1/spending/statements/preview | Bearer | — | — | 200 |
| spending | PUT | /api/v1/benefits/{id}/auto-tracking | Bearer | AutoTrackingDto | — | 200 |
| subscription | GET | /api/v1/subscription | Bearer | — | — | 200 |
| subscription | GET | /api/v1/subscription/plans | Bearer | — | — | 200 |
| subscription | POST | /api/v1/subscription/cancel | Bearer | — | — | 201 |
| subscription | POST | /api/v1/subscription/checkout | Bearer | CheckoutDto | — | 201 |
| subscription | POST | /api/v1/subscription/resume | Bearer | — | — | 201 |
| transactions | DELETE | /api/v1/transactions/{id} | Bearer | — | — | 204 |
| transactions | GET | /api/v1/transactions | Bearer | — | walletCardId, limit | 200 |
| transactions | POST | /api/v1/transactions | Bearer | CreateTransactionDto | — | 201 |
| travel | DELETE | /api/v1/me/balances/{id} | Bearer | — | — | 204 |
| travel | GET | /api/v1/me/balances | Bearer | — | — | 200 |
| travel | GET | /api/v1/transfer-partners | Public | — | currency, program | 200 |
| travel | GET | /api/v1/travel/transfers | Bearer | — | — | 200 |
| travel | POST | /api/v1/travel/plan | Bearer | PlanDto | — | 200 |
| travel | PUT | /api/v1/me/balances | Bearer | BalanceDto | — | 200 |
| wallet | DELETE | /api/v1/wallet/cards/{id} | Bearer | — | — | 204 |
| wallet | DELETE | /api/v1/wallet/pins | Bearer | — | categoryId, merchantId | 204 |
| wallet | GET | /api/v1/wallet/cards | Bearer | — | — | 200 |
| wallet | PATCH | /api/v1/wallet/cards/{id} | Bearer | UpdateWalletCardDto | — | 200 |
| wallet | POST | /api/v1/wallet/cards | Bearer | AddWalletCardDto | — | 201 |
| wallet | POST | /api/v1/wallet/pins | Bearer | PinDto | — | 201 |
| wallet | PUT | /api/v1/wallet/order | Bearer | ReorderDto | — | 204 |
| wallet | PUT | /api/v1/wallet/valuations | Bearer | ValuationDto | — | 200 |

242 operations (plus the MCP endpoint `ALL /mcp`, excluded from Swagger; see mcp-architecture.md)

## 4. Detailed contracts (key endpoints)

### POST /auth/register
Request:
```json
{ "email": "nora@example.com", "password": "correct-horse-1", "name": "Nora" }
```
Validation: email ≤ 254 (lower-cased, trimmed); password 10–128 chars with a letter and a non-letter; name ≤ 80.
Response `201`:
```json
{ "accessToken": "eyJ…", "refreshToken": "q3J…", "expiresIn": 900, "user": { "id": "uuid", "email": "nora@example.com", "name": "Nora", "role": "USER" } }
```
Side effects: creates Wallet, FREE Subscription, NotificationPreference, primary Profile. Errors: 400, 409, 429.

### POST /auth/refresh
`{ "refreshToken": "…" }` → new token pair (200). The old token is revoked. **Reusing a revoked token revokes the whole token family** → 401 `Refresh token reuse detected`.

### POST /auth/oauth (internal)
Header `x-internal-secret`. Body `{ provider: "google"|"apple", providerAccountId, email, name? }`. It links an existing account by provider id, then by email, or else creates a user. Errors: 403 (secret), 401 (deleted account).

### GET /cards?q=&network=&type=&issuerId=&maxFeeCents=&country=&page=&pageSize=
Response `200`: `{ items: CatalogCard[], total, page, pageSize }`, sorted by popularity, then name. `pageSize` ≤ 100.

### POST /wallet/cards
```json
{ "cardId": "uuid", "status": "APPROVED", "cardholder": "PRIMARY", "approvedAt": "2026-01-10", "nickname": "Travel", "lastFour": "4821" }
```
`lastFour` must match `^\d{4}$`; full PANs are rejected. Response `201` WalletCard (with card, currency, rewards). Errors: 403 (plan limit or foreign profile), 404 (card).

### PATCH /wallet/cards/:id
Any subset of `status, cardholder, approvedAt, closedAt, nickname, notes, lastFour, annualFeeOverrideCents, bonusEarned, bonusSpendCents, selectedCategoryIds[], profileId`. Rules: `closedAt ≥ approvedAt`; `status=CLOSED` without `closedAt` stamps now. 403 if not owner.

### GET /recommendations/categories/:idOrSlug
```json
{
  "category": { "id": "…", "slug": "dining", "name": "Dining" },
  "ranked": [
    { "walletCardId": "…", "name": "Contoso Gold", "multiplier": 4, "centsPerPoint": 1.25, "centsPerDollar": 5, "matchLevel": "CATEGORY", "reason": "4X points at restaurants worldwide", "pinned": false }
  ]
}
```
Ranking: pin first → `centsPerDollar` desc → multiplier desc → name. Only APPROVED cards. Rotating rules require the category to be in `selectedCategoryIds`.

### GET /recommendations/merchants/:idOrSlug
Same shape plus `merchant` and `offers` (user's active offers at that merchant). Merchant-specific rules (`MERCHANT`) beat category rules when they are worth more.

### GET /offers/mine?status=ACTIVE|REDEEMED|EXPIRED|ALL&sort=endDate|value|addedDate|alphabetical&walletCardId=&favoritesOnly=&includeSnoozed=&q=
Each item is enriched with `effectiveStatus`, `remainingCents`, `daysLeft`, `snoozed`. Snoozed offers are hidden from `ACTIVE` unless `includeSnoozed=true`. Favorites always sort first.

### PATCH /offers/mine/:id
```json
{ "amountUsedCents": 400, "timesUsed": 1, "redeemed": true, "isFavorite": true, "snoozedUntil": "2026-12-01T00:00:00Z" }
```
Rules (422 on violation): amount ≤ offer value (cash/percent); `timesUsed` ≤ `maxTimes` (non-repeatable max 1); cannot redeem before `startsAt`; cannot change an expired offer; snooze must be in the future and ≤ 1 year. A fully used cash offer auto-redeems, as does a repeatable offer that reaches `maxTimes`.

### POST /offers/custom
`{ walletCardId, title, kind: CASH|POINTS|PERCENT, valueCents, points?, percent?, minSpendCents?, startsAt?, endsAt?, isRepeatable?, maxTimes?, merchantId?, url? }`. `url` must be http(s) (blocks `javascript:`). PERCENT requires `percent`; POINTS requires `points`.

### POST /calculator
```json
{ "spend": [{ "categoryId": "uuid", "annualSpendCents": 600000 }], "candidateCardId": "uuid?" }
```
Response: `{ result: { categories[], grossRewardsCents, annualFeesCents, netValueCents } }` or, with a candidate (Pro), `{ comparison: { current, withCandidate, incrementalValueCents, firstYearValueCents } }`.

### GET /nearby?lat=&lng=&radius=1500&limit=25
radius 50–25,000 m. Returns locations sorted by distance with `bestCard` and the user's active `offers` there. **Coordinates are never persisted.**

### GET /dashboard
`{ plan, unreadNotifications, stats{cards, activeOffers, availableOfferValueCents, redeemedValueCents}, bestByCategory[], expiringOffers[], renewals[], bonuses[], fiveTwentyFour{count,nextDropAt,underLimit} }`.

### Subscription
`GET /subscription/plans` (public) → `{ month:{cents:799}, year:{cents:5999, trialDays:7}, lifetime:{cents:14999} }`.
`POST /subscription/checkout {interval}`: with `BILLING_PROVIDER=mock`, activates immediately (annual → TRIALING). Other providers → 400 until implemented.
`POST /subscription/cancel` → CANCELED, still Pro until `currentPeriodEnd`; lifetime cannot be canceled. `POST /subscription/resume`.

### Admin
`POST /admin/cards` (with nested `rewards[]`), `PATCH /admin/cards/:id` (partial; `rewards` replaces all), `DELETE` (soft: `isActive=false`). Same pattern for categories, merchants, offers. Every write appends to `AuditLog`. `POST /admin/jobs/:name` enqueues to BullMQ; `POST /admin/jobs/:name/run` runs synchronously.

### 4.x Portfolio revision (2026-11-22)

| Endpoint | Contract |
|---|---|
| `GET /five24?profileId&horizonMonths` | `{ asOf, members: [{ profile, status: { count, label, underLimit, slotsAvailable, nextDropAt, nextSlotAt, contributing[], excluded[], unknown[] }, timeline: [{ date, count, label, event }] }] }` — see chase-524-engine.md |
| `GET /portfolio?profileId` | `{ groups: { active, authorizedUser, closed, pending }, byHolder[], totals, counts }`; each card has fee, faceBenefit, realizedBenefit, missedBenefit, rewards, spend, net, effective, returnOnSpend, earnRate, breakEvenSpend (cents) |
| `GET /benefits/summary` | `{ totals, counts{UNUSED…}, available[], expiring[], completed[], missed[] }` of BenefitView |
| `POST /benefits/:id/usage` `{ amountCents, usedOn?, note? }` | 201 BenefitView; 400 if over the period's remaining value or in the future; 403 not owner |
| `POST /imports` (multipart `file`, ≤ 5 MB, .xlsx/.csv) | 201 ImportJob `{ status: PREVIEW|FAILED, summary, errors[], rows[] }`; 400 unsupported/corrupt; 413 too large |
| `POST /imports/:id/commit` | 201 `{ cardsCreated, cardsUpdated, benefitsCreated, usageRows, membersCreated }`; 403 plan limits; 409 already committed |
| `GET /imports/template.csv` | public, `text/csv` |
| `POST /credit-reports/accounts` → `POST …/:id/apply` | tradeline auto-matched to a wallet card; apply copies open month (MONTH precision), AU flag, status, limit |
| `GET /connections/status`, `POST /connections/plaid/{link-token,exchange,sandbox}`, `POST /connections/:id/sync` | 503 unless `BANK_PROVIDER=plaid`; provider errors → 502 with the provider error code only |
| `GET /notifications/push/key`, `POST/DELETE /notifications/push/subscriptions` | VAPID public key or null; endpoints restricted to browser push services |
| `GET/PATCH /household`, `GET/POST/PATCH/DELETE /household/members`, `GET /household/dashboard` | members = cardholders; Pro for members beyond SELF; children AU-only |

### 4.y AI platform (2026-11-23)

| Endpoint | Contract |
|---|---|
| `POST /ai/chat` `{message, agent?, conversationId?, modelId?}` | 200 `{conversationId, agent, answer, refused, model{displayName, provider, demo}, trace[{tool, ok, summary, external?}], pendingActions[{id, summary}], disclaimer}`; 403 without consent; 429 budget/rate; 503 no model available |
| `POST /ai/{analyze,recommend,card-comparison,travel-strategy,portfolio-review}` `{message?, modelId?}` | same response; default prompt per task |
| `POST /ai/actions/:id/confirm|reject` | executes / discards a proposed write; 409 if already decided |
| `GET/PUT /ai/settings` | `{consented, preferredModelId, monthTokens, monthBudget, monthCostUsd, monthRequests}` |
| `POST /me/tokens` `{name, expiresInDays?}` | `{token: "pw_pat_…"}` shown once (scope mcp:read) |
| `ALL /mcp` | MCP Streamable HTTP (stateless), `Authorization: Bearer pw_pat_…` |
| `/admin/ai/*`, `/admin/mcp/*` | providers (keys write-only), models, agents, tools, usage & cost; MCP servers and tool approval |

## 5. OpenAPI example (excerpt)

```yaml
/api/v1/wallet/cards:
  post:
    tags: [wallet]
    security: [{ bearer: [] }]
    requestBody:
      content:
        application/json:
          schema: { $ref: '#/components/schemas/AddWalletCardDto' }
    responses:
      '201': { description: Created }
      '400': { description: Validation error }
      '403': { description: Plan limit or not your profile }
```

## 6. Traceability to the analyzed app's API

| CardPointers endpoint (observed) | Pointwise endpoint |
|---|---|
| `/auth/login`, `/auth/signon`, `/passkey/*` | `/auth/login`, `/auth/register`, `/auth/oauth` (passkeys: roadmap) |
| `/v1/user/token/refresh` | `/auth/refresh` |
| `/v1/user/wallet/`, `/me/` | `/dashboard`, `/wallet/cards`, `/me` |
| `/v1/user/cards/{add,add_multiple,new,delete,order}` | `POST/DELETE /wallet/cards`, `PUT /wallet/order` |
| `/v1/user/inventory/update` | `PATCH /wallet/cards/:id` |
| `/v1/user/checklist/update[/favorite]` | `PATCH /offers/mine/:id` |
| `/v1/user/offers/{add_existing,add_custom,update_custom}` | `POST /offers/mine`, `POST /offers/custom` |
| `/v1/user/offer_alerts/*` | `/me/alerts` |
| `/v1/user/pointers/{favorites,pinned_cards}` | `/wallet/pins` |
| `/v1/user/profiles/*` | `/me/profiles` |
| `/v1/user/notifications/*` | `/notifications/*` |
| `/v1/user/purchase/link`, `/manage/link/` | `/subscription/*` |
| `/v1/user/delete` | `DELETE /me` |
| `/v1/user/extension/offers/add` (bank Offer Sync) | **not implemented by design** |

## Benefit audit (account-level)

All routes are per user; every row is one tracked benefit on one card account.

| Method | Path | Purpose |
|---|---|---|
| GET | `/benefit-audit` | per benefit and account: detected / matched / unmatched credits, overrides, detections with method, confidence, rule, AI reasoning and statement reference |
| GET | `/benefit-audit/rollup?level=account\|cardholder\|product\|household` | utilization records and group totals at the chosen level |
| GET | `/benefit-audit/reconciliation` | expected, detected, pending, missing, expired and unused amounts, potential missed benefits and suggested actions |
| GET | `/benefit-audit/statements` | imported statements with their validation report (PASS / WARNING / FAILED) |
| PATCH | `/benefit-audit/detections/:id` | `{decision: ACCEPT \| REJECT}` manual override |

`POST /spending/statements`, `/spending/statements/bulk` and `/spending/statements/preview` return a `validation` object.
`PUT /ai/settings` accepts `classifyMerchants` (opt-in AI merchant classification).

## Offer intelligence, recommendations, workflows, mailboxes (2026-11-25)

| Method | Path | Purpose |
|---|---|---|
| GET | `/welcome-bonuses` (public) | now includes best-ever, percentile, verdict, days to expiry and advice |
| GET | `/offers/market` | dashboard: history position, advice, difficulty, your first-year / long-term value |
| GET | `/recommendations/smart` | enriched next-card recommendation with probability estimate, risks, alternatives (stored for audit) |
| GET | `/recommendations/audit/:id` | stored inputs snapshot, weights and factors |
| PATCH | `/household/members/:id` | now accepts `goals`, `hasBusiness` |
| GET | `/ai/workflows` · POST `/ai/workflows/:key` | list / run `next-card`, `portfolio-review` |
| GET | `/ai/runs` · `/ai/runs/:id` | auditable run trace |
| GET/PUT | `/admin/ai/prompts[/:key]` · POST `/admin/ai/prompts/:key/rollback/:version` | versioned prompts (admin) |
| GET/POST/DELETE | `/mailboxes`, POST `/mailboxes/:id/sync` | connect, sync and remove a read-only IMAP mailbox |
| PUT | `/ai/settings` | `classifyMerchants` opt-in (existing) |
| GET | `/mailboxes/providers` | which sign-ins the server offers and the redirect URI to register |
| GET | `/mailboxes/oauth/:provider/start` | `google` or `microsoft`: the provider's consent URL |
| GET | `/mailboxes/oauth/callback` (public) | the provider redirects here; the sealed `state` identifies the user |

## Merchant offer intelligence (2026-11-25)

| Method | Path | Purpose |
|---|---|---|
| POST | `/offers/intel/import` | `{walletCardId, text}` — one offer per line; returns created / skipped / rejected (with reasons) |
| GET | `/offers/intel/inventory` | offers with source, reliability, verification, confidence cap, activation (`walletCardId`, `source`, `activation` filters) |
| GET | `/offers/intel/opportunities` | offers ranked by opportunity score (0–100) with nine reasoned factors and a confidence |
| GET | `/offers/intel/missed` | missed offers with root cause, lost value, evidence and action |
| GET | `/offers/intel/merchants/:slug/timeline` | a merchant's offer history, frequency and seasonality |
| GET | `/offers/intel/activation-queue` | offers to activate, by card, soonest first, with the issuer's public offers link |
| POST | `/offers/intel/activation/:id` | `{status: ACTIVATED \| FAILED \| PENDING, note?}` |
| POST | `/offers/intel/plan` | `{merchantId \| merchantText, amountCents, plannedFor?, save?}` — ranked plans with evidence |
| GET · DELETE | `/offers/intel/planned` · `/offers/intel/planned/:id` | saved purchase plans |
| GET | `/offers/intel/events` | the user's offer audit trail (`offerId` filter) |
| POST | `/ai/workflows/purchase-plan` | body `merchantText`, `amountDollars`; also workflow `offer-review` |

Design: `docs/merchant-offer-platform.md`.

## Loyalty asset management (branch pw-2026-feature-loyalty-mngt)

| Method | Path | Purpose |
|---|---|---|
| GET | `/loyalty/programs` | registry: programs and bank currencies with their expiration policy |
| GET · POST | `/loyalty/accounts` | accounts with balance, value, prediction · create (registry program, bank currency or custom program) |
| PATCH · DELETE | `/loyalty/accounts/:id` | update (balance changes are logged) · remove with history |
| POST | `/loyalty/accounts/:id/events` | record earn, bonus, purchase, redeem, expire, transfer, adjust or snapshot |
| GET | `/loyalty/accounts/:id/history` | monthly balance series, growth, category totals |
| GET | `/loyalty/expirations` | risk, alert wording, ways to keep points alive |
| GET · POST | `/loyalty/certificates` | free night / companion / upgrade certificates (`category` filter) |
| GET · POST | `/loyalty/certificates/opportunities` | what to use first; POST matches stays you provide |
| POST | `/loyalty/certificates/:id/check` | redemption rules against candidate stays |
| PATCH · DELETE | `/loyalty/certificates/:id` | mark used / expired, edit, remove |
| GET · POST · PATCH · DELETE | `/loyalty/status[/:id]` | elite status with progress, renewal likelihood, history |
| GET · POST · PATCH · DELETE | `/loyalty/memberships[/:id]` | memberships with expiry, renewal and card-credit suggestion |
| GET | `/loyalty/memberships/:id/number` | decrypted member number (owner only) |
| GET | `/loyalty/valuation` · `/forecast` · `/household` · `/dashboard` | value, expiration timeline, household view, summary |
| GET | `/loyalty/transfers` | routes with ratio, bonus, history stats, transfer/wait advice |
| POST · GET · DELETE | `/loyalty/award-trips[/:id]` | evaluate (and optionally save) an award trip |
| PUT | `/admin/loyalty/bonus-records` | record an observed transfer bonus (admin) |
| POST | `/ai/workflows/loyalty-review` · `/award-trip` | audited workflows |

Design: `docs/loyalty-platform.md`.

## Loyalty automation (branch pw-2026-feature-loyalty-automation)

| Method | Path | Purpose |
|---|---|---|
| POST | `/loyalty/ingest/snapshot` | extension capture; `Authorization: Bearer pw_pat_…` with scope `loyalty:ingest` (not a login token); `{program, text, pageHash?, capturedAt?, memberDigits?}` |
| GET · POST · DELETE | `/loyalty/tokens[/:id]` | extension tokens (shown once, scope `loyalty:ingest`, max 5) |
| POST | `/loyalty/import/email-sample` | `{fromDomain, subject, text, apply?}` — preview what a program email would produce, or apply it |
| POST | `/loyalty/import/statement` | multipart PDF; preview, or `apply=true` to import |
| GET | `/loyalty/observations` | every value any source reported, with outcome and reason (`outcome`, `accountId` filters) |
| POST | `/loyalty/observations/:id/resolve` | `{decision: ACCEPT \| REJECT}` for conflicts and pending changes |
| GET | `/loyalty/refresh-status` | per account: priority, freshness, confidence, source, next refresh, plan |
| POST | `/loyalty/refresh` · `/loyalty/accounts/:id/refresh` | sync connected mailboxes now and report what is still stale |
| GET | `/loyalty/health` · `/loyalty/audit` · `/loyalty/changes` | health 0–100, the eight audit questions, recent changes |
| PATCH | `/loyalty/accounts/:id` | now routed through the provenance funnel; `force: true` overrides a higher-confidence value |
| POST | `/ai/workflows/loyalty-audit` | audited workflow |
