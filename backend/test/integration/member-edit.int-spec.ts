import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JobsService } from '../../src/jobs/jobs.service';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { api, bearer, createApp, register, uniqueEmail } from './helpers';

/** Members who may edit their own cards and points, and the owner's mute for notifications about a member (synthetic data). */
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

const cardId = async (slug: string) => (await prisma.creditCard.findUniqueOrThrow({ where: { slug } })).id;

async function join(owner: string, memberId: string) {
  const inv = (await api(app).post(`${V}/household/members/${memberId}/invite`).set(bearer(owner)).expect(200)).body;
  const j = (await api(app).post(`${V}/auth/accept-invite`).send({ token: inv.url.split('/join/')[1], email: uniqueEmail('m'), password: 'member-pass-12345' }).expect(200)).body;
  return { token: j.accessToken as string, userId: j.user.id as string };
}

/** Owner, Riley (own sign-in), Sam (none), Kid (a child with a sign-in). Each holds one card. */
async function household() {
  const owner = await register(app);
  await api(app).post(`${V}/subscription/checkout`).set(bearer(owner.token)).send({ interval: 'month' }).expect(201);
  const hh = (await api(app).get(`${V}/household`).set(bearer(owner.token)).expect(200)).body;
  const primary = hh.members.find((m: any) => m.isPrimary);
  const riley = (await api(app).post(`${V}/household/members`).set(bearer(owner.token)).send({ nickname: 'Riley', relationship: 'SPOUSE' }).expect(201)).body;
  const sam = (await api(app).post(`${V}/household/members`).set(bearer(owner.token)).send({ nickname: 'Sam', relationship: 'PARENT' }).expect(201)).body;
  const kid = (await api(app).post(`${V}/household/members`).set(bearer(owner.token)).send({ nickname: 'Kid', relationship: 'CHILD', birthYear: 2012 }).expect(201)).body;
  const gold = await cardId('contoso-gold');
  const opened = new Date(Date.now() - 365 * DAY + 10 * DAY).toISOString();
  const add = async (profileId: string, lastFour: string) => (await api(app).post(`${V}/wallet/cards`).set(bearer(owner.token)).send({ cardId: gold, profileId, lastFour, approvedAt: opened }).expect(201)).body.id as string;
  const ownerCard = await add(primary.id, '1111');
  const rileyCard = await add(riley.id, '2222');
  const samCard = await add(sam.id, '3333');
  const r = await join(owner.token, riley.id);
  const k = await join(owner.token, kid.id);
  const allow = (id: string, body: object) => api(app).patch(`${V}/household/members/${id}`).set(bearer(owner.token)).send(body);
  return { owner, primary, riley, sam, kid, ownerCard, rileyCard, samCard, member: r.token, memberUserId: r.userId, kidToken: k.token, allow, gold };
}
const post = (t: string, path: string, body: object = {}) => api(app).post(V + path).set(bearer(t)).send(body);
const patch = (t: string, path: string, body: object = {}) => api(app).patch(V + path).set(bearer(t)).send(body);
const del = (t: string, path: string) => api(app).delete(V + path).set(bearer(t));
const get = (t: string, path: string) => api(app).get(V + path).set(bearer(t));
const list = async (t: string) => (await get(t, '/notifications').expect(200)).body as Array<{ type: string; title: string }>;

describe('TC-MEDIT: members who may edit their own cards and points', () => {
  it('is off by default; the owner switches it on per member, and only for a member with their own sign-in', async () => {
    const h = await household();
    await post(h.member, '/member/cards', { cardId: h.gold }).expect(403);
    await post(h.member, '/member/loyalty/accounts', { programCode: 'MAR_BONVOY' }).expect(403);
    expect((await get(h.member, '/member/me').expect(200)).body.canEdit).toBe(false);
    await h.allow(h.sam.id, { canEdit: true }).expect(400);
    expect((await h.allow(h.riley.id, { canEdit: true }).expect(200)).body).toMatchObject({ canEdit: true });
    // live: no new sign-in needed
    expect((await get(h.member, '/member/me').expect(200)).body.canEdit).toBe(true);
    const members = (await get(h.owner.token, '/household/members').expect(200)).body;
    expect(members.find((m: any) => m.id === h.riley.id)).toMatchObject({ canEdit: true, notifyOwner: true });
    // and off again, at once
    await h.allow(h.riley.id, { canEdit: false }).expect(200);
    await post(h.member, '/member/cards', { cardId: h.gold }).expect(403);
  });

  it('adds, edits and removes their own card; it lands on their profile and nobody else\'s', async () => {
    const h = await household();
    await h.allow(h.riley.id, { canEdit: true }).expect(200);
    const created = (await post(h.member, '/member/cards', { cardId: h.gold, lastFour: '5555', nickname: 'My gold', approvedAt: new Date(Date.now() - 30 * DAY).toISOString() }).expect(201)).body;
    expect(created).toMatchObject({ profileId: h.riley.id, lastFour: '5555', nickname: 'My gold' });
    // it is in the owner's account, on Riley, with its catalog benefits tracked
    const row = await prisma.walletCard.findUniqueOrThrow({ where: { id: created.id }, include: { wallet: true } });
    expect(row.wallet.userId).toBe(h.owner.userId);
    expect(await prisma.userBenefit.count({ where: { walletCardId: created.id } })).toBeGreaterThan(0);
    const ov = (await get(h.member, '/member/overview').expect(200)).body;
    expect(ov.cards.counts.total).toBe(2);
    // the profile is not theirs to choose
    await post(h.member, '/member/cards', { cardId: h.gold, profileId: h.sam.id }).expect(400);
    await patch(h.member, `/member/cards/${created.id}`, { profileId: h.sam.id }).expect(400);
    // edit and remove
    expect((await patch(h.member, `/member/cards/${created.id}`, { nickname: 'Renamed', lastFour: '6666' }).expect(200)).body).toMatchObject({ nickname: 'Renamed', lastFour: '6666' });
    await del(h.member, `/member/cards/${created.id}`).expect(204);
    expect(await prisma.walletCard.count({ where: { id: created.id } })).toBe(0);
    // everything was recorded under the member
    const actions = (await prisma.auditLog.findMany({ where: { actorId: h.memberUserId, entity: 'WalletCard' } })).map((a) => a.action).sort();
    expect(actions).toEqual(['member.card.added', 'member.card.removed', 'member.card.updated']);
  });

  it('cannot touch anyone else\'s card, even with a valid id; the child rule still holds', async () => {
    const h = await household();
    await h.allow(h.riley.id, { canEdit: true }).expect(200);
    for (const id of [h.ownerCard, h.samCard]) {
      await patch(h.member, `/member/cards/${id}`, { nickname: 'mine now' }).expect(404);
      await del(h.member, `/member/cards/${id}`).expect(404);
    }
    expect(await prisma.walletCard.count({ where: { id: { in: [h.ownerCard, h.samCard] } } })).toBe(2);
    // the general wallet routes stay closed
    await post(h.member, '/wallet/cards', { cardId: h.gold }).expect(403);
    await patch(h.member, `/wallet/cards/${h.rileyCard}`, { nickname: 'x' }).expect(403);
    // a child can only hold authorized-user cards
    await h.allow(h.kid.id, { canEdit: true }).expect(200);
    await post(h.kidToken, '/member/cards', { cardId: h.gold }).expect(400);
    await post(h.kidToken, '/member/cards', { cardId: h.gold, cardholder: 'AUTHORIZED_USER' }).expect(201);
    // another household's member cannot touch these either
    const other = await household();
    await other.allow(other.riley.id, { canEdit: true }).expect(200);
    await patch(other.member, `/member/cards/${h.rileyCard}`, { nickname: 'x' }).expect(404);
  });

  it('adds, edits and removes their own loyalty account, and logs credit usage on their own benefits only', async () => {
    const h = await household();
    await h.allow(h.riley.id, { canEdit: true }).expect(200);
    const programs = (await get(h.member, '/member/loyalty/programs').expect(200)).body;
    expect(programs.programs.some((p: any) => p.code === 'MAR_BONVOY')).toBe(true);
    const acct = (await post(h.member, '/member/loyalty/accounts', { programCode: 'MAR_BONVOY', accountNumber: 'MB000012345', balance: 12_000 }).expect(201)).body;
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: acct.id } })).profileId).toBe(h.riley.id);
    await post(h.member, '/member/loyalty/accounts', { programCode: 'MAR_BONVOY', profileId: h.sam.id }).expect(400);
    expect((await patch(h.member, `/member/loyalty/accounts/${acct.id}`, { balance: 15_000 }).expect(200)).body).toMatchObject({ balance: 15_000 });
    // someone else's account is not found
    const owners = (await post(h.owner.token, '/loyalty/accounts', { profileId: h.primary.id, programCode: 'MAR_BONVOY', accountNumber: 'MB000099999', balance: 1 }).expect(201)).body;
    await patch(h.member, `/member/loyalty/accounts/${owners.id}`, { balance: 2 }).expect(404);
    await del(h.member, `/member/loyalty/accounts/${owners.id}`).expect(404);
    await del(h.member, `/member/loyalty/accounts/${acct.id}`).expect(204);

    // benefit usage: hers is allowed, the owner's is not
    const mine = await prisma.userBenefit.findFirstOrThrow({ where: { walletCardId: h.rileyCard, amountPerPeriodCents: { gt: 100 } } });
    const theirs = await prisma.userBenefit.findFirstOrThrow({ where: { walletCardId: h.ownerCard } });
    await post(h.member, `/member/benefits/${mine.id}/usage`, { amountCents: 100 }).expect(201);
    expect(await prisma.benefitUsage.count({ where: { userBenefitId: mine.id } })).toBe(1);
    await post(h.member, `/member/benefits/${theirs.id}/usage`, { amountCents: 100 }).expect(404);
    const usage = await prisma.benefitUsage.findFirstOrThrow({ where: { userBenefitId: mine.id } });
    await del(h.member, `/member/benefits/${mine.id}/usage/${usage.id}`).expect(204);
    expect(await prisma.benefitUsage.count({ where: { userBenefitId: mine.id } })).toBe(0);
    // the general routes stay closed
    await post(h.member, `/benefits/${mine.id}/usage`, { amountCents: 100 }).expect(403);
    await post(h.member, '/loyalty/accounts', { profileId: h.riley.id, programCode: 'MAR_BONVOY' }).expect(403);
  });

  it('removing the sign-in takes the permission away with it', async () => {
    const h = await household();
    await h.allow(h.riley.id, { canEdit: true, notifyOwner: false }).expect(200);
    await del(h.owner.token, `/household/members/${h.riley.id}/login`).expect(204);
    const p = await prisma.profile.findUniqueOrThrow({ where: { id: h.riley.id } });
    expect(p).toMatchObject({ canEdit: false, notifyOwner: true, loginUserId: null });
  });
});

describe('TC-MMUTE: the owner stops hearing about a member', () => {
  it('only for a member with their own sign-in, and the member still hears about their own items', async () => {
    const h = await household();
    await h.allow(h.sam.id, { notifyOwner: false }).expect(400);
    expect((await h.allow(h.riley.id, { notifyOwner: false }).expect(200)).body).toMatchObject({ notifyOwner: false });
    await jobs.run('scan-renewals');
    // the owner is told about their own card and Sam's, not Riley's; Riley is told about hers
    expect((await list(h.owner.token)).filter((n) => n.type === 'CARD_RENEWAL')).toHaveLength(2);
    expect((await list(h.member)).filter((n) => n.type === 'CARD_RENEWAL')).toHaveLength(1);
  });

  it('applies to credits about to reset too, while the member still gets theirs', async () => {
    const h = await household();
    await h.allow(h.riley.id, { notifyOwner: false }).expect(200);
    await post(h.owner.token, '/benefits', { walletCardId: h.rileyCard, name: 'Riley monthly credit', period: 'MONTHLY', amountPerPeriodCents: 5000, howIssued: 'Statement credit' }).expect(201);
    await post(h.owner.token, '/benefits', { walletCardId: h.ownerCard, name: 'Owner monthly credit', period: 'MONTHLY', amountPerPeriodCents: 5000, howIssued: 'Statement credit' }).expect(201);
    const now = new Date();
    await jobs.run('scan-benefit-expirations', new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 12)));
    const owner = (await list(h.owner.token)).filter((n) => n.type === 'BENEFIT_EXPIRING').map((n) => n.title);
    expect(owner.some((t) => t.includes('Owner monthly credit'))).toBe(true);
    expect(owner.some((t) => t.includes('Riley monthly credit'))).toBe(false);
    const mine = (await list(h.member)).filter((n) => n.type === 'BENEFIT_EXPIRING').map((n) => n.title);
    expect(mine.some((t) => t.includes('Riley monthly credit'))).toBe(true);
  });

  it('is undone by switching it back on, and nothing else about the owner changes', async () => {
    const h = await household();
    await h.allow(h.riley.id, { notifyOwner: false }).expect(200);
    const first = await notif.notify(h.owner.userId, 'OFFER_EXPIRING', 'Muted', 'x', '/offers', `mute-${h.rileyCard}`, { profileId: h.riley.id });
    expect(first).toBeNull();
    await h.allow(h.riley.id, { notifyOwner: true }).expect(200);
    const second = await notif.notify(h.owner.userId, 'OFFER_EXPIRING', 'Heard again', 'x', '/offers', `unmute-${h.rileyCard}`, { profileId: h.riley.id });
    expect(second).toBeTruthy();
    expect((await list(h.owner.token)).map((n) => n.title)).toEqual(['Heard again']);
    // an item about Sam (no sign-in) or about nobody in particular is untouched by Riley's mute
    await h.allow(h.riley.id, { notifyOwner: false }).expect(200);
    await notif.notify(h.owner.userId, 'OFFER_EXPIRING', 'About Sam', 'x', '/offers', `sam-${h.samCard}`, { profileId: h.sam.id });
    await notif.notify(h.owner.userId, 'SYSTEM', 'Household notice', 'x');
    expect((await list(h.owner.token)).map((n) => n.title).sort()).toEqual(['About Sam', 'Heard again', 'Household notice']);
  });

  it('a member cannot change either setting for themselves', async () => {
    const h = await household();
    await patch(h.member, `/household/members/${h.riley.id}`, { canEdit: true }).expect(403);
    await patch(h.member, `/household/members/${h.riley.id}`, { notifyOwner: false }).expect(403);
    expect(await prisma.profile.findUniqueOrThrow({ where: { id: h.riley.id } })).toMatchObject({ canEdit: false, notifyOwner: true });
  });
});
