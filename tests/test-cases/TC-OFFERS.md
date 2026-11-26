# Offers tracking — test cases

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-OFFERS-01 | POS | Eligible offers listed | Gold in wallet | Open /offers | Issuer/card offers not yet added | P0 | Major | ✅ INT, services.spec |
| TC-OFFERS-02 | POS | Add eligible offer | Same | Add to card | Appears in Active | P0 | Critical | ✅ PW-OFF-01, CY-OFF-01 |
| TC-OFFERS-03 | NEG | Add same offer twice | Added | POST again | 409 | P1 | Minor | ✅ INT |
| TC-OFFERS-04 | POS | Partial usage | Active cash offer $10 | Save amount $4 | Used $4, remaining $6 | P0 | Major | ✅ PW-OFF-01, INT |
| TC-OFFERS-05 | POS | Full usage auto-redeems | Active $10 | Amount $10 | Status REDEEMED | P0 | Major | ✅ INT, unit |
| TC-OFFERS-06 | NEG | Over-use | $10 offer | Amount $500 | 422 'cannot exceed' | P0 | Major | ✅ PW-OFF-02, INT |
| TC-OFFERS-07 | POS | Mark redeemed | Active | Mark redeemed | Moves to Redeemed tab | P0 | Major | ✅ PW-OFF-01, CY-OFF-02 |
| TC-OFFERS-08 | POS | Undo redeem | Redeemed | Undo | Back to Active | P2 | Minor | ✅ unit |
| TC-OFFERS-09 | BND | Repeatable reaches maxTimes | maxTimes=3 | timesUsed 3 | REDEEMED; 4 → 422 | P1 | Major | ✅ unit |
| TC-OFFERS-10 | NEG | Non-repeatable timesUsed 2 | — | timesUsed 2 | 422 | P2 | Minor | ✅ unit |
| TC-OFFERS-11 | NEG | Redeem before start | Future start | Redeem | 422 'not started' | P2 | Minor | ✅ unit |
| TC-OFFERS-12 | NEG | Edit expired offer | Ended | Change amount | 422 'expired' | P1 | Minor | ✅ unit |
| TC-OFFERS-13 | NEG | Add expired catalog offer | Ended offer | POST /offers/mine | 400 | P1 | Minor | ✅ services.spec |
| TC-OFFERS-14 | POS | Snooze 7 days hides offer | Active | Snooze 7d | Hidden from Active; visible with includeSnoozed | P1 | Minor | ✅ PW-OFF-03, INT |
| TC-OFFERS-15 | NEG | Snooze in past / >1 year | — | Past date; 400 days | 422 | P2 | Minor | ✅ INT, unit |
| TC-OFFERS-16 | POS | Favorite sorts first | Several offers | Favorite one | Starred, first in list | P2 | Minor | ✅ PW-OFF-03, unit |
| TC-OFFERS-17 | POS | Custom cash offer | Card | Form: title, $7.50 | Listed with $7.50 | P0 | Major | ✅ CY-OFF-03, PW-OFF-03 |
| TC-OFFERS-18 | NEG | Custom PERCENT without percent | — | API kind PERCENT, no percent | 400 | P2 | Minor | ✅ INT |
| TC-OFFERS-19 | SEC | Custom offer javascript: URL | — | url 'javascript:alert(1)' | 400 | P0 | Critical | ✅ INT |
| TC-OFFERS-20 | NEG | Custom end before start | — | end < start | 400 | P2 | Minor | ✅ services.spec |
| TC-OFFERS-21 | BND | Free plan 20 offers | FREE with 20 active | Add 21st | 403 | P1 | Major | ✅ services.spec |
| TC-OFFERS-22 | POS | Sorting options | Several offers | Sort by value/end/added/A–Z | Order correct | P2 | Minor | ✅ PW-OFF-04, unit |
| TC-OFFERS-23 | SEC | IDOR on user offers | Two users | B PATCH A's offer / filter A's card | 403 | P0 | Critical | ✅ INT |
| TC-OFFERS-24 | POS | Expire job | Ended offers | Run expire-offers | ACTIVE → EXPIRED | P1 | Major | ✅ INT jobs, services.spec |
