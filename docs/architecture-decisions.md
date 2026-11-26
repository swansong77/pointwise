# Architecture decisions (ADR log)

Format: Context · Options · Decision · Consequences · Status. Evidence and its status (verified / unverified) are in the linked research documents. Standing constraints: **free solutions only**, no card data to AI providers, no bank-credential automation, no real statement data in the repository.

---
## ADR-001 — Transaction import: email + PDF/CSV first, aggregator optional
- **Context:** no issuer exposes a consumer API (`bank-api-research.md`); aggregators are paid beyond a small trial (`account-aggregation-research.md`).
- **Options:** A direct issuer APIs (unavailable) · B aggregator · C user exports/emails.
- **Decision:** C is the primary path; B (Plaid Trial, ≤10 Items) stays optional behind `BANK_PROVIDER`, never upgraded; refactor Plaid behind a `BankProvider` interface.
- **Consequences:** works for every issuer at $0; parser maintenance is the cost, controlled by validating each statement against its printed totals.
- **Status:** accepted.

## ADR-002 — Mailbox ingestion via a connector interface; IMAP first
- **Context:** `email-ingestion-research.md` (provider details partly unverified).
- **Options:** forwarding filter only · IMAP · Gmail/Graph OAuth · hosted parser (paid).
- **Decision:** `MailboxConnector` interface; IMAP adapter first, then Gmail (`gmail.readonly`) and Microsoft Graph (`Mail.Read`) adapters once their facts were verified from official docs (2026-11-25); the owner registers their own free OAuth apps; sealed single-use-style state, refresh token only stored (encrypted); bodies processed in memory and never stored; issuer allow-list + DKIM/DMARC.
- **Consequences:** free, provider-neutral; Google *Personal* mode (one account) avoids verification, *Testing* mode needs weekly re-consent; Microsoft needs no verification for `Mail.Read`.
- **Status:** accepted; implemented.

## ADR-003 — Offers: auto-publish only issuer-verified changes
- **Context:** `offer-sources-research.md`; offers must stay current without admin toil but wrong data is costly.
- **Options:** always review · auto-publish everything · auto-publish when verified.
- **Decision:** publish automatically only when extracted from the issuer's own domain for a known card with plausible values and a bounded change ratio; all else to review; every publish audited with source + diff.
- **Consequences:** fresh data for public offers; lead-site data never publishes itself.
- **Status:** accepted.

## ADR-004 — AI privacy boundary: engines compute, models explain public data
- **Context:** standing rule that AI providers never receive card data; agents are requested to reason about portfolios.
- **Options:** deterministic engines + AI narration of public data · minimized-summary opt-in · public-only.
- **Decision:** privacy class per tool/step; USER steps are server-side engines; a model sees USER results only when its provider is local.
- **Consequences:** auditable and private; narration quality for USER results depends on a local model or templates.
- **Status:** accepted (user-confirmed).

## ADR-005 — Orchestration: declarative workflows with an audit log
- **Context:** one-agent-per-request tool loop cannot express multi-agent flows or reproduce reasoning.
- **Options:** LLM-planned multi-agent chat · hard-coded service calls · declarative workflow of typed steps.
- **Decision:** declarative workflows; each step = agent profile + deterministic engine + optional narration; `AgentRun`/`AgentStep` store inputs hash, output, engine/prompt version, model, duration.
- **Consequences:** deterministic, testable, reproducible; less open-ended than an LLM planner.
- **Status:** accepted.

## ADR-006 — OpenClaw via the OpenAI-compatible adapter and MCP
- **Context:** `openclaw-integration.md` (verified from official docs, defaults partly unverified).
- **Options:** custom adapter · OpenAI-compatible preset + MCP · skip.
- **Decision:** preset on the OpenAI-compatible adapter (`http://127.0.0.1:18789/v1`, model `openclaw/default`); PointWise public tools exposed to OpenClaw via MCP; OpenClaw treated as non-local by default, so it gets PUBLIC data only.
- **Consequences:** no adapter code; security follows OpenClaw's single-operator model (loopback/Tailscale only).
- **Status:** accepted; endpoint default-enablement to be confirmed against a running gateway.

## ADR-007 — Prompt versioning in the database
- **Options:** prompts in code · DB-editable (current) · versioned templates.
- **Decision:** `PromptTemplate` (key, version, body, status); runs record the version; rollback by republishing.
- **Status:** accepted.

## ADR-008 — Recommendation confidence and weights
- **Context:** `recommendation-scorer.md`; new inputs (goals, recent applications, business eligibility, balances, benefit utilization, offer expiry).
- **Decision:** a single versioned weights/config object (no magic numbers in code); confidence = base minus penalties with named reasons; **application probability is an estimate** banded from the self-reported credit band and issuer velocity rules, always labelled as such; each recommendation stores its input snapshot and per-factor contributions (`Recommendation`, `RecommendationFactor`).
- **Consequences:** explainable and reproducible; probabilities are indicative only.
- **Status:** accepted.

---
## ADR-009 — Offer intake: user-side and email-side only; reliability scale
- **Context:** `offer-activation-research.md` — issuers publish no consumer offers API; verified terms (Chase, Rakuten) prohibit scripts/bots; the project forbids server-side bank logins.
- **Options:** server-side automation with credentials · user-side extension · paste/import + mailbox + statements + public pages.
- **Decision:** the third now, extension designed later. Every offer stores its source and a reliability score: 100 official issuer data, 90 account data (e.g. statement credit), 75 email, 50 AI-inferred, 25 user-entered. Confidence of any recommendation is capped by the weakest supporting source and by verification status.
- **Status:** accepted.

## ADR-010 — Assisted activation
- **Decision:** link to the issuer's public offers page and record the user's activation; verify later from a credit or email; flag activations that never produced a credit. No bot activation.
- **Consequences:** slower than automation but compliant; verification closes the loop.
- **Status:** accepted.

## ADR-011 — Merchant identity and opportunity score
- **Decision:** canonical merchants with aliases, MCC, parent company and industry; resolution = normalised descriptor + alias table + MCC + fuzzy fallback with a confidence value; low confidence never drives a recommendation. Opportunity score 0–100 from named factors with weights in one versioned config (`OPP_WEIGHTS`); each factor returns its contribution and reason, and the weights are stored with the result.
- **Status:** accepted.

## ADR-012 — Evidence-required recommendations and stacking
- **Decision:** a recommendation (plan, missed-offer alert, opportunity) is generated only with at least one supporting evidence item (offer ref, transaction ids, rate) and is stored as an `OfferEvent` with evidence and confidence. Stacking rules are data (`STACK_RULES`), marked verified/unverified, and conflicts are shown as warnings.
- **Status:** accepted.

---
## ADR-013 — Loyalty accounts are member-entered; no program logins
- **Context:** the brief asks for AwardWallet-like tracking. Programs offer consumers no API, and the standing rule forbids logging in with credentials or scraping.
- **Decision:** balances and dates are entered by the member (later: parsed from emails/imports they provide). Each account records `source` and `refreshedAt`; every prediction states its confidence.
- **Consequences:** works for any program, including ones not in the registry (custom accounts); freshness depends on the member. **Status:** accepted.

## ADR-014 — Expiration predictions carry a policy, a source and a confidence
- **Decision:** policy type + months + reset conditions per program and bank currency; the member's own date wins; unverified policies cap confidence at 50–60 and unknown ones at 15–20; FIXED policies are computed from earning lots (FIFO) rather than assumed. Alerts fire once per asset, expiry date and threshold.
- **Consequences:** honest about what is known; wrong policies are correctable by admins and overridable per account. **Status:** accepted.

## ADR-015 — Asset valuation definitions
- **Decision:** current / potential / at-risk / expired / recovered / net annual are defined once in `loyalty-valuation.ts` (points at the program's ¢ per point, certificates at stored potential value, status at member-entered annual value, memberships pro-rated, unused card credits from the benefit tracker). Valuations are planning estimates, shown with that label.
- **Status:** accepted.

## ADR-016 — Award planning reuses the transfer planner and states its estimates
- **Decision:** award trips call the existing `planAward` per candidate program (balances first, then lowest-cost transfers, with active bonuses) and rank the results with the trip's preferences, expiring points and certificates. Without the exact points the price is a coarse table flagged as an estimate; transfer time beyond the departure date is penalised.
- **Status:** accepted.

---
## ADR-017 — Loyalty automation: hybrid sources behind one ingestion funnel
- **Context:** `loyalty-aggregation-research.md`, `loyalty-architecture-review.md`. No free permitted consumer API or aggregator returns loyalty balances; AwardWallet's API is business-only and its parsing uses the user's program passwords; Chase and Rakuten terms prohibit scripts and bots (verified).
- **Options:** official APIs · aggregators · email · server-side browser automation · hybrid.
- **Decision:** hybrid of email, statement PDFs, a user-side browser extension and manual entry. All observations enter through `LoyaltyIngestService.apply`; API and aggregator adapters share an interface but stay disabled. Server-side automation is rejected.
- **Consequences:** no credentials held, free, auditable; freshness depends on the user's own data, which the UI states. **Status:** accepted.

## ADR-018 — Source reliability and conflict policy
- **Decision:** Official API 100, Aggregator 90, Email 80, Statement 75, Extension 70, AI-detected 50, Manual 25. A lower-reliability observation never overwrites a higher one; the same value confirms; different values from sources within 10 points are a conflict for the user; stale high-confidence data is flagged and newer lower observations wait as pending. Manual edits go through the same funnel.
- **Status:** accepted.

## ADR-019 — Browser extension security model
- **Decision:** Manifest V3, read-only, user-initiated capture, no credentials read or sent, no remote code, personal access token scoped `loyalty:ingest` (revocable, expiring, rate- and size-limited). Terms risk per program is shown before enabling.
- **Status:** accepted.

## ADR-020 — Refresh tiers
- **Decision:** CRITICAL / HIGH / NORMAL / LOW by expiry, pending changes and stale data; event-driven, daily, weekly, scheduled and manual refresh; refresh confidence decays with age; stale accounts produce a "needs refresh" action rather than a silent gap.
- **Status:** accepted.
