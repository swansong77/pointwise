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

---
## ADR-021 — Offer snapshots: one funnel, one diff
- **Context:** offers reach PointWise from a server-side connector, the member's browser extension, offer emails and pasted lists; each shows the issuer's inventory for one card at one time.
- **Decision:** every source feeds one function (`OfferSyncService.applyInventory`). It hashes the inventory (identical hash = no-op), diffs it against the stored items of that account (`domain/offer-snapshot-diff.ts`: new, updated, removed, expired, redeemed, newly enrolled, reappeared), writes an `OfferEvent` for each change, and keeps the current state in `OfferSnapshotItem`, unique per account, card and issuer offer id. A partial source (an email) never removes anything; a collapsed inventory (over 40 percent smaller) is a warning, not a mass removal.
- **Consequences:** one place to audit and test; the same offer on two members' cards is two rows and two enrollments (never merged).
- **Status:** accepted.

## ADR-022 — Connector contract, vault and the opt-in server-side login
- **Context:** the member asked for automated login and enrollment across six issuers, knowingly overriding the earlier rule against server-side bank logins (ADR-009, ADR-010). Chase's verified terms prohibit "agents, including AI agents or agentic AI, robots, spiders, scripts" and require agent traffic to be labelled. The other issuers' terms were not readable. No real issuer account is available to test against.
- **Options:** (a) refuse; (b) build it on by default; (c) build the framework, ship the real issuer flows as unverified data, **off by default**, and prove everything against a mock issuer.
- **Decision:** (c). A connector implements login, MFA, inventory, enrollments, enroll and health (`offer-automation/connector.ts`); new issuers are a new connector or flow definition and a registry line. Real issuer flows are inert without an optional browser add-on and are switched on only by `OFFER_CONNECTORS_ENABLED=true` plus a per-account opt-in with a recorded acknowledgement of the terms risk. Logins, sessions and device-trust markers are AES-256-GCM encrypted, write-only through the API, redacted from every audit row, event, notification and AI tool. Three bad logins lock the account; traffic is paced, one account at a time, capped per day.
- **Consequences:** the member keeps the choice and the risk is visible; no real issuer flow is claimed to work; passkeys cannot be completed by a server and are user-assisted.
- **Status:** accepted (supersedes the "not built" position of ADR-010 for this feature only; assisted activation remains the default).

## ADR-023 — Enrollment modes, rules and smart scoring
- **Decision:** three modes: recommend only (default), bulk approval, automatic. Rules are always/never over merchant, category, minimum value, offer type, keyword and spend history; a never-rule always wins; always-rules enroll without approval only in automatic mode. Every offer gets six 0-100 sub-scores (value, expiration, merchant preference, travel, household, likelihood of use) and an overall score with reasons, in one versioned weight table (`domain/offer-smart-enroll.ts`). Automatic mode needs an explicit filter; a score floor alone enrolls nothing. An enrollment counts as SUCCESS only after the issuer's enrollments are read back and show the offer; otherwise it is PARTIAL.
- **Status:** accepted.

## ADR-024 — Offer sources and the extension
- **Decision:** the extension (extension-offers/) is user-initiated, issuer-domain-only, reads visible text and sends it to the member's own server with an `offers:ingest` token; "Enroll selected" presses the issuer's own Add button on the open page for offers the member approved, only on click. Offer emails from a known issuer add offers for the member's "Offer Emails" account. Page selectors are text heuristics, unverified.
- **Status:** accepted.


---
## ADR-025 — One registry drives backup, restore, export and import
- **Context:** the schema has 90 models and grows; a hand-written exporter per model would silently miss new ones.
- **Decision:** `domain/data-registry.ts` classifies every model (member data, catalog and configuration, short-lived), says how a member's rows are found (a relation path to the user id), which columns are never exported, which columns hold ids of other models, how rows match on a merge, and which columns are secrets. Insert order comes from the schema's foreign keys (cycles broken at an optional key). A unit test compares the registry with the Prisma schema and fails if a model is unclassified, a column named *Enc is not a listed secret, or a path is not a real chain of relations.
- **Consequences:** a new model cannot be forgotten; the same engine serves backups (all models, ids kept) and member import (member models, ids remapped).
- **Status:** accepted.

## ADR-026 — Passphrase-encrypted backups; secrets re-encrypted
- **Context:** secrets are encrypted with TOKEN_ENC_KEY, there is no key rotation, and a database copy to a server with another key would break every secret.
- **Options:** copy ciphertext (needs the same key on the new server); leave secrets out (everything must be reconnected); decrypt into the backup and protect the file with a passphrase.
- **Decision:** the third (the member's choice). The backup stream is gzip then AES-256-GCM frames under a scrypt key; secrets are stored decrypted inside it and re-encrypted with the target key on restore. A member's own export never contains secrets.
- **Consequences:** moves work across keys; the passphrase is the only protection and is never stored; a backup is as sensitive as the database.
- **Status:** accepted.

## ADR-027 — Restore safety
- **Decision:** verify the whole file before touching anything; require the same database version; make a pre-restore backup; one transaction (truncate, insert in foreign-key order, check every model's count and checksum against the manifest); roll back on any difference; maintenance mode off afterwards. Maintenance mode (a SystemSetting) answers 503 to everyone but administrators, health checks and sign-in.
- **Status:** accepted.


---
## ADR-028 — Category rates: what ranks, what is confirmed
- **Context:** "Best Card by Category" is only as good as the earning rates. The list of 112 curated cards was written from general knowledge; 211 more come from issuer listing pages; 54 of those have no rates; the engine ignored caps, treated categories as flat and could not tell a travel-portal rate from a general one.
- **Decision:** (1) A rate carries `conditional` (needs a portal, a linked account or similar; shown on the card, never used to rank), `verifiedAt` and `sourceUrl`. (2) Airlines, Hotels, Car rental and Transit are sub-categories of Travel: a travel rate applies to them, a sub-category rate does not apply to Travel. (3) A capped rate is blended with the card's base rate for the part of the member's yearly spend above the cap when the spending profile gives that spend; otherwise the headline rate ranks and the cap is shown. (4) Each ranked card says whether an issuer page confirmed the rate it used. (5) The ranking stays a rate comparison: annual fees are not in it (the portfolio and next-card pages net them). (6) About 60 popular cards were checked against the issuers' own pages (rate-verification.ts); pages that could not be read leave the card unverified; a rate that looks wrong and cannot be checked is made conditional until someone confirms it. (7) docs/rewards-audit.md is generated from the data by rules that run in the unit tests.
- **Consequences:** a portal bonus can no longer make a card "best at travel"; a capped card stops winning for a heavy spender; unverified rates are visible; gaps (cards with no recorded rates) are listed, not hidden.
- **Status:** accepted.


---
## ADR-029 — Scheduled refresh of rotating categories (scoped override of no-issuer-automation)
- **Context:** the standing rule forbids automating issuer sites. Quarterly rotating categories (Freedom Flex, Discover it) change every quarter and a hand-kept calendar goes stale. On 2026-11-26 the owner explicitly overrode the rule for this feature.
- **Decision:** the daily job `update-rotating-categories` (04:00 UTC, `ROTATING_AUTO_FETCH`, on by default) may read an issuer's PUBLIC announcement page listed in `seed/rotating-sources.ts`, only when the current quarter (or the next, in the last 45 days) is missing. It uses the catalog-refresh `PageFetcher`: https, allow-listed issuer domains, robots.txt, one request per host per interval, no cookies or credentials. A conservative parser applies a quarter only when the page states one quarter and one rate with recognised categories; otherwise admins are told once a day and import the quarter by hand. Pages known to be unreadable are marked and not requested. `GET /admin/rotating-categories/settings` shows the state.
- **Not covered:** logins, credentials, activating a category for a member, any page behind a login, offers, portals, or any other feature. Each of those still follows the standing rule.
- **Consequences:** quarters appear without a code change when an issuer's page is readable; a wrong or unreadable page degrades to an admin notice, never to a wrong calendar. Issuer terms against automated access are the operator's to check; the job is polite and can be switched off.
- **Status:** accepted.

## ADR-004a — Opt-in redacted view for cloud models (amends ADR-004)
- **Context:** AI Mode (Copilot) should reason about the household's whole portfolio. On 2026-11-26 the owner chose to allow cloud models to receive a redacted, pseudonymized view instead of keeping all private data local.
- **Decision:** raw USER data still goes only to local providers. A new privacy class `REDACTED` may go to a cloud provider only when the member has given a separate consent (`cloudShareConsentAt`, off by default) and the provider is on their allow-list. The view is built by an allow-list serializer: members become "Member A (spouse)", card products, programs and merchants keep their public names, amounts and balances are rounded, dates are relative. Names, emails, card numbers and last four, account and login identifiers, statement lines, addresses, birth years and free-text notes are never included. Every request is stored in `AiDisclosure` and shown to the member. Models only write prose: they never call user tools, and actions come only from the server allow-list. Without consent the deterministic engines answer alone.
- **Consequences:** better prose when a cloud key is supplied; pseudonymized facts can still identify a household in combination, which rounding, consent, the allow-list and the viewer reduce but do not remove.
- **Status:** accepted (user-confirmed).

## ADR-030 — Household members get their own sign-in as a linked login, not a separate account
- **Context:** a household is one owner account with members as `Profile` rows. Members asked for their own credentials, their own mailboxes and their own notifications and briefings. Every table is keyed by the owner's `userId`.
- **Decision:** a member's own sign-in is a `User` row linked to their profile (`Profile.loginUserId`). It holds only the member's channels (preferences, later mailboxes, alert address, push, briefings); household data stays with the owner so household-wide features keep working. Credentials come from a single-use invitation link (SHA-256 stored, 7 days). The server resolves the member's scope from the database on every request and denies every route that is not marked `@MemberSafe()`; the owner chooses per member whether they see only their own data (default) or also the household overview, read only.
- **Rejected:** fully separate accounts joined by invitation (would need a data migration between accounts and every household query rewritten); a login that impersonates the owner (one missed filter would leak the household).
- **Consequences:** safe by default and incremental (each route is opened deliberately); phases 2 and 3 can attach channels to the member's own user without moving data; revocation is immediate. Members cannot write household data until routes are opened for them.
- **Status:** accepted (user-confirmed design, 2026-12).
