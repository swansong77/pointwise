# AI platform & MCP — test cases

Code under test: `backend/src/ai/**`. Automated in `backend/test/unit/ai/*.spec.ts` (U), `backend/test/integration/ai.int-spec.ts` (INT), `playwright/tests/ai-assistant.spec.ts` (PW), `cypress/cypress/e2e/ai-assistant.cy.ts` (CY). All automated tests use the offline demo model; provider keys are removed from the test environment.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-AI-01 | SEC | Consent required before data is sent | new user | POST /ai/chat | 403; UI shows consent panel, no input | P0 | Critical | ✅ INT, PW-AI-01, CY-AI-02, U |
| TC-AI-02 | POS | Consent toggle in settings | — | toggle on/off | chat allowed / refused | P1 | Major | ✅ INT, PW-AI-04 |
| TC-AI-03 | POS | "What is my current 5/24 status?" | family account | ask | tool get_five24_status; answer "Jordan: 5/24 … Riley: 3/24" | P0 | Critical | ✅ INT, PW-AI-02 |
| TC-AI-04 | POS | The 10 spec questions route to the right tools | family | ask each | benefits / best card / renewals / catalog / value / compare / household / valuations | P0 | Major | ✅ INT (it.each), U (mock rules), CY-AI-01 |
| TC-AI-05 | POS | Follow-up keeps the conversation | — | ask twice with conversationId | same conversation, history used | P1 | Minor | ✅ INT, PW-AI-02 |
| TC-AI-06 | POS | Task endpoints map to agents | — | POST /ai/recommend, /portfolio-review, /travel-strategy | card-strategy, family-portfolio, travel-rewards | P1 | Minor | ✅ INT, CY-AI-02 |
| TC-AI-07 | SEC | Write tools require confirmation | card with dining credit | "Log $5 of my Dining credit" | pending action; nothing changed until confirm; confirm once (409 after); reject works | P0 | Critical | ✅ INT, PW-AI-03, U |
| TC-AI-08 | SEC | Pending actions / conversations are owner-scoped | two users | confirm / read / delete other's | 404 | P0 | Critical | ✅ INT |
| TC-AI-09 | NEG | Monthly token budget | budget 1 | chat | 429 | P1 | Major | ✅ INT, U |
| TC-AI-10 | NEG | Unknown agent / task / model, empty message | — | request | 404 / 404 / 404 / 400 | P2 | Minor | ✅ INT, U |
| TC-AI-11 | POS | Failover to the next model on retryable errors | chain a→b, a returns 529 | chat | answered by b; usage recorded for both | P0 | Major | ✅ U (router) |
| TC-AI-12 | POS | Circuit breaker | 3 failures in 2 min | next request | model skipped ("circuit open") for 60 s | P1 | Major | ✅ U |
| TC-AI-13 | NEG | All models fail / none configured | — | chat | 503 with attempts | P1 | Major | ✅ U |
| TC-AI-14 | POS | Cost ledger | priced model | usage | micro-USD = tokens × $/1M (cache read/write) | P1 | Major | ✅ U, INT (admin usage) |
| TC-AI-15 | POS | Anthropic adapter request shape | — | chat | cached system, effort only with capability, fallbacks beta, no forced tool_choice, tool_result mapping, native replay | P0 | Major | ✅ U |
| TC-AI-16 | POS | OpenAI-compatible adapter | OpenAI / compatible | chat | max_completion_tokens vs max_tokens, reasoning_effort, tool calls, finish reasons | P0 | Major | ✅ U |
| TC-AI-17 | POS | Gemini adapter | — | chat | functionDeclarations, ids, thought-signature replay, finish reasons | P0 | Major | ✅ U |
| TC-AI-18 | POS | Error normalisation | 429/5xx/400/network per SDK | chat | retryable flags correct | P0 | Major | ✅ U |
| TC-AI-19 | POS | Refusal and step limit | model refuses / loops | run | refused flag; stops at maxSteps | P1 | Major | ✅ U |
| TC-AI-20 | SEC | Tool errors don't leak internals | tool throws | run | "tool failed" to the model | P1 | Major | ✅ U |
| TC-AI-21 | SEC | API keys write-only and encrypted | admin | set key, list, audit log | encrypted v1 ciphertext in DB; never in responses or audit | P0 | Critical | ✅ INT |
| TC-AI-22 | SEC | Admin endpoints require ADMIN | user | GET /admin/ai/*, /admin/mcp/* | 403; UI redirect | P0 | Critical | ✅ INT, PW-AI-05 |
| TC-AI-23 | NEG | Agent updates validated | admin | unknown tool / model / maxSteps 99 / write MCP tool | 400 | P1 | Major | ✅ INT |
| TC-AI-24 | POS | Model test call | demo model | POST /admin/ai/models/:id/test | ok; disabled provider → 400 | P2 | Minor | ✅ INT |
| TC-AI-25 | POS | Usage & cost dashboard | traffic | GET /admin/ai/usage | totals, by model, by agent, daily | P1 | Major | ✅ INT, PW-AI-05 |
| TC-AI-26 | POS | Pointwise MCP server lists read-only tools, scoped to the token user | PAT | tools/list, tools/call | 11 tools, no write tool; family data | P0 | Critical | ✅ INT, U (in-memory) |
| TC-AI-27 | SEC | MCP auth | — | no token / session JWT / wrong / revoked PAT | 401 | P0 | Critical | ✅ INT, CY-AI-03 |
| TC-AI-28 | SEC | PAT storage | — | create | token shown once; only SHA-256 stored; scope mcp:read; expiry | P0 | Major | ✅ U, INT, PW-AI-04 |
| TC-AI-29 | SEC | MCP URL policy | admin | http to public host, metadata IP, credentials in URL, not allow-listed | 400 | P0 | Critical | ✅ U, INT |
| TC-AI-30 | POS | MCP discovery, health, approval, attach | registered server | check → approve → enable → attach | UP; tool usable; attached to agent | P0 | Major | ✅ INT |
| TC-AI-31 | SEC | Tool poisoning: changed definition loses approval | approved tool | description changes | "changed — review", not usable | P0 | Critical | ✅ INT, U |
| TC-AI-32 | SEC | External tool results labelled untrusted | approved MCP tool | model calls it | result prefixed as untrusted data; failures reported | P1 | Major | ✅ U |
| TC-AI-33 | A11Y | Assistant and admin AI pages pass axe | — | axe | no serious violations | P1 | Major | ✅ PW-AI-A11Y, PW-AI-05 |
| TC-AI-35 | SEC | No user card data reaches any AI provider | family; provider spy | ask 5/24, benefits, value, household, compare, question with card number + email | provider requests contain no member names, labels, notes, digits, emails; only catalog results; answers private:true | P0 | Critical | ✅ INT (provider spy), U (privacy, runtime) |
| TC-AI-36 | SEC | MCP server exposes only public catalog tools | PAT | tools/list; call get_five24_status | 4 public catalog tools (search, compare, offer history, transfer partners); user tool → error, no data | P0 | Critical | ✅ INT, U |
| TC-AI-34 | ❌ manual | Live provider smoke test | real API key | admin "Test" + ask 5/24 | real model answers via tools | P1 | Major | ❌ manual (needs a paid key) |
