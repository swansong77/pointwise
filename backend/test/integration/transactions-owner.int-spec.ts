import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { api, bearer, createApp, register } from "./helpers";

/** The transaction list says whose card each row is on (with the last digits) and can be narrowed to one household member. Synthetic data. */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let riley: string;
let sam: string;
let cardRiley: string;
let cardSam: string;
let cardPlain: string;

const addCard = async (t: string, profileId: string | null, lastFour: string) => {
  const card = await prisma.creditCard.findUniqueOrThrow({ where: { slug: "contoso-gold" } });
  return (await api(app).post(`${V}/wallet/cards`).set(bearer(t)).send({ cardId: card.id, lastFour, ...(profileId && { profileId }) }).expect(201)).body.id as string;
};
const tx = (userId: string, walletCardId: string, externalId: string) =>
  prisma.transaction.create({ data: { userId, walletCardId, amountCents: 1200, description: "FIXTURE STORE", kind: "PURCHASE", source: "MANUAL", externalId } });
const list = (t: string, qs = "") => api(app).get(`${V}/spending/transactions${qs}`).set(bearer(t)).expect(200);

beforeAll(async () => {
  app = await createApp();
  const u = await register(app);
  token = u.token;
  await api(app).post(`${V}/subscription/checkout`).set(bearer(token)).send({ interval: "month" }).expect(201); // household members are a paid feature
  other = (await register(app)).token;
  riley = (await api(app).post(`${V}/household/members`).set(bearer(token)).send({ nickname: "Riley", relationship: "SPOUSE" }).expect(201)).body.id;
  sam = (await api(app).post(`${V}/household/members`).set(bearer(token)).send({ nickname: "Sam", relationship: "PARENT" }).expect(201)).body.id;
  cardRiley = await addCard(token, riley, "1111");
  cardSam = await addCard(token, sam, "2222");
  cardPlain = await addCard(token, null, "3333");
  await tx(u.userId, cardRiley, "t-1");
  await tx(u.userId, cardRiley, "t-2");
  await tx(u.userId, cardSam, "t-3");
  await tx(u.userId, cardPlain, "t-4");
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("transactions: owner, last digits and member filter", () => {
  it("each row names the card's owner and last digits; a card with no owner has none", async () => {
    const rows = (await list(token)).body as Array<{ walletCard: { id: string; lastFour: string; owner: { id: string; nickname: string } | null } }>;
    const by = (id: string) => rows.find((r) => r.walletCard.id === id)!.walletCard;
    expect(by(cardRiley)).toMatchObject({ lastFour: "1111", owner: { id: riley, nickname: "Riley" } });
    expect(by(cardSam)).toMatchObject({ lastFour: "2222", owner: { id: sam, nickname: "Sam" } });
    expect(by(cardPlain)).toMatchObject({ lastFour: "3333", owner: null });
  });
  it("profileId narrows to one member's cards, and combines with a card filter", async () => {
    const mine = (await list(token, `?profileId=${riley}`)).body as Array<{ walletCard: { id: string } }>;
    expect(mine).toHaveLength(2);
    expect(new Set(mine.map((r) => r.walletCard.id))).toEqual(new Set([cardRiley]));
    expect((await list(token, `?profileId=${sam}`)).body).toHaveLength(1);
    expect((await list(token, `?profileId=${riley}&walletCardId=${cardSam}`)).body).toHaveLength(0);
  });
  it("another account's member id shows nothing and a malformed id is refused", async () => {
    expect((await list(other, `?profileId=${riley}`)).body).toHaveLength(0);
    await api(app).get(`${V}/spending/transactions?profileId=nope`).set(bearer(token)).expect(400);
  });
});
