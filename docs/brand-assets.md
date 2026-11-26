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
- **Icons: Simple Icons (CC0 1.0)**, an open collection of brand icons, vendored into `frontend/public/brands/*.svg` by `frontend/scripts/vendor-brands.mjs`. The app serves them itself: **no request to a third party, no hot-linking, nothing scraped from any company's website.** The licence text ships in `public/brands/LICENSE-simple-icons.md`; the manifest `src/lib/brands.generated.json` records each icon's source and version.
- **52 brands have an icon**; **45 do not** (for example Hyatt, IHG, Citi, Capital One, U.S. Bank, Alaska, Hawaiian, Costco, Walmart, Amazon, CLEAR). The collection omits some marks, and none were copied from elsewhere. Those brands show a **generated monogram badge** (initials on a stable dark colour, white text, contrast ≥ 4.5:1). A monogram is never an imitation of a logo.
- **Services.** The mail, bank-link and AI services the app connects to (Gmail, Outlook, IMAP, Plaid, Anthropic, OpenAI, Gemini, Ollama, OpenRouter, OpenClaw) have brand entries too, shown on the mailbox buttons and list and on the AI provider list.
- **Card faces** use the card's catalog colour with the issuer's and network's marks; they are not copies of any issuer's card art.
- The script reads only static data (SVG files and a JSON list) from the package and executes none of its code.

## Trademarks
Logos are the trademarks of their owners. They are shown only to identify a card, bank, program or merchant, are not altered other than being filled with the brand colour, and imply no endorsement. If an owner objects, delete the brand's `simple` entry in `brands/brands.json` and its file; it falls back to a monogram.

## Safety
Every vendored SVG may contain only `svg`, `title` and `path` elements (a unit test enforces this, along with no scripts, links, styles or images), because SVGs are served from the app's own origin. Images are decorative where the name is written beside them, and named (`role="img"`) where they stand alone.

## Adding or changing a brand
1. Edit `frontend/brands/brands.json`: `key`, `name`, `kind`, optional `simple` (the Simple Icons slug), `aliases` and `codes` (program or currency codes) used to find it.
2. `cd /tmp && npm pack simple-icons && tar xzf simple-icons-*.tgz`, then `node frontend/scripts/vendor-brands.mjs /tmp/package`.
3. `cd frontend && npx vitest run test/brands.test.ts`.

## How a logo is found
`resolveBrand` (`src/lib/brands.ts`) matches a code, slug, name, issuer or network after normalising case and punctuation, exactly. A kind filter lets a longer name such as "Marriott Bonvoy Boundless" find the Marriott mark; without one, "Delta Faucet" does **not** match Delta Air Lines.

## Limits
- Fictional catalog issuers and any brand not in the list show monograms.
- Icons come from one open collection, so coverage is partial; adding a logo needs a permitted source (a CC0/open collection or the owner's published brand kit), never a copy from a site.
