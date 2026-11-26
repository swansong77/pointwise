# Household management — test cases

Code under test: `backend/src/portfolio/households.ts`, wallet cardholder rules, `/household`. Automated in INT (`households`), `services.spec.ts`, PW-HH-01, CY-HH-01.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-HH-01 | POS | Household + SELF member created on first use | new user | GET /household | 1 member, SELF, primary | P0 | Major | ✅ INT |
| TC-HH-02 | EDGE | Concurrent first loads create one SELF member | new user | 3 parallel GETs | exactly 1 primary profile (advisory lock) | P0 | Major | ✅ INT |
| TC-HH-03 | NEG | Free plan cannot add members | FREE | POST member | 403 | P0 | Major | ✅ INT |
| TC-HH-04 | POS | Pro adds spouse and child | PRO | POST members | 201 ×2 | P0 | Major | ✅ INT, PW-HH-01 |
| TC-HH-05 | NEG | Second SELF / empty name | PRO | POST | 400 | P1 | Minor | ✅ INT |
| TC-HH-06 | NEG | Child holds a primary card | CHILD member | add card without AU | 400 | P0 | Major | ✅ INT, services.spec, CY-HH-01 |
| TC-HH-07 | POS | Child holds an AU card | CHILD member | add with cardholder AU | 201 | P0 | Major | ✅ INT, CY-HH-01 |
| TC-HH-08 | NEG | Change AU → primary for a child | child AU card | PATCH cardholder PRIMARY | 400 | P1 | Major | ✅ INT |
| TC-HH-09 | NEG | Member with primary cards → CHILD | spouse with card | PATCH relationship CHILD | 400 | P1 | Major | ✅ INT |
| TC-HH-10 | POS | Rename household / member | — | PATCH | 200 | P2 | Minor | ✅ INT |
| TC-HH-11 | NEG | Delete primary member | — | DELETE SELF | 403 | P1 | Major | ✅ INT |
| TC-HH-12 | POS | Delete member moves cards to owner | member with cards | DELETE | 204; cards' profileId null → owner | P1 | Major | ✅ INT (204) |
| TC-HH-13 | SEC | IDOR on members | two users | B PATCH A's member | 404 | P0 | Critical | ✅ INT |
| TC-HH-14 | POS | Separate vs combined portfolios | family account | /portfolio vs ?profileId= | filtered vs all; byHolder roll-ups | P0 | Major | ✅ INT, PW-PORT-01 |
| TC-HH-15 | POS | Household dashboard | family account | GET /household/dashboard | members with cards, totals, 5/24 | P1 | Major | ✅ INT |
| TC-HH-16 | POS | Shared cards via AU | spouse AU on owner's card | portfolio | listed under AU for the spouse | P1 | Minor | ✅ INT (counts) |
| TC-HH-17 | POS | Registration creates SELF member | — | register | primary profile has relationship SELF | P0 | Major | ✅ INT (TC-HH-01) |
