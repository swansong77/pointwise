# Issuer listings check (free catalog verification)

The paid research agent (docs/card-research-agent.md) stays **off**. No API key is configured and nothing billable runs. The catalog is instead checked against each issuer's own "all credit cards" pages, read on **2026-11-22** in a Claude Code session on the owner's existing subscription. Nothing came from aggregators or lead sites, and no bank site was logged into.

## What is recorded

`backend/src/seed/verified-listings.ts` holds one `IssuerListing` per issuer:
- the pages read (`sources`);
- whether the whole lineup was read (`complete`);
- each card's name, personal/business, annual fee, network when stated, headline earning, and product page;
- category rates only where the page stated them.

Rules:
- **Fees are recorded only as stated.** A card whose fee the page did not show is left out; nothing is guessed. Examples: PNC Secured (fee only in a PDF), TD Clear (monthly fee), BECU business cards, Citi AAdvantage Globe, U.S. Bank Shield and Altitude Connect.
- **Cards are retired only from complete listings.** A curated card is marked discontinued only when a complete listing no longer shows it. Two were retired: Capital One Walmart Rewards and Barclays AAdvantage Aviator Red. Incomplete listings never retire anything.
- **A slug** links an entry to a curated card. Other entries become new SEED cards; their slug is `listingSlug(issuer, name)`, which keeps "+" as "plus".

## How it is applied

`applyVerifiedListings` runs on every `SEED_CATALOG=real|both` seed and on `npm run catalog:import`, after the curated import. It uses no network and no AI.

| Case | Effect |
|---|---|
| Curated SEED card on a listing | name, type, network, fee (and rates when stated) updated; `lastVerifiedAt` and `dataAsOf` set to the listing date; `verifiedScope = ISSUER_LISTING`; product page added as a `CardDataSource` |
| New card on a listing | created as a SEED card with the stated facts; the issuer's earning text kept as a feature |
| Curated card missing from a complete listing | `productStatus CLOSED_TO_NEW`, `isActive false` (wallets that hold it keep it) |
| ADMIN or RESEARCH card | never changed; only its product page is registered |

Product pages must pass `validateSourceUrl` (the issuer domain allow-list). The free, rule-based refresh engine (docs/card-refresh-engine.md) then re-checks those pages on its schedule.

The app shows these cards as **"On issuer site · Nov 2026"**. The badge's tooltip says that only the name, type, fee and headline earning were checked, and that full terms are on the product page.

## Coverage (2026-11-22)

**Read (complete or partial):**
- **Big issuers:** Chase, Capital One, Citi (24 of 25 cards), Bank of America, Wells Fargo (personal), U.S. Bank (partial), Discover, Barclays (listing plus 26 product pages).
- **Fintechs and partner cards:** Apple Card (Goldman Sachs), Fidelity (Elan), Synchrony (its own Mastercards), Bread Financial, Bilt, Robinhood.
- **Regional banks:** PNC, TD, Truist, Regions.
- **Credit unions:** Navy Federal, DCU, SDCCU, BECU (personal).

**Blocked or moved (403, 404, timeout or client-side rendering):** American Express listing, Citizens, Huntington, KeyBank, BMO, FNBO, Fifth Third, Alliant, PenFed, SchoolsFirst, Golden 1, First Tech, SECU, Mountain America, America First, RBFCU, Security Service. Their curated cards keep the "Unverified" badge. An admin can confirm them from the product page (Catalog → card → sources) or re-read them later.

## Tests

- `test/unit/catalog/verified-listings.spec.ts` (data):
  - references valid issuers, slugs, categories and currencies;
  - retires only from complete listings;
  - every URL is allow-listed;
  - fees are recorded and slugs are unique.
- `test/unit/catalog/verified-listings-apply.spec.ts` (behaviour):
  - corrections;
  - ADMIN cards untouched;
  - new cards;
  - SEED-only retirement;
  - idempotency.
