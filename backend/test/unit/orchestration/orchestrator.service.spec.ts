import { NotFoundException } from "@nestjs/common";
import { OrchestratorService } from "../../../src/ai/orchestrator.service";
import { DEFAULT_PROMPTS, PromptsService } from "../../../src/ai/prompts.service";

/** The orchestrator with fake services: privacy of narration, audit rows, failure handling. */
function build(models: Array<{ kind: string; name?: string }>, opts: { consent?: boolean; smartFails?: boolean } = {}) {
  const created: { steps: unknown[]; run: unknown[] } = { steps: [], run: [] };
  const prisma = {
    agentRun: { create: jest.fn().mockResolvedValue({ id: "run-1" }), update: jest.fn(async (a: unknown) => created.run.push(a)), findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null) },
    agentStep: { createMany: jest.fn(async (a: { data: unknown[] }) => created.steps.push(...a.data)) },
    offerEvent: { groupBy: jest.fn().mockResolvedValue([{ type: 'RECOMMENDED', _count: 2 }]) },
    $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
    walletCard: { findMany: jest.fn().mockResolvedValue([{ annualFeeOverrideCents: null, card: { annualFeeCents: 25_000 } }]) },
    cardOffer: { findMany: jest.fn().mockResolvedValue([]) },
    aiSettings: { findUnique: jest.fn().mockResolvedValue(opts.consent ? { consentedAt: new Date() } : null) },
    promptTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const rec = { name: "Example Gold", issuer: "Issuer", slug: "gold", firstYearValueCents: 120_000, longTermValueCents: 40_000, probability: 0.8, confidence: 0.7, factors: [{ key: "GOAL_FIT", label: "Matches your goals", deltaCents: 7500, note: "" }], risks: [], advice: [{ code: "NEAR_HIGH", text: "Current offer is near its historic high.", tone: "positive", priority: 3 }] };
  const services: Record<string, unknown> & { portfolio: unknown } = {
    portfolio: { five24: jest.fn().mockResolvedValue({ members: [{ profile: { nickname: "Me" }, status: { count: 2, limit: 5, underLimit: true } }] }) },
    strategy: { householdPlan: jest.fn().mockResolvedValue({ members: [{ member: "Me", top: [{ name: "Example Gold" }] }], pick: { name: "Example Gold" } }) },
    smart: { smart: jest.fn(async () => { if (opts.smartFails) throw new Error("scorer down"); return { engine: "recommendation/2", member: { profileId: "p", nickname: "Me" }, recommended: rec, alternatives: [] }; }) },
    benefits: { rollupView: jest.fn().mockResolvedValue({ groups: [{ allocatedCents: 100_000, utilizationPct: 40 }] }), reconciliation: jest.fn().mockResolvedValue({ totals: { unusedCents: 30_000 } }) },
  };
  const plan = { merchant: { id: "m", name: "Hilton" }, merchantConfidence: 0.97, amountCents: 120_000, plannedPurchaseId: null, plans: [{ kind: "SINGLE", legs: [{ cardName: "Card A", member: "Me", amountCents: 120_000 }], expectedCents: 12_400, maxCents: 12_400, confidence: 75, justification: ["Card A returns $24.00 on $1200.00."], evidence: ["offer o1: Hilton $100 back"], warnings: ["PORTAL + COUPON: risk"], actions: ['Activate "Hilton $100 back" on Card A before paying.'] }] };
  const offers = {
    plan: jest.fn(async () => plan),
    opportunities: jest.fn().mockResolvedValue({ items: [{ merchant: "Hilton", title: "t", score: 82, expectedValueCents: 6_000, daysLeft: 4, confidence: 75, activated: false }] }),
    missed: jest.fn().mockResolvedValue({ totalLostCents: 10_000, items: [{ cause: "NOT_ACTIVATED", offer: { merchant: "Hilton" } }] }),
  };
  services.offers = offers as never;
  const chat = jest.fn().mockResolvedValue({ response: { text: "Narrated text" } });
  const router = {
    usableModels: jest.fn().mockResolvedValue(models.map((m, i) => ({ id: `m${i}`, displayName: m.name ?? m.kind, capabilities: [], inputPrice: null, outputPrice: null, provider: { kind: m.kind } }))),
    chat,
  };
  const svc = new OrchestratorService(prisma as never, services.portfolio as never, services.strategy as never, services.smart as never, services.benefits as never, router as never, new PromptsService(prisma as never), offers as never);
  return { svc, prisma, chat, created, services, offers };
}

describe("TC-ORC: orchestrator service", () => {
  it("runs the next-card workflow, records every step and composes a deterministic answer", async () => {
    const { svc, created } = build([]);
    const r = await svc.run("u1", "next-card", { question: "What card should I get next?" });
    expect(r.status).toBe("COMPLETED");
    expect(r.privacy).toBe("USER");
    expect(r.steps.map((s) => s.id)).toEqual(["offers", "five24", "portfolio", "strategy", "recommendation"]);
    expect(r.steps.every((s) => s.status === "OK")).toBe(true);
    expect(r.answer).toMatch(/Recommended: Example Gold \(Issuer\)\. First-year value \$1,200, long-term \$400\. Application probability about 80% \(an estimate\)/);
    expect(r.answer).toMatch(/Current offer is near its historic high\./);
    expect(r.answer).toMatch(/5\/24: Me 2\/5/);
    expect(r.answer).toMatch(/not financial or credit advice/);
    expect(created.steps).toHaveLength(5);
    expect(r.narration).toBeNull();
  });
  it("never lets an external provider narrate a run that used the user's data", async () => {
    const { svc, chat } = build([{ kind: "ANTHROPIC" }, { kind: "OPENAI_COMPATIBLE", name: "OpenClaw" }], { consent: true });
    const r = await svc.run("u1", "next-card", { narrate: true });
    expect(chat).not.toHaveBeenCalled();
    expect(r.narration).toBeNull();
    expect(r.narrationSkipped).toMatch(/local model is required/);
  });
  it("a local model may narrate it, with the published (or default) narration prompt", async () => {
    const { svc, chat, created } = build([{ kind: "ANTHROPIC" }, { kind: "OLLAMA", name: "llama3.1" }]);
    const r = await svc.run("u1", "next-card", { narrate: true });
    expect(chat).toHaveBeenCalledTimes(1);
    const [chain, req] = chat.mock.calls[0];
    expect(chain).toHaveLength(1);
    expect(chain[0].provider.kind).toBe("OLLAMA");
    expect(req.system).toBe(DEFAULT_PROMPTS["narration.default"]);
    expect(req.messages[0].text).toContain("Recommended: Example Gold");
    expect(r.narration).toMatchObject({ text: "Narrated text", model: "llama3.1", promptVersion: 0 });
    expect((created.steps.at(-1) as { narratedBy: string }).narratedBy).toBe("llama3.1");
  });
  it("a failed required step fails the run but is still fully recorded", async () => {
    const { svc, created } = build([], { smartFails: true });
    const r = await svc.run("u1", "next-card");
    expect(r.status).toBe("FAILED");
    expect(r.steps.map((s) => s.status)).toEqual(["OK", "OK", "OK", "OK", "FAILED"]);
    expect(r.answer).toMatch(/could not be produced/);
    expect(created.steps).toHaveLength(5);
  });
  it("an unknown workflow is a 404 and lists the known ones", async () => {
    const { svc } = build([]);
    await expect(svc.run("u1", "nope")).rejects.toBeInstanceOf(NotFoundException);
    expect(svc.list().map((w) => w.key)).toEqual(["next-card", "portfolio-review", "purchase-plan", "offer-review"]);
    expect(svc.list()[0].steps.map((s) => s.privacy)).toEqual(["PUBLIC", "USER", "USER", "USER", "USER"]);
  });
  it("the portfolio-review workflow reports fees, benefit use and 5/24", async () => {
    const { svc } = build([]);
    const r = await svc.run("u1", "portfolio-review");
    expect(r.answer).toMatch(/1 active cards with \$250 in annual fees/);
    expect(r.answer).toMatch(/used 40%.*\$300 is still unused/);
  });
  it("run detail is owner-only", async () => {
    const { svc } = build([]);
    await expect(svc.runDetail("u1", "missing")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("TC-ORC: versioned prompts", () => {
  const mk = () => {
    const rows: Array<{ id: string; key: string; version: number; body: string; status: string }> = [];
    // eslint-disable-next-line prefer-const
    let prisma: any;
    prisma = {
      promptTemplate: {
        findFirst: jest.fn(async (a: { where: { key: string; status?: string }; orderBy?: unknown }) => rows.filter((r) => r.key === a.where.key && (!a.where.status || r.status === a.where.status)).sort((x, y) => y.version - x.version)[0] ?? null),
        updateMany: jest.fn(async (a: { where: { key: string; status: string }; data: { status: string } }) => { rows.filter((r) => r.key === a.where.key && r.status === a.where.status).forEach((r) => (r.status = a.data.status)); }),
        create: jest.fn(async (a: { data: { key: string; version: number; body: string; status: string } }) => { const r = { id: `id${rows.length}`, ...a.data }; rows.push(r); return r; }),
        findUnique: jest.fn(async (a: { where: { key_version: { key: string; version: number } } }) => rows.find((r) => r.key === a.where.key_version.key && r.version === a.where.key_version.version) ?? null),
        update: jest.fn(async (a: { where: { id: string }; data: { status: string } }) => { const r = rows.find((x) => x.id === a.where.id)!; r.status = a.data.status; return r; }),
      },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    return { svc: new PromptsService(prisma as never), rows };
  };
  const BODY = "Rewrite the result in friendly prose keeping every number exactly as given.";
  it("falls back to the built-in text, then publishes versions with one published at a time", async () => {
    const { svc, rows } = mk();
    expect(await svc.current("narration.default")).toMatchObject({ version: 0, source: "default" });
    expect(await svc.publish("narration.default", BODY, "admin")).toMatchObject({ version: 1, status: "PUBLISHED" });
    expect(await svc.publish("narration.default", `${BODY} v2`, "admin")).toMatchObject({ version: 2 });
    expect(rows.filter((r) => r.status === "PUBLISHED")).toHaveLength(1);
    expect(await svc.current("narration.default")).toMatchObject({ version: 2, source: "database" });
  });
  it("rolls back to an older version and rejects unknown keys, versions and bad text", async () => {
    const { svc } = mk();
    await svc.publish("narration.default", BODY, "admin");
    await svc.publish("narration.default", `${BODY} v2`, "admin");
    await svc.rollback("narration.default", 1, "admin");
    expect((await svc.current("narration.default")).version).toBe(1);
    await expect(svc.rollback("narration.default", 9, "admin")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.current("missing.key")).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.publish("narration.default", "too short", "admin")).rejects.toThrow(/20–4000/);
    await expect(svc.publish("Bad Key!", BODY, "admin")).rejects.toThrow(/Invalid prompt key/);
  });
});

describe("TC-ORC: offer workflows", () => {
  it("purchase-plan runs the planner, records one USER step and states the evidence count", async () => {
    const { svc, offers } = build([]);
    const r = await svc.run("u1", "purchase-plan", { question: "Plan", params: { merchantText: "Hilton", amountCents: 120_000 } });
    expect(r.status).toBe("COMPLETED");
    expect(r.privacy).toBe("USER");
    expect(r.steps.map((s) => [s.id, s.agent, s.engine])).toEqual([["plan", "reward-optimization", "purchase-plan/1"]]);
    expect(offers.plan).toHaveBeenCalledWith("u1", { merchantText: "Hilton", amountCents: 120_000 }, expect.any(Date));
    expect(r.answer).toMatch(/Best: Card A \(Me\) for \$1200\.00 .* expected return \$124\.00/);
    expect(r.answer).toMatch(/Do first: Activate "Hilton \$100 back"/);
    expect(r.answer).toMatch(/Evidence: 1 item\(s\)/);
  });
  it("purchase-plan without a merchant and amount fails cleanly", async () => {
    const { svc } = build([]);
    const r = await svc.run("u1", "purchase-plan", {});
    expect(r.status).toBe("FAILED");
    expect(r.steps[0].error).toMatch(/merchantText and amountDollars are required/);
  });
  it("offer-review ranks opportunities, reports misses and summarises the audit trail", async () => {
    const { svc } = build([]);
    const r = await svc.run("u1", "offer-review", {});
    expect(r.status).toBe("COMPLETED");
    expect(r.steps.map((s) => s.id)).toEqual(["opportunities", "missed", "audit"]);
    expect(r.steps.map((s) => s.agent)).toEqual(["offer-discovery", "merchant-intelligence", "offer-audit"]);
    expect(r.answer).toMatch(/Hilton: score 82\/100, \$60\.00 expected, 4 day\(s\) left \(confidence 75%\)/);
    expect(r.answer).toMatch(/Missed in the last year: \$100\.00 across 1 offer\(s\); the biggest was Hilton \(not activated\)/);
    expect(r.answer).toMatch(/Audit trail, last 30 days: 2 recommended/);
  });
  it("lists the four workflows", () => {
    expect(build([]).svc.list().map((w) => w.key)).toEqual(["next-card", "portfolio-review", "purchase-plan", "offer-review"]);
  });
});
