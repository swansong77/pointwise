# Spreadsheet / CSV Import Design

Source: `backend/src/domain/import.ts` (pure parsing/matching), `backend/src/portfolio/imports.ts` (upload, preview, commit) · UI: `/import` · Tests: `test/unit/imports/`, `test/integration/portfolio.int-spec.ts`, `tests/test-cases/imports/`.

> Privacy: the owner's real "Credit Card Benefits Tracker.xlsx" was inspected **only for its structure** (sheet names, header rows, formulas). No values from it appear in code, fixtures, seed data, logs or docs. Tests use `backend/test/fixtures/tracker.ts`, a synthetic workbook with the same layout.

## 1. Source workbook structure (as analysed)

| Sheet | Layout |
|---|---|
| `Benefits` | Rows 1–5: summary block (Credit value available, Used so far, Remaining, Annual fees, Credits minus fees — formulas over the table). Row 7: "Benefits by card". **Row 8: header** — Card · Benefit · # Cards · Credit value per card ($/yr) · Total value · Used so far · Remaining · How it's issued · Resets · Action needed · Notes · Issuer · Mine / Spouse's. ~190 rows. |
| `Cards` | Row 1 header — Owner · Card · Last digits · Issuer · Annual fee · Credit value (`SUMIF` over Benefits) · Credits minus fee · Notes. ~40 rows. |
| `Dropdown options` | Owner list for data validation (e.g. "Me", "Spouse"). |

Observations that drive the design: header rows are **not** on row 1; values are often **formulas** (cached results must be read); last digits are numbers and may have **5 digits**; "Resets" is free text (Monthly, Quarterly, Semi-annual …); "Mine / Spouse's" is a split like `1 / 0` in owner-list order; there is **no open-date column** (5/24 needs dates from elsewhere).

## 2. Pipeline

```mermaid
sequenceDiagram
  participant U as User (/import)
  participant API as POST /imports
  participant P as domain/import.ts
  participant DB as Postgres
  U->>API: multipart file (≤ 5 MB, .xlsx/.csv)
  API->>API: readUpload → Sheet[] (exceljs; formulas → cached result; CSV RFC 4180)
  API->>P: parseWorkbook(sheets)
  P-->>API: cards[], benefits[], owners[], issues[]
  API->>DB: match vs wallet (matchExisting) + catalog (matchCatalog)
  API->>DB: CardImportJob(PREVIEW) + ImportRow[] (NEW/UPDATE/DUPLICATE/SKIPPED/ERROR)
  API-->>U: preview (nothing in the wallet changed)
  U->>API: POST /imports/:id/commit
  API->>DB: one transaction: claim job → members → issuers/cards → wallet cards → benefits → YTD usage
  API-->>U: { cardsCreated, cardsUpdated, benefitsCreated, usageRows, membersCreated }
```

## 3. Column mapping (header aliases, case/punctuation-insensitive)

| Field | Aliases |
|---|---|
| owner | owner, cardholder, holder, person, who, member |
| card | card, card name, product, account |
| lastDigits | last digits, last 4, last four, last 5, digits, ending in, mask |
| issuer | issuer, bank, institution |
| annualFee | annual fee, af, fee |
| openDate | open date, opened, date opened, approval date, approved … |
| status / type / creditLimit / notes / au | status · type, card type · credit limit, limit · notes · authorized user, au |
| benefit sheet | benefit · credit value per card ($/yr), annual value, value · used so far, used · how it's issued · resets, frequency · action needed · mine / spouse's, owners |

Header search: first 25 rows; required columns `card` (cards) or `card`+`benefit` (benefits). A cards sheet must also have at least one of owner / last digits / annual fee / open date.

## 4. Cell parsing

| Kind | Rule |
|---|---|
| Money | numbers = dollars; strings `$1,234.50`, `(65)`, `-65` |
| Last digits | keep digits; 1–3 digits are zero-padded to 4; **> 5 digits → row ERROR "looks like a full card number"** and the value is discarded |
| Dates | `Date`, Excel serials, `yyyy-mm-dd`, `m/d/yyyy`, `m/d/yy` → DAY; `yyyy-mm`, `mm/yyyy`, `Mar 2024` → MONTH; anything else → warning |
| Period | `parsePeriodText`: month → MONTHLY, quarter → QUARTERLY, semi/half/twice → SEMIANNUAL, "every N years" → MULTI_YEAR, card member/anniversary → CARDMEMBER_YEAR basis |
| Per-period amount | annual value × periodMonths / 12 |
| Category / kind | keyword rules (free night → certificate, lounge → access, TSA/Global Entry, CLEAR, Uber, airline, hotel, dining, streaming, membership, shopping, other) |

## 5. Detection rules

| Detection | Rule |
|---|---|
| Duplicate (within file) | key = owner + canonical issuer + last digits, or owner + card name when no digits; later rows → DUPLICATE |
| Duplicate / update (vs wallet) | same last digits and (same canonical issuer or name similarity ≥ 0.5); else same owner + name similarity ≥ 0.8 when either side lacks digits → UPDATE (fills only empty fields) |
| Closed | status or notes match closed / cancelled / downgraded / product changed |
| Authorized user | AU column truthy, owner "(AU)", or notes "authorized user" |
| Business | type column says business, else card name contains "business"/"biz" |
| Owners | first owner in the owner list (Dropdown sheet or first seen) = the account owner (SELF member); others become household members (Pro), relationship guessed from the name (spouse/partner/child) |
| Benefit → cards | same card name; restricted by the owner split (`1 / 0`); benefits for cards missing from the card list create a card row (warning) |
| Catalog | token-Jaccard on the name (+0.2 for same issuer) ≥ 0.5 → catalog card (fee override if the fee differs); otherwise a **private** card (`CreditCard.ownerId`, never visible in the public catalog) |
| Year-to-date usage | "Used so far" distributed over the benefit year's periods, earliest first (`distributeUsage`) |

## 6. Error handling

| Case | Result |
|---|---|
| No file / unsupported type / corrupt xlsx / binary "CSV" | 400 with a reason |
| > 5 MB | 413 |
| > 20 sheets or > 5 000 rows | 400 |
| No sheet with a Card column | job `FAILED` with the issue listed |
| Row errors | row `ERROR`, not imported; other rows unaffected |
| Plan limits | commit refused (403) if the import would exceed the Free plan's card limit or needs household members |
| Commit twice / discard after commit | 409 (job is claimed atomically inside the commit transaction) |
| Any failure during commit | whole transaction rolls back; job stays `PREVIEW` |

## 7. CSV template

`GET /api/v1/imports/template.csv` (public, static): `Owner,Card,Last digits,Issuer,Annual fee,Open date,Status,Type,Credit limit,Authorized user,Notes`.
