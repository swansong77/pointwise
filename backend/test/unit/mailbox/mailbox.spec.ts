import { authservIdFor } from "../../../src/mailbox/connector";
import { assertPublicHost, isPrivateAddress } from "../../../src/mailbox/host-guard";
import { ImapClientLike, ImapConnector, parseCursor, signInReason } from "../../../src/mailbox/imap.connector";
import { cleanPassword, MailboxService } from "../../../src/mailbox/mailbox.service";
import { classifyMail, MAIL_KIND_LABEL } from "../../../src/domain/mail-classify";
import { encryptSecret } from "../../../src/common/crypto";

process.env.TOKEN_ENC_KEY ??= "unit-test-token-enc-key-0123456789abcdef";

const cfg = { kind: "IMAP" as const, host: "imap.example.com", port: 993, username: "me@example.com", password: "app-pass", folder: "INBOX" };

describe("TC-MBX: host guard (SSRF)", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.5", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"])("%s is private", (ip) => {
    expect(isPrivateAddress(ip)).toBe(true);
  });
  it.each(["8.8.8.8", "142.250.80.46", "172.32.0.1", "2607:f8b0:4004:c07::6a"])("%s is public", (ip) => {
    expect(isPrivateAddress(ip)).toBe(false);
  });
  it("rejects hosts that resolve to private addresses or not at all, accepts public ones, honours the dev override", async () => {
    await expect(assertPublicHost("mail.internal.example", {}, async () => ["10.0.0.5"])).rejects.toThrow(/private network/);
    await expect(assertPublicHost("mail.example.com", {}, async () => ["8.8.8.8", "192.168.0.1"])).rejects.toThrow(/private network/);
    await expect(assertPublicHost("nope.example.com", {}, async () => [])).rejects.toThrow(/could not be resolved/);
    await expect(assertPublicHost("127.0.0.1", {})).rejects.toThrow(/private network/);
    await expect(assertPublicHost("bad host!", {})).rejects.toThrow(/valid mail server/);
    await expect(assertPublicHost("imap.example.com", {}, async () => ["93.184.216.34"])).resolves.toBeUndefined();
    await expect(assertPublicHost("localhost", { MAILBOX_ALLOW_PRIVATE_HOSTS: "true" } as never)).resolves.toBeUndefined();
  });
});

function fakeClient(messages: Array<{ uid: number; from: string; source: string }>, opts: { validity?: number; uidNext?: number; failLogin?: boolean; noFolder?: boolean } = {}) {
  const calls = { fetchedSources: [] as number[], searches: [] as unknown[], released: 0, loggedOut: 0 };
  const client: ImapClientLike = {
    mailbox: { uidValidity: opts.validity ?? 7, uidNext: opts.uidNext ?? Math.max(0, ...messages.map((m) => m.uid)) + 1 },
    connect: async () => { if (opts.failLogin) throw new Error("Invalid credentials"); },
    logout: async () => { calls.loggedOut++; },
    getMailboxLock: async () => { if (opts.noFolder) throw new Error("nope"); return { release: () => { calls.released++; } }; },
    search: async (q) => { calls.searches.push(q); const from = (q as { uid?: string }).uid ? Number((q as { uid: string }).uid.split(":")[0]) : 0; return messages.map((m) => m.uid).filter((u) => u >= from); },
    fetch: async function* (range, query) {
      const set = new Set(Array.isArray(range) ? range : []);
      for (const m of messages.filter((x) => set.has(x.uid))) {
        if ((query as { source?: boolean }).source) { calls.fetchedSources.push(m.uid); yield { uid: m.uid, source: Buffer.from(m.source) }; }
        else yield { uid: m.uid, envelope: { from: [{ address: m.from }] } };
      }
    },
  };
  return { client, calls };
}
const opts = { allowedDomains: ["alerts.chase.com", "aexp.com"], sinceDays: 30, max: 50 };

describe("TC-MBX: why a sign-in failed, and Google app passwords", () => {
  it("says what the server said instead of 'Command failed', never the password", () => {
    expect(signInReason({ authenticationFailed: true, responseText: "Invalid credentials (Failure)", message: "Command failed" })).toBe("the server rejected the user name or password (it said: Invalid credentials (Failure))");
    expect(signInReason({ authenticationFailed: true })).toBe("the server rejected the user name or password");
    expect(signInReason({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" })).toMatch(/server name was not found/);
    expect(signInReason({ code: "ECONNREFUSED" })).toMatch(/port/);
    expect(signInReason({ responseText: "Too many simultaneous connections" })).toBe("Too many simultaneous connections");
    expect(signInReason(new Error("Command failed"))).toBe("Command failed");
  });
  it("removes the spaces Google shows in an app password, for Google hosts only", () => {
    expect(cleanPassword("imap.gmail.com", "abcd efgh ijkl mnop")).toBe("abcdefghijklmnop");
    expect(cleanPassword("IMAP.GoogleMail.com ", "abcd efgh")).toBe("abcdefgh");
    expect(cleanPassword("imap.example.com", "pass word")).toBe("pass word");
    expect(cleanPassword("imap.notgmail.com", "a b")).toBe("a b");
  });
});

describe("TC-MBX: IMAP connector", () => {
  it("verifies login and folder with clear errors", async () => {
    await expect(new ImapConnector(cfg, () => fakeClient([], { failLogin: true }).client).verify()).rejects.toThrow(/Could not sign in/);
    await expect(new ImapConnector(cfg, () => fakeClient([], { noFolder: true }).client).verify()).rejects.toThrow(/Folder "INBOX" was not found/);
    const ok = fakeClient([]);
    await expect(new ImapConnector(cfg, () => ok.client).verify()).resolves.toBeUndefined();
    expect(ok.calls.loggedOut).toBe(1);
  });
  it("reads headers first and fetches bodies only for allow-listed senders", async () => {
    const f = fakeClient([
      { uid: 5, from: "alerts@alerts.chase.com", source: "A" },
      { uid: 6, from: "news@promo.example.org", source: "B" },
      { uid: 7, from: "no-reply@aexp.com", source: "C" },
    ]);
    const r = await new ImapConnector(cfg, () => f.client).fetchNew(null, opts);
    expect(r.messages.map((m) => m.id)).toEqual(["5", "7"]);
    expect(f.calls.fetchedSources).toEqual([5, 7]); // the unrelated message body was never fetched
    expect(r.cursor).toBe("7:7");
    expect(r.more).toBe(false);
    expect(f.calls.released).toBe(1);
    expect((f.calls.searches[0] as { since: Date }).since).toBeInstanceOf(Date); // first sync: recent window only
  });
  it("resumes after the saved UID and starts over when UIDVALIDITY changes", async () => {
    const msgs = [{ uid: 5, from: "a@aexp.com", source: "A" }, { uid: 8, from: "a@aexp.com", source: "B" }];
    const resumed = await new ImapConnector(cfg, () => fakeClient(msgs).client).fetchNew("7:5", opts);
    expect(resumed.messages.map((m) => m.id)).toEqual(["8"]);
    expect(resumed.cursor).toBe("7:8");
    const f = fakeClient(msgs, { validity: 99 });
    const reset = await new ImapConnector(cfg, () => f.client).fetchNew("7:8", opts);
    expect((f.calls.searches[0] as { since?: Date }).since).toBeInstanceOf(Date);
    expect(reset.cursor.startsWith("99:")).toBe(true);
  });
  it("an empty first sync remembers the end of the mailbox so old mail is never read later", async () => {
    const r = await new ImapConnector(cfg, () => fakeClient([], { uidNext: 4321 }).client).fetchNew(null, opts);
    expect(r.messages).toEqual([]);
    expect(r.cursor).toBe("7:4320");
  });
  it("caps a batch and says more is waiting", async () => {
    const msgs = Array.from({ length: 5 }, (_, i) => ({ uid: i + 1, from: "a@aexp.com", source: String(i) }));
    const r = await new ImapConnector(cfg, () => fakeClient(msgs).client).fetchNew(null, { ...opts, max: 2 });
    expect(r.messages.map((m) => m.id)).toEqual(["1", "2"]);
    expect(r.more).toBe(true);
    expect(r.cursor).toBe("7:2");
  });
  it("parses cursors and picks the provider's authentication id", () => {
    expect(parseCursor("7:12")).toEqual({ validity: "7", last: 12 });
    expect(parseCursor("junk")).toBeNull();
    expect(parseCursor(null)).toBeNull();
    expect(authservIdFor("imap.gmail.com")).toBe("mx.google.com");
    expect(authservIdFor("imap.example.com")).toBeUndefined();
    expect(authservIdFor(null)).toBeUndefined();
  });
});

describe("TC-MBX: mail classification", () => {
  it.each([
    ["Your statement is ready", "STATEMENT"],
    ["Your Platinum Card e-statement", "STATEMENT"],
    ["Large purchase alert on your card", "TRANSACTION_ALERT"],
    ["Your Uber One credit was applied", "TRAVEL_CREDIT"],
    ["Airline fee credit posted", "TRAVEL_CREDIT"],
    ["Your Amex Offer cash back was credited", "OFFER_CREDIT"],
    ["Payment due reminder", "ACCOUNT_ALERT"],
    ["Security alert: new sign-in", "ACCOUNT_ALERT"],
    ["Your order confirmation", "PURCHASE_CONFIRMATION"],
    ["Weekend sale", "OTHER"],
  ])("%s → %s", (subject, kind) => {
    expect(classifyMail(subject)).toBe(kind);
  });
  it("looks at the start of the body when the subject says nothing, and has a label for every kind", () => {
    expect(classifyMail("Update", "A statement credit for your hotel booking was applied to your account")).toBe("TRAVEL_CREDIT");
    for (const k of Object.keys(MAIL_KIND_LABEL)) expect(MAIL_KIND_LABEL[k as keyof typeof MAIL_KIND_LABEL]).toBeTruthy();
  });
});

describe("TC-MBX: mailbox service", () => {
  const row = { id: "mb1", userId: "u1", kind: "IMAP" as const, host: "imap.gmail.com", port: 993, username: "me@gmail.com", folder: "INBOX", secretEnc: encryptSecret("app-pass"), cursor: "7:3", active: true };
  const make = (over: { fetch?: () => Promise<unknown>; receive?: jest.Mock; count?: number; dup?: boolean; link?: { id: string; userId: string } | null; owned?: { id: string } | null } = {}) => {
    const prisma = {
      // who a channel belongs to: a member's own sign-in links to a profile; an owner may assign one of their own profiles
      profile: { findUnique: jest.fn().mockResolvedValue(over.link ?? null), findFirst: jest.fn().mockResolvedValue(over.owned ?? null) },
      mailbox: {
        findUniqueOrThrow: jest.fn().mockResolvedValue(row),
        findMany: jest.fn().mockResolvedValue([{ id: "mb1" }]),
        findFirst: jest.fn().mockResolvedValue(row),
        findUnique: jest.fn().mockResolvedValue(over.dup ? row : null),
        count: jest.fn().mockResolvedValue(over.count ?? 0),
        create: jest.fn(async (a: { data: Record<string, unknown> }) => ({ id: "new", createdAt: new Date(), lastSyncAt: null, lastStatus: null, lastError: null, processed: 0, active: true, ...a.data })),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const capture = { receiveFromMailbox: over.receive ?? jest.fn().mockResolvedValue({ accepted: true }) };
    const svc = new MailboxService(prisma as never, capture as never);
    const verify = jest.fn().mockResolvedValue(undefined);
    const fetchNew = jest.fn(over.fetch ?? (async (..._a: unknown[]) => ({ messages: [{ id: "4", raw: Buffer.from("m1") }, { id: "5", raw: Buffer.from("m2") }], cursor: "7:5", more: false })));
    svc.connectorFor = () => ({ verify, fetchNew } as never);
    return { svc, prisma, capture, verify, fetchNew };
  };
  beforeAll(() => { process.env.MAILBOX_ALLOW_PRIVATE_HOSTS = "true"; });
  afterAll(() => { delete process.env.MAILBOX_ALLOW_PRIVATE_HOSTS; });

  it("syncs: passes each message to capture with the provider's auth id, advances the cursor, counts them", async () => {
    const { svc, prisma, capture, fetchNew } = make();
    const r = await svc.sync("mb1");
    expect(r).toMatchObject({ processed: 2, status: "OK" });
    expect(capture.receiveFromMailbox).toHaveBeenCalledTimes(2);
    expect(capture.receiveFromMailbox.mock.calls[0][2]).toBe("mx.google.com");
    expect((fetchNew.mock.calls[0] as unknown[])[0]).toBe("7:3");
    expect(prisma.mailbox.update.mock.calls[0][0].data).toMatchObject({ cursor: "7:5", lastStatus: "OK", lastError: null, processed: { increment: 2 } });
  });
  it("a failing message is skipped, not fatal; a failing fetch keeps the cursor and records the error", async () => {
    const receive = jest.fn().mockRejectedValueOnce(new Error("bad mime")).mockResolvedValue({ accepted: true });
    const a = make({ receive });
    expect(await a.svc.sync("mb1")).toMatchObject({ processed: 1, skipped: 1, status: "OK" });
    const b = make({ fetch: async () => { throw new Error("connection reset"); } });
    expect(await b.svc.sync("mb1")).toMatchObject({ status: "ERROR", processed: 0 });
    const data = b.prisma.mailbox.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ lastStatus: "ERROR", lastError: "connection reset" });
    expect(data.cursor).toBeUndefined();
  });
  it("syncAll adds up every active mailbox", async () => {
    expect(await make().svc.syncAll()).toBe(2);
  });
  it("connect verifies, encrypts the password and never returns it; limits and duplicates are refused", async () => {
    const { svc, prisma, verify } = make();
    const v = await svc.connect("u1", { label: "Mail", host: "imap.example.com", username: "me@example.com", password: "secret-app-pass" });
    expect(verify).toHaveBeenCalled();
    expect(JSON.stringify(v)).not.toContain("secret-app-pass");
    expect(v).not.toHaveProperty("secretEnc");
    const stored = prisma.mailbox.create.mock.calls[0][0].data.secretEnc as string;
    expect(stored).not.toContain("secret-app-pass");
    await expect(make({ count: 3 }).svc.connect("u1", { label: "x", host: "imap.example.com", username: "a@b.c", password: "p" })).rejects.toThrow(/up to 3 mailboxes/);
    await expect(make({ dup: true }).svc.connect("u1", { label: "x", host: "imap.example.com", username: "me@gmail.com", password: "p" })).rejects.toThrow(/already connected/);
  });
  it("a household-wide mailbox has no profile; a member's own is pinned to theirs; an owner can assign one of their members; nobody can pick someone else's", async () => {
    const dto = { label: "Mail", host: "imap.example.com", username: "me@example.com", password: "p" };
    const wide = make();
    await wide.svc.connect("u1", dto);
    expect(wide.prisma.mailbox.create.mock.calls[0][0].data.profileId).toBeNull();
    const mine = make({ link: { id: "p-riley", userId: "owner" } });
    await mine.svc.connect("member", dto);
    expect(mine.prisma.mailbox.create.mock.calls[0][0].data.profileId).toBe("p-riley");
    await expect(make({ link: { id: "p-riley", userId: "owner" } }).svc.connect("member", { ...dto, profileId: "p-someone-else" })).rejects.toThrow(/Unknown household member/);
    const assigned = make({ owned: { id: "p-sam" } });
    await assigned.svc.connect("owner", { ...dto, profileId: "p-sam" });
    expect(assigned.prisma.mailbox.create.mock.calls[0][0].data.profileId).toBe("p-sam");
    await expect(make({ owned: null }).svc.connect("owner", { ...dto, profileId: "p-not-mine" })).rejects.toThrow(/Unknown household member/);
    // the limit is counted per person
    expect(assigned.prisma.mailbox.count).toHaveBeenCalledWith({ where: { userId: "owner", profileId: "p-sam" } });
  });
  it("a bad login surfaces as a clear 400 and nothing is stored", async () => {
    const { svc, prisma, verify } = make();
    verify.mockRejectedValue(new Error("Could not sign in to the mailbox: Invalid credentials"));
    await expect(svc.connect("u1", { label: "x", host: "imap.example.com", username: "a@b.c", password: "p" })).rejects.toThrow(/Could not sign in/);
    expect(prisma.mailbox.create).not.toHaveBeenCalled();
  });
  it("disconnect and syncNow are owner-scoped", async () => {
    const { svc, prisma } = make();
    await expect(svc.disconnect("u1", "mb1")).resolves.toBeUndefined();
    prisma.mailbox.findFirst.mockResolvedValue(null);
    await expect(svc.disconnect("u2", "mb1")).rejects.toThrow(/not found/);
    await expect(svc.syncNow("u2", "mb1")).rejects.toThrow(/not found/);
    expect((await svc.list("u1")).length).toBeGreaterThanOrEqual(0);
  });
});
