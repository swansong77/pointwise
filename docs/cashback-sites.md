# Cash-back sites

Cash-back and points shopping sites (Rakuten, TopCashback, an airline's shopping portal, …) pay a share of a purchase when you reach the store through them. PointWise keeps one shared list of these sites, tells you whether each is answering and how current its rates are, remembers which sites your household has accounts on, and uses all of that in the shopping plan ("Plan a purchase").

Everything here is free, and PointWise never signs in to a cash-back site, never asks for or stores a username or password, and never buys or clicks through for you.

## What is stored
| Data | Where | Who changes it |
|---|---|---|
| The sites (name, home page, cash back or points, what a point is worth, notes) | `CashbackSite` (shared, SYSTEM) | the administrator (Admin, Cash-back sites) |
| A site's status (last check, answered or not, failures in a row) | `CashbackSite` | the daily check, or "Check now" |
| A rate for a store at a site | `PortalRate` (shared): percent or points per dollar, "up to", expiry, conditions, when it was last seen, how it got there (`MANUAL`, `CSV`, `PASTE`, later `AUTO`) | the administrator |
| Which household member has an account on which site | `UserCashbackAccount` (per member, no credentials) | the household owner (Cash-back sites page) |

A list of common sites is created by the seed (names and home pages only, no rates). A site already in the list is never overwritten by a re-seed.

## Status
`cashback-status` (daily, 11:40 UTC) and the administrator's "Check now" make **one GET of each site's public home page** (10 second timeout, a plain user agent that says what it is, the body is never read). The host must resolve to a public address (the same SSRF guard the mailbox connection uses). A reply below 500 means the site is up (a 403 from a site that dislikes automated visitors still means it answers). It is called **not answering** only after **two failed checks in a row**; a single failure shows as "not checked lately". A site is "not checked lately" after 7 days without a check.

## Getting rates in (administrator)
1. **Type one**: site, store, percent (or points per dollar), "up to", expiry, conditions.
2. **Import a CSV**: columns `site, merchant, rate` (`5%`, `up to 5%`), optional `points`, `expires`, `conditions`, `source`. Good rows are kept; bad rows are reported by line.
3. **Paste a store page**: PointWise reads the first stated rate and shows it, with anything else it saw on the page, before saving. Wording understood: `N% Cash Back`, `N% of the price back`, `up to N%`, `N points per $1`, `No Cash Back`. The first rate stated wins, because pages lead with the store-wide rate and mention promotions and category rates after it.

4. **Paste a comparison page for one store** (Cashback Monitor and similar): [Cashback Monitor](https://www.cashbackmonitor.com) lists every site's current rate for a store on one page, so one paste can fill in many sites. Admin, Cash-back sites, "Read a comparison page": type the store, open its Cashback Monitor page from the link there, copy the table, paste it. PointWise shows each site it recognised with its rate (a site and its rate on one line, or the rate on the line after the name) and the names it did not recognise, and saves only when asked. A star after a rate means "a special rate for new members, or an up-to rate" and is counted as "up to". Sites that are not in this server's list are reported and skipped, never created. The names Cashback Monitor uses are mapped in `SITE_ALIASES` (`domain/cashback.ts`).

A rate is replaced (not duplicated) for the same site and store. A rate entered for a site that is not in the list still counts, as an unchecked site.

## How a site is chosen
`domain/cashback.ts` (pure, unit tested):
- **Reliability (0 to 100)** of a rate: how it was learned (read 75, pasted 65, CSV or typed 60), minus its age (a week or two −8, weeks −20, over a month −40), minus 15 for "up to". An expired rate is 0 and not counted.
- **Expected return**: the rate times the amount. An "up to" rate is counted at **60%** of its headline. A points rate is worth points per dollar times what one point is worth at that site.
- **Site health** (see Status): a site that looks down is not counted, and is shown.
- **The pick**: if the household has told PointWise which sites it uses, the best usable one **among those**; if it has told it nothing, the best usable one overall, with a prompt to say which it uses.
- **Consider joining**: a usable site nobody has joined that would return at least $1 more than the pick.
- **Steps**: sign in to the site (naming who has the account), open the store from there, leave other cash-back sites and coupon extensions off, pay with the plan's card in the same session, and check that the cash back shows as pending.

## In the shopping plan
`OfferAnalysisService.plan` asks `CashbackService.recommend` for the merchant. The plan counts the best rate among the sites the household uses (as a stacked component, cited as evidence), and the response carries `cashback` (the pick, the site to consider, every site ranked, steps, warnings), shown above the plan cards. The merchant page carries the same block. The AI tools that call the planner receive it too.

## API
| Route | Who |
|---|---|
| `GET /cashback/sites` | any signed-in owner: sites with status and who has an account |
| `PUT /cashback/accounts/:site` `{ has, profileId? }` | the household owner (default: themselves) |
| `GET /cashback/recommend?merchant=&amount=&payWith=` | any signed-in owner |
| `GET /admin/cashback/sites`, `PUT /admin/cashback/sites/:code`, `POST /admin/cashback/status` | administrator |
| `GET /admin/cashback/rates`, `POST …/rates`, `DELETE …/rates/:id`, `POST …/rates/import`, `POST …/rates/paste` | administrator |

## Cashback Monitor
Every recommendation links to the store's page on Cashback Monitor (`https://www.cashbackmonitor.com/cashback-store/<store-name>/`) so the household can see every site's rate, including sites PointWise does not track. What was checked on its public pages (27 Nov 2026):
- the store pages answer without a login, list the sites that carry the store, and show a headline best rate in the page title;
- **the rate for each site did not come back in the page text** (the cell was empty to a plain page fetch), so PointWise does not try to read per-site rates from it automatically; pasting the table from a browser works because the browser has drawn it;
- its `robots.txt` allows the store pages (`/cashback-store/`) and disallows only the outbound `/go-to/` links, and its terms say nothing about automated access;
- its own wording: the data is not guaranteed and cannot catch a change made during the day.
The paste reader's layout rules were written for a copied table and have **not** been verified against the live page's rendered layout; the preview before saving is how a wrong reading is caught.

## Limits
- Rates are only as good as what was entered; the plan shows how old each is and says so when it is stale. Check the rate on the site before you buy.
- Rates reflect one moment; a site's rate for a store can change daily and can differ by account, category or promotion.
- Household members with their own sign-in do not edit sites or accounts yet; the owner does.
- Automatic reading of public store pages is the next step (Phase 2): Rakuten's and TopCashback's own public pages (verified to carry the rate in plain text), plus Cashback Monitor's headline best rate as a cross-check that a rate on file has not gone stale.
