# AI platform architecture

Builds on `ai-platform.md` (kept as the operational reference) and `openclaw-integration.md`. This document is the layered architecture plus the gaps being closed. **Free-only rule:** no paid API is enabled; defaults are the mock model and local Ollama. Your Claude Pro subscription is not an API key and is not used by the app.

## 1. Layers

| Layer | Responsibility | Where | State |
|---|---|---|---|
| **Provider adapters** | Translate a provider-neutral chat request to each vendor API and back | `backend/src/ai/providers/` (Anthropic, OpenAI-compatible [OpenAI, Azure, OpenRouter, xAI, Mistral, DeepSeek, **OpenClaw preset**, Ollama/local], Gemini, mock) | built; OpenClaw is a seed preset, no code |
| **Response normalisation** | One message/tool-call/usage shape for every provider (`ChatMessage`, `ToolCall`, `Usage`, `ProviderError{retryable}`) | `ai/types.ts` | built |
| **Model routing** | Ordered chain per agent, user preference first, circuit breaker, per-call cost ledger; **new:** capability/cost-tier selection and a privacy filter (see §3) | `ai/router.ts` | extended |
| **Tool abstraction** | Strict-schema tools with a privacy class; MCP server exposes public tools, MCP client registry is admin-approved | `ai/tools.ts`, `mcp-*.ts` | built (+ `get_spend_summary`) |
| **Prompt management** | Base policy in code; per-agent prompt in DB; **new:** versioned `PromptTemplate` (draft/published, rollback), runs record the version | `ai/agents.ts`, `PromptTemplate` | extended |
| **Orchestration** | Declarative workflows over agents with typed step results and an audit log | `ai/orchestrator.ts`, `AgentRun`/`AgentStep` | new |
| **Audit** | Per-run reasoning trace: workflow, step, agent, engine version, input hash, output, model, duration, privacy class | `AgentRun` + `AgentStep` + existing `AiUsage`/`AuditLog` | new |

Adding a provider needs only database rows when it speaks the OpenAI protocol (OpenRouter, OpenClaw, local servers), or one adapter file otherwise.

## 2. Agents (profiles; same runtime, different prompt/tools/chain)

| Requested agent | Profile key | Deterministic engine behind it |
|---|---|---|
| Card Strategy | `card-strategy` | `domain/card-scorer.ts` (+ household "who applies next") |
| Benefit | `benefit-utilization` | `domain/benefit-roll.ts`, detection/reconciliation |
| Offer | `offer-monitoring` | `domain/offer-intel.ts`, `CardOffer` history |
| 5/24 | `five24-planning` | `domain/five24` engine |
| Travel | `travel-rewards` | `domain/travel.ts` |
| Spending | `spending` (new) | `get_spend_summary`, category recommendations |
| Portfolio Review | `portfolio-review` (alias of `annual-fee-review`) | `cardValue`, renewals |

## 3. Privacy boundary (decision ADR-004)
Every tool and workflow step has a privacy class: **PUBLIC** (catalog, offers, history) or **USER** (portfolio, spend, benefits, 5/24 of the user). USER steps are computed by deterministic engines on the server. A model may receive a USER result only if its provider is **local** (Ollama, or OpenClaw explicitly marked local). External providers see PUBLIC data only. The router enforces this by class, not by convention, and the run log records the class of every step.

## 4. Orchestration example
"What card should I get next?":
`offer (PUBLIC)` → `five24 (USER)` → `portfolio-review (USER)` → `card-strategy (USER)` → `recommendation engine (USER)` → response. Each step stores its typed output; the response is composed from these results (template text, optionally narrated by a local model), so the reasoning is reproducible and auditable (`GET /ai/runs/:id`).

## 5. Free-only provider guidance
Default: mock (tests/demo) and Ollama (local, free). Cloud providers remain configurable by the user with their own key but are never enabled by the project.
