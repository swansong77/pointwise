import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { api, bearer, createApp, login, register } from "./helpers";

/** Orchestrated workflows: auditable runs, owner-only traces, privacy of narration, versioned prompts. */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let admin: string;

beforeAll(async () => {
  app = await createApp();
  token = (await register(app)).token;
  other = (await register(app)).token;
  admin = await login(app, "admin@pointwise.local", "Admin12345!");
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("workflows", () => {
  let runId: string;
  it("lists the workflows with each step's agent and privacy class", async () => {
    const r = (await api(app).get(`${V}/ai/workflows`).set(bearer(token)).expect(200)).body;
    const next = r.find((w: { key: string }) => w.key === "next-card");
    expect(next.steps.map((s: { id: string; privacy: string }) => `${s.id}:${s.privacy}`)).toEqual(["offers:PUBLIC", "five24:USER", "portfolio:USER", "strategy:USER", "recommendation:USER"]);
  });

  it("'What card should I get next?' runs every step, records it, and answers deterministically", async () => {
    const r = (await api(app).post(`${V}/ai/workflows/next-card`).set(bearer(token)).send({ question: "What card should I get next?" }).expect(200)).body;
    expect(r).toMatchObject({ workflow: "next-card", status: "COMPLETED", privacy: "USER", narration: null });
    expect(r.steps.map((s: { id: string; status: string }) => [s.id, s.status])).toEqual([["offers", "OK"], ["five24", "OK"], ["portfolio", "OK"], ["strategy", "OK"], ["recommendation", "OK"]]);
    expect(r.answer).toMatch(/5\/24:/);
    expect(r.answer).toMatch(/not financial or credit advice/);
    runId = r.runId;
  });

  it("the run trace shows each step with input hash, output and engine, to its owner only", async () => {
    const t = (await api(app).get(`${V}/ai/runs/${runId}`).set(bearer(token)).expect(200)).body;
    expect(t).toMatchObject({ workflow: "next-card", status: "COMPLETED", engineVersion: "orchestrator/1", question: "What card should I get next?" });
    expect(t.steps).toHaveLength(5);
    expect(t.steps[0]).toMatchObject({ ordinal: 1, agent: "offer-monitoring", privacy: "PUBLIC", status: "OK" });
    expect(t.steps[0].inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.steps[4]).toMatchObject({ engine: "recommendation/2", privacy: "USER" });
    const list = (await api(app).get(`${V}/ai/runs`).set(bearer(token)).expect(200)).body;
    expect(list.map((x: { id: string }) => x.id)).toContain(runId);
    await api(app).get(`${V}/ai/runs/${runId}`).set(bearer(other)).expect(404);
    expect((await api(app).get(`${V}/ai/runs`).set(bearer(other)).expect(200)).body).toEqual([]);
    await api(app).get(`${V}/ai/runs/not-a-uuid`).set(bearer(token)).expect(400);
  });

  it("an unknown workflow is a 404", async () => {
    await api(app).post(`${V}/ai/workflows/nope`).set(bearer(token)).send({}).expect(404);
  });

  it("requires sign-in", async () => {
    await api(app).post(`${V}/ai/workflows/next-card`).send({}).expect(401);
  });

  it("narration of a run that used your data never goes to an external provider", async () => {
    // external (non-local) models exist in the seeded registry; with none local and enabled, narration must be skipped
    await prisma.aiProvider.updateMany({ where: { kind: { in: ["OLLAMA", "MOCK"] } }, data: { status: "DISABLED" } });
    try {
      const r = (await api(app).post(`${V}/ai/workflows/next-card`).set(bearer(token)).send({ narrate: true }).expect(200)).body;
      expect(r.narration).toBeNull();
      expect(r.narrationSkipped).toMatch(/local model is required/);
    } finally {
      await prisma.aiProvider.updateMany({ where: { kind: { in: ["OLLAMA", "MOCK"] } }, data: { status: "ACTIVE" } });
    }
  });
});

describe("prompt versions (admin)", () => {
  const BODY = "Rewrite the PointWise result clearly, keeping every number exactly as written.";
  it("only admins can publish; versions increment; rollback restores", async () => {
    await api(app).put(`${V}/admin/ai/prompts/narration.default`).set(bearer(token)).send({ body: BODY }).expect(403);
    const v1 = (await api(app).put(`${V}/admin/ai/prompts/narration.default`).set(bearer(admin)).send({ body: BODY, note: "first" }).expect(200)).body;
    const v2 = (await api(app).put(`${V}/admin/ai/prompts/narration.default`).set(bearer(admin)).send({ body: `${BODY} Be brief.` }).expect(200)).body;
    expect(v2.version).toBe(v1.version + 1);
    const versions = (await api(app).get(`${V}/admin/ai/prompts/narration.default`).set(bearer(admin)).expect(200)).body;
    expect(versions.filter((x: { status: string }) => x.status === "PUBLISHED")).toHaveLength(1);
    await api(app).post(`${V}/admin/ai/prompts/narration.default/rollback/${v1.version}`).set(bearer(admin)).expect(200);
    const after = (await api(app).get(`${V}/admin/ai/prompts`).set(bearer(admin)).expect(200)).body;
    expect(after.find((p: { key: string }) => p.key === "narration.default").current.version).toBe(v1.version);
    await api(app).put(`${V}/admin/ai/prompts/narration.default`).set(bearer(admin)).send({ body: "short" }).expect(400);
  });
});
