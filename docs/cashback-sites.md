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
| `GET /member/cashback`, `PUT /member/cashback/accounts/:site` `{ has }` | a household member with their own sign-in (the PUT needs the owner's permission to edit); acts only on that member's own profile |
| `GET /admin/cashback/sites`, `PUT /admin/cashback/sites/:code`, `POST /admin/cashback/status` | administrator |
| `GET /admin/cashback/rates`, `POST …/rates`, `DELETE …/rates/:id`, `POST …/rates/import`, `POST …/rates/paste` | administrator |

## Automatic reading (phase 2)
**Off for every site until the administrator allows it.** Admin, Cash-back sites: tick "Read this site's public store pages automatically" (a confirmation says what it does and that many sites' terms of use forbid automated access, so allowing it is the administrator's responsibility) and give the pattern of the site's store pages (`{host}` = the store's web address, `{slug}` = its dashed name). The pattern must be https, on the site's own domain, and say where the store goes. Rakuten (`https://www.rakuten.com/{host}`) and TopCashback (`https://www.topcashback.com/{slug}/`) come with a pattern whose pages were seen to carry the rate in plain text; every other site needs one entered, and BeFrugal's and Swagbucks's pages did not return a rate when checked.

What the daily job (`cashback-rates`, 12:10 UTC) does for an allowed site:
- picks a few stores (25 at most per site per run): those where a purchase is planned in the last 90 days and those that already have a rate from that site, the stalest first, none read in the last 20 hours;
- fetches each store page with the polite fetcher the card catalog already uses: https only, only the site's own domain (every redirect hop is checked, so it cannot be sent elsewhere), `robots.txt` honoured (a refused page is counted, not read), one request per host every 5 seconds, a 2 MB cap, an agent that says what it is (`PointwiseBot/1.0 (...)`), **no cookies, no sign-in, nothing about any member**;
- reads the store-wide rate from the page's title, then its main heading and description, and only then from text a short way after the store's name (never an "up to" claim from loose text, since a site-wide banner looks exactly like one);
- saves it as an automatic read (the address and the words it was read from are kept as the source), unless a rate was entered by hand in the last 3 days, which is newer knowledge and is kept;
- stops for the day when most requests fail, and **switches the site's reading off by itself after 5 failed runs in a row**, with a note.
The administrator can read one store now (Admin, "Read one store now") to see exactly what a site returns before relying on it.

**Cashback Monitor cross-check** (a separate switch, off by default): for the same stores, one public page each is read for the headline best rate shown in its title. It is never used as a rate. When it is at least 2 points and $1 higher than the best rate on file, the recommendation warns that a rate here may be out of date or a site PointWise does not track pays more. A reading older than two weeks is ignored.

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
- A household member with their own sign-in sees the sites and which ones they have an account on (never other members' accounts) on their own page, and can tick or untick them when the owner has allowed editing (the same permission as their cards and points). Otherwise the owner keeps the list.
- Page layouts change. A read that finds nothing is counted and ignored, never guessed; the live pages' wording was checked on 27 Nov 2026 only.
