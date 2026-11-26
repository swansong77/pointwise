# Agent orchestration — test cases

Code: `domain/orchestration.ts`, `ai/orchestrator.service.ts`, `ai/workflows.ts`, `ai/routing.ts`, `ai/privacy.ts`, `ai/prompts.service.ts`.

| ID | Type | Objective | Preconditions | Steps | Expected result | Priority | Severity | Automation |
|---|---|---|---|---|---|---|---|---|
| TC-ORC-01 | SEC | Privacy by provider locality | Anthropic, OpenAI-compatible/OpenClaw, Ollama | mayReceive / selectModels | USER data only to OLLAMA/MOCK; gateways are never local | P0 | Critical | ✅ U (orchestration.spec) |
| TC-ORC-02 | SEC | External model never narrates a run on your data | only non-local models enabled | POST /ai/workflows/next-card {narrate:true} | no model call; narrationSkipped explains | P0 | Critical | ✅ U, INT |
| TC-ORC-03 | POS | Local model narrates with the published prompt | Ollama enabled | run with narrate | chat called once with that model; prompt version recorded | P1 | Major | ✅ U |
| TC-ORC-04 | POS | next-card workflow | user with a card | POST /ai/workflows/next-card | 5 steps OK in order (offers PUBLIC, others USER); deterministic answer with probability "(an estimate)" | P0 | Critical | ✅ U, INT, PW-INT-02, CY-INT-01 |
| TC-ORC-05 | NEG | Failed required step / optional step | scorer throws | run | FAILED, later steps SKIPPED, all recorded; optional failure continues | P0 | Major | ✅ U |
| TC-ORC-06 | POS | Audit trace | after a run | GET /ai/runs/:id | steps with input hash, output, engine, privacy; owner only; other user 404 | P0 | Critical | ✅ INT |
| TC-ORC-07 | POS | Model routing by task | cost tiers, capability | selectModels | free-only default; sorted cheapest first | P1 | Minor | ✅ U |
| TC-ORC-08 | POS | Versioned prompts | admin | PUT / rollback | one PUBLISHED version; rollback restores; short text 400; non-admin 403 | P1 | Major | ✅ U, INT |
| TC-ORC-09 | POS | Spending and portfolio-review agents | seeded | GET /ai/agents | 12 profiles incl. spending, portfolio-review; tool get_spend_summary is USER class | P2 | Minor | ✅ INT |
