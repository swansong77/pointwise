# Chase statements — test cases

Code under test: `backend/src/domain/spend-pdf.ts`, `spend.ts` CSV parser. See `docs/chase-parser-review.md`.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-CHS-01 | POS | MM/DD layout with credits section | synthetic Chase-style lines | parseStatementPdf | 4 rows: purchase, purchase, payment, credit; scan count equal | P0 | Critical | ✅ U (statement-validate.spec) |
| TC-CHS-02 | POS | December transaction on a January statement | closing 01/05 | parse | previous year | P0 | Major | ✅ U (spend-pdf.spec) |
| TC-CHS-03 | POS | Chase CSV export | header + rows | parseStatement | sign detected; category mapped | P1 | Major | ✅ U (spend.spec) |
| TC-CHS-04 | POS | No duplicates within and across sources | bank feed + PDF of the same month | import both | one transaction per purchase | P0 | Major | ✅ INT (statements-bulk) |
| TC-CHS-05 | POS | Validation completeness | imported statement | GET /benefit-audit/statements | report stored with counts and status | P0 | Major | ✅ INT |
