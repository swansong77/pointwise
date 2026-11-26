# Recommendations, nearby, calculator — test cases

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-REC-01 | POS | Best card per category on dashboard | Gold+Voyager+Double | Open dashboard | Dining → Contoso Gold 5¢/$ | P0 | Critical | ✅ PW-REC-01, CY-RWD-01 |
| TC-REC-02 | POS | Ranking order dining | Same | Open /categories/dining | Gold 5, Voyager 4.5, Double 2 | P0 | Critical | ✅ CY-RWD-02, unit |
| TC-REC-03 | POS | Merchant rule beats category | ShopNow card | Open /merchants/shopnow | ShopNow card first (MERCHANT) | P0 | Major | ✅ PW-REC-03, unit |
| TC-REC-04 | POS | Parent category inheritance | Subcategory with parent dining | Rank for subcategory | Dining rules apply (PARENT_CATEGORY) | P2 | Minor | ✅ unit |
| TC-REC-05 | POS | Fallback 'everything else' | Unknown category | Rank | 2% card wins via FALLBACK | P1 | Major | ✅ unit |
| TC-REC-06 | POS | Pin overrides ranking | Any | Pin Double for dining | Double first with 'pinned' | P1 | Major | ✅ PW-REC-02, INT |
| TC-REC-07 | POS | Unpin restores ranking | Pinned | Unpin | Gold first again | P1 | Minor | ✅ PW-REC-02 |
| TC-REC-08 | EDGE | Tie-break by multiplier then name | Equal ¢/$ | Rank | Higher multiplier, then A–Z | P2 | Minor | ✅ unit |
| TC-REC-09 | EDGE | Expired / future reward rule ignored | Dated rule | Rank outside window | Rule ignored | P1 | Major | ✅ unit |
| TC-REC-10 | EDGE | Boundary: rule start == now | Dated rule | Rank at start instant | Active | P3 | Minor | ✅ unit |
| TC-REC-11 | NEG | Non-approved cards excluded | APPLIED/DENIED/CLOSED | Rank | Not listed | P0 | Major | ✅ unit, CY-CARD-02 |
| TC-REC-12 | EDGE | Empty wallet | No cards | Open category | Empty state | P2 | Minor | ✅ unit |
| TC-REC-13 | POS | Nearby demo location | Cards | Nearby → Use demo location | Stores sorted by distance; best card shown | P0 | Major | ✅ PW-REC-04 |
| TC-REC-14 | POS | Nearby with geolocation | Permission granted | Use my location | Results load | P1 | Major | ✅ PW-REC-05 |
| TC-REC-15 | NEG | Geolocation denied | Permission denied | Use my location | Friendly message + demo option | P2 | Minor | ❌ manual |
| TC-REC-16 | NEG | Invalid coordinates | — | GET /nearby?lat=200 | 400 | P1 | Minor | ✅ INT |
| TC-REC-17 | BND | Radius limits | — | radius 49 / 25001 | 400 | P2 | Minor | 🟡 eligible |
| TC-REC-18 | EDGE | No stores in radius | — | lat=0,lng=0 | [] and empty state | P2 | Minor | ✅ INT |
| TC-REC-19 | POS | Calculator totals | Cards | Calculate with defaults | Gross, fees, net shown | P0 | Major | ✅ PW-REC-06, CY-RWD-03, INT |
| TC-REC-20 | NEG | Calculator invalid input | — | Enter 'abc' | Inline error; button disabled | P1 | Minor | ✅ PW-REC-06 |
| TC-REC-21 | NEG | Negative spend via API | — | annualSpendCents -5 | 400 | P1 | Minor | ✅ INT |
| TC-REC-22 | BND | Spend upper bound | — | $100,000,000.01 | Rejected | P3 | Minor | ✅ calculator.spec |
| TC-REC-23 | POS | Compare candidate (Pro) | Pro | Pick candidate; calculate | Incremental + first-year value | P1 | Major | ✅ PW-SUB-01, calculator.spec |
| TC-REC-24 | NEG | Compare on Free | Free | POST with candidateCardId | 403 | P1 | Major | ✅ INT |
