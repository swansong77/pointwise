# Chase statement parser review

**Scope and evidence.** As for the Amex review (`docs/amex-parser-review.md`): no real statement is stored
here. The audit compared the parser's output with an independent scan of the same synthetic statement,
which is exactly what the new **statement validation engine** does for every real import. Chase imports are
therefore *verifiable per statement* rather than assumed correct.

## 1. Layout handled

- Dates as `MM/DD` with no year; the year is taken from the statement's closing date, and a December
  transaction on a January statement is placed in the previous year.
- Sections: `PURCHASE`, `PAYMENTS AND OTHER CREDITS`, `FEES CHARGED`, `INTEREST CHARGED`. Every amount
  in a credits section is a credit however it is printed.
- Credits printed as `-200.00`; payments recognised by `AUTOMATIC PAYMENT - THANK YOU` and similar.
- Chase CSV exports (Transaction Date, Post Date, Description, Category, Type, Amount) are handled by the
  CSV parser, which also uses the bank's category for categorization.

## 2. Audit method

For each statement: transactions found by a deliberately looser line scan (any dated line carrying an
amount, after joining split lines, excluding summary lines) are compared with the rows the strict parser
imported.

| Check | Result on the synthetic statements |
|---|---|
| Imported vs statement transactions | equal for the standard layout, the December/January statement and multi-page statements |
| Missing transactions | none; lines with trailing text after the amount are the one known gap and are now **reported** (see below) |
| Unexpected duplicates | none within a file (identical lines on one statement get distinct occurrence numbers); the same purchase from the bank feed and the PDF is matched across sources |
| Categorization | PDF rows carry no bank category; categories come from merchant matching. CSV rows use Chase's category via `mapBankCategory` |
| Incorrect kinds | "STATEMENT CREDIT" is a CREDIT; payment lines are PAYMENT; a negative line from a merchant with no credit wording is a REFUND |

## 3. Validation report

Each import returns and stores:

| Field | Meaning |
|---|---|
| Statement transaction count | dated lines with an amount found by the independent scan (CSV: data rows) |
| Imported transaction count | rows the parser read (new + already recorded) |
| Difference | count found minus count read |
| Total statement amount / imported amount / missing amount | sums of absolute amounts |
| Detection confidence | 100 on PASS; reduced by missing lines, unreadable lines and missing amount |
| Status | **PASS** (no difference, nothing unread) · **WARNING** (at most 1 line or 5 % missing, ≤ 2 % of the amount, ≤ 1 unreadable line) · **FAILED** (more than that, or no transactions) |

The report is shown after a single import, after a bulk import (for any file that is not PASS), and in
the preview before importing. `GET /benefit-audit/statements` lists the stored reports.

## 4. Known limits

1. Text after the amount on a line is not parsed; the scan still counts it, so the statement shows WARNING /
   FAILED with the missing amount.
2. Year-to-date totals pages and reward summaries are ignored by design (no transaction date at line start).
3. Scanned statements have no text layer and are rejected; use the PDF from the card site or the CSV.
4. The audit used synthetic statements. If your own Chase statement reports WARNING / FAILED, the notes
   give the count and amount to compare against the paper statement.
