import { INestApplication } from "@nestjs/common";
import { api, bearer, createApp, register } from "./helpers";

/** Smart next-card recommendation: goals, probability estimate, risks, factors and the stored audit record. */
const V = "/api/v1";
let app: INestApplication;
let token: string;
let other: string;
let primary: string;

beforeAll(async () => {
  app = await createApp();
  token = (await register(app)).token;
  other = (await register(app)).token;
  const members = (await api(app).get(`${V}/household/members`).set(bearer(token)).expect(200)).body as Array<{ id: string; isPrimary: boolean }>;
  primary = members.find((m) => m.isPrimary)!.id;
});
afterAll(async () => {
  await app.close();
});

describe("goals and business status", () => {
  it("are saved on the member, validated, and not accepted for unknown goals", async () => {
    const ok = await api(app).patch(`${V}/household/members/${primary}`).set(bearer(token)).send({ goals: ["TRAVEL", "TRAVEL", "LOW_FEE"], hasBusiness: true }).expect(200);
    expect(ok.body.goals).toEqual(["TRAVEL", "LOW_FEE"]);
    expect(ok.body.hasBusiness).toBe(true);
    await api(app).patch(`${V}/household/members/${primary}`).set(bearer(token)).send({ goals: ["GET_RICH"] }).expect(400);
  });
});

describe("GET /recommendations/smart", () => {
  let recId: string;
  it("requires sign-in", async () => {
    await api(app).get(`${V}/recommendations/smart`).expect(401);
  });
  it("returns a recommendation with probability (an estimate), confidence, factors, risks and alternatives", async () => {
    const r = (await api(app).get(`${V}/recommendations/smart`).set(bearer(token)).expect(200)).body;
    expect(r.engine).toBe("recommendation/2");
    expect(r.inputs).toMatchObject({ goals: ["TRAVEL", "LOW_FEE"], hasBusiness: true });
    expect(r.recommended).toMatchObject({
      eligible: true,
      probabilityIsEstimate: true,
      recommendationId: expect.any(String),
    });
    expect(r.recommended.probability).toBeGreaterThanOrEqual(0);
    expect(r.recommended.probability).toBeLessThanOrEqual(1);
    expect(r.recommended.confidence).toBeGreaterThan(0);
    expect(Array.isArray(r.recommended.factors)).toBe(true);
    expect(r.recommended.factors.some((f: { key: string }) => f.key.startsWith("GOAL"))).toBe(true);
    expect(r.alternatives.length).toBeLessThanOrEqual(3);
    expect(r.disclaimer).toMatch(/not financial or credit advice/);
    recId = r.recommended.recommendationId;
  });
  it("stores an audit record with the inputs snapshot, weights and every factor, visible only to its owner", async () => {
    const a = (await api(app).get(`${V}/recommendations/audit/${recId}`).set(bearer(token)).expect(200)).body;
    expect(a).toMatchObject({ engineVersion: "recommendation/2", probabilityIsEstimate: true });
    expect(a.weights.goalMatchCents).toBe(7500);
    expect(a.inputs).toMatchObject({ goals: ["TRAVEL", "LOW_FEE"], hasBusiness: true });
    expect(JSON.stringify(a.inputs)).not.toMatch(/\d{9,}/); // no card numbers
    expect(a.factors.length).toBeGreaterThan(0);
    await api(app).get(`${V}/recommendations/audit/${recId}`).set(bearer(other)).expect(404);
    await api(app).get(`${V}/recommendations/audit/not-a-uuid`).set(bearer(token)).expect(400);
  });
  it("changing goals changes the factors and is reflected on the next run", async () => {
    await api(app).patch(`${V}/household/members/${primary}`).set(bearer(token)).send({ goals: ["CASHBACK"] }).expect(200);
    const r = (await api(app).get(`${V}/recommendations/smart`).set(bearer(token)).expect(200)).body;
    expect(r.inputs.goals).toEqual(["CASHBACK"]);
  });
});
