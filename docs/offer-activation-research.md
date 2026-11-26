# Offer activation research

Retrieved **2026-11-25**. **VERIFIED** = read on the issuer's or portal's own page; **UNVERIFIED** = not reached (the page failed to load or could not be found) — nothing here is filled in from memory. The Amex Website Rules and Card Agreements pages failed to load (parse error), the Citi and Bank of America terms were not reachable, and none of the five issuers' *offers-specific* terms were reached, so most of the matrix is unverified.

## 1. What was read

| Source | Fact | Status |
|---|---|---|
| Chase Terms of Use (`chase.com/digital/resources/terms-of-use`) | Unauthorized use includes "robots, spiders, scripts"; AI agents "must clearly and deterministically label all agentic traffic"; Chase may "limit, prevent, suspend, or terminate" AI-agent access; users must limit access to their password "to authorized individuals" | VERIFIED |
| Capital One Website Terms (`capitalone.com/digital/terms-conditions/`, last modified 07/14/2026) | No bot/scraping/automated-access clause found; "Unauthorized use of the Site is prohibited." Online-banking terms not read | VERIFIED (site terms only) |
| Rakuten Terms (`rakuten.com/help/article/terms-conditions`, first ~40k of 58k characters) | Prohibits access "by expert system, electronic agent, 'bot' or other automated means" and "scrape/crawl/spider"; card-linked offers require linking a payment card and adding offers in the app; the browser extension sets a tracking cookie; password confidentiality (§11.1) | VERIFIED |
| Rakuten homepage, store pages | Logged-out pages show store cash-back rates (e.g. `rakuten.com/shop/bestbuy`) | VERIFIED |
| Amex, Citi, Bank of America, Chase Offers, Capital One Offers, BankAmeriDeals terms | how activation works, automation and credential-sharing positions | **UNVERIFIED** |
| Public (logged-out) merchant-offer lists for Amex, Chase, Citi, Capital One, BofA | none found | UNVERIFIED |

## 2. Methods
| Method | Verdict | Why |
|---|---|---|
| User pastes or imports their own offers (text/CSV) | **Allowed** | the user's own data entered by hand; no issuer system touched |
| Offer emails read from the user's connected mailbox (read-only) | **Allowed** | the user's own mail, issuer sender allow-list, DKIM/DMARC check |
| Statement-credit detection (PDF/CSV/alerts already imported) | **Allowed** | uses data the user provides |
| Public merchant/issuer promo pages, `robots.txt` respected | **Allowed with care** | existing fetcher rules (allow-list, rate limit); no logged-in pages |
| Admin-curated shared offers; hand-entered portal rates | **Allowed** | no scraping of portals (Rakuten §5.1 forbids bots/scraping) |
| Assisted activation: open the issuer's offers page in the user's own browser, user clicks "add" | **Allowed** | the user acts; PointWise only links and records |
| Server-side login with the user's credentials; bots that click "add to card" | **Restricted — not built** | Chase and Rakuten prohibit scripts/bots/automated access (verified); sharing credentials conflicts with password-confidentiality terms; breaks the project rule |
| Scraping portal rate pages | **Restricted — not built** | Rakuten §5.1 |
| Browser extension reading the user's own logged-in offers page | **Design only** (appendix) | issuer terms on automated access are unverified for most issuers; Chase's terms make "scripts" and AI-agent traffic a risk; needs per-issuer review before any build |

## 3. Recommendation
Build intake from the allowed methods and **assisted activation**: a bulk checklist and deep link to each issuer's own offers page (a configurable public URL per issuer), `mark activated`, and automatic verification later from a statement credit or confirmation email. Every offer carries its source and a reliability score (official 100, account data 90, email 75, AI-inferred 50, user-entered 25). No recommendation is made without evidence and a confidence value.

## 4. Risk assessment
| Risk | Level | Mitigation |
|---|---|---|
| Issuer terms forbid automated activation | high if automated | not automated; the user performs every activation |
| Offer data goes stale | medium | expiry dates, `lastValidatedAt`, nightly validation job, reliability-capped confidence |
| Wrong merchant resolution | medium | alias table + confidence; low-confidence matches are flagged, never auto-recommended |
| Stacking rules wrong | medium | rules marked community-reported until verified; shown as warnings, not facts |
| Privacy | low | deterministic engines; no offer or spend data to AI providers |

## 5. Appendix — browser extension design (not built)
A Chrome/Firefox extension would run **in the user's own browser session**, read the offers list the page already displays (DOM only, no credentials, no network calls to the issuer beyond the page itself), and send a normalised list (merchant, value, min spend, expiry, card ending) to the user's own PointWise server with a personal access token. It never clicks "add". Open issues before any build: per-issuer terms on scripts and extensions (Chase prohibits "robots, spiders, scripts"), extension-store review, token scope, and whether capturing is user-initiated only. Treat this as a separate decision.

## 6. To verify (free)
Read each issuer's offers terms from its own help centre (Amex Offers, Chase Offers, Citi Merchant Offers, Capital One Offers, BankAmeriDeals) and replace the UNVERIFIED rows with URLs and dates.


## 7. Update 2026-11-26 — offer automation
The member asked for automated discovery and enrollment and chose to build opt-in server-side login connectors, a browser extension (read-only capture plus user-clicked adds) and offer-email intake. See `merchant-offer-automation-review.md`, ADR-021 to ADR-024 and `offer-automation.md`. This section's "Restricted - not built" rows still describe the default; the connectors are off unless the server and the account both opt in, and none has been verified against a real issuer.
