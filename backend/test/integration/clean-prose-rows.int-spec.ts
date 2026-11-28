import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { cleanProseRows } from "../../src/spend/clean-prose-rows";
import { api, bearer, createApp, register } from "./helpers";

/** The one-off cleanup of sentence rows an older import stored from a two-column summary page. Synthetic rows only. */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let userId: string;
let cardId: string;
const SENTENCE = "or later you will pay the late fee and the interest owed on the account";

const add = (externalId: string, description: string, source: "PDF" | "MANUAL", amountCents = 5000) =>
  prisma.transaction.create({
    data: { userId, walletCardId: cardId, amountCents, description, kind: "PAYMENT", source, externalId, occurredAt: new Date("2026-08-12T00:00:00Z") },
  });

beforeAll(async () => {
  app = await createApp();
  const u = await register(app);
  userId = u.userId;
  const card = await prisma.creditCard.findUniqueOrThrow({ where: { slug: "contoso-gold" } });
  cardId = (await api(app).post(`${V}/wallet/cards`).set(bearer(u.token)).send({ cardId: card.id }).expect(201)).body.id;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("clean-prose-rows", () => {
  it("dry run reports and changes nothing; --apply deletes only the sentence rows imported from a PDF", async () => {
    const bad = await add("pdf:aaa1", SENTENCE, "PDF");
    const real = await add("pdf:aaa2", "PAYMENT THANK YOU", "PDF");
    const typed = await add("manual-1", SENTENCE, "MANUAL");
    const lines: string[] = [];
    const dry = await cleanProseRows(prisma, false, (l) => lines.push(l));
    expect(dry!.deleted).toBe(0);
    expect(dry!.found).toBeGreaterThanOrEqual(1);
    expect(lines.join("\n")).toContain("dry run: nothing changed");
    expect(lines.join("\n")).not.toContain("late fee"); // counts only, never the text
    expect(await prisma.transaction.count({ where: { id: { in: [bad.id, real.id, typed.id] } } })).toBe(3);

    const done = await cleanProseRows(prisma, true, () => undefined);
    expect(done!.deleted).toBe(done!.found);
    expect(await prisma.transaction.findUnique({ where: { id: bad.id } })).toBeNull();
    expect(await prisma.transaction.findUnique({ where: { id: real.id } })).not.toBeNull(); // a real merchant row stays
    expect(await prisma.transaction.findUnique({ where: { id: typed.id } })).not.toBeNull(); // typed by hand: not touched
    expect((await cleanProseRows(prisma, false, () => undefined))!.found).toBe(0); // nothing left
  });
});
