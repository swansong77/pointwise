# Card management — test cases

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-WALLET-01 | POS | Add catalog card | Logged in | Wallet → Add card → search 'Voyager' → Add | Card listed with issuer, currency | P0 | Critical | ✅ PW-WAL-01, CY-CARD-01 |
| TC-WALLET-02 | POS | Add with approval date & last4 | Logged in | Add with 2026-02-01 and '4821' | approvedAt saved; •••• 4821 shown | P0 | Major | ✅ PW-WAL-01, INT |
| TC-WALLET-03 | POS | Edit nickname | Card in wallet | Edit → nickname 'Trips' → Save | Nickname shown everywhere | P1 | Minor | ✅ PW-WAL-01 |
| TC-WALLET-04 | POS | Close card | Approved card | Status → CLOSED | closedAt set; excluded from ranking | P0 | Major | ✅ CY-CARD-02, services.spec |
| TC-WALLET-05 | POS | Remove card cascades offers | Card with offers | Remove → confirm | Card and its user offers deleted | P1 | Major | ✅ PW-WAL-01 |
| TC-WALLET-06 | POS | Activate rotating category | Fabrikam Flex | Edit → check Gas | Flex 5% wins gas | P0 | Major | ✅ PW-WAL-04, INT |
| TC-WALLET-07 | POS | Reorder wallet | 2+ cards | PUT /wallet/order reversed | 204; order persisted | P2 | Minor | ✅ INT |
| TC-WALLET-08 | POS | Same card twice (P1/P2) | Pro user | Add same card twice | Two wallet cards | P2 | Minor | 🟡 eligible |
| TC-WALLET-09 | NEG | Full PAN in lastFour | — | lastFour '4111111111111111' | Client error; API 400; never stored | P0 | Critical | ✅ PW-WAL-02, INT |
| TC-WALLET-10 | NEG | lastFour non-numeric | — | '12a4' | 400 | P1 | Minor | ✅ vitest validation |
| TC-WALLET-11 | BND | Free plan 5-card limit | FREE with 5 cards | Add 6th | 403 upgrade message | P0 | Major | ✅ PW-WAL-03, INT |
| TC-WALLET-12 | BND | Free plan exactly 5 | FREE with 4 | Add 5th | 201 | P1 | Minor | ✅ INT |
| TC-WALLET-13 | NEG | closedAt before approvedAt | Card | PATCH approvedAt 05-01, closedAt 01-01 | 400 | P1 | Minor | ✅ INT, services.spec |
| TC-WALLET-14 | NEG | Invalid cardId | — | POST cardId 'x' | 400 | P2 | Minor | ✅ INT |
| TC-WALLET-15 | NEG | Inactive/unknown card | — | POST unknown uuid | 404 | P2 | Minor | ✅ services.spec |
| TC-WALLET-16 | SEC | IDOR edit other user's card | Two users | User B PATCH/DELETE A's card | 403 | P0 | Critical | ✅ INT |
| TC-WALLET-17 | SEC | Foreign profile id | Two users | Add card with B's profileId | 403 | P1 | Major | ✅ services.spec |
| TC-WALLET-18 | POS | Valuation override | Card with miles | PUT valuations 2.2¢ | Rankings use 2.2 | P1 | Major | ✅ INT |
| TC-WALLET-19 | EDGE | Empty wallet UX | New user | Open /wallet | Empty state with CTA | P2 | Minor | ✅ PW-WAL-01 |
| TC-WALLET-20 | EDGE | Annual fee override = 0 | Fee card | Set override 0 | Excluded from renewals & calculator fees | P2 | Minor | ✅ insights.spec |
