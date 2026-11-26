# OpenClaw integration

Retrieved **2026-11-25** from the official site, docs and repository. **VERIFIED** = read on an official page; **UNVERIFIED** = not read or inferred. OpenClaw is free (MIT) software you host yourself, which fits the free-only rule.

## 1. What it is (VERIFIED)
- Open-source, self-hosted personal AI assistant: https://openclaw.ai, docs https://docs.openclaw.ai, source https://github.com/openclaw/openclaw (MIT licence; OpenClaw Foundation). Latest release at retrieval: **v2026.11.10**. Former names (Clawdbot/Moltbot) are not mentioned on the pages read: UNVERIFIED.
- One long-lived **Gateway** owns messaging channels; clients and nodes connect over WebSocket. Skills (`SKILL.md` folders) and plugins extend it; plugins run in-process and are "trusted code".
- No hosted tier or subscription; model costs are paid to whichever provider you configure (a local Ollama model costs nothing).

## 2. How an external app calls it (VERIFIED unless noted)
- Default port **18789**, default bind **loopback** (containers resolve to `0.0.0.0`).
- **OpenAI-compatible HTTP endpoints** on that port: `GET /v1/models`, `POST /v1/chat/completions`, `POST /v1/responses`, `POST /v1/embeddings`, plus `POST /tools/invoke`. Models listed: `openclaw`, `openclaw/default`, `openclaw/<agentId>`; header `x-openclaw-model` overrides the backend model. Whether these endpoints are enabled by default: **UNVERIFIED**.
- Auth: required by default; `gateway.auth.token` / `password` (env `OPENCLAW_GATEWAY_TOKEN`). Bearer auth on these endpoints is **full operator access**; scope headers are ignored under shared-secret auth.
- OpenClaw as **MCP client**: connects to external MCP servers (Streamable HTTP, SSE, stdio), tool filters, optional OAuth. OpenClaw as **MCP server** (`openclaw mcp serve`, stdio) exposes channel-conversation tools only, not a general "run agent" tool.
- Providers: OpenAI, Anthropic, Gemini, OpenRouter, Ollama (bundled plugin, default `http://127.0.0.1:11434`) and OpenAI-compatible custom providers. Provider-page details UNVERIFIED.
- Credentials live under `~/.openclaw/` (config, SQLite state incl. session transcripts and MCP OAuth tokens); docs recommend `700`/`600` permissions and disk encryption; no at-rest encryption mentioned.

## 3. Security considerations (VERIFIED)
- **Single-operator trust model**: not a multi-tenant boundary. Anyone who can operate an agent can make it do anything it can do.
- Tools run on the host by default; sandbox mode defaults to **off** (enable Docker/Podman sandbox explicitly).
- Prompt injection is "out of scope" unless it crosses a policy/auth/sandbox boundary; docs recommend denying `gateway`, `cron`, `sessions_*` for agents handling untrusted content. Cross-provider messaging is allowed by default.
- Published advisories/CVEs: **UNVERIFIED** (advisory page not read). Run `openclaw security audit`.

## 4. Capabilities, benefits, limits, use cases
| | |
|---|---|
| Benefits | Free; speaks the OpenAI chat protocol PointWise already supports; consumes PointWise as an MCP server; can run local models (Ollama) with no per-token cost |
| Limits | Single-operator; full-access token; fast-moving project; transcripts may contain secrets; no HTTP MCP-server mode for general agent runs |
| Use cases | (1) a user's own OpenClaw assistant calls PointWise's **public** tools over MCP ("which card has the best 90K offer right now?"); (2) PointWise routes a **public-data** workflow step (offer research, narration of public offers) to a local OpenClaw agent; (3) chat-app access (WhatsApp/Telegram) to public tools |

## 5. Decision (see ADR-006)
- **Do not build a custom adapter.** Add an `OPENCLAW` *preset* on the existing OpenAI-compatible provider: base URL `http://127.0.0.1:18789/v1`, `Authorization: Bearer <gateway token>` (stored encrypted via the existing admin key endpoint), model `openclaw/default`. No code changes beyond the seed row, matching the "new providers need no code" requirement.
- **Privacy boundary:** OpenClaw is a *non-local-by-default, full-access agent that may forward to cloud models*, so it is classified like an external provider: it receives **public data only**. User-data steps never go to it. (A user who runs OpenClaw wholly against Ollama on their own machine may opt to mark it `local`; default is not local.)
- **PointWise → OpenClaw tools:** the existing MCP server (`/mcp`, personal-access-token, public tools only) is added to OpenClaw with `openclaw mcp add pointwise --url … --transport streamable-http --include <public tools>`.
- Network: loopback or Tailscale/SSH tunnel only; never exposed to the internet.

## 6. Contract test
A mock OpenAI-compatible server standing in for the OpenClaw gateway runs the same workflow as the Claude/Gemini/OpenAI mocks and must produce identical normalised responses (Phase 3 tests).

## 7. Not verified
`/v1/chat/completions` default enablement; per-provider env names; the advisories page; `docs.openclaw.ai/gateway/configuration`, `/sandboxing`, `/tools/skills`, `/cli/mcp/serve`, telemetry details. Confirm against a running gateway before relying on them.
