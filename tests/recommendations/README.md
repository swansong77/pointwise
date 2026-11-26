# Smart recommendation — test cases

Code: `domain/recommendation-intel.ts`, `strategy/smart-recommendation.service.ts`, `GET /recommendations/smart`, `/recommendations/audit/:id`.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-REC2-01 | POS | Goal factors | TRAVEL / CASHBACK / LOW_FEE goals | enrich | match +$75, mismatch −$25, none → no factor | P0 | Major | ✅ U (recommendation-intel.spec) |
| TC-REC2-02 | POS | Balance synergy, utilization, velocity | balances in currency; 100 % / 0 % use; 5 recent applications | enrich | capped synergy; credits rescaled around 50 %; penalty per extra application | P0 | Major | ✅ U |
| TC-REC2-03 | POS | Application probability (estimate) | odds bands, business card without business, 5/24 HARD | enrich | 0.85 / 0.25; ×0.15; ×0.5; ineligible 0; always flagged an estimate | P0 | Critical | ✅ U, INT |
| TC-REC2-04 | POS | Confidence reasons | goals, credit band, utilization, offer history missing | enrich | confidence reduced, each reason named, bounded 0.1–0.95 | P1 | Major | ✅ U |
| TC-REC2-05 | POS | Selection and alternatives | mixed eligibility | selectRecommendation | probability-weighted best eligible + up to three alternatives | P1 | Major | ✅ U |
| TC-REC2-06 | POS | Stored audit | after /recommendations/smart | GET /recommendations/audit/:id | inputs snapshot (no card numbers), weights, factors; other user 404 | P0 | Critical | ✅ INT, CY-INT-01 |
| TC-REC2-07 | POS | Goals saved and validated | member PATCH | goals / hasBusiness | deduplicated; unknown goal 400 | P1 | Minor | ✅ INT |
| TC-REC2-08 | POS | Smart pick UI | goals toggled | /next-card | probability labelled "(estimate)", reasons list | P1 | Minor | ✅ PW-INT-02 |
