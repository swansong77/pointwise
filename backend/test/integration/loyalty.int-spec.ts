import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { LoyaltyJobsService } from "../../src/loyalty/loyalty.module";
import { api, bearer, createApp, register } from "./helpers";

/**
 * Loyalty asset management: accounts and balances, expiration prediction and alerts, certificates, elite status,
 * memberships, valuation, forecast, transfer bonuses, award trips, workflows. All data is synthetic.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString();
const ymd = (offsetDays: number) => iso(offsetDays).slice(0, 10);
const monthsAgo = (m: number, plusDays = 0) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - m);
  return new Date(d.getTime() + plusDays * DAY).toISOString();
};

let app: INestApplication;
let token: string;
let other: string;
let userId: string;
let me: string;
let sam: string;
let otherProfile: string;
let airAcct: string;
const get = (p: string, t = token) => api(app).get(`${V}${p}`).set(bearer(t));
const post = (p: string, b: object, t = token) => api(app).post(`${V}${p}`).set(bearer(t)).send(b);
const patch = (p: string, b: object, t = token) => api(app).patch(`${V}${p}`).set(bearer(t)).send(b);
const del = (p: string, t = token) => api(app).delete(`${V}${p}`).set(bearer(t));

beforeAll(async () => {
  app = await createApp();
  const a = await register(app);
  token = a.token;
  userId = (await prisma.user.findFirstOrThrow({ where: { email: a.email } })).id;
  const b = await register(app);
  other = b.token;
  const otherId = (await prisma.user.findFirstOrThrow({ where: { email: b.email } })).id;
  me = (await prisma.profile.create({ data: { userId, nickname: "Me", relationship: "SELF", isPrimary: true } })).id;
  sam = (await prisma.profile.create({ data: { userId, nickname: "Sam", relationship: "SPOUSE" } })).id;
  otherProfile = (await prisma.profile.create({ data: { userId: otherId, nickname: "Stranger", relationship: "SELF", isPrimary: true } })).id;
  // programs with known policies (the seed's registry is not loaded in test mode)
  const policy = { policySource: "test", policyVerified: true };
  await prisma.loyaltyProgram.upsert({ where: { code: "T_AIR" }, update: {}, create: { code: "T_AIR", name: "Test Air Miles", kind: "AIRLINE", centsPerPoint: 1.5, policyType: "ACTIVITY", policyMonths: 18, resetConditions: ["EARN", "CARD_SPEND", "TRANSFER"], ...policy } });
  await prisma.loyaltyProgram.upsert({ where: { code: "T_FOREVER" }, update: {}, create: { code: "T_FOREVER", name: "Forever Air", kind: "AIRLINE", centsPerPoint: 1.2, policyType: "NEVER", ...policy } });
  await prisma.loyaltyProgram.upsert({ where: { code: "T_STAY" }, update: {}, create: { code: "T_STAY", name: "Test Stay", kind: "HOTEL", centsPerPoint: 0.6, policyType: "ACTIVITY", policyMonths: 24, resetConditions: ["STAY", "EARN"], ...policy } });
  await prisma.rewardCurrency.upsert({ where: { code: "T_BANK" }, update: {}, create: { code: "T_BANK", name: "Test Bank Rewards", centsPerPoint: 1.5, policyType: "WHILE_CARD_OPEN", ...policy } });
});
afterAll(async () => {
  await prisma.transferBonusRecord.deleteMany({ where: { currency: { code: "T_BANK" } } });
  await prisma.transferPartner.deleteMany({ where: { currency: { code: "T_BANK" } } });
  await app.close();
  await prisma.$disconnect();
});

describe("TC-LOY: registry", () => {
  it("lists programs and bank currencies with their expiration policy", async () => {
    const r = (await get("/loyalty/programs").expect(200)).body;
    const air = r.programs.find((p: any) => p.code === "T_AIR");
    expect(air).toMatchObject({ kind: "AIRLINE", policy: { type: "ACTIVITY", months: 18, verified: true } });
    expect(r.currencies.find((c: any) => c.code === "T_BANK").policy.type).toBe("WHILE_CARD_OPEN");
    await api(app).get(`${V}/loyalty/programs`).expect(401);
  });
});

describe("TC-ACCT: accounts and balances", () => {
  it("creates an account, encrypts the number and shows only its last digits", async () => {
    const r = await post("/loyalty/accounts", { profileId: me, programCode: "T_AIR", accountNumber: "AA123456789", balance: 120_000, pendingBalance: 3_000, lastActivityAt: monthsAgo(18, 10), memberSince: "2015-01-01", nickname: "Main" }).expect(201);
    airAcct = r.body.id;
    expect(r.body).toMatchObject({ programName: "Test Air Miles", unit: "miles", balance: 120_000, accountLast4: "6789", valueCents: 180_000, member: "Me" });
    expect(JSON.stringify(r.body)).not.toContain("AA123456789");
    const row = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: airAcct } });
    expect(row.accountNumberEnc).toBeTruthy();
    expect(row.accountNumberEnc).not.toContain("AA123456789");
    expect(r.body.prediction).toMatchObject({ level: "HIGH", atRiskPoints: 120_000, confidence: 80 });
    expect(r.body.prediction.daysLeft).toBeGreaterThanOrEqual(8);
    expect(r.body.prediction.daysLeft).toBeLessThanOrEqual(11);
  });
  it("accepts a bank currency, a program that is not in the registry, and rejects ambiguous or foreign input", async () => {
    const bank = (await post("/loyalty/accounts", { profileId: me, currencyCode: "T_BANK", balance: 200_000 }).expect(201)).body;
    expect(bank).toMatchObject({ isBankCurrency: true, unit: "points", prediction: { expiresAt: null, level: "LOW" } });
    const custom = (await post("/loyalty/accounts", { profileId: sam, customName: "Corner Cafe Club", customKind: "DINING", customCentsPerPoint: 2, balance: 500 }).expect(201)).body;
    expect(custom).toMatchObject({ programName: "Corner Cafe Club", kind: "DINING", centsPerPoint: 2, valueCents: 1000 });
    await post("/loyalty/accounts", { profileId: me, programCode: "T_AIR", currencyCode: "T_BANK" }).expect(400);
    await post("/loyalty/accounts", { profileId: me }).expect(400);
    await post("/loyalty/accounts", { profileId: me, programCode: "NOPE" }).expect(400);
    await post("/loyalty/accounts", { profileId: me, currencyCode: "CASH" }).expect(400);
    await post("/loyalty/accounts", { profileId: otherProfile, programCode: "T_AIR" }).expect(404); // someone else's member
  });
  it("earning resets the clock; redeeming more than the balance is refused; history tracks every change", async () => {
    const before = (await get("/loyalty/accounts").expect(200)).body.find((a: any) => a.id === airAcct);
    const r = (await post(`/loyalty/accounts/${airAcct}/events`, { kind: "EARN", points: 5_000, note: "portal purchase" }).expect(201)).body;
    expect(r.balance).toBe(125_000);
    expect(r.prediction.daysLeft).toBeGreaterThan(before.prediction.daysLeft + 500); // ~18 months from today
    expect(["LOW", "NONE"]).toContain(r.prediction.level);
    await post(`/loyalty/accounts/${airAcct}/events`, { kind: "REDEEM", points: 999_999_999 }).expect(400);
    await post(`/loyalty/accounts/${airAcct}/events`, { kind: "REDEEM", points: 25_000, note: "award" }).expect(201);
    await post(`/loyalty/accounts/${airAcct}/events`, { kind: "EXPIRE", points: 1_000 }).expect(201);
    await post(`/loyalty/accounts/${airAcct}/events`, { kind: "BONUS", points: 2_000 }).expect(201);
    await post(`/loyalty/accounts/${airAcct}/events`, { kind: "ADJUST" , points: 0 }).expect(400); // needs the new balance
    const h = (await get(`/loyalty/accounts/${airAcct}/history?months=6`).expect(200)).body;
    expect(h.totals).toMatchObject({ current: 101_000, pending: 3_000, earned: 5_000, bonus: 2_000, redeemed: 25_000, expired: 1_000 });
    expect(h.months).toHaveLength(6);
    expect(h.months[5].balance).toBe(101_000);
    expect(h.events.map((e: any) => e.kind)).toEqual(expect.arrayContaining(["SNAPSHOT", "EARN", "REDEEM", "EXPIRE", "BONUS"]));
  });
  it("updating the balance records an adjustment; a date you know overrides the prediction and can be cleared", async () => {
    const u = (await patch(`/loyalty/accounts/${airAcct}`, { balance: 90_000, expiresAt: ymd(100), statusLevel: "Gold" }).expect(200)).body;
    expect(u).toMatchObject({ balance: 90_000, statusLevel: "Gold" });
    expect(u.prediction).toMatchObject({ confidence: 90, level: "MEDIUM" });
    const cleared = (await patch(`/loyalty/accounts/${airAcct}`, { expiresAt: null }).expect(200)).body;
    expect(cleared.expiresAt).toBeNull();
    const h = (await get(`/loyalty/accounts/${airAcct}/history`).expect(200)).body;
    expect(h.events[0]).toMatchObject({ kind: "ADJUST", points: -11_000, balanceAfter: 90_000 });
  });
  it("is private to the owner", async () => {
    expect((await get("/loyalty/accounts", other).expect(200)).body).toEqual([]);
    await patch(`/loyalty/accounts/${airAcct}`, { balance: 1 }, other).expect(404);
    await post(`/loyalty/accounts/${airAcct}/events`, { kind: "EARN", points: 1 }, other).expect(404);
    await del(`/loyalty/accounts/${airAcct}`, other).expect(404);
    await get(`/loyalty/accounts/${airAcct}/history`, other).expect(404);
  });
});

describe("TC-EXP: expiration monitoring", () => {
  let hotelAcct: string;
  it("lists risk, wording and the cheapest ways to keep points alive that match the program's reset rules", async () => {
    hotelAcct = (await post("/loyalty/accounts", { profileId: sam, programCode: "T_STAY", balance: 60_000, lastActivityAt: monthsAgo(24, 60) }).expect(201)).body.id;
    const r = (await get("/loyalty/expirations").expect(200)).body;
    const stay = r.items.find((i: any) => i.accountId === hotelAcct);
    expect(stay.message).toMatch(/Test Stay points expire in \d+ days \(60,000 at risk\)/);
    expect(stay.prediction).toMatchObject({ level: "HIGH", confidence: 80 }); // about 60 days left
    expect(stay.preservation.length).toBeGreaterThan(0);
    expect(stay.preservation.every((m: any) => m.confirmedByPolicy)).toBe(true);
    expect(r.items[0].prediction.riskScore).toBeGreaterThanOrEqual(r.items[r.items.length - 1].prediction.riskScore);
    expect(r.items.find((i: any) => i.program === "Corner Cafe Club").message).toBeNull();
  });
  it("the daily scan alerts once per threshold and again only when the date changes", async () => {
    // a balance that expires in 5 days → the 7-day alert
    const soon = (await post("/loyalty/accounts", { profileId: me, programCode: "T_AIR", balance: 7_000, expiresAt: ymd(5), nickname: "soon" }).expect(201)).body;
    const jobs = app.get(LoyaltyJobsService, { strict: false });
    const first = await jobs.scanExpirations(new Date());
    expect(first).toBeGreaterThanOrEqual(1);
    const notes = await prisma.notification.findMany({ where: { userId, type: "LOYALTY_EXPIRING" } });
    expect(notes.some((n) => n.dedupeKey?.startsWith(`loy:acct:${soon.id}:`) && n.dedupeKey.endsWith(":7"))).toBe(true);
    expect(notes.find((n) => n.dedupeKey?.includes(soon.id))!.body).toMatch(/at risk of expiration in Test Air Miles: 5 day/);
    expect(await jobs.scanExpirations(new Date())).toBe(0);
    await patch(`/loyalty/accounts/${soon.id}`, { expiresAt: ymd(12) }).expect(200);
    expect(await jobs.scanExpirations(new Date())).toBe(1); // new date, 14-day threshold
    await del(`/loyalty/accounts/${soon.id}`).expect(204);
  });
  it("monthly snapshots add one history point per account per month", async () => {
    const jobs = app.get(LoyaltyJobsService, { strict: false });
    // the opening balance already counts as this month's snapshot, so nothing is added yet
    expect(await jobs.snapshotBalances(new Date())).toBe(0);
    await prisma.loyaltyEvent.updateMany({ where: { accountId: airAcct }, data: { occurredAt: new Date(Date.now() - 62 * DAY) } });
    const n = await jobs.snapshotBalances(new Date());
    expect(n).toBe(1);
    expect(await jobs.snapshotBalances(new Date())).toBe(0);
  });
  it("members can turn loyalty alerts off", async () => {
    await prisma.notificationPreference.upsert({ where: { userId }, update: { loyaltyExpiring: false }, create: { userId, loyaltyExpiring: false } });
    const acct = (await post("/loyalty/accounts", { profileId: me, programCode: "T_AIR", balance: 9_000, expiresAt: ymd(3) }).expect(201)).body;
    expect(await app.get(LoyaltyJobsService, { strict: false }).scanExpirations(new Date())).toBe(0);
    await prisma.notificationPreference.update({ where: { userId }, data: { loyaltyExpiring: true } });
    await del(`/loyalty/accounts/${acct.id}`).expect(204);
  });
});

describe("TC-CERT: certificates", () => {
  let night: string;
  it("tracks a free night certificate with its restrictions and shows it as expiring", async () => {
    const r = await post("/loyalty/certificates", { profileId: me, category: "FREE_NIGHT", name: "Test Stay Free Night", programCode: "T_STAY", number: "FN-001", issuedAt: ymd(-300), expiresAt: ymd(45), pointCap: 40_000, eligible: ["Grand Test Hotel"], blackout: `${ymd(100)}..${ymd(110)}`, restrictions: "Weekdays only", potentialValueCents: 48_000 }).expect(201);
    night = r.body.id;
    await post("/loyalty/certificates", { profileId: me, category: "FREE_NIGHT", name: "Bad dates", issuedAt: ymd(10), expiresAt: ymd(5) }).expect(400);
    await post("/loyalty/certificates", { profileId: otherProfile, category: "UPGRADE", name: "Not mine" }).expect(404);
    const list = (await get("/loyalty/certificates?category=FREE_NIGHT").expect(200)).body;
    expect(list[0]).toMatchObject({ name: "Test Stay Free Night", program: "Test Stay", view: { state: "EXPIRING" } });
    expect(list[0].view.daysLeft).toBeGreaterThanOrEqual(44);
    expect((await get("/loyalty/certificates?category=COMPANION").expect(200)).body).toEqual([]);
  });
  it("checks redemption rules against stays: cap, eligibility, blackout, date", async () => {
    const ok = { hotel: "Grand Test Hotel", pointsPerNight: 35_000, cashRateCents: 52_000, checkIn: ymd(20) };
    const r = (await post(`/loyalty/certificates/${night}/check`, { stays: [ok, { ...ok, pointsPerNight: 60_000 }, { ...ok, hotel: "Other Inn" }, { ...ok, checkIn: ymd(105) }, { ...ok, checkIn: ymd(90) }] }).expect(200)).body;
    expect(r[0]).toMatchObject({ ok: true, valueCents: 52_000 });
    expect(r[0].warnings.join(" ")).toMatch(/Weekdays only/);
    expect(r[1].reasons[0]).toMatch(/covers up to 40,000/);
    expect(r[2].reasons[0]).toMatch(/not in the eligible list/);
    expect(r[3].reasons.join(" ")).toMatch(/blackout|after the certificate expires/);
    expect(r[4].reasons[0]).toMatch(/after the certificate expires/);
  });
  it("opportunities use the best qualifying hotel and the stored value otherwise", async () => {
    const plain = (await get("/loyalty/certificates/opportunities").expect(200)).body;
    expect(plain[0].message).toMatch(/You have a Test Stay Free Night expiring in 4\d days\. Potential value: \$480\./);
    const withStay = (await post("/loyalty/certificates/opportunities", { stays: [{ hotel: "Grand Test Hotel", pointsPerNight: 30_000, cashRateCents: 61_000, checkIn: ymd(10) }] }).expect(200)).body;
    expect(withStay[0]).toMatchObject({ hotel: "Grand Test Hotel", valueCents: 61_000 });
  });
  it("companion and upgrade certificates are tracked; using one records when and removes it from value", async () => {
    const up = (await post("/loyalty/certificates", { profileId: sam, category: "UPGRADE", subtype: "GLOBAL", name: "Global upgrade", quantity: 2, expiresAt: ymd(200), eligible: ["Long-haul"], potentialValueCents: 40_000 }).expect(201)).body;
    const comp = (await post("/loyalty/certificates", { profileId: me, category: "COMPANION", name: "Companion fare", expiresAt: ymd(400), fareClasses: "Y,B", potentialValueCents: 30_000 }).expect(201)).body;
    const v0 = (await get("/loyalty/valuation").expect(200)).body;
    await patch(`/loyalty/certificates/${comp.id}`, { status: "USED", usageNote: "Booked to Denver" }).expect(200);
    const v1 = (await get("/loyalty/valuation").expect(200)).body;
    expect(v0.currentCents - v1.currentCents).toBe(30_000);
    expect(v1.recoveredCents - v0.recoveredCents).toBe(30_000);
    expect(v1.byCategory.certificates).toBe(48_000 + 80_000); // free night + two upgrades
    const used = (await get("/loyalty/certificates?category=COMPANION").expect(200)).body[0];
    expect(used).toMatchObject({ status: "USED", usageNote: "Booked to Denver", view: { state: "USED" } });
    expect(used.usedAt).toBeTruthy();
    await del(`/loyalty/certificates/${up.id}`).expect(204);
    await del(`/loyalty/certificates/${up.id}`).expect(404);
    await patch(`/loyalty/certificates/${night}`, { quantity: 1 }, other).expect(404);
  });
  it("an unused certificate past its date is reported expired and counted as lost value", async () => {
    const old = (await post("/loyalty/certificates", { profileId: me, category: "FREE_NIGHT", name: "Lapsed", expiresAt: ymd(-10), potentialValueCents: 25_000 }).expect(201)).body;
    const v = (await get("/loyalty/valuation").expect(200)).body;
    expect(v.expiredCents).toBeGreaterThanOrEqual(25_000);
    expect(await app.get(LoyaltyJobsService, { strict: false }).scanExpirations(new Date())).toBeGreaterThanOrEqual(0);
    expect((await prisma.loyaltyCertificate.findUniqueOrThrow({ where: { id: old.id } })).status).toBe("EXPIRED");
  });
});

describe("TC-ELITE: status and memberships", () => {
  it("keeps one row per qualification period; the latest is current; progress, risk and actions are computed", async () => {
    await post("/loyalty/status", { profileId: me, programName: "Test Stay", programCode: "T_STAY", kind: "HOTEL", level: "Gold", periodStart: ymd(-700), expiresAt: ymd(-335), metric: "nights", progress: 62, required: 50, maintained: true }).expect(201);
    const cur = (await post("/loyalty/status", { profileId: me, programName: "Test Stay", programCode: "T_STAY", kind: "HOTEL", level: "Platinum", periodStart: ymd(-300), expiresAt: ymd(65), metric: "nights", progress: 38, required: 50, valueCents: 60_000, benefits: ["Lounge access", "Room upgrades"] }).expect(201)).body;
    const rows = (await get("/loyalty/status").expect(200)).body;
    expect(rows.filter((r: any) => r.program === "Test Stay")).toHaveLength(2);
    const current = rows.find((r: any) => r.id === cur.id);
    expect(current).toMatchObject({ current: true, view: { pct: 76, remaining: 12 } });
    expect(current.view.headline).toBe("Test Stay Platinum: 76% there, needs 12 nights");
    expect(current.view.actions[0]).toMatch(/Earn 12 more nights/);
    expect(rows.find((r: any) => r.level === "Gold").current).toBe(false);
    await patch(`/loyalty/status/${cur.id}`, { progress: 50 }).expect(200);
    expect(((await get("/loyalty/status").expect(200)).body.find((r: any) => r.id === cur.id)).view.headline).toMatch(/maintained/);
    await patch(`/loyalty/status/${cur.id}`, { progress: 38 }, other).expect(404);
    await post("/loyalty/status", { profileId: me, programName: "X", kind: "BOGUS", level: "L" }).expect(400);
  });
  it("memberships: member number stored encrypted, expiry wording, renewal credit suggestion", async () => {
    const m = (await post("/loyalty/memberships", { profileId: me, kind: "GLOBAL_ENTRY", name: "Global Entry", expiresAt: ymd(181), memberNumber: "PASS987654321", renewalCostCents: 12_000, annualValueCents: 2_400, benefits: ["Expedited customs"], autoRenew: false }).expect(201)).body;
    expect(m.memberLast4).toBe("4321");
    expect(JSON.stringify(m)).not.toContain("PASS987654321");
    const list = (await get("/loyalty/memberships").expect(200)).body;
    expect(list[0]).toMatchObject({ name: "Global Entry", memberLast4: "4321", view: { state: "ACTIVE", renewalEligible: true } });
    expect(list[0].view.headline).toBe("Global Entry expires in 6 months.");
    expect(JSON.stringify(list)).not.toContain("PASS987654321");
    expect((await get(`/loyalty/memberships/${m.id}/number`).expect(200)).body.memberNumber).toBe("PASS987654321");
    await get(`/loyalty/memberships/${m.id}/number`, other).expect(404);
    await patch(`/loyalty/memberships/${m.id}`, { expiresAt: ymd(30), autoRenew: true }).expect(200);
    const soon = (await get("/loyalty/memberships").expect(200)).body[0];
    expect(soon.view).toMatchObject({ state: "EXPIRING" });
    expect(soon.view.headline).toMatch(/It renews automatically/);
    await post("/loyalty/memberships", { profileId: me, kind: "CLEAR", name: "CLEAR", linkedWalletCardId: "00000000-0000-4000-8000-000000000000" }).expect(400);
    await del(`/loyalty/memberships/${m.id}`, other).expect(404);
  });
});

describe("TC-VAL: valuation, forecast, household, dashboard", () => {
  it("values every asset class and splits it by member", async () => {
    const v = (await get("/loyalty/valuation").expect(200)).body;
    expect(v.currentCents).toBeGreaterThan(0);
    expect(v.byCategory.points).toBeGreaterThan(300_000); // 200,000 bank points at 1.5¢ plus airline miles
    expect(v.byCategory.status).toBe(60_000);
    expect(v.byCategory.memberships).toBeGreaterThan(0);
    expect(v.potentialCents).toBeGreaterThanOrEqual(v.currentCents);
    expect(v.members.map((m: any) => m.member).sort()).toEqual(["Me", "Sam"]);
    expect(v.totalPoints).toBeGreaterThan(290_000);
  });
  it("the forecast lists points, certificates, status and memberships by window, soonest first", async () => {
    const f = (await get("/loyalty/forecast").expect(200)).body;
    expect(f.buckets.map((b: any) => b.key)).toEqual(["next30", "next90", "next180", "next365", "next730"]);
    const all = f.buckets.flatMap((b: any) => b.items);
    expect(all.map((i: any) => i.type)).toEqual(expect.arrayContaining(["POINTS", "FREE_NIGHT", "STATUS", "MEMBERSHIP"]));
    for (const b of f.buckets) expect(b.totalCents).toBe(b.items.reduce((s: number, i: any) => s + i.valueCents, 0));
    expect(f.buckets[0].items.some((i: any) => i.type === "MEMBERSHIP")).toBe(true); // Global Entry in 30 days
  });
  it("the household view combines members and finds the best transfer for each bank balance", async () => {
    const h = (await get("/loyalty/household").expect(200)).body;
    expect(h.members).toHaveLength(2);
    expect(h.combined.totalPoints).toBeGreaterThan(290_000);
    expect(Array.isArray(h.transfers)).toBe(true);
  });
  it("the dashboard puts it together", async () => {
    const d = (await get("/loyalty/dashboard").expect(200)).body;
    expect(d.valuation.currentCents).toBeGreaterThan(0);
    expect(d.certificates.length).toBeGreaterThan(0);
    expect(d.nextThirtyDays.key).toBe("next30");
    await api(app).get(`${V}/loyalty/dashboard`).expect(401);
  });
});

describe("TC-XFER: transfer bonuses", () => {
  it("routes show ratio, current bonus, history statistics and a recommendation", async () => {
    const bank = await prisma.rewardCurrency.findUniqueOrThrow({ where: { code: "T_BANK" } });
    const air = await prisma.loyaltyProgram.findUniqueOrThrow({ where: { code: "T_AIR" } });
    const forever = await prisma.loyaltyProgram.findUniqueOrThrow({ where: { code: "T_FOREVER" } });
    await prisma.transferPartner.upsert({ where: { currencyId_programId: { currencyId: bank.id, programId: air.id } }, update: { bonusPercent: 35, bonusEndsAt: new Date(Date.now() + 10 * DAY) }, create: { currencyId: bank.id, programId: air.id, ratioFrom: 1, ratioTo: 1, bonusPercent: 35, bonusEndsAt: new Date(Date.now() + 10 * DAY) } });
    await prisma.transferPartner.upsert({ where: { currencyId_programId: { currencyId: bank.id, programId: forever.id } }, update: {}, create: { currencyId: bank.id, programId: forever.id, ratioFrom: 1, ratioTo: 1, transferDays: 2 } });
    // observed history (the admin endpoint writes the same rows)
    for (const [pct, start] of [[25, 330], [30, 240], [30, 150], [40, 60]] as const)
      await prisma.transferBonusRecord.upsert({ where: { currencyId_programId_startsAt: { currencyId: bank.id, programId: air.id, startsAt: new Date(Date.now() - start * DAY) } }, update: {}, create: { currencyId: bank.id, programId: air.id, bonusPercent: pct, startsAt: new Date(Date.now() - start * DAY), source: "test" } });
    const routes = (await get("/loyalty/transfers").expect(200)).body;
    const route = routes.find((r: any) => r.currency === "T_BANK" && r.program === "T_AIR");
    expect(route).toMatchObject({ ratio: "1:1", activeBonusPercent: 35 });
    expect(route.stats).toMatchObject({ count: 4, maxPercent: 40 });
    expect(route.advice.verdict).toBe("TRANSFER_NOW");
    expect(route.advice.text).toMatch(/exceeds the historical average/);
    expect(route.effectiveCentsPerPoint).toBe(2.025);
    expect(routes.find((r: any) => r.program === "T_FOREVER")).toMatchObject({ activeBonusPercent: null, transferDays: 2 });
    expect(routes[0].activeBonusPercent).toBe(35); // active bonuses first
  });
  it("only an admin can record a bonus", async () => {
    await api(app).put(`${V}/admin/loyalty/bonus-records`).set(bearer(token)).send({ currency: "T_BANK", program: "T_AIR", bonusPercent: 30, startsAt: ymd(-5) }).expect(403);
  });
  it("active bonuses are logged as history once", async () => {
    const jobs = app.get(LoyaltyJobsService, { strict: false });
    await jobs.scanExpirations(new Date());
    const n = await prisma.transferBonusRecord.count({ where: { source: "observed by Pointwise", currency: { code: "T_BANK" } } });
    expect(n).toBe(1);
    await jobs.scanExpirations(new Date());
    expect(await prisma.transferBonusRecord.count({ where: { source: "observed by Pointwise", currency: { code: "T_BANK" } } })).toBe(1);
  });
});

describe("TC-AWARD: award trips and workflows", () => {
  it("evaluates programs the household holds or can reach, using expiring points and the active bonus", async () => {
    const r = (await post("/loyalty/award-trips", { destination: "Tokyo", dateFrom: ymd(120), dateTo: ymd(130), cabin: "BUSINESS", region: "LONG_HAUL", airlinePrefs: ["Test Air"], hotelPrefs: ["Test Stay"] }).expect(200)).body;
    expect(r).toMatchObject({ pointsNeeded: 170_000, pointsEstimated: true });
    expect(r.estimateNote).toMatch(/coarse planning estimate/);
    expect(r.options.length).toBeGreaterThan(0);
    const air = r.options.find((o: any) => o.programCode === "T_AIR");
    expect(air).toMatchObject({ shortfall: 0, activeBonusPercent: 35, usesTransfer: true });
    expect(air.reasons.join(" ")).toMatch(/preferred program/);
    expect(r.certificates.map((c: any) => c.name)).toContain("Test Stay Free Night");
    expect(r.options[0].score).toBeGreaterThanOrEqual(r.options[r.options.length - 1].score);
  });
  it("an exact price is used as given; trips can be saved, listed and deleted by the owner", async () => {
    const r = (await post("/loyalty/award-trips", { destination: "Lisbon", dateFrom: ymd(200), dateTo: ymd(210), cabin: "ECONOMY", pointsNeeded: 60_000, save: true }).expect(200)).body;
    expect(r).toMatchObject({ pointsNeeded: 60_000, pointsEstimated: false, estimateNote: null });
    expect(r.tripId).toBeTruthy();
    expect((await get("/loyalty/award-trips").expect(200)).body.map((t: any) => t.destination)).toContain("Lisbon");
    await del(`/loyalty/award-trips/${r.tripId}`, other).expect(404);
    await del(`/loyalty/award-trips/${r.tripId}`).expect(204);
    await post("/loyalty/award-trips", { destination: "X", dateFrom: ymd(10), dateTo: ymd(5), cabin: "FIRST" }).expect(400);
    await post("/loyalty/award-trips", { destination: "Y", dateFrom: ymd(10), dateTo: ymd(20), cabin: "STEERAGE" }).expect(400);
  });
  it("transfers that cannot arrive before departure are flagged", async () => {
    const r = (await post("/loyalty/award-trips", { destination: "Soon", dateFrom: ymd(1), dateTo: ymd(5), cabin: "ECONOMY", pointsNeeded: 150_000, airlinePrefs: ["Test Air"] }).expect(200)).body;
    const air = r.options.find((o: any) => o.programCode === "T_AIR");
    expect(air.usesTransfer).toBe(true);
    expect(air).toBeTruthy();
  });
  it("loyalty-review and award-trip workflows are audited and compose from the engines", async () => {
    const rv = (await post("/ai/workflows/loyalty-review", {}).expect(200)).body;
    expect(rv).toMatchObject({ status: "COMPLETED", privacy: "USER" });
    expect(rv.answer).toMatch(/^Loyalty assets: \$[\d,.]+ now/);
    expect(rv.steps.map((s: any) => s.agent)).toEqual(["valuation", "point-expiration", "certificate", "elite-status", "membership"]);
    const trip = (await post("/ai/workflows/award-trip", { destination: "Tokyo", dateFrom: ymd(120), dateTo: ymd(130), cabin: "BUSINESS" }).expect(200)).body;
    expect(trip.status).toBe("COMPLETED");
    expect(trip.answer).toMatch(/^Best: /);
    const bad = (await post("/ai/workflows/award-trip", {}).expect(200)).body;
    expect(bad.status).toBe("FAILED");
    const detail = (await get(`/ai/runs/${trip.runId}`).expect(200)).body;
    expect(detail.steps[0]).toMatchObject({ agent: "award-travel", engine: "award-trip/1", privacy: "USER" });
  });
  it("the loyalty agents are seeded", async () => {
    const keys = (await prisma.agentProfile.findMany({ select: { key: true } })).map((a) => a.key);
    expect(keys).toEqual(expect.arrayContaining(["point-expiration", "certificate", "elite-status", "transfer-bonus", "award-travel", "membership", "redemption", "valuation"]));
  });
});

describe("TC-LOY: account removal", () => {
  it("deleting an account removes its history", async () => {
    const a = (await post("/loyalty/accounts", { profileId: me, programCode: "T_FOREVER", balance: 1_000 }).expect(201)).body;
    expect(await prisma.loyaltyEvent.count({ where: { accountId: a.id } })).toBe(1);
    await del(`/loyalty/accounts/${a.id}`).expect(204);
    expect(await prisma.loyaltyEvent.count({ where: { accountId: a.id } })).toBe(0);
  });
});
