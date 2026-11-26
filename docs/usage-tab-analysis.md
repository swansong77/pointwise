# Usage tab analysis

Source: `Credit Card Benefits Tracker-v4.xlsx`, sheet **Usage**. This document describes the sheet's
structure, formulas and rules only. No values from the workbook are copied here (the file is the
user's private data; Pointwise tests use synthetic fixtures).

## 1. Layout

One row per **(owner, card account, benefit)**. About 70 rows in the reviewed copy.

| Col | Header | Kind | Meaning |
|---|---|---|---|
| A | Owner | typed (`Me` / `Spouse`) | cardholder |
| B | Card | typed | card *product name* |
| C | Last digits | typed | account identifier (5 digits for Amex, 4 otherwise) |
| D | Benefit | typed | benefit name (must equal the Benefits tab name) |
| E | Credit value ($/yr) | formula | `SUMIFS(Benefits!D, Benefits!A, B, Benefits!B, D)` — looks the value up by **card name + benefit name** |
| F | Used so far | **typed by hand** | year-to-date amount used; the only input that changes |
| G | Remaining | formula | `E − F` |
| H | Resets | copied text | "Monthly", "Quarterly", "Calendar year", "Anniversary"… |
| I | How it's issued | copied text | e.g. "$15/month + extra $20 in December" |

## 2. Usage tracking methodology

- Tracking is **manual**. In the reviewed copy no cell in column F contains a formula and none had been
  filled in; the user types a year-to-date number after reading a statement.
- There is **one number per benefit per year**. Periods are not separated: a monthly $25 credit and an
  annual $300 credit are both tracked as "used so far / yearly value".
- Resets (H) are descriptive text. Nothing in the sheet uses them to compute a period, so a monthly
  credit that was missed in March cannot be told apart from one not yet due.

## 3. Data relationships

```
Usage (Owner, Card, Last digits, Benefit)
   │  E: looks up annual value by (Card name, Benefit name)  ─────────►  Benefits (A = card, B = benefit, D = value per card)
   │
Benefits.F  "Used so far (auto from Usage tab)"
      = SUMIFS(Usage!F, Usage!B = card name, Usage!D = benefit name)    ◄── adds Usage rows back up BY CARD NAME
Cards.F     "Credit value" = SUMIF(Benefits!A = card name, Benefits!D)  (also by card name)
```

The link in both directions is the **card product name**, not the account. `Last digits` and `Owner` are
never used in a formula.

## 4. Benefit consumption logic

`Remaining = Credit value − Used so far`, floored by nothing: over-use shows a negative remainder and
there is no cap at the period allocation. There is no status (unused / partial / expired); the user reads
the number.

## 5. Account ownership rules

- A row belongs to exactly one account on paper (owner + digits), so *entering* data per account works.
- **Aggregation does not respect that.** When the workbook has several cards with the same product name
  (the reviewed copy has three of one Amex product, and many products held twice, across both owners),
  the Benefits tab sums the Usage of all of them into a single "Used so far" while multiplying the per-card
  value by the number of *active* cards. The totals can be right, but the per-account answer ("did my
  spouse's card get its dining credit?") is not recoverable from the summary, and a rename of one card
  silently drops its usage from the sum.
- "Active" / "Deleted" (Cards!I) is respected for the card count only; deleted cards' usage rows still
  add into Used so far because the SUMIFS ignores status.

## 6. Renewal calculations

None. Anniversary and cardmember-year benefits are noted in text ("Anniversary", "Account anniversary
year", "Card year") but the sheet has no renewal date, no period start/end and no formula that rolls a
benefit over. The Cards tab keeps an *Opened* date, but nothing connects it to a benefit period.

## 7. What Pointwise does instead

| Workbook behavior | Pointwise |
|---|---|
| Usage keyed by card name | Usage keyed by **wallet card account** (`UserBenefit.walletCardId`); the account level never groups by product |
| One year-to-date number | One `BenefitUsage` row per period with amount, date, source, status |
| Typed by hand | Detected from statements and bank feeds, with method, confidence and the statement evidence; manual entry still supported |
| Resets as text | Period math from frequency + anchor (`periodContaining`): monthly, quarterly, semi-annual, annual, anniversary, one-time, custom |
| No renewal | Each account's anniversary comes from its own opening date |
| Product rollup hides accounts | Four levels (product, account, cardholder, household), each a sum of account rows |

The import path (`docs/excel-import-design.md`) reads the Usage tab's *Used so far* column and spreads it
across periods with `distributeUsage`; imported usage is stored per account, matched by owner and digits.
