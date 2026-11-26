# Phase 22 — Performance Review

## 1. Latency targets (SLOs)

| Endpoint class | p50 | p95 | p99 | Notes |
|---|---|---|---|---|
| Recommendations (category/merchant) | 20 ms | 100 ms | 200 ms | 4 small indexed queries + pure ranking |
| Dashboard | 60 ms | 250 ms | 500 ms | ~7 queries in parallel (`Promise.all`) |
| Catalog search | 15 ms | 150 ms | 300 ms | ILIKE on name/issuer; trigram index in Scale |
| Writes (wallet/offers) | 25 ms | 400 ms | 800 ms | includes ownership check |
| Login | 150 ms | 400 ms | — | argon2id cost dominates (intentional) |
| Frontend | LCP < 2.5 s (4G), INP < 200 ms, CLS < 0.1 | | | First-load JS 103–131 kB per route (measured, `next build`) |

## 2. Measurements (2026-11-21, Apple Silicon dev machine)

| What | Result | How |
|---|---|---|
| Ranking 50 cards × 16 categories (one dashboard) | **0.106 ms** | `backend/scripts/bench-domain.ts`, 2,000 iterations |
| Calculator 50 cards × 16 categories | **0.109 ms** | same |
| Full integration suite (31 tests, ~250 HTTP calls incl. 30+ argon2 hashes) | 4.9 s | Jest against local Postgres in Docker |
| Next.js production bundle | shared 103 kB; largest route `/dashboard` 131 kB first load | `next build` output |

**Conclusion:** CPU in the domain layer is negligible. Latency is dominated by database round-trips and argon2 (by design). Load testing (k6) against the compose stack is scheduled once Docker validation is unblocked (see docker-validation.md).

## 3. Rendering

- All authenticated pages are client components with TanStack Query: shell renders immediately, data loads in parallel; `staleTime 30 s` avoids refetch storms when navigating.
- Static prerendering for 12 of 18 routes (`○` in build output); dynamic routes (login, `[slug]`, auth handler) are server-rendered on demand.
- No images or web fonts (emoji icons, system font stack) → minimal network weight.
- Improvements: server components with streaming for `/dashboard` (hydrate less JS); `next/dynamic` for admin/calculator tables; prefetch merchant pages on hover.

## 4. Database

| Query | Index | Status |
|---|---|---|
| Wallet cards by `walletId` | `WalletCard(walletId)` | ✅ |
| Rewards by `cardId` | `Reward(cardId)` | ✅ |
| User offers by status / wallet | `UserOffer(status)`, unique `(walletCardId, offerId)` | ✅ |
| Offers by merchant / card / end date | `Offer(merchantId)`, `(cardId)`, `(endsAt)` | ✅ |
| Nearby | `Location(latitude, longitude)` composite + bbox pre-filter, then haversine in app | ✅ (good to ~1M rows; PostGIS `geography` + GiST for Scale) |
| Notifications unread | `Notification(userId, readAt)` | ✅ |
| Catalog text search | `CreditCard(name)` btree (prefix only) | ⚠ add `pg_trgm` GIN on `name` for `ILIKE '%q%'` |
| Analytics by name/time | `(name, createdAt)` | ✅ (partition monthly at Scale) |

N+1 review: services use `include` to fetch relations in one round-trip; `scanExpiringOffers` loops per user with notifications enabled (**N queries**). At Scale, replace it with a single set-based query joined to preferences and batch `createMany(skipDuplicates)`.

Connection pooling: Prisma default pool (`num_cpus*2+1`); for many API replicas, put PgBouncer (transaction mode) in front.

## 5. Caching

See backend-spec.md §6. Priority order for Launch: (1) Redis cache for catalog lists (read-heavy, admin-invalidated); (2) per-user wallet snapshot for recommendations/nearby/dashboard (invalidate on wallet, pin or valuation writes); (3) CDN caching of public catalog GETs.

## 6. API throughput

- Stateless API scales horizontally; throttler storage must move to Redis before running more than one replica.
- Estimated capacity per API replica (1 vCPU): ~800–1,200 RPS for cached reads; ~300 RPS for dashboard without cache (DB-bound). Login is limited to roughly 30–40/s per core by argon2 (64 MiB, t=3). Scale login separately or tune argon2 memory to the hardware.
- Worker: jobs are I/O bound; the expiring-offer scan should be set-based before 100k users (see §4).

## 7. Load test plan (k6)

```js
// k6/recommendations.js (to be added in Beta)
import http from 'k6/http';
export const options = { scenarios: { steady: { executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s', duration: '5m', preAllocatedVUs: 50 } },
  thresholds: { http_req_duration: ['p(95)<100'], http_req_failed: ['rate<0.001'] } };
export default function () {
  http.get(`${__ENV.API}/api/v1/recommendations/categories/dining`, { headers: { Authorization: `Bearer ${__ENV.TOKEN}` } });
}
```
Scenarios: recommendations 200 RPS, dashboard 50 RPS, catalog search 100 RPS, mixed write 20 RPS, login 10 RPS. Pass criteria match §1.
