import { canNarrate, hashInput, runWorkflow, WorkflowDef } from "../../../src/domain/orchestration";
import { isLocalProvider, mayReceive } from "../../../src/ai/privacy";
import { costTier, selectModels } from "../../../src/ai/routing";

const m = (id: string, kind: string, over: Record<string, unknown> = {}) => ({ id, capabilities: [] as string[], inputPrice: null, outputPrice: null, provider: { kind }, ...over });

describe("TC-ORC: privacy by provider locality (ADR-004)", () => {
  it("only Ollama and the offline mock are local", () => {
    expect(isLocalProvider("OLLAMA")).toBe(true);
    expect(isLocalProvider("MOCK")).toBe(true);
    for (const k of ["ANTHROPIC", "OPENAI", "AZURE_OPENAI", "GEMINI", "OPENAI_COMPATIBLE"]) expect(isLocalProvider(k)).toBe(false);
  });
  it("USER data goes to local providers only; PUBLIC data goes anywhere", () => {
    expect(mayReceive("USER", "OLLAMA")).toBe(true);
    expect(mayReceive("USER", "ANTHROPIC")).toBe(false);
    expect(mayReceive("USER", "OPENAI_COMPATIBLE")).toBe(false); // OpenClaw / OpenRouter gateways may forward to the cloud
    expect(mayReceive("PUBLIC", "GEMINI")).toBe(true);
  });
  it("narration needs a model that may see the run's data class", () => {
    expect(canNarrate("USER", { local: false })).toBe(false);
    expect(canNarrate("USER", { local: true })).toBe(true);
    expect(canNarrate("PUBLIC", { local: false })).toBe(true);
    expect(canNarrate("PUBLIC", null)).toBe(false);
  });
});

describe("TC-ORC: task-based model selection", () => {
  it("classifies cost tiers from prices", () => {
    expect(costTier({ inputPrice: null, outputPrice: null })).toBe("FREE");
    expect(costTier({ inputPrice: 0, outputPrice: 0 })).toBe("FREE");
    expect(costTier({ inputPrice: "0.25", outputPrice: 1 })).toBe("LOW");
    expect(costTier({ inputPrice: 3, outputPrice: 15 })).toBe("HIGH");
  });
  it("USER tasks see only local models; free-only excludes priced ones; capability filters", () => {
    const models = [m("claude", "ANTHROPIC", { inputPrice: 3, outputPrice: 15 }), m("llama", "OLLAMA"), m("gemini-free", "GEMINI"), m("local-tools", "OLLAMA", { capabilities: ["tools"] })];
    expect(selectModels(models, { privacy: "USER" }).map((x) => x.id)).toEqual(["llama", "local-tools"]);
    expect(selectModels(models, { privacy: "PUBLIC" }).map((x) => x.id)).toEqual(["gemini-free", "llama", "local-tools"]);
    expect(selectModels(models, { privacy: "PUBLIC", maxCost: "HIGH" }).map((x) => x.id)).toContain("claude");
    expect(selectModels(models, { privacy: "USER", capability: "tools" }).map((x) => x.id)).toEqual(["local-tools"]);
    expect(selectModels([], { privacy: "USER" })).toEqual([]);
  });
});

interface Ctx { n: number }
const wf = (steps: WorkflowDef<Ctx>["steps"]): WorkflowDef<Ctx> => ({
  key: "t",
  title: "t",
  steps,
  compose: (r, s) => ({ answer: `ok=${Object.keys(r).join(",")} status=${JSON.stringify(s)}`, highlights: [] }),
});

describe("TC-ORC: workflow runner", () => {
  it("runs steps in order, passes prior results, hashes inputs and records outputs", async () => {
    const out = await runWorkflow(
      wf([
        { id: "a", agentKey: "offer-monitoring", engine: "e1", privacy: "PUBLIC", input: (c) => ({ n: c.n }), run: async (c) => c.n + 1 },
        { id: "b", agentKey: "card-strategy", engine: "e2", privacy: "USER", input: (_c, p) => ({ a: p.a }), run: async (_c, p) => (p.a as number) * 2 },
      ]),
      { n: 1 },
    );
    expect(out.failed).toBe(false);
    expect(out.results).toEqual({ a: 2, b: 4 });
    expect(out.steps.map((s) => [s.ordinal, s.id, s.status, s.output])).toEqual([[1, "a", "OK", 2], [2, "b", "OK", 4]]);
    expect(out.steps[0].inputHash).toBe(hashInput({ n: 1 }));
    expect(out.steps[0].inputHash).not.toBe(out.steps[1].inputHash);
    expect(out.privacy).toBe("USER");
    expect(out.composed.answer).toContain("ok=a,b");
  });
  it("a failing required step is recorded and skips the rest", async () => {
    const out = await runWorkflow(
      wf([
        { id: "a", agentKey: "x", engine: "e", privacy: "PUBLIC", run: async () => 1 },
        { id: "b", agentKey: "x", engine: "e", privacy: "USER", run: async () => { throw new Error("boom"); } },
        { id: "c", agentKey: "x", engine: "e", privacy: "USER", run: async () => 3 },
      ]),
      { n: 0 },
    );
    expect(out.failed).toBe(true);
    expect(out.steps.map((s) => s.status)).toEqual(["OK", "FAILED", "SKIPPED"]);
    expect(out.steps[1].error).toBe("boom");
    expect(out.results).toEqual({ a: 1 });
    expect(out.privacy).toBe("PUBLIC"); // the USER step never ran successfully
  });
  it("a failing optional step does not stop the workflow", async () => {
    const out = await runWorkflow(
      wf([
        { id: "a", agentKey: "x", engine: "e", privacy: "PUBLIC", optional: true, run: async () => { throw new Error("nope"); } },
        { id: "b", agentKey: "x", engine: "e", privacy: "PUBLIC", run: async () => 2 },
      ]),
      { n: 0 },
    );
    expect(out.failed).toBe(false);
    expect(out.steps.map((s) => s.status)).toEqual(["FAILED", "OK"]);
    expect(out.composed.answer).toContain("FAILED");
  });
  it("hashing is stable under key order and distinguishes values", () => {
    expect(hashInput({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(hashInput({ b: { d: [1, 2], c: 2 }, a: 1 }));
    expect(hashInput({ a: 1 })).not.toBe(hashInput({ a: 2 }));
    expect(hashInput(undefined)).toBe(hashInput(null));
    expect(hashInput(1)).toHaveLength(64);
  });
  it("uses the injected clock for durations", async () => {
    let t = 0;
    const out = await runWorkflow(wf([{ id: "a", agentKey: "x", engine: "e", privacy: "PUBLIC", run: async () => 1 }]), { n: 0 }, () => (t += 5));
    expect(out.steps[0].durationMs).toBe(5);
  });
});

import { PROVIDERS } from "../../../src/seed/ai";
describe("TC-ORC: OpenClaw preset", () => {
  it("is seeded disabled, on the OpenAI-compatible adapter, with a token from the environment, and is not a local provider", () => {
    const p = PROVIDERS.find((x) => x.name.startsWith("OpenClaw"))!;
    expect(p).toMatchObject({ kind: "OPENAI_COMPATIBLE", apiKeyEnv: "OPENCLAW_GATEWAY_TOKEN", active: false });
    expect(p.baseUrl).toMatch(/:18789\/v1$/);
    expect(p.models[0].modelId).toBe("openclaw/default");
    expect(isLocalProvider(p.kind)).toBe(false);
  });
});
