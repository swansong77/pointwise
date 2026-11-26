# American Express statements — test cases

Code under test: `backend/src/domain/benefit-aliases.ts`, `benefit-detect.ts`, `classify` in `spend.ts`. See `docs/amex-parser-review.md`. All descriptors are synthetic.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-AMX-01 | POS | Platinum credit descriptors resolve to the right benefit | 10 Platinum benefits | detectBenefits on each credit line | digital, resy, saks (CR), equinox, clear, walmart+, airline, hotel, global entry, lululemon; confidence ≥ 85 | P0 | Critical | ✅ U (benefit-detect.spec) |
| TC-AMX-02 | POS | Credits without the word 'credit' | `SAKS FIFTH AVENUE CR`, `AIRLINE FEE REIMB` negative | classify | CREDIT; a plain `SAKS FIFTH AVENUE` refund stays REFUND | P0 | Critical | ✅ U |
| TC-AMX-03 | POS | Gold dining merchants | Shake Shack, Five Guys, Grubhub | detectBenefits | Dining credit via alias, ≥ 85 | P0 | Major | ✅ U |
| TC-AMX-04 | POS | Uber variants | UBER, UBER TRIP, UBER EATS, UBER*EATS, UBER* ONE | detectBenefits | Uber benefit for each | P0 | Major | ✅ U |
| TC-AMX-05 | POS | Exact credit confirms usage | Gold card, rideshare purchase then credit | import twice | EXPECTED then CONFIRMED, verification VERIFIED | P0 | Critical | ✅ INT, CY-BA-01 |
| TC-AMX-06 | POS | Fuzzy match is review-tier | `WALMRT SUPERCENTER` | detectBenefits | FUZZY, < 85, unverified | P1 | Major | ✅ U |
| TC-AMX-07 | POS | Ambiguous ties go to manual review | two benefits, equal confidence, different rules | pickDetection | null | P1 | Major | ✅ U |
| TC-AMX-08 | POS | AI classification (mock) | opt-in on; unknown merchant | BenefitClassifyService | returns group; capped 75; only a merchant string is sent; cached; off by default | P0 | Critical | ✅ U (benefit-classify.spec) |
| TC-AMX-09 | SEC | No card data reaches the model | opt-in on | inspect request | no digits, amounts, user id or names in system or user text | P0 | Critical | ✅ U |
