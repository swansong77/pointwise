# Benefit reconciliation & audit — test cases

Code under test: `backend/src/domain/benefit-roll.ts`, `backend/src/benefit-audit/**`, pages `/benefits/audit`, `/benefits/reconciliation`. Household fixtures use three accounts of one product.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-REC-01 | POS | Expected vs detected vs missing | monthly benefit, Jan used, Feb not | reconcileBenefit | expected 3, detected 1, missing 1 period, suggestion | P0 | Critical | ✅ U (benefit-roll.spec), INT |
| TC-REC-02 | POS | Pending credit | purchase recorded, credit not yet | reconcile | pending amount, 'wait for the statement credit' | P1 | Major | ✅ U |
| TC-REC-03 | POS | Potential missed benefit | period ends in days, nothing used | reconcile | potentialMissed, 'Use $X before DATE' | P0 | Major | ✅ U |
| TC-REC-04 | POS | Expired / one-time | expiresOn passed | reconcile / benefitRecord | expired amount; status EXPIRED | P0 | Major | ✅ U |
| TC-REC-05 | POS | Card opened mid-year | anchor this month | reconcile | earlier periods not owed | P1 | Major | ✅ U |
| TC-REC-06 | POS | Rejected or dismissed usage ignored |  | reconcile / record | not counted | P0 | Major | ✅ U, INT |
| TC-REC-07 | POS | Audit page lists detections with evidence | imported statement | GET /benefit-audit; UI | method, confidence, rule, statement reference, overrides | P0 | Critical | ✅ INT, PW-BA-01, CY-BA-01 |
| TC-REC-08 | POS | Manual override | detected usage | PATCH /benefit-audit/detections/:id | ACCEPT → verified; REJECT → removed from totals and not re-created on rescan; second decision 400 | P0 | Critical | ✅ INT, PW-BA-01 |
| TC-REC-09 | SEC | Ownership | other user | rollup / audit / decide | empty / 404 | P0 | Critical | ✅ INT |
| TC-REC-10 | A11Y | Audit and reconciliation pages |  | axe | no serious/critical violations | P1 | Major | ✅ PW-BA-01, PW-BA-02 |
