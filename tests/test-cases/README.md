# Test Case Catalog (Phase 18)

One file per feature. Each case has: **ID · Objective · Preconditions · Steps · Expected · Priority (P0–P3) · Severity (Critical/Major/Minor) · Automation (✅ automated + test reference / 🟡 eligible / ❌ manual)**.
Types: **POS** positive · **NEG** negative · **EDGE** edge case · **BND** boundary.

| File | Feature | Cases |
|---|---|---|
| [TC-AUTH.md](TC-AUTH.md) | Authentication & sessions | 24 |
| [TC-WALLET.md](TC-WALLET.md) | Card management | 20 |
| [TC-REC.md](TC-REC.md) | Best-card recommendations, nearby, calculator | 24 |
| [TC-OFFERS.md](TC-OFFERS.md) | Offers tracking | 24 |
| [TC-NOTIF-SUB.md](TC-NOTIF-SUB.md) | Notifications, jobs, subscriptions | 22 |
| [TC-ADMIN-PRIV.md](TC-ADMIN-PRIV.md) | Admin, analytics, privacy, security | 20 |
| [../524/README.md](../524/README.md) | Chase 5/24 engine | 23 |
| [../benefits/README.md](../benefits/README.md) | Benefit tracking, alerts, value analytics | 27 |
| [../households/README.md](../households/README.md) | Household management | 17 |
| [../imports/README.md](../imports/README.md) | Spreadsheet/CSV, bank and credit-report import (Experian, Equifax, TransUnion, Credit Karma) | 35 |
| [../ai/README.md](../ai/README.md) | AI platform, agents, providers, MCP, privacy boundary | 36 |
| [../spend/README.md](../spend/README.md) | Spend tracking (CSV, PDF, bank), automatic capture (alert emails, Plaid webhook), automatic benefit tracking, bulk statement drop | 31 |
| [../catalog/README.md](../catalog/README.md) | Card knowledge base, refresh engine, offer history, card research, real catalog, issuer coverage, issuer listings check | 51 |
| [../strategy/README.md](../strategy/README.md) | Next-card scorer, travel, streaming, evals, operations, credit band, fine print | 45 |

**Total: 399 cases** (134 original + 93 portfolio revision + 36 AI platform + 27 card knowledge base + 45 Phases D–F + 19 card research / real catalog / coverage + 26 spend tracking & capture + 9 credit report import + 5 issuer listings check + 5 bulk statements; of the new ones 92 are automated and 1 is manual — importing the owner's private workbook). Original 134: (67 positive, 42 negative, 9 edge, 8 boundary, 6 security, 1 a11y, 1 performance; 44 P0). 128 are mapped to automated tests, 5 are automation-eligible, 1 is manual. All automated cases were executed and pass in Docker (backend unit 155, integration 34, frontend 28, Playwright 36, Cypress 22); see docs/docker-validation.md. Machine-readable export: [`test-cases.csv`](test-cases.csv).

Seed data referenced: demo user `demo@pointwise.local`, admin `admin@pointwise.local`, fictional cards (`contoso-gold` 4X dining/groceries at 1.25¢, `northwind-voyager` 3X travel/dining at 1.5¢, `fabrikam-flex` 5% rotating, `fabrikam-double` 2% everywhere, `litware-blue-cash` 6% groceries…), merchants (`freshcart`, `shopnow`…), demo location 37.7749,−122.4194.
