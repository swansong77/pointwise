# Authentication & sessions — test cases

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-AUTH-01 | POS | Register with valid data | Anonymous | Open /signup; enter name, new email, `e2e-password-1`; submit | 201; redirected to /wallet; session cookie set | P0 | Critical | ✅ PW-AUTH-01, CY-AUTH-01, INT auth |
| TC-AUTH-02 | POS | Login with valid credentials | Registered user | /login; enter email+password; submit | Redirect to /dashboard; header shows initials | P0 | Critical | ✅ PW-AUTH-05 |
| TC-AUTH-03 | POS | Session survives page reload | Logged in | Reload /wallet | Still authenticated | P0 | Major | ✅ PW-AUTH-01 |
| TC-AUTH-04 | POS | Logout revokes refresh token | Logged in | Click Sign out; replay old refresh token via API | Redirect /login; refresh → 401 | P0 | Critical | ✅ INT register→refresh→logout |
| TC-AUTH-05 | POS | Access token refresh rotates token | Valid refresh token | POST /auth/refresh | New pair; old token revoked | P0 | Critical | ✅ INT, auth.service.spec |
| TC-AUTH-06 | NEG | Refresh token reuse revokes family | Rotated token | Reuse old refresh token, then new one | Both → 401 'reuse detected' | P0 | Critical | ✅ INT, auth.service.spec |
| TC-AUTH-07 | NEG | Wrong password | Registered user | Login with wrong password | 401 'Invalid email or password' (generic) | P0 | Major | ✅ PW-AUTH-04, CY-AUTH-02 |
| TC-AUTH-08 | NEG | Unknown email | — | Login with unregistered email | Same generic 401 message (no enumeration) | P1 | Major | ✅ auth.service.spec |
| TC-AUTH-09 | NEG | Duplicate registration | Email exists | Register same email (different case) | 409 conflict; UI message | P0 | Major | ✅ INT, PW-AUTH-03 |
| TC-AUTH-10 | NEG | Weak password (<10 chars) | — | Register with 'short' | Client error + API 400 | P1 | Minor | ✅ PW-AUTH-02, INT |
| TC-AUTH-11 | NEG | Password letters only | — | Register 'onlyletterslong' | 400 'letter and a non-letter' | P2 | Minor | ✅ INT |
| TC-AUTH-12 | NEG | Invalid email format | — | Register 'not-an-email' | 400 listing email error | P1 | Minor | ✅ INT |
| TC-AUTH-13 | NEG | Mass assignment of role | — | Register with body {role:'ADMIN'} | 400 (forbidNonWhitelisted) | P0 | Critical | ✅ INT |
| TC-AUTH-14 | NEG | Protected page without session | Anonymous | Visit /dashboard | Redirect /login?callbackUrl=… | P0 | Major | ✅ CY-AUTH-03, PW-AUTH-05 |
| TC-AUTH-15 | NEG | API without bearer | — | GET /api/v1/wallet/cards | 401 | P0 | Critical | ✅ CY-AUTH-05, INT |
| TC-AUTH-16 | NEG | Tampered JWT | — | Bearer 'garbage' | 401 | P0 | Critical | ✅ INT |
| TC-AUTH-17 | SEC | Open redirect via callbackUrl | Registered user | /login?callbackUrl=https://evil.example | After login lands on /dashboard | P0 | Critical | ✅ PW-AUTH-06, vitest |
| TC-AUTH-18 | POS | callbackUrl honoured for internal path | Registered | Visit /offers anonymously, login | Lands on /offers | P1 | Minor | ✅ PW-AUTH-06 |
| TC-AUTH-19 | POS | Forgot password (existing) | Registered | Submit email on /forgot-password | Same confirmation; email in MailHog with 1-hour link | P1 | Major | 🟡 eligible |
| TC-AUTH-20 | NEG | Forgot password (unknown) | — | Submit unknown email | Identical confirmation (202) | P1 | Major | ✅ PW-AUTH-07, INT |
| TC-AUTH-21 | NEG | Reset with invalid/expired token | — | POST reset-password bad token | 401 | P1 | Major | ✅ INT, auth.service.spec |
| TC-AUTH-22 | POS | Reset password revokes sessions | Valid token | Reset; use old refresh token | Old sessions 401 | P1 | Critical | ✅ auth.service.spec |
| TC-AUTH-23 | POS | Google/Apple sign-in links account | OAuth configured | Sign in with Google using existing email | Same user id; emailVerified set | P1 | Major | ✅ INT oauth, auth.service.spec |
| TC-AUTH-24 | BND | Auth rate limit | — | 11 logins/min from one IP (default 10) | 11th → 429 | P1 | Major | 🟡 eligible |
