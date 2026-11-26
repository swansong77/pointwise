# Admin, analytics, privacy & security — test cases

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-ADMIN-PRIV-01 | POS | Admin dashboard stats | Admin | Open /admin | KPIs visible | P1 | Minor | ✅ PW-AUTH-08, INT |
| TC-ADMIN-PRIV-02 | NEG | Non-admin /admin page | USER | Visit /admin | Redirect to login | P0 | Critical | ✅ PW-AUTH-08 |
| TC-ADMIN-PRIV-03 | NEG | Non-admin admin API | USER | GET /admin/stats | 403 | P0 | Critical | ✅ INT |
| TC-ADMIN-PRIV-04 | POS | Create card with rewards | Admin | POST /admin/cards | 201; visible in catalog | P1 | Major | ✅ INT |
| TC-ADMIN-PRIV-05 | POS | Partial card update replaces rewards | Admin | PATCH name + rewards | 200; rewards replaced | P1 | Major | ✅ INT |
| TC-ADMIN-PRIV-06 | NEG | Invalid slug | Admin | slug 'Bad Slug!' | 400 | P2 | Minor | ✅ INT |
| TC-ADMIN-PRIV-07 | POS | Soft-delete card | Admin | DELETE card | isActive=false; audit 'deactivate' | P1 | Major | ✅ INT |
| TC-ADMIN-PRIV-08 | POS | Create offer from UI | Admin | Admin form | 'Offer created' | P1 | Major | ✅ PW-ADM-01 |
| TC-ADMIN-PRIV-09 | POS | Run job from UI | Admin | Run expire-offers | Status message | P2 | Minor | ✅ PW-ADM-01 |
| TC-ADMIN-PRIV-10 | NEG | Unknown job name | Admin | POST /admin/jobs/not-a-job/run | 400 | P3 | Minor | ✅ INT |
| TC-ADMIN-PRIV-11 | POS | Change role | Admin | Set user ADMIN | 200; audit 'set_role' | P1 | Major | ✅ INT |
| TC-ADMIN-PRIV-12 | NEG | Invalid role | Admin | role 'ROOT' | 400 | P3 | Minor | ✅ INT |
| TC-ADMIN-PRIV-13 | POS | Audit log lists actions | Admin writes | GET /admin/audit | Entries with actor email | P1 | Major | ✅ INT |
| TC-ADMIN-PRIV-14 | POS | Analytics event ingest | User | POST /analytics/events page_viewed | 202 | P3 | Minor | ✅ INT |
| TC-ADMIN-PRIV-15 | NEG | Bad event name | User | name 'Bad Name' | 400 | P3 | Minor | ✅ INT |
| TC-ADMIN-PRIV-16 | POS | Data export excludes secrets | User | GET /me/export / Download my data | JSON file; no passwordHash | P0 | Critical | ✅ PW-PRIV-01, INT |
| TC-ADMIN-PRIV-17 | POS | Account deletion | User | Type DELETE → Delete account | User row gone; login 401 | P0 | Critical | ✅ PW-PRIV-01, INT |
| TC-ADMIN-PRIV-18 | SEC | Security headers | — | GET /login | XFO DENY, nosniff, CSP frame-ancestors none, no x-powered-by | P0 | Major | ✅ PW-SMK-03 |
| TC-ADMIN-PRIV-19 | A11Y | No serious axe violations | — | Scan all pages desktop + mobile | 0 serious/critical | P1 | Major | ✅ PW-SMK-01/02 |
| TC-ADMIN-PRIV-20 | PERF | Dashboard p95 < 250 ms at 50 RPS | Seeded DB | k6 script | Meets SLO | P2 | Major | 🟡 eligible |
