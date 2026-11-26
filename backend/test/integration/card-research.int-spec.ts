import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "fs";
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import { join } from "path";
import { api, bearer, createApp, login, register } from "./helpers";

/**
 * Card-research agent end to end with the offline demo model standing in for Claude: queue a run,
 * the worker job executes it, facts are checked against the fixture issuer page, the admin approves a
 * new card, re-verifies it, and unverifiable candidates need an explicit override. No paid model.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let site: Server;
let admin: string;
let user: string;
let demoModelId: string;
let demoCaps: string[];
let serveCard = true;
const tag = `${Date.now() % 1_000_000}`;
const issuer = `Fixturebank${tag}`;

const runJob = () =>
  api(app)
    .post(`${V}/admin/jobs/research-cards/run`)
    .set(bearer(admin))
    .expect(201);

beforeAll(async () => {
  const body = readFileSync(
    join(__dirname, "../fixtures/pages/research-card.html"),
    "utf8",
  );
  site = createServer((req, res) => {
    if (req.url === "/robots.txt")
      return void res
        .writeHead(200, { "content-type": "text/plain" })
        .end("User-agent: *\nAllow: /\n");
    if (req.url === `/t${tag}/research-card` && serveCard)
      return void res.writeHead(200, { "content-type": "text/html" }).end(body);
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", () => r()));
  process.env.MOCK_RESEARCH_BASE_URL = `http://127.0.0.1:${(site.address() as AddressInfo).port}/t${tag}`;
  // the demo model stands in for a Claude model with web search
  const demo = await prisma.aiModel.findFirstOrThrow({
    where: { modelId: "pointwise-demo" },
  });
  demoModelId = demo.id;
  demoCaps = demo.capabilities;
  await prisma.aiModel.update({
    where: { id: demo.id },
    data: { capabilities: [...demoCaps, "web_search"] },
  });
  app = await createApp();
  admin = await login(app, "admin@pointwise.local", "Admin12345!");
  user = (await register(app)).token;
});

afterAll(async () => {
  await prisma.aiModel.update({
    where: { id: demoModelId },
    data: { capabilities: demoCaps },
  });
  delete process.env.MOCK_RESEARCH_BASE_URL;
  site.closeAllConnections();
  await new Promise((r) => site.close(r));
  await app.close();
  await prisma.$disconnect();
});

describe("card research", () => {
  let cardId: string;
  let slug: string;

  it("is admin-only and validates the task", async () => {
    await api(app)
      .get(`${V}/admin/card-research/status`)
      .set(bearer(user))
      .expect(403);
    await api(app)
      .post(`${V}/admin/card-research`)
      .send({ kind: "DISCOVER", issuer: "Chase" })
      .expect(401);
    const s = await api(app)
      .get(`${V}/admin/card-research/status`)
      .set(bearer(admin))
      .expect(200);
    expect(s.body).toMatchObject({
      available: true,
      models: expect.arrayContaining([expect.stringMatching(/Demo model/)]),
    });
    await api(app)
      .post(`${V}/admin/card-research`)
      .set(bearer(admin))
      .send({ kind: "DISCOVER" })
      .expect(400);
    await api(app)
      .post(`${V}/admin/card-research`)
      .set(bearer(admin))
      .send({ kind: "VERIFY" })
      .expect(400);
    await api(app)
      .post(`${V}/admin/card-research`)
      .set(bearer(admin))
      .send({ kind: "VERIFY", cardId: "00000000-0000-4000-8000-000000000000" })
      .expect(404);
    await api(app)
      .post(`${V}/admin/card-research`)
      .set(bearer(admin))
      .send({ kind: "DISCOVER", issuer: "Chase", limit: 99 })
      .expect(400);
  });

  it("discovers cards: off-domain results and unprovable facts are dropped, the rest is checked on the page", async () => {
    const run = await api(app)
      .post(`${V}/admin/card-research`)
      .set(bearer(admin))
      .send({ kind: "DISCOVER", issuer, focus: "everyday cards", limit: 5 })
      .expect(202);
    expect(run.body).toMatchObject({
      status: "QUEUED",
      kind: "DISCOVER",
      maxCards: 5,
    });
    await runJob();
    const done = await api(app)
      .get(`${V}/admin/card-research/${run.body.id}`)
      .set(bearer(admin))
      .expect(200);
    expect(done.body).toMatchObject({
      status: "DONE",
      candidates: 1,
      searches: 1,
      fetches: 1,
      model: expect.stringMatching(/Demo/),
    });
    expect(done.body.notes).toMatch(
      /Dropped: Copycat Card: aggregator\.example is not an allow-listed issuer domain/,
    );
    expect(done.body.sources[0].url).toMatch(/\/research-card$/);
    const [c] = done.body.results;
    expect(c).toMatchObject({
      name: `${issuer} Everyday Research Card`,
      issuerName: issuer,
      annualFeeCents: 9500,
      verification: "PARTIAL",
      evidenceFrom: "POINTWISE",
      matchedCardId: null,
      status: "PENDING",
    });
    expect(c.verifiedFacts).toBe(9); // 6 facts + 2 rates + 1 feature; the fake fee fact and the 10X rate are dropped
    expect(c.totalFacts).toBe(11);
    expect(c.data.rewards.map((r: { category: string }) => r.category)).toEqual(
      ["dining", "groceries"],
    );
    const list = await api(app)
      .get(`${V}/admin/card-candidates`)
      .set(bearer(admin))
      .expect(200);
    expect(list.body.some((x: { id: string }) => x.id === c.id)).toBe(true);
    const runs = await api(app)
      .get(`${V}/admin/card-research`)
      .set(bearer(admin))
      .expect(200);
    expect(
      runs.body.find((r: { id: string }) => r.id === run.body.id)._count
        .results,
    ).toBe(1);
  });

  it("approving a new card adds it to the catalog with its issuer, currency, rates, source and offer history", async () => {
    const [c] = (
      await api(app)
        .get(`${V}/admin/card-candidates?status=PENDING`)
        .set(bearer(admin))
    ).body.filter((x: { issuerName: string }) => x.issuerName === issuer);
    await api(app)
      .post(`${V}/admin/card-candidates/${c.id}/approve`)
      .set(bearer(user))
      .send({})
      .expect(403);
    const ok = await api(app)
      .post(`${V}/admin/card-candidates/${c.id}/approve`)
      .set(bearer(admin))
      .send({ centsPerPoint: 1.2 })
      .expect(200);
    expect(ok.body).toMatchObject({
      status: "APPROVED",
      created: true,
      rewards: 2,
    });
    cardId = ok.body.cardId;
    slug = ok.body.slug;
    await api(app)
      .post(`${V}/admin/card-candidates/${c.id}/approve`)
      .set(bearer(admin))
      .send({})
      .expect(409);
    const card = await api(app).get(`${V}/cards/${slug}`).expect(200);
    expect(card.body).toMatchObject({
      name: `${issuer} Everyday Research Card`,
      annualFeeCents: 9500,
      bonusPoints: 60000,
      bonusSpendCents: 400000,
      bonusMonths: 3,
      foreignTxFee: false,
      catalogSource: "RESEARCH",
    });
    expect(card.body.issuer.name).toBe(issuer);
    expect(card.body.currency.code).toBe("RESEARCH_POINTS");
    expect(card.body.lastVerifiedAt).toBeTruthy();
    expect(
      card.body.rewards.map((r: { multiplier: string }) =>
        Number(r.multiplier),
      ),
    ).toEqual([3, 2]);
    expect(card.body.features.map((f: { text: string }) => f.text)).toEqual([
      "No foreign transaction fees",
    ]);
    const sources = await api(app)
      .get(`${V}/admin/card-sources?cardId=${cardId}`)
      .set(bearer(admin))
      .expect(200);
    expect(sources.body[0].url).toMatch(/\/research-card$/);
    expect(
      (await api(app).get(`${V}/cards/${slug}/offer-history`).expect(200)).body
        .versions,
    ).toHaveLength(1);
    const audit = await prisma.auditLog.findFirst({
      where: { entity: "CardCandidate", entityId: c.id, action: "approve" },
    });
    expect(audit).toBeTruthy();
  });

  it("verifying an existing card turns changed facts into change proposals", async () => {
    await prisma.creditCard.update({
      where: { id: cardId },
      data: { annualFeeCents: 12000, lastVerifiedAt: null },
    });
    const run = await api(app)
      .post(`${V}/admin/card-research`)
      .set(bearer(admin))
      .send({ kind: "VERIFY", cardId })
      .expect(202);
    await runJob();
    const done = (
      await api(app)
        .get(`${V}/admin/card-research/${run.body.id}`)
        .set(bearer(admin))
    ).body;
    expect(done.status).toBe("DONE");
    expect(done.card.slug).toBe(slug);
    const [c] = done.results;
    expect(c.matchedCardId).toBe(cardId);
    const ok = await api(app)
      .post(`${V}/admin/card-candidates/${c.id}/approve`)
      .set(bearer(admin))
      .send({ applyRewards: true })
      .expect(200);
    expect(ok.body).toMatchObject({ created: false, proposals: 1, rewards: 2 });
    const proposals = await api(app)
      .get(`${V}/admin/card-proposals?status=PENDING&cardId=${cardId}`)
      .set(bearer(admin))
      .expect(200);
    expect(proposals.body).toEqual([
      expect.objectContaining({
        field: "annualFeeCents",
        oldValue: 12000,
        newValue: 9500,
        method: "RESEARCH",
      }),
    ]);
    expect(
      (
        await api(app)
          .get(`${V}/admin/card-sources?cardId=${cardId}`)
          .set(bearer(admin))
      ).body,
    ).toHaveLength(1); // same page, not duplicated
    await api(app)
      .post(`${V}/admin/card-proposals/${proposals.body[0].id}/approve`)
      .set(bearer(admin))
      .send({})
      .expect(200);
    const card = (await api(app).get(`${V}/cards/${slug}`)).body;
    expect(card.annualFeeCents).toBe(9500);
    expect(card.lastVerifiedAt).toBeTruthy();
  });

  it("news scan reads lead sites for discovery only: leads are links, facts quoted from the lead are dropped", async () => {
    const s = await api(app)
      .get(`${V}/admin/card-research/status`)
      .set(bearer(admin))
      .expect(200);
    expect(s.body.leadDomains).toEqual([
      "doctorofcredit.com",
      "thepointsguy.com",
      "milemoa.com",
    ]);
    const run = await api(app)
      .post(`${V}/admin/card-research`)
      .set(bearer(admin))
      .send({
        kind: "NEWS",
        issuer: `${issuer}n`,
        focus: "elevated offers",
        limit: 8,
      })
      .expect(202);
    expect(run.body).toMatchObject({
      kind: "NEWS",
      useLeads: true,
      maxCards: 8,
    });
    await runJob();
    const done = (
      await api(app)
        .get(`${V}/admin/card-research/${run.body.id}`)
        .set(bearer(admin))
    ).body;
    expect(done.status).toBe("DONE");
    const lead = done.sources.find((x: { lead: boolean }) => x.lead);
    expect(lead).toMatchObject({
      url: expect.stringMatching(/doctorofcredit\.com/),
      via: "fetch",
    });
    expect(JSON.stringify(done.sources)).not.toMatch(/100,000/); // lead page text is not stored
    const [c] = done.results;
    expect(c.data.leads).toEqual([
      {
        url: "https://www.doctorofcredit.com/pointwise-demo-elevated-offer/",
        title: "Elevated offer (demo lead)",
      },
    ]);
    const bonus = c.data.facts.filter(
      (f: { field: string }) => f.field === "bonusAmount",
    );
    expect(bonus).toEqual([
      expect.objectContaining({ value: 60000, verified: true }),
    ]); // 100,000 from the lead is not on the issuer page
    expect(c.totalFacts).toBe(12);
    expect(c.verifiedFacts).toBe(9);
    expect(c.evidenceFrom).toBe("POINTWISE");
  });

  it("leads can be switched off per run", async () => {
    const run = await api(app)
      .post(`${V}/admin/card-research`)
      .set(bearer(admin))
      .send({ kind: "DISCOVER", issuer: `${issuer}x`, useLeads: false })
      .expect(202);
    expect(run.body.useLeads).toBe(false);
    await runJob();
    const done = (
      await api(app)
        .get(`${V}/admin/card-research/${run.body.id}`)
        .set(bearer(admin))
    ).body;
    expect(done.results[0].data.leads).toEqual([]);
    expect(done.sources.every((x: { lead: boolean }) => !x.lead)).toBe(true);
  });

  it("a page nobody could load gives an UNVERIFIED candidate that needs an explicit override", async () => {
    serveCard = false;
    try {
      const run = await api(app)
        .post(`${V}/admin/card-research`)
        .set(bearer(admin))
        .send({ kind: "DISCOVER", issuer: `${issuer}b` })
        .expect(202);
      await runJob();
      const [c] = (
        await api(app)
          .get(`${V}/admin/card-research/${run.body.id}`)
          .set(bearer(admin))
      ).body.results;
      expect(c).toMatchObject({
        verification: "UNVERIFIED",
        evidenceFrom: "NONE",
        verifiedFacts: 0,
      });
      const no = await api(app)
        .post(`${V}/admin/card-candidates/${c.id}/approve`)
        .set(bearer(admin))
        .send({})
        .expect(400);
      expect(no.body.message).toMatch(/acceptUnverified/);
      const rejected = await api(app)
        .post(`${V}/admin/card-candidates/${c.id}/reject`)
        .set(bearer(admin))
        .send({ note: "could not check" })
        .expect(200);
      expect(rejected.body.status).toBe("REJECTED");
      await api(app)
        .post(`${V}/admin/card-candidates/${c.id}/reject`)
        .set(bearer(admin))
        .send({})
        .expect(409);
    } finally {
      serveCard = true;
    }
  });

  it("queues verification for unverified real cards only, and refuses to start without a web-search model", async () => {
    const seedCard = await prisma.creditCard.create({
      data: {
        slug: `seed-${tag}`,
        name: `Seed ${tag}`,
        issuerId: (await prisma.issuer.findFirstOrThrow()).id,
        network: "VISA",
        currencyId: (
          await prisma.rewardCurrency.findUniqueOrThrow({
            where: { code: "CASH" },
          })
        ).id,
        catalogSource: "SEED",
        popularity: 10_000,
      },
    });
    const r = await api(app)
      .post(`${V}/admin/card-research/verify-unverified`)
      .set(bearer(admin))
      .send({ max: 50 })
      .expect(202);
    expect(r.body.queued).toBeGreaterThanOrEqual(1);
    const queued = await prisma.cardResearchRun.findMany({
      where: { status: "QUEUED", kind: "VERIFY" },
      include: { card: { select: { catalogSource: true } } },
    });
    expect(queued.some((q) => q.cardId === seedCard.id)).toBe(true);
    expect(queued.every((q) => q.card?.catalogSource !== "DEMO")).toBe(true);
    // don't run them here; clean up
    await prisma.cardResearchRun.deleteMany({ where: { status: "QUEUED" } });
    await prisma.creditCard.update({
      where: { id: seedCard.id },
      data: { isActive: false },
    });

    await prisma.aiModel.update({
      where: { id: demoModelId },
      data: { capabilities: demoCaps },
    });
    try {
      const s = await api(app)
        .get(`${V}/admin/card-research/status`)
        .set(bearer(admin))
        .expect(200);
      expect(s.body.available).toBe(false);
      expect(s.body.note).toMatch(/Claude/);
      await api(app)
        .post(`${V}/admin/card-research`)
        .set(bearer(admin))
        .send({ kind: "DISCOVER", issuer: "Chase" })
        .expect(503);
    } finally {
      await prisma.aiModel.update({
        where: { id: demoModelId },
        data: { capabilities: [...demoCaps, "web_search"] },
      });
    }
  });

  it("research all issuers: one DISCOVER run per registry bank / credit union not researched recently; coverage counts personal and business cards", async () => {
    const cu = await prisma.issuer.create({
      data: {
        name: `Registry CU ${tag}`,
        website: "https://www.navyfederal.org",
        kind: "CREDIT_UNION",
        aliases: [],
      },
    });
    const bank = await prisma.issuer.create({
      data: {
        name: `Registry Bank ${tag}`,
        website: "https://www.pnc.com",
        kind: "BANK",
        aliases: [],
        lastResearchedAt: new Date(),
      },
    });
    const offList = await prisma.issuer.create({
      data: {
        name: `Offlist ${tag}`,
        website: "https://www.not-an-issuer.example",
        kind: "BANK",
        aliases: [],
      },
    });
    const cash = await prisma.rewardCurrency.findUniqueOrThrow({
      where: { code: "CASH" },
    });
    for (const [slug, type] of [
      ["p", "PERSONAL"],
      ["b1", "BUSINESS"],
      ["b2", "BUSINESS"],
    ] as const)
      await prisma.creditCard.create({
        data: {
          slug: `cov-${slug}-${tag}`,
          name: `Cov ${slug} ${tag}`,
          issuerId: cu.id,
          network: "VISA",
          type,
          currencyId: cash.id,
          catalogSource: "SEED",
        },
      });
    await api(app)
      .post(`${V}/admin/card-research/discover-all`)
      .set(bearer(user))
      .send({})
      .expect(403);
    const r = await api(app)
      .post(`${V}/admin/card-research/discover-all`)
      .set(bearer(admin))
      .send({ kinds: ["CREDIT_UNION", "BANK"] })
      .expect(202);
    expect(r.body.issuers).toContain(cu.name);
    expect(r.body.issuers).not.toContain(bank.name); // researched recently
    expect(r.body.issuers).not.toContain(offList.name); // website not on the issuer allow-list
    const again = await api(app)
      .post(`${V}/admin/card-research/discover-all`)
      .set(bearer(admin))
      .send({ kinds: ["CREDIT_UNION"] })
      .expect(202);
    expect(again.body.issuers).not.toContain(cu.name); // already queued
    await api(app)
      .post(`${V}/admin/card-research/discover-all`)
      .set(bearer(admin))
      .send({ kinds: ["SAVINGS_CLUB"] })
      .expect(400);
    const cov = await api(app)
      .get(`${V}/admin/card-research/coverage`)
      .set(bearer(admin))
      .expect(200);
    expect(
      cov.body.issuers.find((i: { issuer: string }) => i.issuer === cu.name),
    ).toMatchObject({
      kind: "CREDIT_UNION",
      personal: 1,
      business: 2,
      verified: 0,
      lastResearchedAt: null,
    });
    expect(cov.body.totals.creditUnions).toBeGreaterThanOrEqual(1);
    await api(app)
      .get(`${V}/admin/card-research/coverage`)
      .set(bearer(user))
      .expect(403);
    // the worker's DONE step stamps the issuer
    await runJob();
    expect(
      (await prisma.issuer.findUniqueOrThrow({ where: { id: cu.id } }))
        .lastResearchedAt,
    ).not.toBeNull();
    await prisma.cardResearchRun.deleteMany({ where: { status: "QUEUED" } });
    await prisma.creditCard.updateMany({
      where: { issuerId: cu.id },
      data: { isActive: false },
    });
  });

  it("a run left RUNNING by a stopped worker is marked FAILED", async () => {
    const run = await prisma.cardResearchRun.create({
      data: {
        kind: "DISCOVER",
        issuer: "Chase",
        status: "RUNNING",
        startedAt: new Date(Date.now() - 60 * 60_000),
      },
    });
    await runJob();
    const r = await prisma.cardResearchRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(r).toMatchObject({
      status: "FAILED",
      error: expect.stringMatching(/timed out/),
    });
  });
});
