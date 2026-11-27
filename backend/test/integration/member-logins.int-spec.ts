import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, register, uniqueEmail } from './helpers';

/** Household members with their own sign-in: invitation, scope, visibility, revocation, isolation (synthetic data). */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
const PASS = 'member-pass-123';

const tokenOf = (url: string) => url.split('/join/')[1];

async function proOwner() {
  const o = await register(app);
  await api(app).post(`${V}/subscription/checkout`).set(bearer(o.token)).send({ interval: 'month' }).expect(201);
  return o;
}
const addMember = async (t: string, body: object) => (await api(app).post(`${V}/household/members`).set(bearer(t)).send(body).expect(201)).body;
const invite = async (t: string, id: string) => (await api(app).post(`${V}/household/members/${id}/invite`).set(bearer(t)).expect(200)).body as { url: string; expiresAt: string; emailed: boolean };
const accept = (token: string, email: string, password = PASS) => api(app).post(`${V}/auth/accept-invite`).send({ token, email, password, name: 'Riley R' });
const cardId = async (slug: string) => (await prisma.creditCard.findUniqueOrThrow({ where: { slug } })).id;

beforeAll(async () => {
  app = await createApp();
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

async function household() {
  const owner = await proOwner();
  const hh = (await api(app).get(`${V}/household`).set(bearer(owner.token)).expect(200)).body;
  const primary = hh.members.find((m: any) => m.isPrimary);
  const riley = await addMember(owner.token, { nickname: 'Riley', relationship: 'SPOUSE', email: uniqueEmail('riley-on-file') });
  const sam = await addMember(owner.token, { nickname: 'Sam', relationship: 'PARENT' });
  return { owner, primary, riley, sam };
}

describe('TC-MEMBER: invitation', () => {
  it('creates a one-time link, shows it as invited, and never exposes ids or hashes', async () => {
    const { owner, riley } = await household();
    expect(riley.login).toMatchObject({ status: 'NONE', canHaveLogin: true, email: null });
    expect(riley).not.toHaveProperty('loginUserId');
    const inv = await invite(owner.token, riley.id);
    expect(inv.url).toMatch(/\/join\/[A-Za-z0-9_-]{40,}$/);
    expect(new Date(inv.expiresAt).getTime() - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    const list = (await api(app).get(`${V}/household/members`).set(bearer(owner.token)).expect(200)).body;
    const r = list.find((m: any) => m.id === riley.id);
    expect(r.login.status).toBe('INVITED');
    expect(JSON.stringify(list)).not.toContain(tokenOf(inv.url));
    // only the hash is stored
    expect(await prisma.memberInvite.count({ where: { tokenHash: tokenOf(inv.url) } })).toBe(0);
    const info = (await api(app).get(`${V}/auth/invite/${tokenOf(inv.url)}`).expect(200)).body;
    expect(info).toMatchObject({ nickname: 'Riley' });
    expect(Object.keys(info).sort()).toEqual(['expiresAt', 'household', 'nickname']);
  });

  it('a new invite replaces the old one; the owner cannot invite themselves; strangers get 404', async () => {
    const { owner, primary, riley } = await household();
    const a = await invite(owner.token, riley.id);
    const b = await invite(owner.token, riley.id);
    await api(app).get(`${V}/auth/invite/${tokenOf(a.url)}`).expect(404);
    await api(app).get(`${V}/auth/invite/${tokenOf(b.url)}`).expect(200);
    await api(app).post(`${V}/household/members/${primary.id}/invite`).set(bearer(owner.token)).expect(400);
    const stranger = await register(app);
    await api(app).post(`${V}/household/members/${riley.id}/invite`).set(bearer(stranger.token)).expect(404);
    await api(app).delete(`${V}/household/members/${riley.id}/invite`).set(bearer(owner.token)).expect(204);
    await api(app).get(`${V}/auth/invite/${tokenOf(b.url)}`).expect(404);
  });

  it('expired, revoked and garbage links are refused', async () => {
    const { owner, riley } = await household();
    const inv = await invite(owner.token, riley.id);
    await prisma.memberInvite.updateMany({ where: { profileId: riley.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await api(app).get(`${V}/auth/invite/${tokenOf(inv.url)}`).expect(404);
    await accept(tokenOf(inv.url), uniqueEmail('late')).expect(404);
    await api(app).get(`${V}/auth/invite/not-a-real-token-at-all-000000`).expect(404);
    await accept('x'.repeat(30), uniqueEmail('x')).expect(404);
  });

  it('accepting: weak passwords and existing addresses are refused without burning the link; it works once', async () => {
    const { owner, riley } = await household();
    const taken = await register(app);
    const t = tokenOf((await invite(owner.token, riley.id)).url);
    await accept(t, uniqueEmail('m'), 'short').expect(400);
    await accept(t, uniqueEmail('m'), 'onlyletterspassword').expect(400);
    await accept(t, taken.email).expect(409);
    const email = uniqueEmail('riley');
    const ok = await accept(t, email).expect(200);
    expect(ok.body.user).toMatchObject({ email, role: 'USER', member: { nickname: 'Riley', visibility: 'OWN' } });
    await accept(t, uniqueEmail('again')).expect(404);
    await api(app).get(`${V}/auth/invite/${t}`).expect(404);
    const list = (await api(app).get(`${V}/household/members`).set(bearer(owner.token)).expect(200)).body;
    expect(list.find((m: any) => m.id === riley.id).login).toMatchObject({ status: 'ACTIVE', email });
    // inviting someone who already has a sign-in is a conflict
    await api(app).post(`${V}/household/members/${riley.id}/invite`).set(bearer(owner.token)).expect(409);
  });

  it('two people racing for one link: exactly one wins', async () => {
    const { owner, riley } = await household();
    const t = tokenOf((await invite(owner.token, riley.id)).url);
    const results = await Promise.all([accept(t, uniqueEmail('r1')), accept(t, uniqueEmail('r2')), accept(t, uniqueEmail('r3'))]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await prisma.profile.count({ where: { id: riley.id, loginUserId: { not: null } } })).toBe(1);
  });
});

describe('TC-MEMBER: what a member sees', () => {
  async function joined() {
    const h = await household();
    const gold = await cardId('contoso-gold');
    const mine = (await api(app).post(`${V}/wallet/cards`).set(bearer(h.owner.token)).send({ cardId: gold, profileId: h.primary.id }).expect(201)).body;
    const rileys = (await api(app).post(`${V}/wallet/cards`).set(bearer(h.owner.token)).send({ cardId: gold, profileId: h.riley.id, lastFour: '4242' }).expect(201)).body;
    const sams = (await api(app).post(`${V}/wallet/cards`).set(bearer(h.owner.token)).send({ cardId: gold, profileId: h.sam.id }).expect(201)).body;
    const post = (path: string, body: object) => api(app).post(V + path).set(bearer(h.owner.token)).send(body);
    await post('/loyalty/accounts', { profileId: h.riley.id, programCode: 'T_AIR', accountNumber: 'AA123456789', balance: 5000 }).expect(201);
    await post('/loyalty/accounts', { profileId: h.primary.id, programCode: 'T_AIR', accountNumber: 'ZZ987654321', balance: 99999 }).expect(201);
    const email = uniqueEmail('riley');
    const t = tokenOf((await invite(h.owner.token, h.riley.id)).url);
    const res = (await accept(t, email).expect(200)).body;
    return { ...h, email, member: res.accessToken as string, refresh: res.refreshToken as string, memberUserId: res.user.id as string, mine, rileys, sams };
  }

  it('my view is pinned to the member: their cards, loyalty and nothing of the others', async () => {
    const j = await joined();
    const me = (await api(app).get(`${V}/member/me`).set(bearer(j.member)).expect(200)).body;
    expect(me).toMatchObject({ email: j.email, nickname: 'Riley', relationship: 'SPOUSE', visibility: 'OWN' });
    const ov = (await api(app).get(`${V}/member/overview`).set(bearer(j.member)).expect(200)).body;
    expect(ov.cards.counts.total).toBe(1);
    const ids = [...ov.cards.groups.active, ...ov.cards.groups.authorizedUser].map((c: any) => c.walletCardId ?? c.id);
    expect(ids).toEqual([j.rileys.id]);
    expect(ov.loyalty).toHaveLength(1);
    expect(ov.loyalty[0]).toMatchObject({ balance: 5000, accountLast4: '6789' });
    const text = JSON.stringify(ov);
    for (const secret of ['ZZ987654321', '99999', 'AA123456789', 'accountNumberEnc', j.mine.id, j.sams.id]) expect(text).not.toContain(secret);
  });

  it('everything else is denied to a member, and my view is denied to the owner', async () => {
    const j = await joined();
    for (const path of ['/household', '/household/members', '/wallet/cards', '/portfolio', '/benefits', '/notifications', '/me', '/offers/inventory', '/offers/savings', '/loyalty/accounts', '/spending', '/chief/command-center', '/copilot/settings']) {
      const r = await api(app).get(V + path).set(bearer(j.member));
      expect({ path, denied: [403, 404].includes(r.status) }).toEqual({ path, denied: true });
    }
    await api(app).get(`${V}/household`).set(bearer(j.member)).expect(403);
    await api(app).delete(`${V}/me`).set(bearer(j.member)).expect(403);
    await api(app).post(`${V}/household/members/${j.sam.id}/invite`).set(bearer(j.member)).expect(403);
    await api(app).get(`${V}/member/overview`).set(bearer(j.owner.token)).expect(403);
    await api(app).get(`${V}/member/overview`).expect(401);
  });

  it('the household overview needs HOUSEHOLD visibility, takes effect at once, and hides other members\' sign-ins', async () => {
    const j = await joined();
    await api(app).get(`${V}/member/household`).set(bearer(j.member)).expect(403);
    await api(app).patch(`${V}/household/members/${j.riley.id}`).set(bearer(j.owner.token)).send({ visibility: 'HOUSEHOLD' }).expect(200);
    const d = (await api(app).get(`${V}/member/household`).set(bearer(j.member)).expect(200)).body;
    expect(d.members.map((m: any) => m.profile.nickname).sort()).toEqual(['Riley', 'Sam', 'Test']);
    const text = JSON.stringify(d);
    expect(text).not.toContain(j.email);
    expect(text).not.toContain('"login"');
    expect(text).not.toContain(j.owner.email);
    // still read only: nothing writable is reachable
    await api(app).post(`${V}/household/members`).set(bearer(j.member)).send({ nickname: 'X' }).expect(403);
    await api(app).patch(`${V}/household/members/${j.riley.id}`).set(bearer(j.owner.token)).send({ visibility: 'OWN' }).expect(200);
    await api(app).get(`${V}/member/household`).set(bearer(j.member)).expect(403);
    await api(app).patch(`${V}/household/members/${j.riley.id}`).set(bearer(j.owner.token)).send({ visibility: 'EVERYTHING' }).expect(400);
  });

  it('the member has their own channels and no wallet, plan or household of their own', async () => {
    const j = await joined();
    expect(await prisma.wallet.count({ where: { userId: j.memberUserId } })).toBe(0);
    expect(await prisma.household.count({ where: { ownerId: j.memberUserId } })).toBe(0);
    expect(await prisma.subscription.count({ where: { userId: j.memberUserId } })).toBe(0);
    expect(await prisma.notificationPreference.count({ where: { userId: j.memberUserId } })).toBe(1);
    expect((await prisma.auditLog.findMany({ where: { entity: 'Profile', entityId: j.riley.id } })).map((a) => a.action).sort()).toEqual(['member.invite.created', 'member.login.created']);
  });

  it('the member signs in with their own password and can refresh', async () => {
    const j = await joined();
    const l = (await api(app).post(`${V}/auth/login`).send({ email: j.email, password: PASS }).expect(200)).body;
    expect(l.user.member).toMatchObject({ nickname: 'Riley' });
    await api(app).post(`${V}/auth/login`).send({ email: j.email, password: 'wrong-password-1' }).expect(401);
    const r = (await api(app).post(`${V}/auth/refresh`).send({ refreshToken: l.refreshToken }).expect(200)).body;
    await api(app).get(`${V}/member/me`).set(bearer(r.accessToken)).expect(200);
  });
});

describe('TC-MEMBER: revoking and deleting', () => {
  it('removing the sign-in locks the member out immediately, keeps their data, and allows a new invite', async () => {
    const h = await household();
    const gold = await cardId('contoso-gold');
    await api(app).post(`${V}/wallet/cards`).set(bearer(h.owner.token)).send({ cardId: gold, profileId: h.riley.id }).expect(201);
    const email = uniqueEmail('riley');
    const j = (await accept(tokenOf((await invite(h.owner.token, h.riley.id)).url), email).expect(200)).body;
    await api(app).get(`${V}/member/me`).set(bearer(j.accessToken)).expect(200);
    await api(app).delete(`${V}/household/members/${h.riley.id}/login`).set(bearer(h.owner.token)).expect(204);
    // the access token that was valid a moment ago is refused straight away
    await api(app).get(`${V}/member/me`).set(bearer(j.accessToken)).expect(401);
    await api(app).post(`${V}/auth/refresh`).send({ refreshToken: j.refreshToken }).expect(401);
    await api(app).post(`${V}/auth/login`).send({ email, password: PASS }).expect(401);
    expect(await prisma.user.count({ where: { email } })).toBe(0);
    // the household still has Riley and Riley's card
    const list = (await api(app).get(`${V}/household/members`).set(bearer(h.owner.token)).expect(200)).body;
    expect(list.find((m: any) => m.id === h.riley.id)).toMatchObject({ login: { status: 'NONE' } });
    expect(await prisma.walletCard.count({ where: { profileId: h.riley.id } })).toBe(1);
    await api(app).delete(`${V}/household/members/${h.riley.id}/login`).set(bearer(h.owner.token)).expect(404);
    await invite(h.owner.token, h.riley.id);
  });

  it("another owner cannot remove or reach someone else's member sign-in", async () => {
    const h = await household();
    const j = (await accept(tokenOf((await invite(h.owner.token, h.riley.id)).url), uniqueEmail('riley')).expect(200)).body;
    const stranger = await register(app);
    await api(app).delete(`${V}/household/members/${h.riley.id}/login`).set(bearer(stranger.token)).expect(404);
    await api(app).patch(`${V}/household/members/${h.riley.id}`).set(bearer(stranger.token)).send({ visibility: 'HOUSEHOLD' }).expect(404);
    await api(app).get(`${V}/member/me`).set(bearer(j.accessToken)).expect(200);
  });

  it('deleting the member, or the whole account, removes the sign-ins with it', async () => {
    const h = await household();
    const a = (await accept(tokenOf((await invite(h.owner.token, h.riley.id)).url), uniqueEmail('a')).expect(200)).body;
    const b = (await accept(tokenOf((await invite(h.owner.token, h.sam.id)).url), uniqueEmail('b')).expect(200)).body;
    await api(app).delete(`${V}/household/members/${h.riley.id}`).set(bearer(h.owner.token)).expect(204);
    await api(app).get(`${V}/member/me`).set(bearer(a.accessToken)).expect(401);
    expect(await prisma.user.count({ where: { id: a.user.id } })).toBe(0);
    await api(app).delete(`${V}/me`).set(bearer(h.owner.token)).expect(204);
    await api(app).get(`${V}/member/me`).set(bearer(b.accessToken)).expect(401);
    expect(await prisma.user.count({ where: { id: b.user.id } })).toBe(0);
  });

  it('the legacy profile delete also removes the sign-in', async () => {
    const h = await household();
    const a = (await accept(tokenOf((await invite(h.owner.token, h.riley.id)).url), uniqueEmail('a')).expect(200)).body;
    await api(app).delete(`${V}/me/profiles/${h.riley.id}`).set(bearer(h.owner.token)).expect(204);
    expect(await prisma.user.count({ where: { id: a.user.id } })).toBe(0);
  });
});
