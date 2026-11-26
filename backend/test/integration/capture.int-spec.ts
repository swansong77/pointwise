import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { makePdf } from "../fixtures/make-pdf";
import { api, bearer, createApp, register } from "./helpers";

/**
 * Automatic capture: card alert emails forwarded to the user's private address become transactions
 * (benefits update), statement PDFs attached to emails are imported and merged with earlier alerts,
 * and unknown cards wait for the user. Synthetic messages only.
 */
const V = "/api/v1";
const SECRET = process.env.INBOUND_EMAIL_SECRET as string;
const prisma = new PrismaClient();
let app: INestApplication;
let token: string;
let other: string;
let address: string;
let goldCard: string;
let spareCard: string;
const now = new Date();
const longDate = now.toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const mmdd = `${String(now.getUTCMonth() + 1).padStart(2, "0")}/${String(now.getUTCDate()).padStart(2, "0")}`;
let seq = 0;

function mime(o: {
  from: string;
  to?: string;
  subject: string;
  text: string;
  auth?: string;
  pdf?: Buffer;
  id?: string;
}) {
  const headers = [
    ...(o.auth ? [`Authentication-Results: ${o.auth}`] : []),
    `From: ${o.from}`,
    `To: ${o.to ?? "Jo <jo@gmail.example>"}`,
    `Subject: ${o.subject}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${o.id ?? `m${Date.now()}-${seq++}`}@test.example>`,
    "MIME-Version: 1.0",
  ];
  if (!o.pdf)
    return Buffer.from(
      [...headers, "Content-Type: text/plain; charset=utf-8", "", o.text].join(
        "\r\n",
      ),
    );
  const b = "BOUNDARY42";
  return Buffer.from(
    [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${b}"`,
      "",
      `--${b}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      o.text,
      `--${b}`,
      'Content-Type: application/pdf; name="statement.pdf"',
      'Content-Disposition: attachment; filename="statement.pdf"',
      "Content-Transfer-Encoding: base64",
      "",
      o.pdf.toString("base64").replace(/.{76}/g, "$&\r\n"),
      `--${b}--`,
      "",
    ].join("\r\n"),
  );
}
const deliver = (raw: Buffer, to = address, secret = SECRET) =>
  api(app)
    .post(`${V}/inbound/email`)
    .set("x-inbound-secret", secret)
    .set("x-envelope-to", to)
    .set("content-type", "message/rfc822")
    .send(raw);
const PASS = "mx.pointwise.test; dkim=pass header.d=chase.com; spf=pass";
const status = async (t = token) =>
  (await api(app).get(`${V}/capture/status`).set(bearer(t)).expect(200)).body;

beforeAll(async () => {
  app = await createApp();
  token = (await register(app)).token;
  other = (await register(app)).token;
  const gold = await prisma.creditCard.findUniqueOrThrow({
    where: { slug: "contoso-gold" },
  });
  const dbl = await prisma.creditCard.findUniqueOrThrow({
    where: { slug: "fabrikam-double" },
  });
  const approvedAt = new Date(now.getTime() - 40 * 86_400_000).toISOString();
  goldCard = (
    await api(app)
      .post(`${V}/wallet/cards`)
      .set(bearer(token))
      .send({ cardId: gold.id, approvedAt, lastFour: "4321" })
      .expect(201)
  ).body.id;
  spareCard = (
    await api(app)
      .post(`${V}/wallet/cards`)
      .set(bearer(token))
      .send({ cardId: dbl.id, approvedAt })
      .expect(201)
  ).body.id;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe("automatic capture by forwarded alert emails", () => {
  it("each user gets a private address; cards start manual with hints", async () => {
    const s = await status();
    address = s.inbox.address;
    expect(address).toMatch(/^u-[0-9a-f]{24}@in\.pointwise\.test$/);
    expect(s.inbox).toMatchObject({
      configured: true,
      enabled: true,
      received: 0,
      gmailFilter: expect.stringContaining("chase.com"),
    });
    expect(
      s.cards.find(
        (c: { walletCardId: string }) => c.walletCardId === spareCard,
      ),
    ).toMatchObject({
      via: "MANUAL",
      hint: expect.stringMatching(/last 4 digits/),
    });
    expect((await status(other)).inbox.address).not.toBe(address);
  });

  it("the inbound endpoint needs the provider secret; unknown addresses are dropped quietly", async () => {
    const raw = mime({ from: "alerts@chase.com", subject: "x", text: "x" });
    await api(app)
      .post(`${V}/inbound/email`)
      .set("x-envelope-to", address)
      .send(raw)
      .expect(401);
    await deliver(raw, address, "wrong-secret-wrong-secret-0123").expect(401);
    expect(
      (
        await deliver(
          raw,
          "u-ffffffffffffffffffffffff@in.pointwise.test",
        ).expect(202)
      ).body,
    ).toEqual({ accepted: false });
  });

  it("Gmail forwarding confirmation is shown to the user", async () => {
    const r = await deliver(
      mime({
        from: "Gmail Team <forwarding-noreply@google.com>",
        subject:
          "(#987654321) Gmail Forwarding Confirmation - Receive Mail from jo@gmail.example",
        text: "Confirm: https://mail-settings.google.com/mail/vf-test123",
      }),
    ).expect(202);
    expect(r.body).toEqual({
      accepted: true,
      kind: "FORWARD_CONFIRMATION",
      status: "PROCESSED",
    });
    expect((await status()).inbox.confirmation).toMatchObject({
      code: "987654321",
      url: "https://mail-settings.google.com/mail/vf-test123",
    });
  });

  it("non-issuer senders and failed DKIM are rejected", async () => {
    expect(
      (
        await deliver(
          mime({
            from: "promo@shop.example",
            subject: "Your $5.00 transaction with X",
            text: "You made a $5.00 transaction with X ending in 4321",
          }),
        ).expect(202)
      ).body.status,
    ).toBe("REJECTED");
    expect(
      (
        await deliver(
          mime({
            from: "alerts@chase.com",
            auth: "mx.pointwise.test; dkim=fail header.d=chase.com; dmarc=fail",
            subject: "Your $5.00 transaction with X",
            text: "You made a $5.00 transaction with X ending in 4321",
          }),
        ).expect(202)
      ).body.status,
    ).toBe("REJECTED");
    expect(
      await prisma.transaction.count({ where: { walletCardId: goldCard } }),
    ).toBe(0);
  });

  it("an alert becomes a transaction on the card with those digits and updates its benefits; the same email twice counts once", async () => {
    const raw = mime({
      id: "uber-1",
      from: "Chase <no.reply.alerts@chase.com>",
      auth: PASS,
      subject: "Your $23.45 transaction with UBER *TRIP",
      text: `You made a $23.45 transaction with UBER *TRIP on ${longDate} at 8:14 PM ET. Account ending in (...4321)`,
    });
    expect((await deliver(raw).expect(202)).body).toEqual({
      accepted: true,
      kind: "ALERT",
      status: "PROCESSED",
    });
    const tx = (
      await api(app)
        .get(`${V}/spending/transactions?walletCardId=${goldCard}`)
        .set(bearer(token))
        .expect(200)
    ).body;
    expect(tx).toEqual([
      expect.objectContaining({
        description: "UBER *TRIP",
        amountCents: 2345,
        source: "EMAIL",
        benefits: [
          expect.objectContaining({
            name: "Rideshare credit",
            status: "EXPECTED",
            amountCents: 1000,
          }),
        ],
      }),
    ]);
    expect((await deliver(raw).expect(202)).body.status).toBe("DUPLICATE");
    const s = await status();
    expect(s.recent[0]).toMatchObject({
      kind: "ALERT",
      status: "DUPLICATE",
      verified: true,
      merchant: "UBER *TRIP",
    });
    expect(
      s.cards.find(
        (c: { walletCardId: string }) => c.walletCardId === goldCard,
      ),
    ).toMatchObject({ via: "EMAIL", automatic: true });
  });

  it("an alert for an unknown card waits; assigning it (and remembering the digits) records it", async () => {
    const r = await deliver(
      mime({
        from: "alerts@chase.com",
        auth: PASS,
        subject: "Transaction alert",
        text: `A $6.50 transaction was made at SQ *BEAN STREET COFFEE on ${longDate} on card ending in 7777.`,
      }),
    ).expect(202);
    expect(r.body.status).toBe("NEEDS_CARD");
    const item = (await status()).needsCard[0];
    expect(item).toMatchObject({
      amountCents: 650,
      merchant: "SQ *BEAN STREET COFFEE",
      lastDigits: "7777",
    });
    await api(app)
      .post(`${V}/capture/items/${item.id}/assign`)
      .set(bearer(other))
      .send({ walletCardId: spareCard })
      .expect(404);
    const a = await api(app)
      .post(`${V}/capture/items/${item.id}/assign`)
      .set(bearer(token))
      .send({ walletCardId: spareCard, remember: true })
      .expect(200);
    expect(a.body.status).toBe("PROCESSED");
    expect(
      (await prisma.walletCard.findUniqueOrThrow({ where: { id: spareCard } }))
        .lastFour,
    ).toBe("7777");
    await api(app)
      .post(`${V}/capture/items/${item.id}/assign`)
      .set(bearer(token))
      .send({ walletCardId: spareCard })
      .expect(400);
    // the next alert for 7777 goes straight to the card
    expect(
      (
        await deliver(
          mime({
            from: "alerts@chase.com",
            auth: PASS,
            subject: "Transaction alert",
            text: `A $4.00 transaction was made at QUICKFUEL on ${longDate} on card ending in 7777.`,
          }),
        ).expect(202)
      ).body.status,
    ).toBe("PROCESSED");
  });

  it("a statement PDF attached to an email is imported; its row for the alerted purchase merges with the alert", async () => {
    const pdf = makePdf([
      [
        "Fixture Bank Rewards Visa",
        "Account Number: XXXX XXXX XXXX 4321",
        `Opening/Closing Date ${mmdd}/${String(now.getUTCFullYear()).slice(2)} - ${mmdd}/${String(now.getUTCFullYear()).slice(2)}`,
      ],
      [
        "PURCHASE",
        `${mmdd} UBER *TRIP HELP.UBER.COM CA 23.45`,
        `${mmdd} FRESHCART MARKET 41.20`,
      ],
    ]);
    const r = await deliver(
      mime({
        from: "statements@chase.com",
        auth: PASS,
        subject: "Your statement",
        text: "Your statement is attached.",
        pdf,
      }),
    ).expect(202);
    expect(r.body).toEqual({
      accepted: true,
      kind: "STATEMENT",
      status: "PROCESSED",
    });
    expect((await status()).recent[0].note).toBe(
      "1 new, 1 merged with alerts, 0 already recorded",
    );
    const tx = (
      await api(app)
        .get(`${V}/spending/transactions?walletCardId=${goldCard}`)
        .set(bearer(token))
        .expect(200)
    ).body;
    expect(tx).toHaveLength(2);
    const uber = tx.find(
      (t: { amountCents: number }) => t.amountCents === 2345,
    );
    expect(uber).toMatchObject({
      source: "PDF",
      description: "UBER *TRIP HELP.UBER.COM CA",
      benefits: [expect.objectContaining({ name: "Rideshare credit" })],
    });
  });

  it("turning the inbox off or rotating the address stops delivery; items can be discarded", async () => {
    const raw = () =>
      mime({
        from: "alerts@chase.com",
        auth: PASS,
        subject: "Your $1.00 transaction with X",
        text: "You made a $1.00 transaction with X ending in 4321",
      });
    await api(app)
      .patch(`${V}/capture/inbox`)
      .set(bearer(token))
      .send({ enabled: false })
      .expect(200);
    expect((await deliver(raw()).expect(202)).body.accepted).toBe(false);
    await api(app)
      .patch(`${V}/capture/inbox`)
      .set(bearer(token))
      .send({ enabled: true })
      .expect(200);
    const rotated = (
      await api(app)
        .post(`${V}/capture/inbox/rotate`)
        .set(bearer(token))
        .expect(200)
    ).body.inbox.address;
    expect(rotated).not.toBe(address);
    expect((await deliver(raw(), address).expect(202)).body.accepted).toBe(
      false,
    );
    expect((await deliver(raw(), rotated).expect(202)).body.accepted).toBe(
      true,
    );
    const anyItem = (await status()).recent[0];
    await api(app)
      .delete(`${V}/capture/items/${anyItem.id}`)
      .set(bearer(other))
      .expect(404);
    await api(app)
      .delete(`${V}/capture/items/${anyItem.id}`)
      .set(bearer(token))
      .expect(204);
    await api(app).get(`${V}/capture/status`).expect(401);
  });
});
