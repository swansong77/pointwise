import {
  BenefitClassifyService,
  parseClassification,
  SYSTEM_PROMPT,
} from "../../../src/ai/benefit-classify";
import { aiDetection, merchantForAi } from "../../../src/domain/benefit-detect";

const settings = (over: Record<string, unknown> = {}) => ({
  consentedAt: new Date(),
  classifyMerchants: true,
  preferredModelId: null,
  ...over,
});

function build(opts: { settings?: unknown; models?: unknown[]; reply?: string; fail?: boolean }) {
  const prisma = { aiSettings: { findUnique: jest.fn().mockResolvedValue("settings" in opts ? opts.settings : settings()) } };
  const router = {
    usableModels: jest.fn().mockResolvedValue(opts.models ?? [{ id: "m1" }]),
    chat: jest.fn(async () => {
      if (opts.fail) throw new Error("down");
      return { response: { text: opts.reply ?? '{"group":"uber","confidence":90,"reasoning":"Uber trips"}' } };
    }),
  };
  const spend = { classifier: null as unknown };
  const svc = new BenefitClassifyService(prisma as never, router as never, spend as never);
  return { svc, prisma, router, spend };
}

describe("TC-AI: merchant classification", () => {
  it("registers itself as the spend classifier", () => {
    const { svc, spend } = build({});
    svc.onModuleInit();
    expect(spend.classifier).toBe(svc);
  });

  it("parses a well-formed answer and clamps confidence", () => {
    expect(parseClassification('{"group":"uber","confidence":140,"reasoning":"x"}')).toEqual({
      group: "uber",
      confidence: 100,
      reasoning: "x",
    });
    expect(parseClassification('noise {"group":"resy","confidence":-5} noise')).toMatchObject({ group: "resy", confidence: 0, reasoning: "" });
  });
  it.each([
    "no json",
    "{bad json}",
    '{"group":null,"confidence":80}',
    '{"group":"not-a-group","confidence":80}',
    '{"group":"uber","confidence":"high"}',
    "[1,2]",
    "null",
  ])("rejects %s", (text) => {
    expect(parseClassification(text)).toBeNull();
  });

  it("sends only the cleaned merchant string and the generic group list — no user data", async () => {
    const { svc, router } = build({});
    const merchant = merchantForAi("UBER *TRIP 8005928996 $23.45 4111");
    await svc.classify("user-1", merchant);
    const [, req, ctx] = router.chat.mock.calls[0] as unknown as [unknown, { system: string; messages: Array<{ text: string }> }, { userId: string; agentKey: string }];
    expect(req.messages).toEqual([{ role: "user", text: `Merchant: ${merchant}` }]);
    expect(req.messages[0].text).not.toMatch(/\d/);
    expect(req.system).toBe(SYSTEM_PROMPT);
    expect(ctx.agentKey).toBe("benefit-classify");
    expect(JSON.stringify(req)).not.toMatch(/user-1|23\.45|8005928996/i);
  });

  it("does nothing unless the user opted in", async () => {
    const { svc, router } = build({ settings: settings({ classifyMerchants: false }) });
    expect(await svc.classify("u", "uber")).toBeNull();
    const none = build({ settings: null });
    expect(await none.svc.classify("u", "uber")).toBeNull();
    expect(router.chat).not.toHaveBeenCalled();
  });

  it("answers from cache the second time and prefers the user's chosen model", async () => {
    const { svc, router } = build({ settings: settings({ preferredModelId: "m2" }), models: [{ id: "m1" }, { id: "m2" }] });
    const a = await svc.classify("u", "uber eats");
    const b = await svc.classify("u2", "UBER EATS");
    expect(a).toEqual(b);
    expect(router.chat).toHaveBeenCalledTimes(1);
    const chain = (router.chat.mock.calls[0] as unknown[])[0] as Array<{ id: string }>;
    expect(chain.map((m) => m.id)).toEqual(["m2", "m1"]);
  });

  it("no usable model or a failing provider yields no classification", async () => {
    expect(await build({ models: [] }).svc.classify("u", "x")).toBeNull();
    expect(await build({ fail: true }).svc.classify("u", "x")).toBeNull();
    expect(await build({ reply: "not json" }).svc.classify("u", "x")).toBeNull();
  });

  it("an AI answer becomes a capped review-tier detection", () => {
    const d = aiDetection("b1", 98, "uber trip");
    expect(d).toMatchObject({ method: "AI", tier: "REVIEW" });
    expect(d!.confidence).toBeLessThan(85);
  });
});
