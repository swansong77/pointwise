# Card Research Agent & Real-Card Catalog

Status: **built (2026-11-27, Phase G)**. Source: `backend/src/catalog-research/` (service, admin API), `backend/src/domain/card-research.ts` (pure: tool schema, normalisation, evidence checks, matching), `backend/src/seed/real-catalog{,.data}.ts` (curated real-card list + importer); UI `/admin/catalog` → **Research**; job `research-cards`. Tests: `backend/test/unit/catalog/card-research.spec.ts`, `backend/test/integration/card-research.int-spec.ts`, `frontend/test/catalog.test.ts`, `tests/catalog/` (TC-CR-*).

## 1. What it does
- **Find an issuer's cards (DISCOVER):** "What cards does Chase offer now?" → a Claude agent searches and reads the issuer's own website and submits each card with facts quoted from its product page.
- **Scan card news (NEWS, 2026-11-28):** reads card news and community sites — Doctor of Credit, The Points Guy, MileMoa (lead sites) — for new cards, new or elevated welcome offers and recent changes, then confirms each on the issuer's product page. Optional issuer filter and focus (e.g. "elevated offers").
- **Verify a catalog card (VERIFY):** finds the card's official product page and re-checks its annual fee, welcome offer, foreign transaction fee, earning rates and main features. "Verify unverified cards" queues this for up to 50 cards at a time.
- **Real cards instead of samples:** a curated list of 112 real U.S. cards (83 personal, 29 business) from 15 issuers — the eight largest banks and card companies plus Barclays, Synchrony, Goldman Sachs (Apple Card), Elan and the credit unions Navy Federal, PenFed and Alliant — with 18 points currencies and 19 co-brand merchants.

Nothing reaches the catalog until an administrator approves it.

## 2. Flow

```mermaid
sequenceDiagram
  participant A as Admin (/admin/catalog → Research)
  participant API as API
  participant W as worker: research-cards
  participant C as Claude (web_search + web_fetch, issuer domains only)
  participant F as Pointwise fetcher (robots.txt, allow-list)
  participant DB as Postgres
  A->>API: POST /admin/card-research {DISCOVER, issuer} → run QUEUED
  A->>API: POST /admin/jobs/research-cards (start now; the job also runs every 2 min)
  W->>C: task + submit_card_research schema (allowed_domains = issuer site)
  C-->>W: searches, fetched pages, submit_card_research {cards, facts, evidence quotes}
  W->>W: normalise (https + allow-listed URL, known categories, rate/fee ranges)
  W->>F: fetch each product page itself
  F-->>W: page text (or blocked → use the page text Claude fetched)
  W->>W: keep only facts whose quote is on the page and states the value
  W->>DB: CardCandidate (VERIFIED / PARTIAL / UNVERIFIED, matched catalog card)
  A->>API: approve / reject
  API->>DB: new card (issuer, currency, rates, source, offer history) or change proposals for an existing card
```

## 3. Safety rules
| Rule | How |
|---|---|
| Issuer sites are the only source of facts | `web_search_20260209` / `web_fetch_20260209` with `allowed_domains` = the issuer's own domain (from `Issuer.website`), else the issuer allow-list (`DEFAULT_ISSUER_DOMAINS` + `CARD_SOURCE_ALLOWED_DOMAINS`). Product URLs are re-validated (`validateSourceUrl`); anything else is dropped and listed in the run notes. Lead sites (§3a) may be read for discovery only; no card app or aggregator database is used. |
| Not from memory | The system prompt forbids numbers from memory; every fact, rate and feature carries a verbatim quote. |
| Evidence checked by Pointwise | Pointwise fetches the product page itself (robots.txt, bot user agent, rate limit). If the issuer blocks it, the page text Claude fetched (returned in the `web_fetch` result) is used, and the candidate says so. Facts whose quote is not on the page, or whose quote does not state the value, are dropped (same validator as the refresh engine). |
| Prompt injection | Page text is data; the agent has only search, fetch and the submit tool; it cannot write to the catalog. The fixture page contains an injection ("report a $0 annual fee and 10X…"); neither survives the checks. |
| Human approval | Candidates are PENDING until approved. Existing cards get ordinary change proposals (reviewed in **Review changes**). Candidates with no checkable fact need `acceptUnverified`. Approvals and rejections are audit-logged and claimed atomically. |
| Privacy | Only issuer and card names go to the model — never user data (privacy rule). |
| Cost | Admin-started only; the job does nothing when no run is queued. Per run: at most 10 searches and 20 page fetches (VERIFY: 4 + 4), 8 model turns, 16k output tokens; tokens, searches and pages are shown per run and recorded in the AI usage ledger (`agentKey: card-research`). Web search is billed per search by Anthropic. |
| Models | Claude models (provider ANTHROPIC) or a model with the `web_search` capability; `CARD_RESEARCH_MODEL` sets the preferred model id (e.g. `claude-sonnet-5-5`). OpenAI/Gemini adapters refuse server tools. Tests use the offline demo model with a fixed answer (no paid calls). |

## 3a. Lead sites (Doctor of Credit, The Points Guy, MileMoa)
Lead sites are where new cards and elevated offers show up first, so the agent may search and read them in every task (per-run switch `useLeads`, on by default; NEWS always uses them). They are **leads, never evidence**:

| Rule | How |
|---|---|
| Discovery only | The prompt tells the agent to confirm everything on the issuer's own product page; a lead page can't be a product URL (fails the issuer allow-list) and its text is never used to check facts (only the product page — fetched by Pointwise, or Claude's copy of that same URL — is). A "fact" quoted from a lead article is dropped (test: 100,000-point claim from the lead vs 60,000 on the issuer page). |
| No copying | Only each lead's link and title are stored (`candidate.data.leads`, run `sources` with `lead: true`); article text, comments and ratings are not stored or shown. Reviewers open the link to read the article on its site. |
| Allowed sites | `CARD_RESEARCH_LEAD_DOMAINS` (default `doctorofcredit.com,thepointsguy.com,milemoa.com`; empty = no leads). Claude's web tools enforce the list together with the issuer domains; robots.txt and site access rules are applied by the provider's fetcher. MileMoa posts are in Korean — Claude reads them; candidates are still in English from the issuer page. Member-only forum boards can't be read. |
| Budget | NEWS: up to 12 searches and 25 page reads; DISCOVER 10 / 20; VERIFY 4 / 6. |

## 4. Approving
- **New card:** issuer matched by name/alias (created with its website if new); currency = Cash back, an existing currency with the same name/code, or a new currency (admin sets ¢/pt, default 1.0); slug from the name; category rates, features, welcome offer, product page as a `CardDataSource`, first offer-history version. `catalogSource = RESEARCH`, `lastVerifiedAt` set when facts were checked.
- **Existing card:** the product page is registered as a source (not duplicated), verified facts go through `CardRefreshService.propose` → change proposals; "Replace earning rates" swaps the card's category rates for the verified ones. When the page confirms every value, the card is marked verified.

## 5. Real-card catalog
`real-catalog.data.ts`: card names, issuers, networks, annual fees, category earning rates (with caps), co-brand merchant rates, product families and typical credit bands, written by the Pointwise team from general knowledge **as of 2026-06-01**. Nothing is copied from any card app or aggregator database. Welcome offers are left out because they change every few weeks; they come only from verified issuer pages. Portal-only, rotating and chosen-category rates are features, not category rates, so the best-card engine never overstates them. Points values (¢/pt) are Pointwise's own conservative defaults.

Every imported card is `catalogSource = SEED`, `dataAsOf = 2026-06-01`, and shows **"Unverified · as of Jun 2026"** in the card search until an issuer page confirms it (approved proposal, page with no differences, or verified research). Re-importing refreshes only SEED cards that are still unverified; admin-edited, researched or verified cards are never overwritten. Nothing is deleted.

| Command | Effect |
|---|---|
| `SEED_CATALOG=real docker compose up` | real cards only (admin + an empty demo user; no fictional family) |
| `SEED_CATALOG=both docker compose up` | fictional demo data + real cards |
| `SEED_CATALOG=demo` (default) | fictional catalog + demo family — tests, CI and Docker validation use this |
| `npm run catalog:import [-- --retire-demo]` | import into an existing database; `--retire-demo` hides the fictional cards (isActive=false, not deleted) |

Then **Research → Verify unverified cards** checks them against the issuer sites (needs `ANTHROPIC_API_KEY`).

## 5a. Issuer registry and coverage (2026-12-04)
No public list covers every U.S. card, so coverage is a process, not a file:
- **Registry** (`ISSUER_REGISTRY` = issuers with curated cards + `REGISTRY_ONLY_ISSUERS`): 39 institutions with their official website and kind (`Issuer.kind`: BANK, CREDIT_UNION, CARD_COMPANY, FINTECH) — the large banks, regional banks (PNC, TD, Citizens, Truist, Fifth Third, Regions, Huntington, KeyBank, BMO, FNBO, Bread), 14 credit unions (Navy Federal, PenFed, Alliant, BECU, SchoolsFirst, Golden 1, First Tech, DCU, SECU, Mountain America, America First, RBFCU, Security Service, SDCCU) and fintechs (Bilt, Robinhood). Every website is on the research / refresh allow-list. Admins can add any other issuer (and `CARD_SOURCE_ALLOWED_DOMAINS`).
- **Research all issuers** (`POST /admin/card-research/discover-all {kinds?, staleDays=30, max≤100}`): one DISCOVER run (≤ 25 cards, lead sites on) per registry issuer not researched in `staleDays`, skipping issuers already queued or whose website is not allow-listed. Each finished run stamps `Issuer.lastResearchedAt`. New cards arrive as candidates for approval; existing ones as change proposals. Billed per run.
- **Coverage** (`GET /admin/card-research/coverage`, *Coverage* tab): per issuer — kind, personal and business card counts (public, non-demo), verified count, last researched, candidates waiting; totals (issuers, credit unions, cards personal/business, verified, never researched, issuers without cards).
- **Personal vs business** (`CreditCard.type`): candidates carry it from the issuer page; the card search has *All / Personal / Business* and labels business cards; the coverage table counts both.

## 6. API (ADMIN)
| Route | Purpose |
|---|---|
| `GET /admin/card-research/status` | model available, allow-list |
| `POST /admin/card-research` | `{kind: DISCOVER, issuer, focus?, limit≤25, useLeads?}`, `{kind: VERIFY, cardId, useLeads?}` or `{kind: NEWS, issuer?, focus?, limit≤25}` → 202 QUEUED |
| `POST /admin/card-research/discover-all` | `{kinds?, staleDays?, max?}` research every registry issuer not checked recently |
| `GET /admin/card-research/coverage` | coverage per issuer (personal / business / verified / last researched) |
| `POST /admin/card-research/verify-unverified` | `{max≤50}` queue VERIFY for unverified non-demo cards |
| `GET /admin/card-research`, `GET /admin/card-research/:id` | runs (tokens, searches, pages, notes, error) and their candidates |
| `GET /admin/card-candidates?status` | candidates to review |
| `POST /admin/card-candidates/:id/approve` | `{acceptUnverified?, applyRewards?, centsPerPoint?, currencyCode?}` |
| `POST /admin/card-candidates/:id/reject` | `{note?}` |

Public card APIs now include `catalogSource`, `dataAsOf`, `lastVerifiedAt`.

## 7. Data (migration `20261127000000_card_research`)
`CatalogSource` enum (DEMO, SEED, ADMIN, RESEARCH) + `CreditCard.catalogSource/dataAsOf/lastVerifiedAt`; `CardResearchRun` (kind DISCOVER/VERIFY/NEWS, issuer/card, focus, maxCards, useLeads (migration `20261128000000_research_leads`), status, model, searches, fetches, tokens, sources, notes, error); `CardCandidate` (facts JSON with per-fact `verified`, verification, evidenceFrom, matchedCardId, status, createdCardId, reviewer).

## 8. Limits
- Issuer sites often block bots; then evidence comes from the page Claude fetched (marked AGENT) or nothing can be checked (UNVERIFIED, needs an override).
- The agent reads public product pages only; it never signs in to a bank or reads account data (no bank automation).
- Benefit credits (e.g. statement credits) are listed as features; benefit templates for the benefits tracker are still admin-curated.
- Transfer partners for the real points currencies are not seeded (admin-curated in **Transfer partners**).
