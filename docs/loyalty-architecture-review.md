# Loyalty automation — architecture review

Inputs: `loyalty-aggregation-research.md` (verified 2026-11-25), `email-loyalty-imports.md`, `offer-activation-research.md` (Chase and Rakuten terms prohibit scripts, bots and automated access; verified), and the standing rules (free only; no server-side logins; no household data to AI providers).

## 1. Options

| | Advantages | Disadvantages | Security risk | Maintenance cost | Automation | Best for |
|---|---|---|---|---|---|---|
| **A. Official APIs** | Most reliable and permitted, if they existed | None found for consumer balances (research); per-program onboarding | Low (OAuth) | Low per program | High | Any program that publishes one — adapter slot kept |
| **B. Aggregator services** (AwardWallet, bank aggregators) | Broad coverage, no parser upkeep | AwardWallet API is business-only and per-member priced; its parsing logs in with the user's program password; banking aggregators do not cover loyalty | **High** (credential handoff to a third party) | Low | High | Not usable here (paid, partner-gated, credential-based); disabled adapter documented |
| **C. Email automation** | Free; the user already receives balance, status, certificate and expiry emails; no credentials; DKIM-checked; works with the existing mailbox pipeline | Only what programs email; wording differs and changes; patterns need maintenance and real samples | Low (read-only, body never stored) | Medium (rules as data) | Medium–high for programs that email often | Balances, status, awards issued, expiry warnings, monthly summaries |
| **C2. Statement PDFs** | Free; precise numbers and activity; reconciles against printed totals | Needs the user to download or forward; formats vary | Low | Medium | Medium | Opening/closing balance, activity history, year-end totals, fallback when no emails |
| **D. Browser automation (server-side)** | Highest coverage | Needs the user's credentials on a server, defeats MFA, violates program terms (verified for Chase and Rakuten), brittle | **Very high** | **High** | High | **Rejected** |
| **D2. Browser extension in the user's own session** | No credentials leave the browser; sees exactly what the user sees; catches pages with no email | Per-program selectors break when pages change; scripted reading may breach some programs' terms (Chase forbids "scripts"); needs the user to visit and click | Medium (token in the extension; mitigated by scope, revocation, read-only, user-initiated) | High (selectors as data) | Medium (user-initiated) | Balances and status for programs without useful emails |
| **E. Hybrid** | Each source covers the others' gaps; a provenance engine decides which value to trust; honest confidence | More moving parts | Low–medium | Medium | **Highest achievable without credentials** | Everything |

## 2. Decision (ADR-017)

**E: hybrid of email + PDF + user-side extension + manual entry, merged by a provenance and conflict engine.** The official-API and aggregator adapters implement the same `LoyaltySource` interface but stay disabled with the reason recorded (unavailable, paid, or credential-based). Server-side browser automation is rejected.

Selection against the criteria asked for: **reliability** (every value carries its source, reliability and age; the highest-confidence value is never overwritten by a lower one), **automation** (as high as the user's own data allows: mail arrives on its own, statements parse on arrival, the extension captures in one click), **maintainability** (parser rules and page extractors are data tables with fixtures, not code per program), **scalability** (a single ingestion funnel; refresh scheduling by priority), **privacy** (no credentials, bodies not stored, account numbers encrypted, nothing sent to an AI provider).

## 3. What "automatic" means here (stated in the UI too)

PointWise updates a program automatically when the user's own mail, statements or browser session supply the data. It cannot refresh a program the user never emails, exports or visits, and it says so: stale accounts get a "needs refresh" notice naming what to do (sync the mailbox, capture the page, forward the statement).

## 4. Source reliability scale (ADR-018)

Official API 100 · Aggregator 90 · Email confirmation 80 · Statement import 75 · Extension capture 70 (the user's own page, parser unverified) · AI-detected 50 · Manual entry 25. A lower-reliability observation never overwrites a higher one; materially different values from sources within 10 points become a conflict for the user; a stale high-confidence value is flagged and the newer lower observation waits as a pending observation.

## 5. Extension security model (ADR-019)

Manifest V3, minimal permissions, no remote code, read-only. Runs only when the user clicks "Capture this page" (auto-capture off by default). Sends `{program, fields, capturedAt, pageHash}` to the user's own PointWise server with a **personal access token of scope `loyalty:ingest`** (revocable, expiring, rate-limited, size-limited, schema-validated). The user's program credentials are never read, stored or transmitted. Terms risk is shown before enabling a program, because Chase's verified terms forbid "robots, spiders, scripts".

## 6. Refresh tiers (ADR-020)

CRITICAL (expiring in 30 days, a status or certificate change pending, an active transfer bonus on a held currency) · HIGH (expiring in 90 days, or stale) · NORMAL · LOW. Cadences: event-driven (email arrival, extension push), daily, weekly, scheduled, manual. Refresh confidence = source reliability decayed by age.
