# Brand logos and icons

## What the app shows
Logos and icons for banks and card issuers, card networks, airlines and airline programs, hotels and hotel programs, bank reward currencies, shopping portals, merchants and memberships. The directory is **Brand logos** in the menu (`/brands`); logos also appear wherever a card, issuer, merchant, program or service is named:

| Where | What shows |
|---|---|
| Wallet, wallet search, portfolio, household, benefits (and the audit and reconciliation lists), spending cards and transactions, dashboard (best card, expiring offers, annual fees), 5/24 contributing cards, ranked cards on merchant, category and nearby pages | the card face with the issuer's and network's marks (looked up from the wallet by id) |
| Merchant lists and pages, nearby stores, offers, offer intelligence (opportunities, missed offers, activation checklist, inventory), offer plans, planned purchases, spending transactions and pending alerts | the merchant's logo (transactions and alerts only when the merchant is recognised) |
| Next-card recommendations, offer market, import preview, credit-report accounts, bank connections, admin catalog | the issuer's logo |
| Every loyalty view, travel balances and transfer tables | the program or bank-currency logo |
| Mailbox buttons and list, admin AI providers | the service logo |

Only the calculator's drop-down (browsers cannot show images inside a select) and plain text such as notification messages have none.

## Where they come from
Two sources, both vendored into `frontend/public/brands/*.svg` and served by the app itself (**no request to a third party at runtime**):
- **Simple Icons (CC0 1.0)**, an open icon collection, by `frontend/scripts/vendor-brands.mjs` (58 brands). Single-colour marks filled with the brand colour.
- **Public-domain and CC0 logo files from Wikimedia Commons** (31 brands, among them Capital One, U.S. Bank, PNC, Synchrony, Navy Federal, Alaska, Hawaiian, Wyndham, Choice, Best Western, Hertz, Avis, Enterprise, Walmart, Best Buy, Chevron, Sephora, TSA PreCheck and the UnionPay, JCB and Diners Club networks). Each file page states the artwork is public domain (PD-textlogo or PD-shape: too simple to be copyrightable; PD-USGov) or CC0. They keep their own colours. `frontend/brands/sources.json` records, for every one, the file page, the licence text and the date; `public/brands/NOTICE-commons-logos.md` explains the terms.
- A brand with neither gets a **generated monogram badge** (initials on a stable dark colour, white text, contrast 4.5:1 or better). A monogram is never an imitation of a logo.

**Coverage** (147 brands): 89 have a logo and 58 a monogram. Banks and issuers 15 of 39 (the others are mostly credit unions and regional banks), airlines 27 of 27, hotels 9 of 11, shopping portals 2 of 3, merchants 25 of 47, networks 5 of 5, memberships 1 of 5, services 5 of 10, bank rewards 1 of 1. A test (`frontend/test/brand-coverage.test.ts`) fails if any issuer, merchant, loyalty program or reward currency in the catalog has no brand entry; the names come from the seed data (`backend/src/seed/brand-names.ts`, committed as `frontend/test/fixtures/catalog-names.json`, regenerated with `backend/scripts/export-brand-names.ts`).

**Looked at and not used** (30, with the reason, in `sources.json`): Costco (the file's original upload says it may not be used without permission), The Home Depot (non-free), CLEAR and DragonPass (CC BY-SA, which needs attribution and share-alike), Citi and Goldman Sachs (fair-use or non-free), Amazon, Kroger and CVS (the free file is a retired logo), T-Mobile and Nordstrom (the source is a third-party logo site), TD Bank, Truist and Alliant (non-free upload history), IHG (uses an SVG mask), Discover on Commons (embeds a raster image), Priority Pass (uses an SVG `use` element) and the credit unions and banks with no Commons file or an unconfirmed licence. Where the company publishes its own brand-asset page that allows use, that page can be added as a source the same way; none of the pages checked could be read as text or offered a direct SVG with a clear permission.

- **Card faces** show the card's catalog colour and **only the issuing bank's logo**; the payment network's mark (Visa, Mastercard, ...) is not shown on cards. They are not copies of any issuer's card art.
- **Services.** The mail, bank-link and AI services the app connects to (Gmail, Outlook, IMAP, Plaid, Anthropic, OpenAI, Gemini, Ollama, OpenRouter, OpenClaw) have brand entries too, shown on the mailbox buttons and list and on the AI provider list.
- The script reads only static data (SVG files and a JSON list); it executes none of any package's code.

## Trademarks
Logos are the trademarks of their owners. A logo can be public domain as artwork and still be a registered trademark (Commons tags every file here "Trademarked"). They are shown only to identify a card, bank, program or merchant, are not altered other than being cleaned and, for single-colour marks, filled with the brand colour, and imply no endorsement. Remove a logo (the file and its entry in `sources.json`) at the owner's request.

## Safety
Every outside logo goes through a strict cleaner (`frontend/scripts/svg-safe.mjs`) before it is served from the app's own origin: only drawing elements (shapes, gradients, clip paths) and a short list of presentation attributes are kept; scripts, styles, images, links, text, masks, filters, event handlers and external references make the file fail, and a failed file is not used. Simple class rules from Illustrator exports are turned into attributes first. Unit tests cover each refusal and check every served file.

## Adding or changing a brand
1. Edit `frontend/brands/brands.json`: `key`, `name`, `kind`, optional `simple` (the Simple Icons slug), `aliases` and `codes` (program or currency codes) used to find it. For a logo from another source, save the SVG in `frontend/brands/assets/<key>.svg` and add its page, licence text and date to `brands/sources.json`.
2. `cd /tmp && npm pack simple-icons && tar xzf simple-icons-*.tgz`, then `node frontend/scripts/vendor-brands.mjs /tmp/package`.
3. `cd frontend && npx vitest run test/brands.test.ts`.

## How a logo is found
`resolveBrand` (`src/lib/brands.ts`) matches a code, slug, name, issuer or network after normalising case and punctuation, exactly. A kind filter lets a longer name such as "Marriott Bonvoy Boundless" find the Marriott mark; without one, "Delta Faucet" does **not** match Delta Air Lines.

## Limits
- Fictional catalog issuers and any brand not in the list show monograms.
- Icons come from one open collection, so coverage is partial; adding a logo needs a permitted source (a CC0/open collection or the owner's published brand kit), never a copy from a site.
