import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JobsService } from '../../src/jobs/jobs.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { api, bearer, createApp, register, uniqueEmail } from './helpers';

/** Household members' own notifications, preferences, push and briefings (synthetic data). */
const V = '/api/v1';
const prisma = new PrismaClient();
const DAY = 86_400_000;
let app: INestApplication;
let jobs: JobsService;
let notif: NotificationsService;

beforeAll(async () => {
  app = await createApp();
  jobs = app.get(JobsService);
  notif = app.get(NotificationsService);
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

/**
 * An owner with a spouse who has their own sign-in and a parent without one. Every card renews in about ten days, so each person has
 * something due: the owner's own card, Riley's card, and Sam's card.
 */
async function household() {
  const owner = await register(app);
  await api(app).post(`${V}/subscription/checkout`).set(bearer(owner.token)).send({ interval: 'month' }).expect(201);
  const hh = (await api(app).get(`${V}/household`).set(bearer(owner.token)).expect(200)).body;
  const primary = hh.members.find((m: any) => m.isPrimary);
  const riley = (await api(app).post(`${V}/household/members`).set(bearer(owner.token)).send({ nickname: 'Riley', relationship: 'SPOUSE' }).expect(201)).body;
  const sam = (await api(app).post(`${V}/household/members`).set(bearer(owner.token)).send({ nickname: 'Sam', relationship: 'PARENT' }).expect(201)).body;
  const gold = await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } });
  expect(gold.annualFeeCents).toBeGreaterThan(0);
  const opened = new Date(Date.now() - 365 * DAY + 10 * DAY).toISOString();
  const add = async (profileId: string, lastFour: string) =>
    (await api(app).post(`${V}/wallet/cards`).set(bearer(owner.token)).send({ cardId: gold.id, profileId, lastFour, approvedAt: opened }).expect(201)).body.id as string;
  const ownerCard = await add(primary.id, '1111');
  const rileyCard = await add(riley.id, '2222');
  const samCard = await add(sam.id, '3333');
  const inv = (await api(app).post(`${V}/household/members/${riley.id}/invite`).set(bearer(owner.token)).expect(200)).body;
  const email = uniqueEmail('riley');
  const j = (await api(app).post(`${V}/auth/accept-invite`).send({ token: inv.url.split('/join/')[1], email, password: 'riley-pass-12345', name: 'Riley' }).expect(200)).body;
  const ids = (userId: string) => ({ userId });
  return { owner, primary, riley, sam, ownerCard, rileyCard, samCard, member: j.accessToken as string, memberUserId: j.user.id as string, ids };
}

const list = async (t: string, extra = '') => (await api(app).get(`${V}/notifications${extra}`).set(bearer(t)).expect(200)).body as Array<{ id: string; type: string; title: string; body: string; link: string | null; readAt: string | null; deferredAt: string | null }>;

describe("TC-MNOTE: a member's own notifications", () => {
  it('a household item reaches the member whose card it is, and only them; the owner still gets everything', async () => {
    const h = await household();
    await jobs.run('scan-renewals');
    const mine = (await list(h.member)).filter((n) => n.type === 'CARD_RENEWAL');
    expect(mine).toHaveLength(1);
    expect(mine[0].link).toBe('/my');
    const owners = (await list(h.owner.token)).filter((n) => n.type === 'CARD_RENEWAL');
    // the owner is told about all three cards (own, Riley's, Sam's)
    expect(owners).toHaveLength(3);
    // nothing for Sam (no sign-in) and no second copy for the owner's own card
    expect(await prisma.notification.count({ where: { userId: h.memberUserId } })).toBe(1);
    // running the job again adds nothing
    await jobs.run('scan-renewals');
    expect((await list(h.member)).filter((n) => n.type === 'CARD_RENEWAL')).toHaveLength(1);
    expect((await list(h.owner.token)).filter((n) => n.type === 'CARD_RENEWAL')).toHaveLength(3);
  });

  it("the member's own switches decide what they get", async () => {
    const h = await household();
    const prefs = (await api(app).put(`${V}/notifications/preferences`).set(bearer(h.member)).send({ cardRenewal: false }).expect(200)).body;
    expect(prefs).toMatchObject({ cardRenewal: false });
    await jobs.run('scan-renewals');
    expect((await list(h.member)).filter((n) => n.type === 'CARD_RENEWAL')).toHaveLength(0);
    expect((await list(h.owner.token)).filter((n) => n.type === 'CARD_RENEWAL')).toHaveLength(3);
    // the member's choice is theirs: the owner's own preferences are untouched
    expect((await api(app).get(`${V}/notifications/preferences`).set(bearer(h.owner.token)).expect(200)).body.cardRenewal).toBe(true);
  });

  it("the member's own Quiet Mode holds their routine updates; critical ones and briefings still arrive", async () => {
    const h = await household();
    await api(app).put(`${V}/notifications/preferences`).set(bearer(h.member)).send({ quietMode: true }).expect(200);
    await notif.notify(h.owner.userId, 'OFFER_EXPIRING', 'Offer ends soon', 'A routine update', '/offers', `t-${h.rileyCard}`, { profileId: h.riley.id });
    await notif.notify(h.owner.userId, 'CARD_RENEWAL', 'A fee posts soon', 'Critical', '/wallet', `c-${h.rileyCard}`, { profileId: h.riley.id });
    expect((await list(h.member)).map((n) => n.type)).toEqual(['CARD_RENEWAL']);
    expect((await list(h.member, '?includeDeferred=true')).map((n) => n.type).sort()).toEqual(['CARD_RENEWAL', 'OFFER_EXPIRING']);
    expect((await api(app).get(`${V}/notifications/unread-count`).set(bearer(h.member)).expect(200)).body.count).toBe(1);
    // the owner is not in Quiet Mode, so they got both at once
    expect((await list(h.owner.token)).map((n) => n.type).sort()).toEqual(['CARD_RENEWAL', 'OFFER_EXPIRING']);
  });

  it('marking read is private: a member sees, reads and clears only their own', async () => {
    const h = await household();
    await jobs.run('scan-renewals');
    const mine = (await list(h.member))[0];
    const ownerNote = (await list(h.owner.token))[0];
    await api(app).post(`${V}/notifications/${ownerNote.id}/read`).set(bearer(h.member)).expect(404);
    await api(app).post(`${V}/notifications/${mine.id}/read`).set(bearer(h.owner.token)).expect(404);
    await api(app).post(`${V}/notifications/${mine.id}/read`).set(bearer(h.member)).expect(204);
    expect((await api(app).get(`${V}/notifications/unread-count`).set(bearer(h.member)).expect(200)).body.count).toBe(0);
    expect((await api(app).get(`${V}/notifications/unread-count`).set(bearer(h.owner.token)).expect(200)).body.count).toBeGreaterThan(0);
    await api(app).post(`${V}/notifications/read-all`).set(bearer(h.member)).expect(204);
  });

  it("a credit about to reset also reaches the member whose card it is, on their own switch", async () => {
    const h = await household();
    const credit = async (card: string, name: string) =>
      (await api(app).post(`${V}/benefits`).set(bearer(h.owner.token)).send({ walletCardId: card, name, period: 'MONTHLY', amountPerPeriodCents: 5000, howIssued: 'Statement credit' }).expect(201)).body.id as string;
    const rileysCredit = await credit(h.rileyCard, 'Riley monthly credit');
    const ownersCredit = await credit(h.ownerCard, 'Owner monthly credit');
    const now = new Date();
    const lastDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 12));
    await jobs.run('scan-benefit-expirations', lastDay);
    const mine = (await list(h.member)).filter((n) => n.type === 'BENEFIT_EXPIRING');
    // her card's catalog credits are due too; what matters is that hers is there, the owner's is not, and all point at her own view
    expect(mine.filter((n) => n.title.includes('Riley monthly credit'))).toHaveLength(1);
    expect(mine.some((n) => n.title.includes('Owner monthly credit'))).toBe(false);
    expect(mine.every((n) => n.link === '/my')).toBe(true);
    const before = mine.length;
    // the owner heard about both credits; the member heard only about theirs
    const owner = (await list(h.owner.token)).filter((n) => n.type === 'BENEFIT_EXPIRING' && /monthly credit/.test(n.title));
    expect(owner.map((n) => n.title).sort()).toEqual(['Owner monthly credit expires today', 'Riley monthly credit expires today']);
    expect(rileysCredit).not.toBe(ownersCredit);
    // running it again repeats nothing
    await jobs.run('scan-benefit-expirations', lastDay);
    expect((await list(h.member)).filter((n) => n.type === 'BENEFIT_EXPIRING')).toHaveLength(before);

    // a member who switched benefit alerts off hears nothing, and the owner still does
    const off = await household();
    await api(app).put(`${V}/notifications/preferences`).set(bearer(off.member)).send({ benefitExpiring: false }).expect(200);
    await api(app).post(`${V}/benefits`).set(bearer(off.owner.token)).send({ walletCardId: off.rileyCard, name: 'Quiet credit', period: 'MONTHLY', amountPerPeriodCents: 5000, howIssued: 'Statement credit' }).expect(201);
    await jobs.run('scan-benefit-expirations', lastDay);
    expect((await list(off.member)).filter((n) => n.type === 'BENEFIT_EXPIRING')).toHaveLength(0);
    expect((await list(off.owner.token)).filter((n) => n.type === 'BENEFIT_EXPIRING' && /Quiet credit/.test(n.title))).toHaveLength(1);
  });

  it('the push routes are open to a member and behave exactly as for the owner (push is not configured in this environment)', async () => {
    const h = await household();
    const body = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' } };
    for (const t of [h.owner.token, h.member]) {
      expect((await api(app).get(`${V}/notifications/push/key`).set(bearer(t)).expect(200)).body).toEqual({ publicKey: null });
      await api(app).post(`${V}/notifications/push/subscriptions`).set(bearer(t)).send(body).expect(400);
      await api(app).delete(`${V}/notifications/push/subscriptions`).set(bearer(t)).send({ endpoint: body.endpoint }).expect(204);
    }
    expect(await prisma.pushSubscription.count({ where: { userId: h.memberUserId } })).toBe(0);
  });

  it('removing the sign-in removes the member\'s notifications; the owner keeps theirs', async () => {
    const h = await household();
    await jobs.run('scan-renewals');
    await api(app).delete(`${V}/household/members/${h.riley.id}/login`).set(bearer(h.owner.token)).expect(204);
    expect(await prisma.notification.count({ where: { userId: h.memberUserId } })).toBe(0);
    expect((await list(h.owner.token)).filter((n) => n.type === 'CARD_RENEWAL')).toHaveLength(3);
  });
});

describe("TC-MBRIEF: a member's own briefing", () => {
  it('is built from their own cards only, stored under their own sign-in, and listed', async () => {
    const h = await household();
    const r = (await api(app).post(`${V}/member/briefings`).set(bearer(h.member)).send({ kind: 'DAILY' }).expect(200)).body;
    expect(r.briefing).toBeTruthy();
    const b = r.briefing.content;
    expect(b).toMatchObject({ kind: 'DAILY' });
    expect(b.headline).toContain('Riley');
    const text = JSON.stringify(b);
    expect(text).toMatch(/renews/);
    // one renewal: Riley's card, never the owner's or Sam's
    const lines = b.sections.flatMap((s: any) => s.lines).filter((l: any) => /renews/.test(l.text));
    expect(lines).toHaveLength(1);
    const stored = (await api(app).get(`${V}/member/briefings`).set(bearer(h.member)).expect(200)).body;
    expect(stored).toHaveLength(1);
    // the same day returns the same one; the owner sees none of it
    const again = (await api(app).post(`${V}/member/briefings`).set(bearer(h.member)).send({ kind: 'DAILY' }).expect(200)).body;
    expect(again.briefing.id).toBe(r.briefing.id);
    expect(await prisma.copilotBriefing.count({ where: { userId: h.owner.userId } })).toBe(0);
  });

  it('a weekly summary is available too, and a bad kind is refused', async () => {
    const h = await household();
    const w = (await api(app).post(`${V}/member/briefings`).set(bearer(h.member)).send({ kind: 'WEEKLY' }).expect(200)).body;
    expect(w.briefing.content).toMatchObject({ kind: 'WEEKLY' });
    await api(app).post(`${V}/member/briefings`).set(bearer(h.member)).send({ kind: 'MONTHLY' }).expect(400);
  });

  it('a member with nothing due gets no daily briefing instead of an empty one', async () => {
    const owner = await register(app);
    await api(app).post(`${V}/subscription/checkout`).set(bearer(owner.token)).send({ interval: 'month' }).expect(201);
    const riley = (await api(app).post(`${V}/household/members`).set(bearer(owner.token)).send({ nickname: 'Riley', relationship: 'SPOUSE' }).expect(201)).body;
    const inv = (await api(app).post(`${V}/household/members/${riley.id}/invite`).set(bearer(owner.token)).expect(200)).body;
    const j = (await api(app).post(`${V}/auth/accept-invite`).send({ token: inv.url.split('/join/')[1], email: uniqueEmail('r'), password: 'riley-pass-12345' }).expect(200)).body;
    const r = (await api(app).post(`${V}/member/briefings`).set(bearer(j.accessToken)).send({ kind: 'DAILY' }).expect(200)).body;
    expect(r.briefing).toBeNull();
    expect(r.message).toMatch(/Nothing is due/);
  });

  it('the scheduled job makes it once per day, announces it once, and respects the member\'s own switch', async () => {
    const h = await household();
    await jobs.run('member-daily');
    const first = (await list(h.member)).filter((n) => n.title === 'Your daily briefing');
    expect(first).toHaveLength(1);
    expect(first[0].link).toBe('/my');
    await jobs.run('member-daily');
    expect((await list(h.member)).filter((n) => n.title === 'Your daily briefing')).toHaveLength(1);
    expect(await prisma.copilotBriefing.count({ where: { userId: h.memberUserId, kind: 'DAILY' } })).toBe(1);

    const other = await household();
    await api(app).put(`${V}/notifications/preferences`).set(bearer(other.member)).send({ briefingDaily: false }).expect(200);
    await jobs.run('member-daily');
    expect((await list(other.member)).filter((n) => n.title === 'Your daily briefing')).toHaveLength(0);
    expect(await prisma.copilotBriefing.count({ where: { userId: other.memberUserId } })).toBe(0);
  });

  it("the weekly job announces a weekly summary", async () => {
    const h = await household();
    await jobs.run('member-weekly');
    expect((await list(h.member)).filter((n) => n.title === 'Your weekly briefing')).toHaveLength(1);
  });

  it('the owner has no member briefings, and a member cannot reach the household briefings or the Chief of Staff', async () => {
    const h = await household();
    await api(app).get(`${V}/member/briefings`).set(bearer(h.owner.token)).expect(403);
    await api(app).post(`${V}/member/briefings`).set(bearer(h.owner.token)).send({ kind: 'DAILY' }).expect(403);
    for (const p of ['/copilot/briefings', '/chief/overview', '/copilot/settings']) {
      const r = await api(app).get(V + p).set(bearer(h.member));
      expect([403, 404]).toContain(r.status);
    }
    await api(app).get(`${V}/member/briefings`).expect(401);
  });
});
