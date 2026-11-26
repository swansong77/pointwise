# Statement import & validation — test cases

Code under test: `backend/src/domain/spend-pdf.ts` (`joinSplitLines`, `scanStatementPdf`), `backend/src/domain/statement-validate.ts`, `backend/src/spend/spend.service.ts` (`store`, `validation`), `GET /benefit-audit/statements`. Fixtures: synthetic text lines and CSV built in the tests.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-STM-01 | POS | PASS when everything imported | 2-page Amex-style statement | parse + scan + validate | counts equal, missing 0, PASS, confidence 100 | P0 | Critical | ✅ U (statement-validate.spec) |
| TC-STM-02 | POS | Multi-page statement keeps sections | credits on page 1, more on page 2 | parseStatementPdf | credit lines on page 2 stay credits; purchases stay purchases | P0 | Major | ✅ U |
| TC-STM-03 | POS | Digital (text-layer) PDF import | synthetic PDF | POST /spending/statements | rows imported; validation returned and stored | P0 | Critical | ✅ INT (statements-bulk, benefit-audit) |
| TC-STM-04 | POS | OCR-style noisy text | line with trailing text after the amount | parse + scan + validate | not parsed, but counted by the scan; status not PASS | P1 | Major | ✅ U |
| TC-STM-05 | POS | Split lines joined | date+merchant / city / amount | joinSplitLines | one line each; long or dated neighbours not joined | P0 | Major | ✅ U |
| TC-STM-06 | POS | WARNING | 1 of 40 missed, small amount | validateStatement | WARNING; missing amount and note | P0 | Major | ✅ U |
| TC-STM-07 | NEG | FAILED | half missed / no rows / many unreadable | validateStatement | FAILED; confidence ≤ 60 | P0 | Critical | ✅ U, INT |
| TC-STM-08 | POS | More rows than scan | imported > found | validateStatement | difference negative, note | P2 | Minor | ✅ U |
| TC-STM-09 | POS | Validation shown to users | import with an unreadable line | bulk import in UI | report with counts, difference, missing amount, notes | P0 | Major | ✅ PW-BA-03 |
| TC-STM-10 | POS | Scanned PDF is rejected | image-only PDF | import | clear 400, nothing stored (OCR not supported) | P1 | Major | ✅ U, INT (spend) |
