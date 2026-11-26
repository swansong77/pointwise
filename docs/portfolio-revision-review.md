# Portfolio & Benefits Revision — Review and Decisions

Date: 2026-11-21 · Scope: the "Additional Product Requirements Revision" (card-portfolio management, benefits tracking, 5/24, households, bank/bureau import).

**Decisions confirmed with the product owner**
1. Automatic discovery = **provider-neutral `BankConnector` + Plaid sandbox adapter**; spreadsheet/CSV import and manual entry are the primary paths; credit bureaus = feasibility study + manual/file entry.
2. The owner's real benefits-tracker workbook was read **for structure only**. Tests use a synthetic look-alike; the owner imports the real file through the app.

## 1. Requirements that cannot be built as written

| Requirement | Reality | Resolution |
|---|---|---|
| Direct connections to 15 issuers | None of them offers a consumer account API. Access goes through aggregators (Plaid, MX, Finicity/Mastercard Open Finance, Akoya) under a commercial contract. Aggregators return name, mask, limit, balance, status — **not** open date, annual fee or authorized users. Screen-scraping with stored bank credentials violates bank terms and is a security liability. | `BankConnector` interface + `PlaidConnector` (sandbox works without a contract). See [bank-and-bureau-feasibility.md](bank-and-bureau-feasibility.md). |
| Credit Karma integration | No public API; automated access prohibited by its terms. | Not built. Documented as not feasible. |
| Experian integration | FCRA "permissible purpose", business agreement, identity verification, compliance review. | Feasibility doc + manual tradeline entry (copy from annualcreditreport.com) with auto-matching. |
| 95 %+ coverage | Achievable for pure domain code; overall integration coverage is bounded by provider code that can't run without keys. | 95 % gate on new domain modules (met: 97–100 %); provider code covered by unit tests with fakes. |

## 2. Conflicts with the existing data model (avoid duplication)

| Proposed entity | Existing | Decision |
|---|---|---|
| CreditAccount | `WalletCard` | Extended `WalletCard` (open-date precision, credit limit, 5/24 exclusion, source + metadata). |
| Cardholder | `Profile` + `Cardholder` enum | `Profile` **is** the cardholder (added `relationship`, `birthYear`, `householdId`). |
| Household | — | New `Household` (one per owner). |
| CardIssuer | `Issuer` | Reused; added `businessReportsToPersonal`, `aliases`. |
| RewardProgram | `RewardCurrency` | Reused (naming only). |
| NotificationPreference | exists | Added `benefitExpiring`, `benefitEmail`, `benefitPush`. |
| FiveTwentyFourCalculation | `domain/insights.fiveTwentyFour()` | Full engine in `domain/five24.ts`; `FiveTwentyFourSnapshot` keeps daily history. |
| Benefit, BenefitUsage, BenefitCategory, BenefitNotification, CardImportJob, CreditBureauAccount, CreditMonitoringRecord | — | New: `Benefit` (catalog template), `UserBenefit` (tracked), `BenefitUsage`, `BenefitCategory`, `BenefitNotification` (delivery log), `CardImportJob` + `ImportRow`, `BankConnection`, `CreditReportAccount` (= CreditBureauAccount/CreditMonitoringRecord), `PushSubscription`. |

## 3. Gaps and errors in the specification (corrected)

1. **Last digits** — Amex shows 5 digits; `lastFour` widened to `VARCHAR(5)` and validated `^\d{4,5}$`. (Field name kept for API compatibility.) Imports refuse anything longer (possible full card number) and never store it.
2. **Benefits are not annual** — credits reset monthly / quarterly / semi-annually / annually / every N years, on the calendar or the cardmember year. Modelled as `period` + `periodMonths` + `basis` + `amountPerPeriodCents`; usage is tracked per period instance.
3. **90/60/30/7/1-day alerts** are meaningless for a monthly credit → thresholds scale with the period (monthly 7/1; quarterly 30/7/1; semi-annual 60/30/7/1; annual+ 90/60/30/7/1). Only the smallest crossed threshold is sent; one delivery per (benefit, period, threshold, channel).
4. **5/24 rule details** — AU cards count; business cards count only for issuers that report them to personal bureaus; closed cards count; applications/denials don't; month-precision dates drop off on the 1st of the 25th month; counted **per person**; manual exclusion with a reason. See [chase-524-engine.md](chase-524-engine.md).
5. **Children** can only be authorized users (enforced in wallet + household APIs).
6. **`scheduler` / `notification-service`** are separate processes of the same backend image (no new codebases).
7. **Push** = Web Push (VAPID) + service worker + subscription table; endpoints restricted to browser push services (SSRF guard).
8. **Privacy** — imports are processed at runtime only; the real workbook is never copied into seed, fixtures, logs, screenshots or docs. Bank tokens are AES-256-GCM encrypted. Uploads ≤ 5 MB, `.xlsx`/`.csv` only, formulas never evaluated (cached values read).
9. **Naming** — the product stays **Pointwise**, a self-hosted card-portfolio tracker; it is not marketed under another product's name.

## 4. What was delivered

| Area | Delivered |
|---|---|
| Docs | this review, [excel-import-design](excel-import-design.md), [bank-and-bureau-feasibility](bank-and-bureau-feasibility.md), [chase-524-engine](chase-524-engine.md), [household-management](household-management.md), [benefit-notification-system](benefit-notification-system.md), [benefits-data-model](benefits-data-model.md) |
| Schema | migration `20261122000000_portfolio_benefits` (12 new tables, 10 enums, backfill of households) |
| Domain | `five24.ts`, `benefits.ts`, `portfolio.ts`, `import.ts`, `dates.ts` (pure, 97–100 % covered) |
| API | `/household`, `/five24`, `/portfolio`, `/benefits`, `/imports`, `/connections`, `/credit-reports`, `/notifications/push` |
| Jobs | `scan-benefit-expirations`, `snapshot-524`, `sync-bank-connections` |
| UI | `/portfolio`, `/benefits`, `/five24`, `/household`, `/import`, settings (benefit alerts + push) |
| Docker | 9 services incl. `scheduler`, `notification-service` |
| Tests | unit (domain + services), integration (17 new cases), Playwright (8), Cypress (6), test-case docs |

## 5. Effort

Product scope ≈ 6–8 engineer-weeks; implemented here as a working vertical slice of every feature. Production follow-ups: Plaid production contract + Link UI, Experian partnership (if pursued), curated benefit catalog for real card products, VAPID keys and push UX polish.
