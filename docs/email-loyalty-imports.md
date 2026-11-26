# Email and statement imports for loyalty data

Status: implemented on branch `pw-2026-feature-loyalty-automation`. Decision record: ADR-017 to ADR-020 (`architecture-decisions.md`); why these sources: `loyalty-architecture-review.md`.

## 1. What program emails can carry
| Kind | Examples | Becomes |
|---|---|---|
| Balance | "Your current points balance is 85,400", "You have 45,000 miles", pending and lifetime points | `balance`, `pendingBalance`, `lifetimePoints` |
| Status | "Congratulations, you have reached Gold Medallion status", "Your Platinum Elite status is valid through …" | `statusLevel`, `statusDeadline`, an `EliteStatus` row (new level = new qualification period; the earlier row stays as history) |
| Expiry notice | "25,000 miles will expire on 01/15/2027" | `expiresAt` (wins over the predicted date) and a recorded expiring-points notice |
| Certificate | "You've earned a Free Night Award … up to 40,000 points … Expires on March 31, 2027", companion and upgrade awards | `LoyaltyCertificate` with its conditions parsed by the condition engine |
| Activity | "You earned 5,000 miles", "redeemed", "expired", "transferred" | `LoyaltyEvent` rows (history, last activity) |
| Monthly summary | balance plus activity in one message | all of the above |

## 2. Pipeline
1. Mail reaches Pointwise by a connected mailbox (read-only sync) or the forwarding address. Sender domains of known programs are on the allow-list (`senderDomains()` includes `loyaltySenderDomains()`), DKIM/DMARC is checked, bodies are never stored.
2. `CaptureService.loyaltyMail` matches the sender to a program (`domain/loyalty-email.ts`, `PROGRAM_RULES`, 33 programs including the airlines, hotels, bank programs and portals asked for) and runs `parseLoyaltyEmail`. A genuine card transaction alert from the same domain (a bank that is also a points program) still continues to the card flow.
3. Observations pass through `LoyaltyIngestService.apply`, the single funnel for every source: they are matched to the member's account (by program, then by the account digits the message mentions), decided by the provenance engine (`loyalty-provenance.ts`), logged as `LoyaltyObservation` (value, source, reliability, outcome, reason, evidence hash — no message text) and applied.
4. Unmatched mail (no account for the program, or several and no digits) is recorded with the reason; nothing is guessed.

## 3. Reliability and conflicts
Official API 100, aggregator 90, **email 80**, **statement 75**, **extension 70**, AI-detected 50, manual 25. A lower-reliability value never overwrites a higher one (it is kept and logged); the same value from another source cross-confirms it; different values from sources within 10 points are a **conflict** the member settles in Loyalty → Imports & conflicts; a stale stored value makes the newer lower-confidence value **pending**; values older than the stored one are history only. Manual edits use the same funnel (25) with an explicit "override" for the member.

## 4. PDF statements
`domain/loyalty-statement.ts` on the sandboxed text extractor: program, period, opening and closing balance, printed totals and dated activity lines, **reconciled** (opening + activity = closing; printed earned/redeemed/expired totals equal the lines read) → PASS / WARNING / FAILED. A WARNING is shown before import. Dollar amounts are never read as points, so card statements are not mistaken for loyalty statements. Reached by email attachment, or Loyalty → Imports (preview, then import). The PDF is not stored.

## 5. Honest limits
- **The reading rules are generic and have not been checked against real program emails or statements** (no real accounts were used; fixtures are synthetic). Every parser result is flagged unverified. To improve a program, paste a redacted real email into Loyalty → Imports → "Test a program email" and compare, then adjust that program's entry.
- Programs that send no useful email give nothing here; use statements, the browser extension or manual entry.
- Only what the member's own mail contains can be read; Pointwise never signs in to a program.
