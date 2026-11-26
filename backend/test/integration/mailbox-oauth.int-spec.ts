import { INestApplication } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { MailboxService } from "../../src/mailbox/mailbox.service";
import { api, bearer, createApp, register } from "./helpers";

/**
 * Gmail sign-in end to end with a fake Google: consent URL, callback, encrypted token storage, sync through the
 * capture pipeline, revoked access, and revoke on disconnect. Synthetic data only.
 */
const V = "/api/v1";
const prisma = new PrismaClient();
let app: INestApplication;
let svc: MailboxService;
let token: string;
let other: string;
const now = new Date();
const longDate = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const alert = Buffer.from(
  ["From: Chase <no.reply.alerts@chase.com>", "To: me@gmail.test", "Subject: Your card was used", `Date: ${now.toUTCString()}`, `Message-ID: <gm-${Date.now()}@test.example>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "", `You made a $12.34 transaction with COFFEE SHOP on ${longDate} at 8:14 PM ET. Account ending in (...2468)`].join("\r\n"),
);

const seen: string[] = [];
let revokedGrant = false;
const fakeGoogle = async (url: string, init?: { method?: string; body?: string }) => {
  seen.push(`${init?.method ?? "GET"} ${url.split("?")[0]}`);
  const reply = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body, text: async () => JSON.stringify(body), arrayBuffer: async () => new ArrayBuffer(0) });
  if (url === "https://oauth2.googleapis.com/token") {
    if (revokedGrant) return reply(400, { error: "invalid_grant" });
    return reply(200, { access_token: "AT-secret", refresh_token: "RT-secret-value", expires_in: 3599 });
  }
  if (url.endsWith("/users/me/profile")) return reply(200, { emailAddress: "me@gmail.test" });
  if (url.includes("/users/me/messages?")) return reply(200, { messages: [{ id: "g1" }] });
  if (url.includes("/users/me/messages/g1")) return reply(200, { id: "g1", internalDate: String(Date.now()), raw: alert.toString("base64url") });
  if (url === "https://oauth2.googleapis.com/revoke") return reply(200, {});
  return reply(404, {});
};

beforeAll(async () => {
  app = await createApp();
  svc = app.get(MailboxService);
  svc.oauthFetch = fakeGoogle as never;
  token = (await register(app)).token;
  other = (await register(app)).token;
  const card = await prisma.creditCard.findUniqueOrThrow({ where: { slug: "contoso-gold" } });
  await api(app).post(`${V}/wallet/cards`).set(bearer(token)).send({ cardId: card.id, lastFour: "2468" }).expect(201);
});
afterAll(async () => {
  delete process.env.GOOGLE_OAUTH_CLIENT_ID;
  delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  await app.close();
  await prisma.$disconnect();
});

describe("Gmail sign-in", () => {
  let id: string;
  let state: string;

  it("is unavailable until the owner configures a client id and secret", async () => {
    const p = (await api(app).get(`${V}/mailboxes/providers`).set(bearer(token)).expect(200)).body;
    expect(p).toMatchObject({ gmail: false, outlook: false, redirectUri: expect.stringContaining("/api/v1/mailboxes/oauth/callback") });
    await api(app).get(`${V}/mailboxes/oauth/google/start`).set(bearer(token)).expect(400);
    await api(app).get(`${V}/mailboxes/oauth/nope/start`).set(bearer(token)).expect(400);
    await api(app).get(`${V}/mailboxes/oauth/google/start`).expect(401);
  });

  it("start returns Google's consent URL with a sealed state", async () => {
    process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client";
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
    expect((await api(app).get(`${V}/mailboxes/providers`).set(bearer(token))).body.gmail).toBe(true);
    const url = new URL((await api(app).get(`${V}/mailboxes/oauth/google/start`).set(bearer(token)).expect(200)).body.url);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe("test-client");
    expect(url.searchParams.get("scope")).toContain("gmail.readonly");
    state = url.searchParams.get("state") as string;
    expect(state.length).toBeGreaterThan(40);
  });

  it("the callback stores an encrypted refresh token and redirects back to the app", async () => {
    const r = await api(app).get(`${V}/mailboxes/oauth/callback`).query({ code: "CODE", state }).redirects(0).expect(302);
    expect(r.headers.location).toMatch(/\/spending\?mailbox=connected$/);
    const list = (await api(app).get(`${V}/mailboxes`).set(bearer(token)).expect(200)).body;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "GMAIL", username: "me@gmail.test", label: "Gmail", host: null });
    expect(JSON.stringify(list)).not.toContain("RT-secret-value");
    id = list[0].id;
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id } });
    expect(row.secretEnc).not.toContain("RT-secret-value");
    expect((await api(app).get(`${V}/mailboxes`).set(bearer(other)).expect(200)).body).toEqual([]);
  });

  it("connecting again refreshes the stored token instead of adding a second mailbox", async () => {
    const url = new URL((await api(app).get(`${V}/mailboxes/oauth/google/start`).set(bearer(token))).body.url);
    await api(app).get(`${V}/mailboxes/oauth/callback`).query({ code: "CODE2", state: url.searchParams.get("state") }).redirects(0).expect(302);
    expect(await prisma.mailbox.count({ where: { userId: (await prisma.mailbox.findUniqueOrThrow({ where: { id } })).userId } })).toBe(1);
  });

  it("a bad, expired or declined sign-in redirects with a clear reason and creates nothing", async () => {
    const bad = await api(app).get(`${V}/mailboxes/oauth/callback`).query({ code: "x", state: "forged" }).redirects(0).expect(302);
    expect(decodeURIComponent(bad.headers.location)).toMatch(/mailbox=error&reason=The sign-in link expired/);
    const url = new URL((await api(app).get(`${V}/mailboxes/oauth/google/start`).set(bearer(other))).body.url);
    const denied = await api(app).get(`${V}/mailboxes/oauth/callback`).query({ error: "access_denied", state: url.searchParams.get("state") }).redirects(0).expect(302);
    expect(decodeURIComponent(denied.headers.location)).toMatch(/You declined access/);
    expect((await api(app).get(`${V}/mailboxes`).set(bearer(other))).body).toEqual([]);
  });

  it("sync reads issuer mail through the capture pipeline", async () => {
    const r = await api(app).post(`${V}/mailboxes/${id}/sync`).set(bearer(token)).expect(200);
    expect(r.body).toMatchObject({ status: "OK", processed: 1 });
    const txs = (await api(app).get(`${V}/spending/transactions`).set(bearer(token)).expect(200)).body as Array<{ description: string | null; amountCents: number }>;
    expect(txs.find((t) => /COFFEE/i.test(t.description ?? ""))).toMatchObject({ amountCents: 1234 });
    expect(seen).toContain("GET https://gmail.googleapis.com/gmail/v1/users/me/messages");
  });

  it("revoked access is reported as 'reconnect needed' and keeps the mailbox", async () => {
    revokedGrant = true;
    const r = await api(app).post(`${V}/mailboxes/${id}/sync`).set(bearer(token)).expect(200);
    revokedGrant = false;
    expect(r.body.status).toBe("RECONNECT");
    const row = await prisma.mailbox.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ lastStatus: "RECONNECT", active: true });
    expect(row.lastError).toMatch(/connect the mailbox again/);
  });

  it("disconnecting revokes the grant at Google and deletes the mailbox", async () => {
    await api(app).delete(`${V}/mailboxes/${id}`).set(bearer(other)).expect(404);
    await api(app).delete(`${V}/mailboxes/${id}`).set(bearer(token)).expect(204);
    expect(seen).toContain("POST https://oauth2.googleapis.com/revoke");
    expect(await prisma.mailbox.count({ where: { id } })).toBe(0);
  });
});
