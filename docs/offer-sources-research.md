# Offer sources research (free-only)

**Evidence status.** The live research for this document was **not run** (research agent stopped by the user). Sources: the project's own `card-research-agent.md`, `card-refresh-engine.md` and `card-offer-history.md`; items marked ⚠ are background knowledge, **UNVERIFIED on 2026-11-25**. The code already enforces the safe rules below (robots.txt, allow-list, rate limit).

## 1. Candidate sources

| Source | Automatable? | Cost | Reliability | Risk |
|---|---|---|---|---|
| **Issuer product / apply pages** (americanexpress.com, chase.com, capitalone.com, citi.com …) | yes, if robots.txt allows and terms do not forbid ⚠ — fetcher checks robots and rate-limits | $0 | high for the public offer; **targeted/personalised offers are not visible** | pages change layout; some block bots |
| **Issuer public offer/press pages** | same | $0 | high | same |
| **Affiliate/publisher programs** (card affiliate networks) | feeds exist but require an approved publisher account ⚠ | free to join, contract terms | structured | approval, disclosure rules |
| **Community aggregator sites** (Doctor of Credit, The Points Guy, MileMoa, Frequent Miler) | **lead only**: reading for ideas is fine, copying content is not (copyright/ToS ⚠) | $0 | fast but unofficial | accuracy, copyright |
| **Partner promotions / transfer bonuses** (loyalty program pages) | yes, same rules as issuer pages | $0 | high | layout churn |
| **Targeted offer feeds / in-app offers** | not accessible without logging in to the issuer | – | – | never done (no bank logins) |
| **User reports** (retention offers; existing `RetentionOfferReport`) | yes | $0 | crowd-sourced | anonymised and aggregated |

## 2. Options

| | A. Issuer pages only, auto-publish verified | B. A + community sites as leads, admin review | C. Paid data licence |
|---|---|---|---|
| Cost | $0 | $0 | paid — **not used** |
| Accuracy | high for public offers | adds early signals, needs review | high |
| Legal risk | low | low (leads only, no copying) | low |
| Maintenance | extractor upkeep | + lead curation | vendor |

## 3. Recommendation
**Option B with the policy chosen in ADR-003:** scheduled fetch of registered issuer pages; changes that are extracted from the issuer's own domain, match a known card and pass plausibility bounds are **published automatically** (audited, notified); everything else — new cards, large jumps, anything derived from a lead site — goes to the admin review queue. Community sites stay leads (the research agent already treats them as such and requires issuer-page verification).

## 4. What is collected
Issuer, card, bonus amount/type, cash/points/miles value (valuation table), minimum spend and window, annual fee and first-year waiver, expiration date, source URL, import timestamp, and full version history (`CardOffer`, `card-offer-history.md`).

## 5. Implementation plan (Phase 1)
Scheduled refresh job; `AutoPublishPolicy` (pure, tested); `offer-intel` domain functions; `/offers/market` dashboard.

## 6. Verification tasks (free)
For each registered issuer page: read robots.txt and terms, record URL and date here; replace each ⚠ above.
