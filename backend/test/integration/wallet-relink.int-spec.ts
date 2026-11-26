import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { api, bearer, createApp, register } from './helpers';

/** Imported (custom) cards with no rates are matched to the catalog card of the same name, on request. Synthetic cards only. */
const V = '/api/v1';
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let userId: string;
let other: { token: string; userId: string };
const cardIds: string[] = [];
let customWallet: string;
let customCard: string;
let catalogCard: string;

beforeAll(async () => {
  app = await createApp();
  ({ token, userId } = await register(app));
  other = await register(app);
  const cash = await prisma.rewardCurrency.findUniqueOrThrow({ where: { code: 'CASH' } });
  const issuer = await prisma.issuer.findFirstOrThrow();
  const base = await prisma.category.findUniqueOrThrow({ where: { slug: 'everything-else' } });
  const dining = await prisma.category.findUniqueOrThrow({ where: { slug: 'dining' } });
  const sfx = Date.now();
  catalogCard = (await prisma.creditCard.create({ data: { slug: `relink-cat-${sfx}`, name: 'Zorro Gold Card', issuerId: issuer.id, currencyId: cash.id, network: 'VISA', annualFeeCents: 0, catalogSource: 'SEED', rewards: { create: [{ categoryId: dining.id, multiplier: 4, description: '4x dining' }, { categoryId: base.id, multiplier: 1, description: '1x' }] } } })).id;
  customCard = (await prisma.creditCard.create({ data: { slug: `u-relink-${sfx}`, name: 'Zorro Gold', issuerId: issuer.id, currencyId: cash.id, network: 'VISA', annualFeeCents: 0, isActive: false, ownerId: userId, catalogSource: 'ADMIN' } })).id;
  const noMatch = await prisma.creditCard.create({ data: { slug: `u-relink-x-${sfx}`, name: 'Totally Unknown Legacy', issuerId: issuer.id, currencyId: cash.id, network: 'VISA', annualFeeCents: 0, isActive: false, ownerId: userId, catalogSource: 'ADMIN' } });
  cardIds.push(catalogCard, customCard, noMatch.id);
  const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
  const mk = (cardId: string, lastFour: string) => prisma.walletCard.create({ data: { walletId: wallet.id, cardId, lastFour, status: 'APPROVED', approvedAt: new Date('2018-03-29') } });
  customWallet = (await mk(customCard, '2004')).id;
  await mk(noMatch.id, '9999');
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, other.userId] } } });
  await prisma.creditCard.deleteMany({ where: { id: { in: cardIds } } });
  await app.close();
  await prisma.$disconnect();
});

describe('matching imported cards to the catalog', () => {
  it('proposes only cards with no rates that match, and nothing for someone else', async () => {
    const r = (await api(app).get(`${V}/wallet/custom-matches`).set(bearer(token)).expect(200)).body;
    expect(r.matches).toHaveLength(1);
    expect(r.matches[0]).toMatchObject({ walletCardId: customWallet, customName: 'Zorro Gold', catalogName: 'Zorro Gold Card', lastFour: '2004' });
    expect(r.unmatched).toBe(1);
    expect((await api(app).get(`${V}/wallet/custom-matches`).set(bearer(other.token)).expect(200)).body.matches).toEqual([]);
  });

  it('moves the wallet card onto the catalog card, keeps its details, and removes the unused custom card', async () => {
    const moved = await api(app).post(`${V}/wallet/custom-matches`).set(bearer(other.token)).send({ walletCardIds: [customWallet] }).expect(200);
    expect(moved.body.moved).toBe(0); // not theirs
    expect((await api(app).post(`${V}/wallet/custom-matches`).set(bearer(token)).send({ walletCardIds: [customWallet] }).expect(200)).body.moved).toBe(1);
    const wc = await prisma.walletCard.findUniqueOrThrow({ where: { id: customWallet } });
    expect([wc.cardId, wc.lastFour, wc.approvedAt?.toISOString().slice(0, 10)]).toEqual([catalogCard, '2004', '2018-03-29']);
    expect(await prisma.creditCard.count({ where: { id: customCard } })).toBe(0);
    const list = (await api(app).get(`${V}/wallet/cards`).set(bearer(token)).expect(200)).body as Array<{ id: string; card: { name: string; rewards: unknown[] } }>;
    expect(list.find((x) => x.id === customWallet)!.card).toMatchObject({ name: 'Zorro Gold Card' });
    expect(list.find((x) => x.id === customWallet)!.card.rewards).toHaveLength(2);
    expect((await api(app).get(`${V}/wallet/custom-matches`).set(bearer(token)).expect(200)).body.matches).toEqual([]);
  });
});
