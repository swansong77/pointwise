# American Express statement parser review

**Scope and evidence.** No real statement is stored in this repository (statements are card data and
must not be committed). This review was made by reading the parser code and running it on **synthetic
statements** that reproduce the Amex layouts the parser must handle (`backend/test/unit/spend/statement-validate.spec.ts`).
Findings about a real statement come from the **validation report** that every import now produces:
if a real Amex statement shows WARNING or FAILED, its notes say how many transactions were not read.

## 1. Pipeline (before → after)

```
PDF ──► pdf-text.mjs (sandboxed pdfjs, text layer only)        no OCR
    ──► joinSplitLines            (new)  date+merchant / city / amount on separate lines → one line
    ──► parseStatementPdf               TX_LINE: date [date] description amount, section state (credits / charges)
    ──► classify                  (changed) PAYMENT | CREDIT | REFUND | FEE | PURCHASE
    ──► detectBenefits            (new)  exact → alias → regex → fuzzy → (opt-in AI)
    ──► validateStatement         (new)  independent line scan vs imported rows → PASS / WARNING / FAILED
```

## 2. Findings

| # | Problem | Effect on benefits | Status |
|---|---|---|---|
| 1 | Credits printed without the word "credit" (`SAKS FIFTH AVENUE CR`, `AIRLINE FEE REIMB`) were classified **REFUND**, and only CREDIT lines are matched to benefits | The credit was imported but never counted toward the benefit | **Fixed**: issuer credit patterns (`benefit-aliases.ts`) classify a negative line as CREDIT. A plain refund from the same merchant stays REFUND |
| 2 | Only the words *credit, statement credit, uber cash, reward, rebate, offer…* made a CREDIT; no per-benefit descriptors for Resy, Equinox, Walmart+, airline fee, digital entertainment, hotel, Global Entry, Saks, lululemon, CLEAR | Several Platinum credits were not matched | **Fixed**: alias group per benefit, each with merchant aliases, patterns and the issuer's credit wording |
| 3 | Transactions split over two or three lines (merchant, city/state, amount) were skipped, because `TX_LINE` needs everything on one line | Missing transactions, silent | **Fixed**: `joinSplitLines` (dated line without an amount + following undated lines up to one that ends with an amount, max two lines). Nothing is joined across a new date |
| 4 | A line with text after the amount (points multiplier, "Pending") does not match `TX_LINE` | Missing transaction | **Not parsed on purpose** (guessing the amount position is unsafe). **Detected**: the loose scan counts it, so the statement shows WARNING / FAILED with the amount missing |
| 5 | No OCR; a scanned or photographed statement has no text layer | Whole statement unreadable | Unchanged: the import says so and asks for the card site's PDF or CSV. Recommended follow-up: on-device OCR (the text must never go to an AI provider) |
| 6 | Several card members / additional cards on one statement | All rows go to the card chosen (or matched by digits) | Correct at the account level (the account is the unit of benefit tracking). Digits detection uses the 5-digit account number Amex prints |
| 7 | The same credit seen from the bank connection **and** the PDF | Double counting | Handled earlier by cross-source duplicate matching (same amount/direction within 4 days); detections are unique per (benefit, transaction) |
| 8 | A usage was recorded with no record of *why* | Not auditable | **Fixed**: every usage stores method, confidence, rule, normalized merchant, statement import; `BenefitDetection` keeps the audit row and manual overrides |
| 10 | **Found on a real statement**: Pay Over Time transactions and credits end with a `⧫` marker after the amount (`$26.99 ⧫`), so `TX_LINE` (amount must be last) matched only the AutoPay payment: 1 of 9 transactions imported, which the validation report correctly flagged FAILED | Statement credits and charges missing | **Fixed**: the trailing marker is stripped before parsing and scanning. The same statement now imports 9 of 9 and the totals match. The merchant detail printed on the line below each row (`GOOGLE *YOUTUBEPREMIUM`) is ignored; credit rows are named by Amex (`Platinum Uber One Credit`) and match their benefits. Regression test uses an invented statement with the same layout |
| 11 | Real statements print the account as `Account Ending 9-12345`; the digits detector did not allow the `9-` prefix, so bulk import could not match a PDF to its card | Every Amex PDF came back "Choose card" | **Fixed** in `statementDigits` |
| 12 | A bulk drop of 17 PDFs (~21 MB) failed with "JSON Parse error: Unexpected identifier Internal": the web proxy rejects request bodies over 10 MB | Whole drop lost | **Fixed**: the browser uploads in batches of at most 6 MB and merges the results; the proxy limit is also raised to 64 MB. All 17 statements (Jun 2025 – Oct 2026) parse with PASS locally |
| 9 | A generic `STATEMENT CREDIT` line matches no benefit | Credit imported, benefit not updated | Unchanged on purpose: it is listed under *Credits that matched no benefit* on the Benefit audit page so the user can assign it |

## 3. Supported credit types

Detected from the card's own benefit list; a credit can only be assigned to a benefit that card account has.

| Credit | Signals (any one is enough; strongest wins) |
|---|---|
| Dining (Gold) | `dining credit`; aliases Grubhub, Seamless, Shake Shack, Five Guys, Cheesecake Factory, Goldbelly, Wine.com |
| Uber | `uber one credit`, `uber cash`, `uber *trip/eats/one` |
| Resy | `resy`, `resy credit` |
| Airline | `airline fee credit`, `airline incidental`, `air fee reimb` |
| Digital entertainment | `digital entertainment`; Disney+, Hulu, ESPN+, Peacock, NYT, Audible, SiriusXM, … |
| CLEAR | `clear plus … credit`, `clearme` |
| Walmart+ | `walmart+ membership credit` |
| Hotel | `hotel credit`, `fine hotels`, `hotel collection`, `amex travel` |
| Saks | `saks … cr/credit` |
| Equinox | `equinox … credit` |
| Global Entry / TSA PreCheck | `global entry / tsa / cbp … credit / reimbursement` |
| lululemon | `lululemon … credit` |

## 4. Confidence scoring and review

| Method | Confidence | Tier |
|---|---|---|
| Exact (the benefit's own keyword / credit word) | 92 purchase, 95 credit | auto-assign |
| Alias (alias table) | 85–86 | auto-assign |
| Regex (issuer credit wording, 90; merchant pattern, 80) | 80–90 | credit wording auto-assigns, merchant pattern goes to review |
| Category only (e.g. any dining purchase) | 70 | review |
| Fuzzy (a descriptor word within 80 % edit similarity of a keyword) | 50 + 30 × similarity (< 85) | review |
| AI (opt-in) | capped at 75 | review, never auto-assigned |
| Below 60 | not assigned | listed as unmatched |

Review-tier matches are saved as unverified usage and appear on the **Benefit audit** page with
*Correct* / *Not this benefit*. Rejecting removes the usage from every total and prevents a rescan from
re-creating it. Two benefits tied on confidence from different rules are left to manual review.

## 5. AI classification (optional)

Off by default; the user turns it on in Settings. The model receives **one cleaned merchant string**
(`uber eats`; digits removed, 60 characters max) and a fixed list of generic benefit groups. It never
receives amounts, dates, account digits, names, which cards the user owns, or any statement text. It
answers `{group, confidence, reasoning}`; the reasoning is stored on the detection for audit. Only
merchants that no rule recognised are sent, each merchant once per server process. Tests use a mock.

## 6. What was not verified

- Real statements. Run an import of your own Amex PDF and read the validation report, or the
  **Statements** list (`GET /benefit-audit/statements`). Each WARNING / FAILED note says what to look at.
- Statement layouts other than text-layer PDFs and CSV.

## 7. Citi statements (found on real statements)

| Problem | Fix |
|---|---|
| Two-column layout: sidebar text ("full rewards details", "6X, otherwise 3X)") lands on the same line after the amount, so 4 of 8 transactions were skipped | `matchTxLine`: when the strict rule fails, a `$` amount followed only by text without another amount is accepted; a description containing its own `$x.xx` is never read this way |
| Statements with no activity (new balance $0.00, "No Transaction Activity at This Time", a $0.00 membership fee line) were reported FAILED | `showsNoActivity`: PASS with a note, recorded as covered; $0.00 lines are not transactions or errors |
| "Standard Purchases" heading after a credits section left the section state on credits | recognised as a charges section |

All 40 Citi statements and all 17 Amex statements in the reviewer's folders pass validation locally.

## 8. Reconciliation against the statement's own printed totals (real statements)

The first validation compared the parser with a scan that shares its date and amount patterns, so a layout the parser
cannot read was invisible to both. Validation now also compares the imported rows with the totals each statement
prints in its account summary (Payments, Credits, Purchases, New Charges, Fees, Interest): the rows' credits and charges
must each equal some combination of printed totals, otherwise the report says "The statement prints charges of X but the
imported rows total Y" (WARNING, or FAILED for a large gap).

Run over 226 real statements (60 Chase, 126 Amex across 9 cards, 40 Citi) this found, and the fixes resolved:

| Finding | Statements | Fix |
|---|---|---|
| Sidebar number before or glued to the date (`963700 12/22 12/24 … $44.76`, `96370010/10 10/10 …`) | Citi | stripped when two dates follow |
| Heading with sidebar text (`Standard Purchases changes may affect…`) left the parser in credit mode, so purchases became credits | Citi | known multi-word headings are recognised at line start |
| `Payments Other Than By Mail` (a mailing block) taken for the Payments section | Citi | bare "Payments" / "Credits" headings must be the whole line |
| Legal text starting with `Payments:` flipped the section | Chase Ink Business (16 statements) | headings must be short lines |
| Amounts under a dollar printed as `.79` | Chase | integer part optional |
| Fee row with its amount two lines below, between sidebar lines | Citi annual fee | joiner reaches 3 lines, stops at totals and foreign-currency notes (a first version joined a foreign-currency note to a totals line; the totals check caught it) |
| `MEMBERSHIP FEE` treated as a purchase | Citi | fee |
| Months with no activity but a carried credit balance | Amex | PASS with a note |
| Account notices saved as statements (11 Amex PDFs) | Amex | refused with "This PDF is an account notice, not a statement" |

Result: all 215 statements that print totals reconcile; 11 files are notices. All 60 Chase statements also satisfy
previous balance + rows = new balance.
