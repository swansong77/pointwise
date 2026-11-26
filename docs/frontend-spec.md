# Phase 13 — Frontend Specification (Next.js)

Source: `frontend/src`. App Router; all authenticated pages are client components using TanStack Query against the same-origin API proxy (`/api/v1/*` → NestJS).

## 1. Global structure

| Element | File | Notes |
|---|---|---|
| Root layout | `app/layout.tsx` | `Providers` (SessionProvider, QueryClientProvider) |
| Auth route | `app/api/auth/[...nextauth]/route.ts` | NextAuth handlers |
| Route guard | `middleware.ts` | Redirects to `/login` without a session; `/admin/*` requires `role=ADMIN` |
| App shell | `components/app-shell.tsx` | Header (logo, unread badge, avatar, sign-out), sidebar nav (Admin link only for admins), skip link, mobile toggle |
| UI kit | `components/ui.tsx` | Button, Field, Input, Select, Panel, Badge, EmptyState, Spinner, ErrorText, ProgressBar, PageHeader |
| Data hooks | `lib/queries.ts` | Query keys + `useApiMutation` (invalidates keys on success) |
| API client | `lib/api.ts` | `apiFetch`, `ApiError`, `useApi()` (adds Bearer from session) |

## 2. Pages

| Page | Route | Data (API) | Key interactions | States |
|---|---|---|---|---|
| Landing | `/` | session (server) | Redirect to dashboard if signed in | — |
| Login | `/login` | NextAuth credentials | Email/password; Google/Apple buttons if configured; safe `callbackUrl` (open-redirect protection) | invalid credentials, OAuth error |
| Signup | `/signup` | `POST /auth/register` → signIn | Client password rule mirrors API; redirect to `/wallet?welcome=1` | duplicate email (409) |
| Forgot / Reset password | `/forgot-password`, `/reset-password?token=` | `/auth/forgot-password`, `/auth/reset-password` | Same success message whether or not the account exists | expired token |
| Dashboard | `/dashboard` | `GET /dashboard` | Stats tiles; best card per category (links to category); expiring offers; welcome-bonus progress bars (at-risk tone); upcoming annual fees; 5/24 | empty wallet CTA |
| Wallet | `/wallet` | `GET/POST/PATCH/DELETE /wallet/cards`, `/cards?q=`, `/categories` | Search & add card (approval date, last 4 validated); edit nickname/status; activate rotating categories; remove with confirm | plan limit 403 message |
| Offers | `/offers` | `/offers/mine`, `/offers/eligible`, `POST /offers/mine`, `PATCH`, `DELETE`, `POST /offers/custom` | Tabs Active/Redeemed/Expired; sort; add eligible offers; mark redeemed; partial amount; snooze 7 days; favorite; custom offer form | empty per tab, 422 rule errors shown inline |
| Nearby Offers | `/nearby` | `GET /nearby` | Browser geolocation (or demo location); radius; per-store best card + offers | permission denied, no results |
| Merchants | `/merchants` | `/categories`, `/merchants?q=` | Category chips; merchant search (name or domain) | no results |
| Merchant Details | `/merchants/[slug]` | `/recommendations/merchants/:slug`, `/merchants/:slug` | Ranked cards here; my offers here; all current offers | no cards CTA |
| Category | `/categories/[slug]` | `/recommendations/categories/:slug`, pins | Ranked cards; pin/unpin a card for the category | — |
| Reward Calculator | `/calculator` | `/categories`, `/cards`, `/subscription`, `POST /calculator` | Annual spend per category (defaults); optional candidate card (Pro); results table, gross/fees/net; comparison callout | invalid dollar input |
| Notifications | `/notifications` | `/notifications`, read, read-all | Unread styling; view link marks read | all caught up |
| Settings | `/settings` | `/me`, `/subscription`, `/notifications/preferences`, `/me/export`, `DELETE /me` | Profile name; plan cards (month/year/lifetime); cancel/resume; notification toggles and expiring-days; download data; delete account (type DELETE) | — |
| Admin Portal | `/admin` | `/admin/stats`, `/admin/users`, `/admin/audit`, `/admin/jobs/:name/run`, `/admin/offers` | KPIs; run jobs; create catalog offer; user list with role change; audit log | 403 for non-admins (middleware + API) |

### Portfolio revision pages

| Route | Purpose | Data | Key components |
|---|---|---|---|
| `/portfolio` | Active / authorized-user / closed (/applied) cards with fee, benefits used/face, rewards, effective value, break-even; value by card and by cardholder | `GET /portfolio`, `/household/members` | `StatTiles`, `Tabs`, `BarList`, scrollable table region |
| `/benefits` | Available / expiring / completed / missed benefits; log usage; add custom benefit; auto-tracking per benefit (rules or "suggested", latest automatic matches with credit expected / posted, "Not this benefit", edit rules / reset / off) | `GET /benefits/summary`, `/wallet/cards` | `ProgressBar`, inline usage form |
| `/five24` | Per-member gauge, next-slot date, counted / not-counted cards with reasons, projection chart; credit-report open-date entry | `GET /five24`, `/credit-reports/accounts` | `Five24Gauge`, `Five24TimelineChart` (inline SVG, list alternative) |
| `/household` | Members with their cards, 5/24 and totals; add/rename/remove members | `GET /household/dashboard` | — |
| `/import` | Upload xlsx/csv → preview rows → commit; CSV template; bank connections (when configured); history | `POST /imports`, `/connections/*` | `FormData` upload (JSON content-type only for string bodies) |
| `/settings` | + benefit alert toggles and browser push opt-in (`/sw.js` service worker) | `/notifications/preferences`, `/notifications/push/*` | `PushToggle` |

| `/assistant` | Chat with an assistant (agent + model picker, suggested spec questions, "data used" trace, demo-model badge, pending actions to confirm, monthly token usage); consent panel first | `/ai/*` | `Answer` (text rendered as plain lines — no HTML) |
| `/settings` | + AI assistant (consent, preferred model, usage) and "Connect an AI app (MCP)" tokens | `/ai/settings`, `/me/tokens` | — |
| `/next-card` | Who should apply next (household pick), ranked cards per member with first-year / ongoing value, return on fee, 5/24 chip, confidence, reasons, warnings; credit-use selector; credit-band picker with approval-odds chips; monthly spend editor | `/household/next-card`, `/recommendations/next-card`, `/me/spend-profile` | `Panel`, `Badge`, `Select` |
| `/travel` | Balances per member (add / remove), best use of each balance with transfer bonuses, award planner, fine-print search (highlighted snippets), partner table | `/me/balances`, `/travel/transfers`, `/travel/plan`, `/transfer-partners` | `Panel`, `Field`, `Badge` |
| `/admin/ops` | Status, problems, DB/Redis latency, queue, scheduled jobs (next / last run), AI model circuits and error rates, MCP and card-source health, 7-day events; refreshes every 15 s | `/admin/ops/health`, `/admin/ops/logs` | `StatTiles`, `Badge` |
| `/import` (credit report) | *Credit reports (Experian, Equifax, TransUnion)*: up to 3 report PDFs and/or pasted text, where to get each report, whose report → preview per card account (opened date / precision, status, AU, limit, reporting bureaus, bureau date disagreement, matched card and how, date conflict) with action Set date / Add card / Skip and replace-date option → result | `/credit-reports/import/preview`, `/credit-reports/import` | `Panel`, `Select` |
| `/spending` | **Automatic import** panel (cards automated N of M with via bank / alert emails / not automated, forwarding address with copy / pause / new address, Gmail steps + filter + confirmation code, *Which card?* assignment, recent alert emails); Spending: 30-day totals, statement PDF or CSV import (card, file, sign override for CSV → preview table with type, category/merchant, matched benefit and why → import result with benefit updates), transaction list (card / matched filters, benefit badges expected / posted) | `/spending/summary`, `/spending/statements/preview`, `/spending/statements`, `/spending/transactions` | `StatTiles`, `Panel`, `Badge` |
| `/admin/catalog` | Card data: review change proposals (old → new, evidence quote, confidence, flags; approve / approve with correction / reject), issuer-page sources (add, refresh now, paste page text), welcome offers vs 24-month median with elevated badge, transfer partners (ratio, days, bonus), **Coverage** (totals; per-issuer personal / business / verified / last researched / to review; filter by institution type; *Research … not checked in 30 days*), **Research** (start DISCOVER/VERIFY runs, "verify unverified cards", run list with tokens/searches/pages, candidates with ✓/? per quoted fact, approve → catalog / change proposals, reject) | `/admin/card-proposals`, `/admin/card-sources`, `/admin/card-research`, `/admin/card-candidates`, `/admin/cards/:id/extract`, `/welcome-bonuses` | `Tabs`, `Table`, `Badge` |
| `/admin/ai` | Providers & write-only keys, models (prices, capabilities, test), assistants, usage & cost, MCP servers (register, check, approve/enable tools) | `/admin/ai/*`, `/admin/mcp/*` | `Tabs`, `BarList`, `StatTiles` |

Charts are plain inline SVG (no chart library, CSP-compatible) with accessible names and text alternatives.

## 3. State management

- **Server state:** TanStack Query. Defaults: `staleTime 30s`, no refetch on focus, no retry on 4xx. Mutations invalidate affected keys (e.g. a wallet change invalidates `wallet` and `dashboard`).
- **Session state:** NextAuth JWT session (`accessToken`, `role`, `error`). `SessionProvider` refetches every 5 min; the JWT callback refreshes backend tokens 60 s before expiry. A `RefreshAccessTokenError` triggers sign-out.
- **Local UI state:** React `useState` only. No global client store is needed.

## 4. Design system

- Tailwind with a `brand` (indigo) palette and slate neutrals; rounded-2xl panels; emoji category icons (no icon font dependency).
- Card identity is shown as a color swatch derived from the card's `color`.
- Money is always formatted from integer cents (`lib/format.ts`).

## 5. Accessibility (WCAG 2.2 AA targets)

Skip link; `aria-current` on the active nav item; labelled inputs via `Field`; `role="alert"` for errors; `role="status"` for loading/success; `role="progressbar"` with values; tabs implement `role="tablist"/"tab"` with `aria-selected`; buttons have accessible names (e.g. "Add Contoso Gold"); visible focus rings; color is never the only status signal (badges include text).

## 6. Security (client)

CSP (`default-src 'self'`, no third-party scripts), `frame-ancestors 'none'`, nosniff, strict referrer, `Permissions-Policy` (geolocation self only). No tokens in `localStorage`. All API calls go same-origin. `callbackUrl` is sanitized. `lastFour` is validated client- and server-side, and full card numbers are never accepted.

## 7. Testing hooks

Stable `data-testid` attributes: `login-submit`, `signup-submit`, `stats`, `best-by-category`, `expiring-offers`, `bonuses`, `renewals`, `five-twenty-four`, `add-card-panel`, `card-search-results`, `wallet-card`, `wallet-list`, `offer-row`, `offer-list`, `eligible-offers`, `custom-offer-form`, `redeem`, `demo-location`, `nearby-item`, `merchant-results`, `merchant-ranking`, `category-ranking`, `calculate`, `calc-results`, `gross`, `net`, `comparison`, `notification`, `read-all`, `plan-month|year|lifetime`, `cancel-subscription`, `export-data`, `admin-stats`, `admin-jobs`, `admin-users`, `nav-notifications`, `unread-badge`, `sign-out`.
