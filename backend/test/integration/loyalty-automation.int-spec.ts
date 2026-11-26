import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { LoyaltyRefreshJobs } from "../../src/loyalty/loyalty-automation.module";
import { makePdf } from "../fixtures/make-pdf";
import { api, bearer, createApp, register } from "./helpers";

/**
 * Loyalty automation: extension snapshots with a scoped token, email and PDF intake, the provenance rules
 * (a lower-confidence source never overwrites a higher one), conflicts, refresh status, health and the audit.
 * Synthetic data only; the parsers are generic and unverified against real program emails.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
const DAY = 86_400_000;
const SECRET = process.env.INBOUND_EMAIL_SECRET as string;
let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let me: string;
let marriott: string; // account id
let ext: string; // extension token
let seq = 0;
const ymd = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

const get = (p: string, t = token) => api(app).get(`${V}${p}`).set(bearer(t));
const post = (p: string, b: object, t = token) => api(app).post(`${V}${p}`).set(bearer(t)).send(b);
const patch = (p: string, b: object, t = token) => api(app).patch(`${V}${p}`).set(bearer(t)).send(b);
const snapshot = (body: object, t: string | null = ext) => {
  const r = api(app).post(`${V}/loyalty/ingest/snapshot`);
  return (t ? r.set("Authorization", `Bearer ${t}`) : r).send(body);
};
const account = async (id = marriott) => (await get("/loyalty/accounts").expect(200)).body.find((a: any) => a.id === id);

const PAGE = (balance: string, status = "Gold Elite") => `Welcome back. Your current points balance is ${balance}. Your ${status} status is valid through February 28, 2027. Member number ending 4821.`;

function mime(o: { from: string; subject: string; text: string; pdf?: Buffer; auth?: string }) {
  const headers = [`Authentication-Results: ${o.auth ?? "mx.pointwise.test; dkim=pass header.d=marriott.com; spf=pass"}`, `From: ${o.from}`, "To: Jo <jo@gmail.example>", `Subject: ${o.subject}`, `Date: ${new Date().toUTCString()}`, `Message-ID: <l${Date.now()}-${seq++}@test.example>`, "MIME-Version: 1.0"];
  if (!o.pdf) return Buffer.from([...headers, "Content-Type: text/plain; charset=utf-8", "", o.text].join("\r\n"));
  const b = "BOUNDARY42";
  return Buffer.from([...headers, `Content-Type: multipart/mixed; boundary="${b}"`, "", `--${b}`, "Content-Type: text/plain; charset=utf-8", "", o.text, `--${b}`, 'Content-Type: application/pdf; name="statement.pdf"', 'Content-Disposition: attachment; filename="statement.pdf"', "Content-Transfer-Encoding: base64", "", o.pdf.toString("base64").replace(/.{76}/g, "$&\r\n"), `--${b}--`, ""].join("\r\n"));
}
let address = "";
const deliver = (raw: Buffer) => api(app).post(`${V}/inbound/email`).set("x-inbound-secret", SECRET).set("x-envelope-to", address).set("content-type", "message/rfc822").send(raw);

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  token = a.token;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: a.email } })).id;
  other = (await register(app)).token;
  me = (await prisma.profile.create({ data: { userId, nickname: "Me", relationship: "SELF", isPrimary: true } })).id;
  const policy = { policySource: "test", policyVerified: true };
  await prisma.loyaltyProgram.upsert({ where: { code: "MAR_BONVOY" }, update: {}, create: { code: "MAR_BONVOY", name: "Marriott Bonvoy", kind: "HOTEL", centsPerPoint: 0.8, policyType: "ACTIVITY", policyMonths: 24, resetConditions: ["STAY", "EARN"], ...policy } });
  await prisma.loyaltyProgram.upsert({ where: { code: "AA_AADVANTAGE" }, update: {}, create: { code: "AA_AADVANTAGE", name: "American Airlines AAdvantage", kind: "AIRLINE", centsPerPoint: 1.5, policyType: "ACTIVITY", policyMonths: 18, ...policy } });
  marriott = (await post("/loyalty/accounts", { profileId: me, programCode: "MAR_BONVOY", accountNumber: "MB000004821", balance: 10_000, lastActivityAt: new Date(Date.now() - 30 * DAY).toISOString() }).expect(201)).body.id;
  address = (await get("/capture/status").expect(200)).body.inbox.address;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("TC-EXT: extension tokens and snapshots", () => {
  it("creates a token with the ingest scope only; the clear token is shown once", async () => {
    const t = (await post("/loyalty/tokens", { name: "My browser" }).expect(201)).body;
    ext = t.token;
    expect(t.scopes).toEqual(["loyalty:ingest"]);
    expect(ext).toMatch(/^pw_pat_/);
    const list = (await get("/loyalty/tokens").expect(200)).body;
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(ext);
    expect((await prisma.personalAccessToken.findFirstOrThrow({ where: { id: t.id } })).tokenHash).toBe(createHash("sha256").update(ext).digest("hex"));
    await post("/loyalty/tokens", { name: "" }).expect(400);
  });
  it("a snapshot updates the account, tagged as the extension (reliability 70), and the page text is not stored", async () => {
    const r = (await snapshot({ program: "MAR_BONVOY", text: PAGE("85,400"), pageHash: "page-1" }).expect(200)).body;
    expect(r).toMatchObject({ accepted: true, applied: expect.any(Number), unverifiedParser: true, accountId: marriott });
    expect(r.rules).toEqual(expect.arrayContaining(["balance.label"]));
    const a = await account();
    expect(a.balance).toBe(85_400);
    expect(a).toMatchObject({ balanceSource: "EXTENSION", balanceReliability: 70, statusLevel: "Gold Elite" });
    const obs = await prisma.loyaltyObservation.findMany({ where: { userId } });
    expect(JSON.stringify(obs)).not.toContain("Welcome back");
    expect(obs.every((o) => o.evidenceHash.length === 64)).toBe(true);
    expect(await prisma.eliteStatus.findFirst({ where: { userId, level: "Gold Elite" } })).toMatchObject({ source: "EXTENSION", reliability: 70 });
  });
  it("capturing the same page twice changes nothing (idempotent)", async () => {
    const before = await prisma.loyaltyObservation.count({ where: { userId } });
    const r = (await snapshot({ program: "MAR_BONVOY", text: PAGE("85,400"), pageHash: "page-1" }).expect(200)).body;
    expect(r.duplicates).toBe(r.observations);
    expect(await prisma.loyaltyObservation.count({ where: { userId } })).toBe(before);
  });
  it("rejects missing, wrong-scope, revoked and unknown tokens; validates the body", async () => {
    await snapshot({ program: "MAR_BONVOY", text: PAGE("1,000") }, null).expect(401);
    await snapshot({ program: "MAR_BONVOY", text: PAGE("1,000") }, "pw_pat_nope").expect(401);
    const mcp = "pw_pat_" + randomBytes(24).toString("base64url");
    await prisma.personalAccessToken.create({ data: { userId, name: "mcp", prefix: mcp.slice(0, 13), tokenHash: createHash("sha256").update(mcp).digest("hex"), scopes: ["mcp:read"], expiresAt: new Date(Date.now() + DAY) } });
    await snapshot({ program: "MAR_BONVOY", text: PAGE("1,000") }, mcp).expect(401); // another scope cannot ingest
    await snapshot({ program: "NOPE", text: PAGE("1,000") }).expect(400);
    await snapshot({ program: "MAR_BONVOY", text: "short" }).expect(400);
    await snapshot({ program: "MAR_BONVOY", text: "x".repeat(30_001) }).expect(400);
    const gone = (await post("/loyalty/tokens", { name: "temp" }).expect(201)).body;
    await api(app).delete(`${V}/loyalty/tokens/${gone.id}`).set(bearer(token)).expect(204);
    await snapshot({ program: "MAR_BONVOY", text: PAGE("1,000") }, gone.token).expect(401);
    await api(app).delete(`${V}/loyalty/tokens/${gone.id}`).set(bearer(token)).expect(404);
    expect((await account()).balance).toBe(85_400);
  });
  it("a page with nothing recognisable is accepted=false with guidance; an unmatched program is reported, not guessed", async () => {
    const r = (await snapshot({ program: "MAR_BONVOY", text: "Book your summer escape and save big on every stay." }).expect(200)).body;
    expect(r).toMatchObject({ accepted: false });
    expect(r.reason).toMatch(/Open the page that shows your balance/);
    const noAcct = (await snapshot({ program: "HH_HONORS", text: "Your current points balance is 5,000." }).expect(200)).body;
    expect(noAcct.unmatched).toMatch(/No HH_HONORS account/);
  });
  it("the token cannot call user endpoints and is private to its owner", async () => {
    await api(app).get(`${V}/loyalty/accounts`).set("Authorization", `Bearer ${ext}`).expect(401);
    expect((await get("/loyalty/tokens", other).expect(200)).body).toEqual([]);
  });
});

describe("TC-PROV: a lower-confidence source never overwrites a higher one", () => {
  it("manual (25) cannot replace the extension value (70): kept and reported; the audit trail records why", async () => {
    const r = (await patch(`/loyalty/accounts/${marriott}`, { balance: 40_000 }).expect(200)).body;
    expect(r.balance).toBe(85_400);
    expect(r.ingest).toMatchObject({ kept: 1, applied: 0 });
    const o = (await get("/loyalty/observations?outcome=KEPT").expect(200)).body.find((x: any) => x.field === "balance" && x.sourceType === "MANUAL");
    expect(o.reason).toMatch(/Lower reliability \(25 < 70\)/);
    expect(o.storedValue).toBe(85_400);
  });
  it("force records an explicit member override", async () => {
    const r = (await patch(`/loyalty/accounts/${marriott}`, { balance: 40_000, force: true }).expect(200)).body;
    expect(r.balance).toBe(40_000);
    expect(r).toMatchObject({ balanceSource: "MANUAL", balanceReliability: 25 });
    expect(r.ingest.applied).toBe(1);
  });
  it("an email (80) replaces the manual value; a statement (75) that disagrees with it is a conflict for the member", async () => {
    const sample = (await post("/loyalty/import/email-sample", { fromDomain: "e.marriott.com", subject: "Your Bonvoy summary", text: "Your current points balance is 92,000.", apply: true }).expect(200)).body;
    expect(sample.result.applied).toBeGreaterThanOrEqual(1);
    expect(await account()).toMatchObject({ balance: 92_000, balanceSource: "EMAIL", balanceReliability: 80 });
    const pdf = makePdf([["Marriott Bonvoy Account Statement", "Statement period: 11/01/2026 - 11/30/2026", "Beginning balance 90,000", "11/10/2026  Hotel stay Courtyard  +3,000", "Ending balance 93,000"]]);
    const imp = (await api(app).post(`${V}/loyalty/import/statement`).set(bearer(token)).field("apply", "true").attach("file", pdf, "stmt.pdf").expect(200)).body;
    expect(imp).toMatchObject({ applied: true, program: "Marriott Bonvoy", opening: 90_000, closing: 93_000, validation: { status: "PASS" } });
    expect(imp.result.conflicts).toBe(1); // 93,000 (statement, 75) vs 92,000 (email, 80): sources disagree
    expect((await account()).balance).toBe(92_000);
    const conflict = (await get("/loyalty/observations?outcome=CONFLICT").expect(200)).body[0];
    expect(conflict).toMatchObject({ field: "balance", sourceType: "STATEMENT", storedValue: 92_000, value: 93_000 });
    // the member settles it
    await post(`/loyalty/observations/${conflict.id}/resolve`, { decision: "ACCEPT" }).expect(200);
    expect(await account()).toMatchObject({ balance: 93_000, balanceVerification: "CROSS_CONFIRMED" });
    expect((await get("/loyalty/observations?outcome=CONFLICT").expect(200)).body).toEqual([]);
    await post(`/loyalty/observations/${conflict.id}/resolve`, { decision: "ACCEPT" }).expect(200); // already settled: no-op
    await post(`/loyalty/observations/${conflict.id}/resolve`, { decision: "MAYBE" }).expect(400);
    await post(`/loyalty/observations/${conflict.id}/resolve`, { decision: "REJECT" }, other).expect(404);
  });
  it("rejecting a conflict leaves the stored value", async () => {
    await post("/loyalty/import/email-sample", { fromDomain: "marriott.com", subject: "Summary", text: "Your current points balance is 95,000.", apply: true }).expect(200);
    const b = await account();
    expect(b.balance).toBe(95_000);
    const low = (await patch(`/loyalty/accounts/${marriott}`, { balance: 1_000 }).expect(200)).body;
    expect(low.balance).toBe(95_000);
    expect((await get("/loyalty/observations?outcome=KEPT").expect(200)).body.length).toBeGreaterThan(1);
  });
  it("statement activity becomes history with the running balance, and a mismatched statement is a warning", async () => {
    const h = (await get(`/loyalty/accounts/${marriott}/history`).expect(200)).body;
    expect(h.events.some((e: any) => e.kind === "EARN" && e.points === 3_000 && e.balanceAfter === 93_000)).toBe(true);
    const bad = makePdf([["Marriott Bonvoy Account Statement", "Statement period: 10/01/2026 - 10/31/2026", "Beginning balance 80,000", "10/10/2026  Hotel stay  +3,000", "Ending balance 99,999"]]);
    const prev = (await api(app).post(`${V}/loyalty/import/statement`).set(bearer(token)).attach("file", bad, "s.pdf").expect(200)).body;
    expect(prev).toMatchObject({ applied: false, validation: { status: "WARNING" } });
    expect(prev.validation.reasons[0]).toMatch(/not the printed closing balance 99,999/);
    await api(app).post(`${V}/loyalty/import/statement`).set(bearer(token)).expect(400);
    await api(app).post(`${V}/loyalty/import/statement`).set(bearer(token)).attach("file", Buffer.from("not a pdf"), "x.pdf").expect(400);
  });
});

describe("TC-MAIL: loyalty emails through the inbound pipeline", () => {
  it("a program email updates the matching account (source EMAIL), is DKIM-checked, and is recorded without its body", async () => {
    const res = await deliver(mime({ from: "Marriott Bonvoy <no-reply@e.marriott.com>", subject: "Your Bonvoy points", text: "Hello. Your current points balance is 101,500. Your Platinum Elite status is valid through February 28, 2027. Member number ending 4821." }));
    expect(res.status).toBe(202);
    expect(await account()).toMatchObject({ balance: 101_500, statusLevel: "Platinum Elite", balanceSource: "EMAIL" });
    const row = await prisma.inboundEmail.findFirstOrThrow({ where: { userId, kind: "LOYALTY" }, orderBy: { receivedAt: "desc" } });
    expect(row.note).toMatch(/Marriott Bonvoy: \d+ applied/);
    expect(JSON.stringify(row)).not.toContain("101,500");
    // status history: Gold Elite then Platinum Elite, newest is current
    const st = (await get("/loyalty/status").expect(200)).body.filter((s: any) => s.program === "Marriott Bonvoy");
    expect(st.map((s: any) => [s.level, s.current])).toEqual(expect.arrayContaining([["Platinum Elite", true], ["Gold Elite", false]]));
  });
  it("an email that fails authentication is rejected; mail from a non-program domain does nothing", async () => {
    const before = (await account()).balance;
    await deliver(mime({ from: "x <no-reply@e.marriott.com>", subject: "Your Bonvoy points", text: "Your current points balance is 7.", auth: "mx.pointwise.test; dkim=fail header.d=marriott.com" }));
    await deliver(mime({ from: "x <a@example.org>", subject: "Your points", text: "Your current points balance is 7." }));
    expect((await account()).balance).toBe(before);
  });
  it("a certificate award email creates a certificate with its conditions", async () => {
    await deliver(mime({ from: "Marriott <no-reply@marriott.com>", subject: "Your award", text: `You've earned a Free Night Award! Valid for stays up to 40,000 points per night. Valid only on award bookings. Expires on ${new Date(Date.now() + 120 * DAY).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}. Member number ending 4821.` }));
    const certs = (await get("/loyalty/certificates?category=FREE_NIGHT").expect(200)).body;
    const c = certs.find((x: any) => /Marriott Free night/i.test(x.name));
    expect(c).toMatchObject({ pointCap: 40_000, status: "AVAILABLE" });
    const row = await prisma.loyaltyCertificate.findFirstOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ source: "EMAIL", reliability: 80 });
    expect((row.conditions as Array<{ type: string }>).map((x) => x.type)).toEqual(expect.arrayContaining(["POINT_CAP", "AWARD_ONLY"]));
    // the same email again is a no-op
    const n = (await get("/loyalty/certificates").expect(200)).body.length;
    await deliver(mime({ from: "Marriott <no-reply@marriott.com>", subject: "Your award", text: `You've earned a Free Night Award! Valid for stays up to 40,000 points per night. Valid only on award bookings. Expires on ${new Date(Date.now() + 120 * DAY).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}. Member number ending 4821.` }));
    expect((await get("/loyalty/certificates").expect(200)).body.length).toBe(n);
  });
  it("an email for a program the member has no account for is reported, not applied", async () => {
    await deliver(mime({ from: "AA <no-reply@aa.com>", subject: "Your miles", text: "You have 12,000 miles in your account.", auth: "mx.pointwise.test; dkim=pass header.d=aa.com" }));
    const row = await prisma.inboundEmail.findFirstOrThrow({ where: { userId, kind: "LOYALTY" }, orderBy: { receivedAt: "desc" } });
    expect(row.note).toMatch(/No AA_AADVANTAGE account/);
  });
});

describe("TC-REFRESH: status, priority, plan, health, audit", () => {
  it("every account gets a priority, next refresh time, confidence and a plan naming what to do", async () => {
    const s = (await get("/loyalty/refresh-status").expect(200)).body;
    const m = s.accounts.find((a: any) => a.accountId === marriott);
    expect(m).toMatchObject({ freshness: "FRESH", source: "EMAIL", reliability: 80 });
    expect(m.refreshConfidence).toBeGreaterThan(70);
    expect(["CRITICAL", "HIGH", "NORMAL"]).toContain(m.priority);
    expect(m.plan.some((p: any) => p.kind === "CONNECT_MAILBOX" || p.kind === "SYNC_MAILBOX" || p.kind === "CAPTURE_PAGE")).toBe(true);
    expect(s.sources).toMatchObject({ mailbox: false, extension: true });
    expect(s.summary.accounts).toBe(1);
    const row = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: marriott } });
    expect(row.nextRefreshAt).toBeTruthy();
    expect(row.refreshPriority).toBe(m.priority);
  });
  it("an account that was never refreshed is flagged and gets a manual plan", async () => {
    const stale = (await post("/loyalty/accounts", { profileId: me, programCode: "AA_AADVANTAGE", balance: 20_000, lastActivityAt: (() => { const d = new Date(); d.setUTCMonth(d.getUTCMonth() - 18); return new Date(d.getTime() + 15 * DAY).toISOString(); })(), nickname: "old" }).expect(201)).body;
    await prisma.loyaltyAccount.update({ where: { id: stale.id }, data: { provenance: {}, refreshedAt: new Date(Date.now() - 120 * DAY), lastSuccessfulRefreshAt: new Date(Date.now() - 120 * DAY), nextRefreshAt: null, balanceSource: null } });
    const s = (await get("/loyalty/refresh-status").expect(200)).body;
    const a = s.accounts.find((x: any) => x.accountId === stale.id);
    expect(a.priority).toBe("CRITICAL"); // expires within 30 days
    expect(a.reasons[0]).toMatch(/points expire in \d+ day/);
    expect(a.freshness).toBe("STALE");
    expect(a.plan.map((p: any) => p.kind)).toEqual(expect.arrayContaining(["FORWARD_STATEMENT", "UPDATE_MANUALLY"]));
    expect(s.summary.stale).toBeGreaterThanOrEqual(1);
    // the hourly job nudges once per week
    const jobs = app.get(LoyaltyRefreshJobs, { strict: false });
    expect(await jobs.refreshDue(new Date(), async () => undefined)).toBeGreaterThanOrEqual(1);
    expect(await jobs.refreshDue(new Date(), async () => undefined)).toBe(0);
    const n = await prisma.notification.findFirstOrThrow({ where: { userId, type: "LOYALTY_STALE" } });
    expect(n.body).toMatch(/AAdvantage \(Me\) has not been updated recently/);
    await prisma.loyaltyAccount.delete({ where: { id: stale.id } });
  });
  it("manual refresh reports the plan (no mailbox connected, nothing to sync)", async () => {
    const r = (await post("/loyalty/refresh", {}).expect(200)).body;
    expect(r).toMatchObject({ mailboxes: 0, synced: [] });
    const one = (await post(`/loyalty/accounts/${marriott}/refresh`, {}).expect(200)).body;
    expect(one.account.accountId).toBe(marriott);
  });
  it("health: 0–100 per account, program and household, with factors", async () => {
    const h = (await get("/loyalty/health").expect(200)).body;
    expect(h.household.score).toBeGreaterThanOrEqual(0);
    expect(h.household.score).toBeLessThanOrEqual(100);
    expect(["HEALTHY", "NEEDS_ATTENTION", "AT_RISK"]).toContain(h.household.label);
    expect(h.accounts[0].factors).toHaveLength(8);
    expect(h.programs.map((p: any) => p.program)).toContain("MAR_BONVOY");
  });
  it("the audit answers the eight questions and recent changes list sources", async () => {
    const a = (await get("/loyalty/audit").expect(200)).body;
    expect(a.questions.map((q: any) => q.question)).toEqual([
      "What loyalty assets are expiring next?", "What free night certificates remain unused?", "What is my total loyalty portfolio value?", "What elite statuses are at risk?", "What rewards should I redeem first?", "What accounts have not refreshed recently?", "What balances changed recently?", "What points are most at risk?",
    ]);
    expect(a.questions.every((q: any) => q.answer.length > 3)).toBe(true);
    const c = (await get("/loyalty/changes?days=30").expect(200)).body;
    expect(c.changes.some((x: any) => x.what === "balance" && x.source === "EMAIL" && x.reliability === 80)).toBe(true);
  });
  it("the loyalty-audit workflow runs from the engines and is audited", async () => {
    const r = (await post("/ai/workflows/loyalty-audit", {}).expect(200)).body;
    expect(r).toMatchObject({ status: "COMPLETED", privacy: "USER" });
    expect(r.answer).toMatch(/^Loyalty health: \d+\/100/);
    expect(r.answer).toMatch(/What points are most at risk\?/);
    expect(r.steps.map((s: any) => s.agent)).toEqual(["loyalty-audit", "refresh-health"]);
  });
  it("everything is private to the owner and needs sign-in", async () => {
    expect((await get("/loyalty/observations", other).expect(200)).body).toEqual([]);
    expect((await get("/loyalty/refresh-status", other).expect(200)).body.accounts).toEqual([]);
    await api(app).get(`${V}/loyalty/health`).expect(401);
    await api(app).post(`${V}/loyalty/import/email-sample`).send({ fromDomain: "marriott.com", subject: "x", text: "y" }).expect(401);
  });
});

describe("TC-EMAIL: sample tester", () => {
  it("previews what a pasted email would produce without saving, and says when a sender is unknown", async () => {
    const before = await prisma.loyaltyObservation.count({ where: { userId } });
    const p = (await post("/loyalty/import/email-sample", { fromDomain: "hilton.com", subject: "Points expiring", text: "10,000 points will expire on 03/01/2027 unless you have account activity." }).expect(200)).body;
    expect(p).toMatchObject({ program: "Hilton Honors", kind: "EXPIRY", unverifiedParser: true });
    expect(p.observations.map((o: any) => o.field)).toEqual(expect.arrayContaining(["expiresAt", "expiringPoints"]));
    expect(await prisma.loyaltyObservation.count({ where: { userId } })).toBe(before);
    expect((await post("/loyalty/import/email-sample", { fromDomain: "example.org", subject: "x", text: "Your current points balance is 5." }).expect(200)).body.program).toBeNull();
  });
});
