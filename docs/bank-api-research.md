# Official bank API research

**Evidence status — read this first.** The live per-issuer research for this document was **not run** (the research agent was stopped by the user). Nothing below is newly verified on 2026-11-25. Sources:
- **Carried over** from `bank-and-bureau-feasibility.md` (written 2026-11-21; its sources were not recorded): no listed issuer publishes a consumer-facing account API; data programs exist for approved aggregators/partners only.
- **Background knowledge** (no URL, **UNVERIFIED**): items marked ⚠.
Treat every ⚠ item as a lead to verify against the issuer's developer site before building on it.

## 1. Findings per issuer

| Issuer | Consumer/third-party API for a cardholder's own transactions | Evidence |
|---|---|---|
| American Express | None known for individuals. A developer portal exists for partner/commercial products (e.g. corporate card data, merchant offers) ⚠ | carried over + ⚠ |
| Chase | Data sharing for approved aggregators; no individual developer access | carried over |
| Capital One | Developer programme (DevExchange) aimed at partners/commercial ⚠; FDX-based sharing for aggregators | carried over + ⚠ |
| Citi | Developer hub for partners/commercial ⚠; aggregator data sharing | ⚠ |
| Bank of America | No consumer API; aggregator data sharing | carried over |
| Wells Fargo | Gateway for approved partners; FDX-based aggregator access | carried over |
| Discover | No consumer API known ⚠ | ⚠ |
| Barclays (US) | No consumer API known ⚠ | ⚠ |
| PenFed | No consumer API known ⚠ | ⚠ |

Authentication models seen in the industry: OAuth 2.0 with FDX-style data-sharing between the bank and an approved aggregator; partner-contract API keys for commercial products. Individuals cannot obtain these.

## 2. Standards and regulation (UNVERIFIED ⚠)
- CFPB Personal Financial Data Rights rule (Section 1033) and the FDX standard are the intended basis for consumer-permissioned sharing; the rule has been in litigation and revision, so its in-force status must be re-checked before relying on it.
- Terms of service of large issuers generally prohibit sharing credentials and automated scraping ⚠ — consistent with the project rule never to log in to bank sites.

## 3. Options

| | A. Use official issuer APIs directly | B. Aggregator (see `account-aggregation-research.md`) | C. User-supplied exports/emails (PDF, CSV, alert emails) |
|---|---|---|---|
| Cost | not available to individuals | free tiers limited; paid beyond | **$0** |
| Coverage | none | broad but card coverage per issuer unverified | every issuer (statements downloadable by the cardholder) |
| Complexity | n/a | medium | medium (parsers) |
| Maintainability | n/a | vendor handles bank changes | we maintain parsers; mitigated by printed-totals validation |
| Security | n/a | token storage, vendor trust | no bank credentials ever |
| Scalability | n/a | per-Item cost | unlimited |

## 4. Recommendation
**Option C as the primary free path**, Option B only as an optional, flag-gated free-tier trial; Option A is not available. Revisit when the issuers publish a consumer API (check `bank-api-research.md` every release). Implemented: bulk PDF/CSV drop, forwarded-alert emails, email ingestion engine (Phase 4).

## 5. Implementation plan
Nothing new for this document; it records why no direct API integration is built. Verification task (free, manual): open each issuer's developer/data-sharing page and replace each ⚠ with a URL and retrieval date.
