# Quarterly rotating categories

Cards such as Chase Freedom Flex, the original Chase Freedom and Discover it Cash Back earn a higher rate in categories that change every quarter and must be activated. PointWise keeps these current from three inputs: the committed calendar, an admin import, and (by the user's explicit override of the no-issuer-automation rule, for this feature only) a daily read of the issuer's public announcement page.

## How it works
1. **The calendar** (`backend/src/seed/rotating-calendar.ts`) lists each card family, quarter, categories, rate, quarterly cap, the issuer page that announced it and the date a person read it. Only quarters read on the issuer's own page are listed; nothing is guessed.
2. **Applying** (`seed/rotating.apply.ts`): each category becomes one reward row for the card, marked rotating, active from the first to the last day of the quarter, with the quarterly cap and the page and date. A corrected entry replaces the old rows of that quarter; other quarters are kept. Cards an admin edited are left alone.
3. **Daily job** `update-rotating-categories` (04:00 UTC): applies the calendar, then notifies each member who holds a rotating card, once per card per quarter, with the categories, rate and cap and the reminder to activate with the issuer. In the last 21 days of a quarter it tells admins which rotating cards have no entry for the next quarter.
4. **Admin import** `POST /admin/rotating-categories` (admin only, audited): the next quarter without a code change. Body: `quarter` (`2027-Q1`), `cards` (slugs), `categories` (`cat`, `mult`, `desc`), optional `capDollars`, `sourceUrl`, `checkedOn`. `GET /admin/rotating-categories` shows which rotating cards have the current and next quarter.
5. **Ranking:** a rotating rate counts only inside its quarter and only when the member selected that category on the wallet card (the member activates with the issuer, then selects it in the app). It is blended with the base rate above the quarterly cap like any capped rate.

## Reading the issuer's public page (explicit override, this feature only)
- `seed/rotating-sources.ts` lists the public pages. The job reads one only when its card lacks the current quarter, or the next quarter in the last 45 days of a quarter, so at most one request per source per day and usually none.
- It uses the same polite fetcher as the catalog refresh: https, allow-listed issuer domains, robots.txt honoured, one request per host per interval, no cookies, no credentials, no login. It never activates a category or clicks anything.
- `domain/rotating-parse.ts` is conservative: it applies a quarter only when the page states exactly one quarter and one rate in sentences naming recognised categories. Otherwise (blocked, script-rendered, ambiguous) admins get one notice per day saying why, and the quarter is added by import.
- Turn it off with `ROTATING_AUTO_FETCH=false`.
- The original Chase Freedom (no longer open to new applicants) shares the Flex calendar. The Flex page is the source; Chase's page for the retired card was not read, so that card's quarter rests on the two cards sharing categories.
- **Checked 2026-11-26:** Chase Freedom Flex's product page states its quarter in the page text (source used). Discover's calendar page loads its categories by script and its text states only "5% on up to $1,500 each quarter", so Discover is marked unreadable and needs an import each quarter. Chase's older `/personal/credit-cards/freedom/5percent` address returns 404.

## What it does not do
- It does not log in, activate anything for the member, or read any page behind a login. Activation stays the member's own step.
- Quarters not in the calendar, not imported and not readable on a source page are unknown; admins are warned 21 days before quarter end.
- The page reader is untested against live pages beyond the checks above; the parser is tested on synthetic text.

## Each quarter
Usually nothing: the job reads the page. If the admin notice says a page could not be read, read the issuer's announcement and POST it to `/admin/rotating-categories`.
