import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { MailboxService } from "../../src/mailbox/mailbox.service";
import { MailboxConnector } from "../../src/mailbox/connector";
import { api, bearer, createApp, register } from "./helpers";

/**
 * Connected mailbox: a fake connector stands in for the IMAP server (the IMAP adapter itself is covered by
 * unit tests with a fake client). Messages go through the real capture pipeline: allow-list, parsing,
 * matching to a card, dedupe. Synthetic messages only.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let svc: MailboxService;
const now = new Date();
const longDate = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

const mime = (o: { from: string; subject: string; text: string; id: string }) =>
  Buffer.from(
    [`From: ${o.from}`, "To: Jo <jo@gmail.example>", `Subject: ${o.subject}`, `Date: ${now.toUTCString()}`, `Message-ID: <${o.id}@test.example>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", o.text].join("\r\n"),
  );

const alert = mime({ from: "Chase <no.reply.alerts@chase.com>", subject: "Your card was used", text: `You made a $23.45 transaction with UBER *TRIP on ${longDate} at 8:14 PM ET. Account ending in (...6543)`, id: `mbx-${Date.now()}` });
const stranger = mime({ from: "deals@promo.example.org", subject: "Sale", text: "buy now", id: `mbx-promo-${Date.now()}` });
const notice = mime({ from: "Chase <no.reply.alerts@chase.com>", subject: "Payment due reminder", text: "Your payment is due soon.", id: `mbx-notice-${Date.now()}` });

let cursorSeen: Array<string | null> = [];
let failNext = false;
const fake: MailboxConnector = {
  verify: async () => undefined,
  fetchNew: async (cursor) => {
    cursorSeen.push(cursor);
    if (failNext) throw new Error("connection reset");
    return { messages: [{ id: "1", raw: alert }, { id: "2", raw: stranger }, { id: "3", raw: notice }], cursor: "7:3", more: false };
  },
};

beforeAll(async () => {
  process.env.MAILBOX_ALLOW_PRIVATE_HOSTS = "true";
  app = await createApp();
  svc = app.get(MailboxService);
  svc.connectorFor = () => fake;
  token = (await register(app)).token;
  other = (await register(app)).token;
  const card = await prisma.creditCard.findUniqueOrThrow({ where: { slug: "contoso-gold" } });
  await api(app).post(`${V}/wallet/cards`).set(bearer(token)).send({ cardId: card.id, lastFour: "6543" }).expect(201);
});
afterAll(async () => {
  delete process.env.MAILBOX_ALLOW_PRIVATE_HOSTS;
  await app.close();
  await prisma.$disconnect();
});

describe("connect and manage", () => {
  let id: string;
  it("rejects a private-network host unless local development allows it, and validates input", async () => {
    process.env.MAILBOX_ALLOW_PRIVATE_HOSTS = "false";
    await api(app).post(`${V}/mailboxes`).set(bearer(token)).send({ label: "x", host: "127.0.0.1", username: "me@example.com", password: "p" }).expect(400);
    process.env.MAILBOX_ALLOW_PRIVATE_HOSTS = "true";
    await api(app).post(`${V}/mailboxes`).set(bearer(token)).send({ label: "", host: "imap.example.com", username: "me@example.com", password: "p" }).expect(400);
    await api(app).post(`${V}/mailboxes`).send({}).expect(401);
  });
  it("connects: the password is never returned and is stored encrypted", async () => {
    const r = await api(app).post(`${V}/mailboxes`).set(bearer(token)).send({ label: "Personal", host: "imap.example.com", username: "me@example.com", password: "super-secret-app-pass" }).expect(201);
    expect(JSON.stringify(r.body)).not.toContain("super-secret-app-pass");
    expect(r.body).toMatchObject({ label: "Personal", kind: "IMAP", host: "imap.example.com", port: 993, folder: "INBOX", active: true });
    id = r.body.id;
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id } });
    expect(row.secretEnc).not.toContain("super-secret-app-pass");
    await api(app).post(`${V}/mailboxes`).set(bearer(token)).send({ label: "Again", host: "imap.example.com", username: "me@example.com", password: "p" }).expect(400);
    expect((await api(app).get(`${V}/mailboxes`).set(bearer(token)).expect(200)).body).toHaveLength(1);
    expect((await api(app).get(`${V}/mailboxes`).set(bearer(other)).expect(200)).body).toEqual([]);
  });
  it("sync reads allowed senders through the capture pipeline: a transaction appears, strangers are ignored, notices are labelled", async () => {
    const r = await api(app).post(`${V}/mailboxes/${id}/sync`).set(bearer(token)).expect(200);
    expect(r.body).toMatchObject({ status: "OK", processed: 3 });
    const txs = (await api(app).get(`${V}/spending/transactions`).set(bearer(token)).expect(200)).body as Array<{ description: string | null; amountCents: number; source: string }>;
    const t = txs.find((x) => /UBER/i.test(x.description ?? ""));
    expect(t).toMatchObject({ amountCents: 2345, source: "EMAIL" });
    const inbox = (await api(app).get(`${V}/capture/status`).set(bearer(token)).expect(200)).body;
    const items = JSON.stringify(inbox);
    expect(items).toContain("Account alert"); // the payment reminder was recognised, nothing imported from it
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ cursor: "7:3", lastStatus: "OK", processed: 3 });
  });
  it("syncing the same message again creates no second transaction (dedupe by Message-ID)", async () => {
    await api(app).post(`${V}/mailboxes/${id}/sync`).set(bearer(token)).expect(200);
    const txs = (await api(app).get(`${V}/spending/transactions`).set(bearer(token)).expect(200)).body as Array<{ description: string | null }>;
    expect(txs.filter((x) => /UBER/i.test(x.description ?? ""))).toHaveLength(1);
    expect(cursorSeen.at(-1)).toBe("7:3"); // the saved cursor is passed back
  });
  it("a failing mailbox keeps its cursor and shows the error", async () => {
    failNext = true;
    const r = await api(app).post(`${V}/mailboxes/${id}/sync`).set(bearer(token)).expect(200);
    failNext = false;
    expect(r.body).toMatchObject({ status: "ERROR" });
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ cursor: "7:3", lastStatus: "ERROR", lastError: "connection reset" });
  });
  it("another user cannot sync or remove it; the owner can disconnect", async () => {
    await api(app).post(`${V}/mailboxes/${id}/sync`).set(bearer(other)).expect(404);
    await api(app).delete(`${V}/mailboxes/${id}`).set(bearer(other)).expect(404);
    await api(app).delete(`${V}/mailboxes/${id}`).set(bearer(token)).expect(204);
    expect(await prisma.mailbox.count({ where: { id } })).toBe(0);
    cursorSeen = [];
  });
});
