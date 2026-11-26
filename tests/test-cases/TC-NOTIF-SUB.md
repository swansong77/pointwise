# Notifications, jobs, subscriptions — test cases

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-NOTIF-SUB-01 | POS | Expiring offer notification | Offer ends in 5 days | Run scan-expiring-offers | Notification created; badge shows | P0 | Major | ✅ PW-NOT-01, CY-NOT-01, INT |
| TC-NOTIF-SUB-02 | POS | Job idempotency | Same | Run job twice | Still one notification | P0 | Major | ✅ INT |
| TC-NOTIF-SUB-03 | POS | Respect expiringDays pref | Pref = 3 | Offer in 5 days | No notification | P1 | Minor | ✅ services.spec |
| TC-NOTIF-SUB-04 | POS | Renewal notification | Fee card renewing in ≤30d | Run scan-renewals | CARD_RENEWAL created | P1 | Major | ✅ services.spec |
| TC-NOTIF-SUB-05 | POS | Bonus at risk | Deadline ≤30d, <75% | Run scan-bonus-deadlines | BONUS_DEADLINE created | P1 | Major | ✅ services.spec |
| TC-NOTIF-SUB-06 | POS | Offer alert match | Pro alert 'coffee' | New catalog coffee offer; run match job | OFFER_ALERT created | P1 | Major | ✅ services.spec |
| TC-NOTIF-SUB-07 | POS | Email digest | Unread notifications | Run email-digest | One email per user in MailHog; emailedAt stamped | P1 | Major | ✅ services.spec |
| TC-NOTIF-SUB-08 | EDGE | Digest SMTP failure | SMTP down | Run digest | emailedAt not stamped; retried next run | P2 | Major | ✅ services.spec |
| TC-NOTIF-SUB-09 | POS | Mark one read | Unread | Mark read | Badge decrements | P1 | Minor | ✅ INT |
| TC-NOTIF-SUB-10 | POS | Mark all read | Unread | Mark all read | Badge disappears | P1 | Minor | ✅ PW-NOT-01, CY-NOT-01 |
| TC-NOTIF-SUB-11 | NEG | Mark other user's notification | — | POST /notifications/:id/read (foreign) | 404 | P1 | Major | ✅ services.spec |
| TC-NOTIF-SUB-12 | POS | Preferences persist | — | Uncheck digest; reload | Still unchecked | P2 | Minor | ✅ PW-NOT-02 |
| TC-NOTIF-SUB-13 | BND | expiringDays bounds | — | 0 / 61 / 999 | 400 | P2 | Minor | ✅ INT, CY-NOT-02 |
| TC-NOTIF-SUB-14 | POS | Plans endpoint public | Anonymous | GET /subscription/plans | Prices returned | P2 | Minor | ✅ INT |
| TC-NOTIF-SUB-15 | POS | Upgrade monthly | FREE | Click Monthly | PRO active; period end in 1 month | P0 | Critical | ✅ PW-SUB-01, CY-SUB-02, INT |
| TC-NOTIF-SUB-16 | POS | Annual starts trial | FREE | Click Annual | TRIALING | P1 | Major | ✅ PW-SUB-02, services.spec |
| TC-NOTIF-SUB-17 | POS | Lifetime has no cancel | FREE | Click Lifetime | PRO lifetime; cancel hidden | P1 | Minor | ✅ CY-SUB-01 |
| TC-NOTIF-SUB-18 | POS | Cancel keeps Pro until period end | PRO monthly | Cancel | CANCELED, effective PRO | P0 | Major | ✅ PW-SUB-01, INT |
| TC-NOTIF-SUB-19 | POS | Resume | Canceled in period | Resume | ACTIVE | P1 | Minor | ✅ CY-SUB-02, INT |
| TC-NOTIF-SUB-20 | NEG | Cancel lifetime | Lifetime | POST cancel | 400 | P2 | Minor | ✅ services.spec |
| TC-NOTIF-SUB-21 | NEG | Invalid interval | — | interval 'weekly' | 400 | P2 | Minor | ✅ INT |
| TC-NOTIF-SUB-22 | EDGE | Expired period downgrades | PRO, period ended | Any gated action | Treated as FREE | P1 | Major | ✅ geo-entitlements.spec |
