# Merchant offer intelligence platform

Status: implemented 2026-11-25. Decisions: ADR-009 to ADR-012 in `architecture-decisions.md`. Intake and activation limits: `offer-activation-research.md`.

**Principle.** Deterministic engines compute; models only narrate public data. Every recommendation (plan, missed-offer alert, opportunity) carries a justification, its evidence, a confidence capped by source reliability, and an audit record. A plan with nothing to cite is not returned.

## 1. Offer record (one permanent record per offer)

| Field | Meaning |
|---|---|
| `id` (UUID), `issuerId`, `cardId`, `merchantId` | identity |
| `offerType` | STATEMENT_CREDIT · CASHBACK_PERCENT · POINTS_BONUS · SPEND_GET · PORTAL_RATE · COUPON |
| `valueCents`, `percent`, `points`, `minSpendCents`, `startsAt`, `endsAt`, `terms`, `url` | terms |
| `enrollmentRequired`; per user: `UserOffer.activationStatus` (NOT_REQUIRED · PENDING · ACTIVATED · FAILED), `activatedAt`, `activationVerifiedBy` (MANUAL · STATEMENT · EMAIL) | activation |
| `source`, `sourceRef`, `reliability` | where it came from and how far to trust it |
| `verification` (UNVERIFIED · VERIFIED · DISPUTED), `lastValidatedAt` | verification |
| `OfferEvent` rows | audit trail: IMPORTED, UPDATED, ACTIVATED, ACTIVATION_FAILED, ACTIVATION_VERIFIED, EXPIRED, REDEEMED, RECOMMENDED, MISSED_DETECTED, PLANNED — each with actor (USER, SYSTEM, AGENT) and a `detail` JSON of evidence and confidence |

**Source reliability** (`domain/offer-import.ts`): issuer official 100 · account data 90 · email 75 · public page 75 · curated 75 · portal 50 · AI-inferred 50 · entered by the user 25. `confidenceCap(source, verification)`: a verified offer is lifted to at least 90, a disputed one is 0. No score or plan may claim more confidence than its weakest source.

## 2. Intake (rule-compliant; nothing logs in to a bank)

| Tier | Source | Status |
|---|---|---|
| 1 | issuer data | none is available to consumers (see research); not scraped |
| 2 | account data: statement credits detected in imported statements | verifies activations (job `verify-offer-activation`) |
| 3 | pasted or imported offers (`POST /offers/intel/import`); issuer offer emails from the connected mailbox (planned hook in `mail-classify`) | built (paste); mailbox parsing is the next step |
| 4 | public promo pages, admin-curated shared offers, hand-entered portal rates (`PortalRate`) | built (curated + portal rates) |
| 5 | browser extension in the user's own session | designed only (research appendix) |

Assisted activation: the checklist (`GET /offers/intel/activation-queue`) groups offers by card, shows days left, and links to the issuer's public offers page (`Issuer.offersUrl`, opened in the user's own browser). The user clicks **Mark activated**; `verify-offer-activation` confirms it from a matching statement credit (merchant plus amount within ±10%), lifting verification to VERIFIED, or flags it FAILED when the terms were met and no credit arrived 14 days after the last qualifying purchase.

## 3. Merchant identity (`domain/merchant-resolve.ts`, `seed/merchant-identities.ts`)

Canonical merchant with `aliases[]`, `mcc[]`, `parentCompany`, `industry`. Resolution order: exact name 0.98, alias 0.92–0.97, name in text 0.90, bare host word 0.70, fuzzy (one edit, ≥ 5 letters) 0.60; a matching MCC adds 0.04, a conflicting one subtracts 0.15. Below 0.5 there is no match; below 0.8 the result is never used to drive a recommendation (`isTrusted`). About 65 merchants are seeded (Amazon and Whole Foods share a parent; Uber and Uber Eats are separate merchants of one parent; hotel brands map to their group). The statement importer's `matchMerchant` also uses aliases.

## 4. Engines (all pure, versioned, unit-tested)

| Engine | File | Output |
|---|---|---|
| Eligibility state | `domain/offer-engine.ts` | ELIGIBLE · ACTIVATED · PARTIAL · PENDING_CREDIT · COMPLETED · EXPIRED |
| Missed offers | same | per offer: cause (NOT_ADDED, NOT_ACTIVATED, WRONG_CARD, BELOW_MIN_SPEND, EXPIRED_BEFORE_PURCHASE), lost value, evidence strings, transaction ids, confidence, recommended action |
| Spending behavior | `domain/spend-behavior.ts` | per merchant: visits per month, average ticket, seasonality, subscription flag, household members; category share |
| Opportunity score | `domain/opportunity-score.ts` | 0–100 from nine factors (weights in `OPP_WEIGHTS`, sum 100): urgency 15, expected savings 25, spend frequency 15, merchant usage 10, category preference 5, simplicity 10, redemption probability 10, historical utilization 5, household relevance 5; each factor returns points and a reason; stores the weights and `opportunity/1` |
| Merchant timeline | `domain/merchant-timeline.ts` | offers per year, average and best value, seasonality, percentile of the current best offer |
| Stacking | `domain/offer-stack.ts` | components (card earn, issuer offer, portal, coupon, gift card, store sale); rules are data and flagged unverified; CONFLICT drops the smaller side, RISK halves the smaller side's expected value; warnings name the rule |
| Purchase planner | `domain/purchase-plan.ts` | ranks every household card (including authorized-user cards) by risk-weighted net return; tests splitting the spend (offer minimum on the offer card, rest on the best earner) and suggests it only if it wins by at least $1; justification, evidence, warnings, actions (what to activate first), confidence |

## 5. API

| Method | Path | Purpose |
|---|---|---|
| POST | `/offers/intel/import` | `{walletCardId, text}` → created / skipped / rejected lines |
| GET | `/offers/intel/inventory` | all offers with source, reliability, verification, confidence cap, activation; filters `walletCardId`, `source`, `activation` |
| GET | `/offers/intel/opportunities` | ranked, with per-factor reasons |
| GET | `/offers/intel/missed` | missed offers with root cause and evidence |
| GET | `/offers/intel/merchants/:slug/timeline` | offer history for a merchant |
| GET | `/offers/intel/activation-queue` · POST `/offers/intel/activation/:id` | assisted activation |
| POST | `/offers/intel/plan` | `{merchantId \| merchantText, amountCents, plannedFor?, save?}` |
| GET/DELETE | `/offers/intel/planned[/:id]` | planned purchases |
| GET | `/offers/intel/events` | the user's audit trail |

Jobs: `scan-offer-opportunities` (daily; expiring high-value offers and newly found missed offers, notifications deduplicated) and `verify-offer-activation` (daily).

## 6. Agents and workflows

Seven new profiles on the existing runtime: Offer Discovery, Merchant Intelligence, Reward Optimization, Travel Offers, Shopping Offers, Family Offer Optimization, Offer Audit (plus the existing Offer Monitoring and Portfolio Review — nine in all). Tools added: `plan_purchase`, `get_missed_offers`, `get_offer_opportunities`, `get_offer_audit_trail` — all USER-class: results go to the user, never to an external model. Workflows `purchase-plan` and `offer-review` record every step in `AgentRun` / `AgentStep`; a model may narrate only if the privacy rules allow it (a local model for the user's own data).

## 7. UI

`/offers/intel` (Opportunities with "Why this score?", Missed offers, Activation checklist, Inventory & import with source and reliability badges, Audit trail) and `/offers/plan` (merchant + amount → ranked plans with actions, warnings, evidence, save). Both are in the main menu.

## 8. Limits and open items

- **Not verified:** issuer offer terms for Amex, Citi, Bank of America and the offers-specific terms of Chase and Capital One (research document); all stacking rules (community-reported).
- No browser extension; offers arrive by paste/import, curated data and hand-entered portal rates. Issuer offer-email parsing is a follow-up on the mailbox pipeline.
- The opportunity score estimates redemption from the user's own spending history; with little history it is explicitly low-confidence.
- `Issuer.offersUrl` (the public offers page the checklist links to) is left empty because no issuer URL was verified; set it per issuer in the database. The checklist still works without it.
- Portal rates are entered by hand; portals are not scraped (Rakuten §5.1).
