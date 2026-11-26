# Benefit tab analysis

Source: `Credit Card Benefits Tracker-v4.xlsx`, sheet **Benefits** (the request calls it "Benefit"; the tab
is named *Benefits*). Structure and rules only; no workbook values are reproduced.

## 1. Layout

A summary block (rows 1–5) and a table starting at row 8 (about 185 benefit rows).

**Summary block** (all formulas): credit value available `=SUM(E)`, used so far `=SUM(F)`, remaining
`=SUM(G)`, annual fees `=Cards!E` (total), and *credits minus fees*.

**Table columns**

| Col | Header | Kind | Meaning |
|---|---|---|---|
| A | Card | typed | card product name |
| B | Benefit | typed | benefit name |
| C | # Cards | formula | `COUNTIFS(Cards!B = A, Cards!I = "Active")` — active cards of that product name |
| D | Credit value per card ($/yr) | typed | annual face value of one copy |
| E | Total value | formula | `C × D` |
| F | Used so far (auto from Usage tab) | formula | `SUMIFS(Usage!F, Usage!B = A, Usage!D = B)` |
| G | Remaining | formula | `E − F` |
| H | How it's issued | text | "$10 per month", "Annual", "Ongoing", "1 per card each anniversary" |
| I | Resets | text | see §4 |
| J | Action needed | text | "Enroll", "Pay application fee with card", "Add card to Uber account"… |
| K | Notes | text | conditions, dates |
| L | Issuer | text | Amex, Chase, … |
| M | Mine / Spouse's (active) | formula | `COUNTIFS(... "Me" ...) & " / " & COUNTIFS(... "Spouse" ...)` |

## 2. Benefit definitions

A benefit is a free-text name under a card product. Types are implicit in the text: statement credits
("Resy credit"), memberships ("CLEAR+ credit"), certificates ("free night"), and ongoing perks with no
dollar value ("Ongoing" in column H, value blank). The sheet has no kind column and no category.

## 3. Credit limits

Column D is the **annual** value of one card's benefit. Per-period amounts live only in the text of
column H ("$100 per quarter", "$15/month + extra $20 in December"). Irregular schedules (a larger December
amount) cannot be calculated from D. Total available value is `# active cards × D`.

## 4. Frequencies (column I, "Resets")

Observed vocabulary: *Calendar year*, *Monthly*, *Quarterly*, *Semi-annual*, *Annual*, *Every 4 years*,
*Anniversary*, *Account anniversary year*, *Anniversary year*, *Card year*, plus a few dates ("Ends
12/31/2026", "Activate by 12/31/2026"). About half the rows have no value (ongoing perks).

Mapping used by PointWise (`parsePeriodText`, `frequencyLabel`):

| Workbook text | PointWise frequency |
|---|---|
| Monthly | Monthly |
| Quarterly | Quarterly |
| Semi-annual | Semi-Annual |
| Calendar year / Annual | Annual (calendar) |
| Anniversary / Account anniversary year / Card year | Anniversary Year |
| Every N years | Custom Period (multi-year) |
| "Ends …", "Activate by …" | One-Time with an expiration date |

## 5. Tracking rules

- Used so far is **derived** from the Usage tab by (card name, benefit name). The match is exact text, so
  a renamed benefit or a typo yields zero usage.
- `# Cards` counts **active** cards of the product; usage from deleted cards is still summed.
- Owner split (M) is informational.
- Action needed (J) is a to-do label, not a state: nothing records whether it was done.

## 6. Expiration rules

There is **no expiration column**. Expirations appear as text in Resets or Notes. Periodic benefits expire
by being reset (not modeled); fixed-date offers ("Ends 12/31/2026") are only readable by a person.

## 7. Weaknesses this project removes

1. Value, count and usage are all grouped by card product name, so several cards of one product merge.
2. Per-period amounts and irregular schedules are text, so reconciliation cannot be computed.
3. No renewal or expiry dates; no "missed" concept.
4. Usage is typed, one number per year.

## 8. PointWise model

`Benefit` (catalog template per product) → `UserBenefit` (one per wallet card account: frequency, per-period
amount, basis, optional `expiresOn` / one-time window) → `BenefitUsage` (per period, with detection method,
confidence, verification and statement evidence). See `docs/benefits-data-model.md`.

Utilization is available at four levels, each a sum of account-level rows:

| Level | Question answered |
|---|---|
| Card product | "How are all my Gold cards doing together?" |
| Card account | "Did card ···1002's dining credit post?" |
| Cardholder | "How much of my own credits did I use vs my spouse?" |
| Household | "Credits used vs available across everything" |

`GET /benefit-audit/rollup?level=…` returns these; `GET /benefit-audit/reconciliation` returns expected,
detected, missing, expired and unused credits with suggested actions.
