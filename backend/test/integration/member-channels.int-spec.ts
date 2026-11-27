import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { MailboxService } from '../../src/mailbox/mailbox.service';
import { MailboxConnector } from '../../src/mailbox/connector';
import { api, bearer, createApp, register, uniqueEmail } from './helpers';

/** Household members' own mailboxes and alert addresses: scoped to their own cards and accounts (synthetic data). */
const V = '/api/v1';
const prisma = new PrismaClient();
const SECRET = process.env.INBOUND_EMAIL_SECRET as string;
let app: INestApplication;
let svc: MailboxService;
const now = new Date();
const longDate = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
let seq = 0;

const mime = (o: { from: string; subject: string; text: string; dkim: string }) =>
  Buffer.from(
    [
      `Authentication-Results: mx.pointwise.test; dkim=pass header.d=${o.dkim}; spf=pass`,
      `From: ${o.from}`,
      'To: Jo <jo@gmail.example>',
      `Subject: ${o.subject}`,
      // dated at send time (a few seconds ahead is clamped to now), so it is newer than the account the test just made
      `Date: ${new Date(Date.now() + 5000).toUTCString()}`,
      `Message-ID: <mc${Date.now()}-${seq++}@test.example>`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      '',
      o.text,
    ].join('\r\n'),
  );
const chaseAlert = (amount: string, digits: string) =>
  mime({
    from: 'Chase <no.reply.alerts@chase.com>',
    subject: 'Your card was used',
    dkim: 'chase.com',
    text: `You made a $${amount} transaction with UBER *TRIP on ${longDate} at 8:14 PM ET. Account ending in (...${digits})`,
  });
const bonvoy = (balance: string) =>
  mime({
    from: 'Marriott Bonvoy <no-reply@e.marriott.com>',
    subject: 'Your Bonvoy points',
    dkim: 'marriott.com',
    text: `Hello. Your current points balance is ${balance}.`,
  });
const deliver = (raw: Buffer, to: string) =>
  api(app).post(`${V}/inbound/email`).set('x-inbound-secret', SECRET).set('x-envelope-to', to).set('content-type', 'message/rfc822').send(raw);
const status = async (t: string) => (await api(app).get(`${V}/capture/status`).set(bearer(t)).expect(200)).body;

beforeAll(async () => {
  process.env.MAILBOX_ALLOW_PRIVATE_HOSTS = 'true';
  app = await createApp();
  svc = app.get(MailboxService);
});
afterAll(async () => {
  delete process.env.MAILBOX_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await prisma.$disconnect();
});

/** An owner with a spouse who has their own sign-in, and a parent without one. Owner and spouse BOTH have a card ending 4321 and a Bonvoy account. */
async function household() {
  const owner = await register(app);
  await api(app).post(`${V}/subscription/checkout`).set(bearer(owner.token)).send({ interval: 'month' }).expect(201);
  const hh = (await api(app).get(`${V}/household`).set(bearer(owner.token)).expect(200)).body;
  const primary = hh.members.find((m: any) => m.isPrimary);
  const riley = (await api(app).post(`${V}/household/members`).set(bearer(owner.token)).send({ nickname: 'Riley', relationship: 'SPOUSE' }).expect(201)).body;
  const sam = (await api(app).post(`${V}/household/members`).set(bearer(owner.token)).send({ nickname: 'Sam', relationship: 'PARENT' }).expect(201)).body;
  const gold = (await prisma.creditCard.findUniqueOrThrow({ where: { slug: 'contoso-gold' } })).id;
  const opened = new Date(now.getTime() - 40 * 86_400_000).toISOString();
  const add = async (profileId: string, lastFour: string) =>
    (await api(app).post(`${V}/wallet/cards`).set(bearer(owner.token)).send({ cardId: gold, profileId, lastFour, approvedAt: opened }).expect(201)).body.id as string;
  const ownerCard = await add(primary.id, '4321');
  const rileyCard = await add(riley.id, '4321');
  const samCard = await add(sam.id, '7777');
  const acct = async (profileId: string, balance: number) =>
    (
      await api(app)
        .post(`${V}/loyalty/accounts`)
        .set(bearer(owner.token))
        .send({ profileId, programCode: 'MAR_BONVOY', accountNumber: 'MB00000' + balance, balance })
        .expect(201)
    ).body.id as string;
  const ownerAcct = await acct(primary.id, 10_000);
  const rileyAcct = await acct(riley.id, 20_000);
  const inv = (await api(app).post(`${V}/household/members/${riley.id}/invite`).set(bearer(owner.token)).expect(200)).body;
  const email = uniqueEmail('riley');
  const j = (
    await api(app)
      .post(`${V}/auth/accept-invite`)
      .send({ token: inv.url.split('/join/')[1], email, password: 'riley-pass-12345', name: 'Riley' })
      .expect(200)
  ).body;
  return { owner, primary, riley, sam, ownerCard, rileyCard, samCard, ownerAcct, rileyAcct, member: j.accessToken as string, memberUserId: j.user.id as string };
}

describe("TC-MCHAN: a member's own alert address", () => {
  it('has its own address and sees only their own cards; the owner keeps the whole household', async () => {
    const h = await household();
    const m = await status(h.member);
    const o = await status(h.owner.token);
    expect(m.inbox.address).toBeTruthy();
    expect(m.inbox.address).not.toBe(o.inbox.address);
    expect(m.cards.map((c: any) => c.walletCardId)).toEqual([h.rileyCard]);
    expect(o.cards.map((c: any) => c.walletCardId).sort()).toEqual([h.ownerCard, h.rileyCard, h.samCard].sort());
    expect(m.cards[0].bank).toBeNull();
  });

  it("the same digits are ambiguous for the household address but resolved by the member's own", async () => {
    const h = await household();
    const ownerAddr = (await status(h.owner.token)).inbox.address as string;
    const memberAddr = (await status(h.member)).inbox.address as string;
    // household-wide: two cards end 4321, so it asks which one
    await deliver(chaseAlert('11.11', '4321'), ownerAddr).expect(202);
    const o = await status(h.owner.token);
    expect(o.needsCard).toHaveLength(1);
    expect(await prisma.transaction.count({ where: { userId: h.owner.userId, amountCents: 1111 } })).toBe(0);
    // the member's own address pins to their card
    await deliver(chaseAlert('22.22', '4321'), memberAddr).expect(202);
    const tx = await prisma.transaction.findMany({ where: { amountCents: 2222, userId: h.owner.userId } });
    expect(tx).toHaveLength(1);
    expect(tx[0].walletCardId).toBe(h.rileyCard);
    // it is the member's review list that records it, not the owner's
    expect((await status(h.member)).recent.some((r: any) => r.status === 'PROCESSED' && r.amountCents === 2222)).toBe(true);
    expect((await status(h.owner.token)).recent.some((r: any) => r.amountCents === 2222)).toBe(false);
  });

  it("a member's alert for a card that is not theirs never lands on it", async () => {
    const h = await household();
    const memberAddr = (await status(h.member)).inbox.address as string;
    await deliver(chaseAlert('33.33', '7777'), memberAddr).expect(202); // Sam's card
    expect(await prisma.transaction.count({ where: { userId: h.owner.userId, amountCents: 3333 } })).toBe(0);
    const m = await status(h.member);
    expect(m.needsCard).toHaveLength(1);
    expect(m.needsCard[0]).toMatchObject({ lastDigits: '7777' });
  });

  it('a member can assign a waiting alert to their own card only', async () => {
    const h = await household();
    const memberAddr = (await status(h.member)).inbox.address as string;
    await deliver(chaseAlert('44.44', '9999'), memberAddr).expect(202);
    const item = (await status(h.member)).needsCard[0];
    await api(app).post(`${V}/capture/items/${item.id}/assign`).set(bearer(h.member)).send({ walletCardId: h.ownerCard }).expect(404);
    await api(app).post(`${V}/capture/items/${item.id}/assign`).set(bearer(h.member)).send({ walletCardId: h.samCard }).expect(404);
    await api(app).post(`${V}/capture/items/${item.id}/assign`).set(bearer(h.member)).send({ walletCardId: h.rileyCard }).expect(200);
    expect((await prisma.transaction.findMany({ where: { amountCents: 4444, userId: h.owner.userId } })).map((t) => t.walletCardId)).toEqual([h.rileyCard]);
    // another household's member cannot see or touch this queue
    const other = await household();
    await api(app).post(`${V}/capture/items/${item.id}/assign`).set(bearer(other.member)).send({ walletCardId: other.rileyCard }).expect(404);
    await api(app).delete(`${V}/capture/items/${item.id}`).set(bearer(other.member)).expect(404);
  });

  it('the address can be paused and replaced, and the old one stops working', async () => {
    const h = await household();
    const before = (await status(h.member)).inbox.address as string;
    const r = (await api(app).post(`${V}/capture/inbox/rotate`).set(bearer(h.member)).expect(200)).body;
    expect(r.inbox.address).not.toBe(before);
    expect((await deliver(chaseAlert('55.55', '4321'), before)).body).toMatchObject({ accepted: false });
    await api(app).patch(`${V}/capture/inbox`).set(bearer(h.member)).send({ enabled: false }).expect(200);
    expect((await deliver(chaseAlert('66.66', '4321'), r.inbox.address)).body).toMatchObject({ accepted: false });
    expect(await prisma.transaction.count({ where: { userId: h.owner.userId, amountCents: { in: [5555, 6666] } } })).toBe(0);
  });

  it("a loyalty e-mail updates the member's own account, not the owner's (both hold the program)", async () => {
    const h = await household();
    const ownerAddr = (await status(h.owner.token)).inbox.address as string;
    const memberAddr = (await status(h.member)).inbox.address as string;
    // household-wide: two Bonvoy accounts and nothing says which, so nothing is guessed
    await deliver(bonvoy('55,000'), ownerAddr).expect(202);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: h.ownerAcct } })).balance).toBe(10_000);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: h.rileyAcct } })).balance).toBe(20_000);
    // the member's own address updates their account
    await deliver(bonvoy('77,000'), memberAddr).expect(202);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: h.rileyAcct } })).balance).toBe(77_000);
    expect((await prisma.loyaltyAccount.findUniqueOrThrow({ where: { id: h.ownerAcct } })).balance).toBe(10_000);
  });
});

describe('TC-MCHAN: mailboxes per person', () => {
  const fake = (raw: Buffer): MailboxConnector => ({ verify: async () => undefined, fetchNew: async () => ({ messages: [{ id: '1', raw }], cursor: '1:1', more: false }) });
  const connect = (t: string, body: object) => api(app).post(`${V}/mailboxes`).set(bearer(t)).send({ label: 'Mail', host: 'imap.example.com', password: 'app-pass', ...body });

  it('a member connects their own mailbox; it feeds only their cards and the owner sees only health, never the address', async () => {
    const h = await household();
    svc.connectorFor = () => fake(chaseAlert('12.34', '4321'));
    const mb = (await connect(h.member, { username: 'riley@example.com' }).expect(201)).body;
    expect(mb.profile).toMatchObject({ id: h.riley.id, nickname: 'Riley' });
    await api(app).post(`${V}/mailboxes/${mb.id}/sync`).set(bearer(h.member)).expect(200);
    const tx = await prisma.transaction.findMany({ where: { userId: h.owner.userId, amountCents: 1234 } });
    expect(tx.map((t) => t.walletCardId)).toEqual([h.rileyCard]);
    // the owner cannot list the member's mailboxes, but sees counts and health on the member
    expect((await api(app).get(`${V}/mailboxes`).set(bearer(h.owner.token)).expect(200)).body).toEqual([]);
    const m = (await api(app).get(`${V}/household/members`).set(bearer(h.owner.token)).expect(200)).body.find((x: any) => x.id === h.riley.id);
    expect(m.channels).toMatchObject({ mailboxes: 1, needsAttention: 0 });
    expect(m.channels.lastSyncAt).toBeTruthy();
    expect(JSON.stringify(m)).not.toContain('riley@example.com');
    // a member cannot choose another person's profile
    await connect(h.member, { username: 'again@example.com', profileId: h.sam.id }).expect(400);
  });

  it('an owner assigns a mailbox to a member without a sign-in; it feeds only that member', async () => {
    const h = await household();
    svc.connectorFor = () => fake(chaseAlert('45.67', '7777'));
    const mb = (await connect(h.owner.token, { username: 'sam@example.com', profileId: h.sam.id }).expect(201)).body;
    expect(mb.profile).toMatchObject({ nickname: 'Sam' });
    await api(app).post(`${V}/mailboxes/${mb.id}/sync`).set(bearer(h.owner.token)).expect(200);
    expect((await prisma.transaction.findMany({ where: { userId: h.owner.userId, amountCents: 4567 } })).map((t) => t.walletCardId)).toEqual([h.samCard]);
    // a profile that is not theirs is refused
    const stranger = await household();
    await connect(h.owner.token, { username: 'x@example.com', profileId: stranger.sam.id }).expect(400);
    // the owner's own household-wide mailbox is separate and has its own limit
    await connect(h.owner.token, { username: 'owner@example.com' }).expect(201);
    expect((await api(app).get(`${V}/mailboxes`).set(bearer(h.owner.token)).expect(200)).body).toHaveLength(2);
  });

  it('the limit is per person: three each, so a household can connect many mailboxes in total', async () => {
    const h = await household();
    svc.connectorFor = () => fake(chaseAlert('1.00', '1'));
    for (const n of [1, 2, 3]) await connect(h.member, { username: `r${n}@example.com` }).expect(201);
    await connect(h.member, { username: 'r4@example.com' }).expect(400);
    for (const n of [1, 2, 3]) await connect(h.owner.token, { username: `o${n}@example.com` }).expect(201);
    await connect(h.owner.token, { username: 'o4@example.com' }).expect(400);
    for (const n of [1, 2, 3]) await connect(h.owner.token, { username: `s${n}@example.com`, profileId: h.sam.id }).expect(201);
    await connect(h.owner.token, { username: 's4@example.com', profileId: h.sam.id }).expect(400);
  });

  it("removing the member's sign-in removes their mailboxes and address; an assigned mailbox falls back to household-wide when its member is deleted", async () => {
    const h = await household();
    svc.connectorFor = () => fake(chaseAlert('1.00', '1'));
    await connect(h.member, { username: 'riley@example.com' }).expect(201);
    const assigned = (await connect(h.owner.token, { username: 'sam@example.com', profileId: h.sam.id }).expect(201)).body;
    await api(app).get(`${V}/capture/status`).set(bearer(h.member)).expect(200);
    await api(app).delete(`${V}/household/members/${h.riley.id}/login`).set(bearer(h.owner.token)).expect(204);
    expect(await prisma.mailbox.count({ where: { userId: h.memberUserId } })).toBe(0);
    expect(await prisma.emailInbox.count({ where: { userId: h.memberUserId } })).toBe(0);
    await api(app).delete(`${V}/household/members/${h.sam.id}`).set(bearer(h.owner.token)).expect(204);
    expect((await prisma.mailbox.findUniqueOrThrow({ where: { id: assigned.id } })).profileId).toBeNull();
  });

  it("a member cannot reach another person's mailbox, and the owner's routes stay closed to them", async () => {
    const h = await household();
    svc.connectorFor = () => fake(chaseAlert('1.00', '1'));
    const own = (await connect(h.owner.token, { username: 'owner@example.com' }).expect(201)).body;
    await api(app).post(`${V}/mailboxes/${own.id}/sync`).set(bearer(h.member)).expect(404);
    await api(app).delete(`${V}/mailboxes/${own.id}`).set(bearer(h.member)).expect(404);
    expect((await api(app).get(`${V}/mailboxes`).set(bearer(h.member)).expect(200)).body).toEqual([]);
    await api(app).get(`${V}/imports`).set(bearer(h.member)).expect(403);
    await api(app).post(`${V}/connections/plaid/link-token`).set(bearer(h.member)).expect(403);
  });
});
