# Card import — test cases

Code under test: `backend/src/domain/import.ts`, `portfolio/imports.ts`, `portfolio/connections.ts`, `portfolio/credit-reports.ts`, `/import`. Fixture: `backend/test/fixtures/tracker.ts` (synthetic look-alike of the tracker workbook — the real file is never used in tests).

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-IMP-01 | POS | Read all worksheets, header below summary block | synthetic tracker | parseWorkbook | Benefits + Cards read; owners Me, Spouse | P0 | Critical | ✅ U |
| TC-IMP-02 | POS | Map cards (owner, digits, issuer, fee, date, precision) | — | parse | Metro Platinum 41007, $695, 2025-03-14 DAY; "2024-07" MONTH | P0 | Major | ✅ U |
| TC-IMP-03 | POS | Detect duplicate rows | same owner/issuer/digits twice | parse / preview | 2nd row DUPLICATE | P0 | Major | ✅ U, INT, PW-IMP-01 |
| TC-IMP-04 | POS | Detect closed cards | status/notes "Closed" | parse / commit | closed → wallet status CLOSED | P0 | Major | ✅ U, INT |
| TC-IMP-05 | POS | Detect authorized-user cards | notes "Authorized user…", AU column, "(AU)" | parse / commit | cardholder AUTHORIZED_USER | P0 | Major | ✅ U, INT, PW-IMP-01 |
| TC-IMP-06 | SEC | Full card number is refused and never stored | 16-digit "last digits" | preview | row ERROR; value absent from the response | P0 | Critical | ✅ U, INT, CY-IMP-01 |
| TC-IMP-07 | POS | Benefits → periods, per-period amounts, owner split | Resets column | parse | hotel semi-annual $300/period; streaming monthly; GE every 4 years | P0 | Major | ✅ U |
| TC-IMP-08 | POS | Year-to-date usage distributed | "Used so far" $300 | commit | hotel used this year $300 | P1 | Major | ✅ INT, U |
| TC-IMP-09 | NEG | Benefit without value skipped (warning) | blank value | parse | not imported; warning | P2 | Minor | ✅ U |
| TC-IMP-10 | EDGE | Benefit whose card isn't on the card list | — | parse | card row created for the first owner with a count | P2 | Minor | ✅ U |
| TC-IMP-11 | POS | Preview writes nothing; commit creates members/cards/benefits | PRO | upload → commit | wallet empty after preview; 5 cards, 8 benefits, 1 member after commit | P0 | Critical | ✅ INT |
| TC-IMP-12 | POS | Re-import matches existing cards | committed import | upload again | 5 UPDATE, 0 new benefits | P0 | Major | ✅ INT |
| TC-IMP-13 | NEG | Commit twice / discard after commit | committed job | POST commit / DELETE | 409 | P1 | Major | ✅ INT |
| TC-IMP-14 | NEG | Plan limits at commit | FREE; extra owner or > 5 cards | commit | 403 | P1 | Major | ✅ INT |
| TC-IMP-15 | NEG | Missing / unsupported / corrupt / oversize / no Card column | — | upload | 400 / 400 / 400 / 413 / job FAILED | P1 | Major | ✅ INT, U, PW-IMP-02 |
| TC-IMP-16 | POS | CSV parsing (quotes, CRLF, BOM) + template | — | parseCsv; GET template.csv | parsed; template public, text/csv | P1 | Minor | ✅ U, INT |
| TC-IMP-17 | SEC | Imported private cards never appear in the public catalog | after import | GET /cards?q=…, /cards/:id | 0 results; 404 | P0 | Major | ✅ INT |
| TC-IMP-18 | SEC | Import jobs are owner-scoped | two users | B GET A's job | 404 | P0 | Critical | ✅ INT |
| TC-IMP-19 | POS | Catalog & wallet matching | — | matchCatalog / matchExisting | issuer aliases (Amex ↔ American Express); digits+issuer; owner+name | P1 | Major | ✅ U |
| TC-IMP-20 | POS | Bank import (Plaid) maps credit accounts | fake connector | sync | matched cards updated, new private cards (source BANK), plan limit respected | P1 | Major | ✅ U (connections.spec) |
| TC-IMP-21 | SEC | Bank token encrypted at rest; tamper detected | — | encrypt/decrypt | random IV; GCM auth failure on tamper | P0 | Critical | ✅ U |
| TC-IMP-22 | NEG | Bank provider not configured | default env | link-token / exchange | 503; status enabled=false | P1 | Minor | ✅ INT |
| TC-IMP-23 | NEG | Provider error mapping | Plaid 400 | exchange | 502 with error code only | P1 | Minor | ✅ U |
| TC-IMP-24 | POS | Credit-report tradeline auto-match + apply | card with last digits | POST account → apply | matched; open date month precision; AU flag | P0 | Major | ✅ INT, CY-524-02 |
| TC-IMP-25 | NEG | Tradeline validation | future date; full number | POST | 400 | P1 | Minor | ✅ INT |
| TC-IMP-26 | ❌ manual | Import the owner's real workbook | owner's file | upload via /import | preview matches the sheet's totals | P1 | Major | ❌ manual (by the owner; file is private) |
| TC-CRK-01 | POS | Preview a pasted Credit Karma report | wallet card ··4321 (Chase) | preview text | LINK by last digits (date MISSING), AMEX (old, AU, closed) SKIP, recent Capital One ADD, auto loan skipped; nothing saved | P0 | Major | ✅ INT |
| TC-CRK-02 | POS | Import confirmed rows | preview | import | open date 2019-03-15 (DAY) + limit on the card; private Capital One card ··9876; 2 report accounts; 5/24 +1 | P0 | Critical | ✅ INT, PW-CRK-01 |
| TC-CRK-03 | POS | Re-import and date precedence | imported | preview again; LINK month-only; with overwrite | alreadyImported, date SAME; day-level date kept; replaced only with overwrite | P1 | Major | ✅ INT |
| TC-CRK-04 | POS | Printed PDF report | single-space label/value lines | preview PDF | same parsing; source CREDIT_KARMA_PDF; matched by last digits | P1 | Major | ✅ INT |
| TC-CRK-05 | POS | Report layouts and skipping | separate-line, colon, single-space, summary rows; loans; missing / future dates | parseCreditReport | accounts with precision; skipped with reasons; duplicates collapse; creditor→issuer mapping | P0 | Major | ✅ U |
| TC-CRK-06 | SEC | Validation and ownership | other user; scan; .docx; non-report text; future date; bad action | preview / import | 404 / 400 with clear messages | P0 | Critical | ✅ INT |
| TC-CRK-07 | POS | Bureau layouts | TransUnion / Equifax / Experian style reports | parseCreditReport | TU heading mask and account+loan type, pay status, remarks; EQ owner / month dates / digits; EX account-name blocks; first-digit masks ignored; ignored fields never split accounts | P0 | Major | ✅ U |
| TC-CRK-08 | POS | Merge three bureaus | same Chase account on TU (day), EQ (month, digits), EX (2 days later); Capital One on TU and EX one month apart | mergeReports | one entry each with bureaus; earliest day-level date; digits from EQ; month disagreement listed; different digits stay separate | P0 | Major | ✅ U |
| TC-CRK-09 | POS | Upload three reports at once | TU PDF + EQ text file + EX PDF | preview; import | bureau MULTIPLE, per-file summary, one merged account matched by last digits; saved once with reportedBy = 3 bureaus; 4 files → 400 | P0 | Major | ✅ INT |
