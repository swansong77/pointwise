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
  const loyalty = {
    valuation: jest.fn().mockResolvedValue({ currentCents: 500_000, potentialCents: 520_000, atRiskCents: 40_000, expiredCents: 8_000, recoveredCents: 30_000 }),
    expirations: jest.fn().mockResolvedValue({ items: [{ program: "American Airlines", message: "120,000 miles at risk of expiration in American Airlines: 7 day(s) left.", prediction: { confidence: 50 } }] }),
    certificateIntelligence: jest.fn().mockResolvedValue([{ message: "You have a IHG Free Night expiring in 45 days. Potential value: $300.", urgency: "MEDIUM" }]),
    statuses: jest.fn().mockResolvedValue([{ current: true, member: "Me", view: { risk: "HIGH", headline: "Marriott Platinum: 76% there, needs 12 nights" } }]),
    memberships: jest.fn().mockResolvedValue([{ member: "Me", view: { state: "EXPIRING", headline: "Global Entry expires in 46 day(s)." }, creditSuggestion: "Use the credit on Amex Platinum for renewal." }]),
    evaluateTrip: jest.fn().mockResolvedValue({ pointsEstimated: true, estimateNote: "Estimated.", options: [{ programName: "United MileagePlus", pointsNeeded: 170_000, shortfall: 0, reasons: ["Your balances fully cover this award."], warnings: [] }], certificates: [{ usable: true, name: "IHG Free Night", member: "Me", note: "Valid for the stay." }] }),
  };
  const loyaltyAuto = {
    audit: jest.fn().mockResolvedValue({ questions: [{ question: "What loyalty assets are expiring next?", answer: "Test Air: 25,000 miles in 12 day(s) (confidence 80%)." }, { question: "What accounts have not refreshed recently?", answer: "1: Test Stay (Me)." }] }),
    health: jest.fn().mockResolvedValue({ household: { score: 72, label: "NEEDS_ATTENTION", reasons: ["Test Stay is the weakest account (40)"] } }),
  };
  const chat = jest.fn().mockResolvedValue({ response: { text: "Narrated text" } });
  const router = {
    usableModels: jest.fn().mockResolvedValue(models.map((m, i) => ({ id: `m${i}`, displayName: m.name ?? m.kind, capabilities: [], inputPrice: null, outputPrice: null, provider: { kind: m.kind } }))),
    chat,
  };
  const svc = new OrchestratorService(prisma as never, services.portfolio as never, services.strategy as never, services.smart as never, services.benefits as never, router as never, new PromptsService(prisma as never), offers as never, loyalty as never, loyaltyAuto as never);
  return { svc, prisma, chat, created, services, offers, loyalty, loyaltyAuto };
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
    expect(svc.list().map((w) => w.key)).toEqual(["next-card", "portfolio-review", "purchase-plan", "offer-review", "loyalty-review", "award-trip", "loyalty-audit"]);
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
    expect(r.steps.map((s) => [s.id, s.agent, s.engine])).toEqual([["plan", "reward-optimization", "purchase-plan/2"]]);
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
    expect(build([]).svc.list().map((w) => w.key)).toEqual(["next-card", "portfolio-review", "purchase-plan", "offer-review", "loyalty-review", "award-trip", "loyalty-audit"]);
  });
});

describe("TC-ORC: loyalty workflows", () => {
  it("loyalty-review composes value, expirations, certificates, status and memberships from the engines", async () => {
    const { svc } = build([]);
    const r = await svc.run("u1", "loyalty-review", {});
    expect(r.status).toBe("COMPLETED");
    expect(r.privacy).toBe("USER");
    expect(r.steps.map((s) => [s.id, s.agent])).toEqual([["valuation", "valuation"], ["expirations", "point-expiration"], ["certificates", "certificate"], ["status", "elite-status"], ["memberships", "membership"]]);
    expect(r.answer).toMatch(/Loyalty assets: \$5000\.00 now, \$5200\.00 potential; \$400\.00 at risk, \$80\.00 expired, \$300\.00 recovered\./);
    expect(r.answer).toMatch(/120,000 miles at risk of expiration in American Airlines.*confidence 50%/);
    expect(r.answer).toMatch(/IHG Free Night expiring in 45 days/);
    expect(r.answer).toMatch(/Marriott Platinum: 76% there, needs 12 nights/);
    expect(r.answer).toMatch(/Global Entry expires in 46 day\(s\)\. Use the credit on Amex Platinum/);
    expect(r.answer).toMatch(/confirm with the program/);
  });
  it("award-trip evaluates once, names the best program, notes the estimate and usable certificates", async () => {
    const { svc, loyalty } = build([]);
    const r = await svc.run("u1", "award-trip", { params: { destination: "Tokyo", dateFrom: "2027-03-10", dateTo: "2027-03-20", cabin: "BUSINESS" } });
    expect(r.status).toBe("COMPLETED");
    expect(loyalty.evaluateTrip).toHaveBeenCalledWith("u1", expect.objectContaining({ destination: "Tokyo", cabin: "BUSINESS" }), expect.any(Date));
    expect(r.answer).toMatch(/Best: United MileagePlus — 170,000 points \(estimate\), fully covered\./);
    expect(r.answer).toMatch(/Certificate: IHG Free Night \(Me\) — Valid for the stay\./);
    expect(r.answer).toMatch(/Estimated\./);
  });
  it("award-trip without a destination and dates fails cleanly", async () => {
    const { svc } = build([]);
    const r = await svc.run("u1", "award-trip", {});
    expect(r.status).toBe("FAILED");
    expect(r.steps[0].error).toMatch(/destination, dateFrom and dateTo are required/);
  });
  it("a quiet household says nothing needs attention", async () => {
    const { svc, loyalty } = build([]);
    loyalty.expirations.mockResolvedValue({ items: [] });
    loyalty.certificateIntelligence.mockResolvedValue([]);
    loyalty.statuses.mockResolvedValue([]);
    loyalty.memberships.mockResolvedValue([]);
    expect((await svc.run("u1", "loyalty-review", {})).answer).toMatch(/Nothing needs attention right now/);
  });
});

describe("TC-ORC: loyalty audit workflow", () => {
  it("answers the audit questions from the engines and leads with the health score", async () => {
    const { svc, loyaltyAuto } = build([]);
    const r = await svc.run("u1", "loyalty-audit", {});
    expect(r.status).toBe("COMPLETED");
    expect(r.privacy).toBe("USER");
    expect(r.steps.map((s) => [s.id, s.agent, s.engine])).toEqual([["audit", "loyalty-audit", "loyalty-audit/1"], ["health", "refresh-health", "loyalty-health/1"]]);
    expect(loyaltyAuto.audit).toHaveBeenCalledWith("u1", [], expect.any(Date));
    expect(r.answer).toMatch(/^Loyalty health: 72\/100 \(needs attention\)\. Test Stay is the weakest account \(40\)\./);
    expect(r.answer).toMatch(/What loyalty assets are expiring next\? Test Air: 25,000 miles in 12 day\(s\)/);
    expect(r.answer).toMatch(/What accounts have not refreshed recently\? 1: Test Stay \(Me\)\./);
    expect(r.answer).toMatch(/confirm with the program/);
  });
  it("the health step is optional: the audit still completes without it", async () => {
    const { svc, loyaltyAuto } = build([]);
    loyaltyAuto.health.mockRejectedValue(new Error("down"));
    const r = await svc.run("u1", "loyalty-audit", {});
    expect(r.status).toBe("COMPLETED");
    expect(r.steps[1].status).toBe("FAILED"); // recorded, but an optional step does not fail the run
    expect(r.answer).not.toMatch(/Loyalty health/);
  });
});
