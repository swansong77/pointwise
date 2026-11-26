# AI Streaming, Evals, Live Smoke Tests and Operations (Phase E)

Status: **built (2026-11-25)**.

## 1. Streaming answers
`POST /api/v1/ai/chat/stream` — same body and checks as `/ai/chat` (auth, consent, budget, rate limit), answered as server-sent events:

| Event | Data |
|---|---|
| `start` | conversationId, agent |
| `delta` | text chunk |
| `reset` | discard streamed text (a model failed mid-answer and the router failed over, or a private answer replaces the model's preamble) |
| `tool` | name, status `running` / `done` / `error` |
| `done` | the full `/ai/chat` result (answer, trace, private flag, pending actions…) |
| `error` | status, message (consent, budget, model outage) |

Provider support: Claude via `client.beta.messages.stream()` + `finalMessage()` with `eager_input_streaming` on each tool (handlers validate inputs; a response stopped at `max_tokens` never runs its tool calls); OpenAI-compatible providers via `stream: true` with tool-call fragments accumulated by index; Gemini falls back to one chunk; the demo model streams word by word. Private (user-data) answers are composed by Pointwise and sent as one `delta` after a `reset` — the model never sees them. The UI (`/assistant`) shows live text and tool progress and falls back to `/ai/chat` when streaming is unavailable.

## 2. Grounding eval set
`backend/test/evals/grounding.json` — 16 questions on the demo family account (5/24, benefits, best card, renewals, value, next card, who should apply, transfers, award plan, household, card comparison, transfer partners, offer history, an unknown card, card fine print). Graded deterministically by `src/ai/evals.ts` (no LLM judge):
- `answered` (non-empty, not refused), `tool:<name>` (the right tool answered; `allowToolError` when "not found" is correct), `matches:<regex>` (expected facts), `excludes:<text>`, `private` / `catalog-only` (user-data answers never went to a model).

Runs:
- **CI gate:** `test/integration/evals.int-spec.ts` — demo model, must pass 100 %.
- **Any model:** `npm run eval` (demo) or `EVAL_MODEL_ID=<AiModel.id> EVAL_LIVE=1 npm run eval` (real model — costs money, refused without `EVAL_LIVE=1`). Writes `eval-report.md` / `eval-report.json`. Live runs measure tool selection and catalog answers; user data still never reaches the model.

## 3. Live provider smoke tests
`backend/test/live/providers.live-spec.ts` (`npm run test:live`) — skipped unless `LIVE_AI_SMOKE=1` and the provider's key is set. Per provider: a one-word reply and one streamed tool call with synthetic text only. Never part of `npm test`, CI or Docker validation.

## 4. Operations page
`GET /admin/ops/health` and `GET /admin/ops/logs` (ADMIN), UI `/admin/ops` (refreshes every 15 s):
- status ok / degraded / down + problem list; database and Redis round-trip latency; queue counts; every scheduled job with its cron, next run and last run (ok/failed, duration);
- AI models: circuit breaker state (this API process), 24 h requests, error rate, mean latency (usage ledger);
- MCP servers (status, last error), card sources (active, failing);
- events (7 days): failed jobs, AI errors, MCP and card-source errors, admin audit entries.
No secrets, keys or user identities are returned.
