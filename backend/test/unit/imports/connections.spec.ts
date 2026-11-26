import {
  BadGatewayException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { decryptSecret, encryptSecret } from "../../../src/common/crypto";
import {
  BankConnector,
  ConnectionsService,
  connectorFromEnv,
  PlaidConnector,
} from "../../../src/portfolio/connections";
import { createPrismaMock, PrismaMock } from "../prisma-mock";

const KEY = "unit-test-token-encryption-key-0123456789";

describe("crypto (AES-256-GCM)", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptSecret("access-sandbox-abc", KEY);
    const b = encryptSecret("access-sandbox-abc", KEY);
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(decryptSecret(a, KEY)).toBe("access-sandbox-abc");
  });
  it("detects tampering, wrong keys and bad formats", () => {
    const c = encryptSecret("secret", KEY);
    const parts = c.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."), KEY)).toThrow();
    expect(() => decryptSecret(c, `${KEY}-other`)).toThrow();
    expect(() => decryptSecret("v2.a.b.c", KEY)).toThrow(/Unsupported/);
    expect(() => encryptSecret("x", "short")).toThrow(/TOKEN_ENC_KEY/);
  });
});

const json = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

describe("PlaidConnector", () => {
  it("calls the sandbox host with credentials and maps credit-card accounts", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const fetchFn = jest.fn(async (url: string, init: RequestInit) => {
      calls.push([url, JSON.parse(init.body as string)]);
      if (url.endsWith("/link/token/create"))
        return json(200, { link_token: "link-sandbox-1" });
      if (url.endsWith("/item/public_token/exchange"))
        return json(200, { access_token: "access-1", item_id: "item-1" });
      if (url.endsWith("/sandbox/public_token/create"))
        return json(200, { public_token: "public-1" });
      if (url.endsWith("/item/remove")) return json(200, {});
      return json(200, {
        item: { institution_name: "Sandbox Bank" },
        accounts: [
          {
            account_id: "a1",
            name: "Plaid Credit Card",
            official_name: "Plaid Diamond 12.5% APR",
            mask: "3333",
            type: "credit",
            subtype: "credit card",
            balances: { limit: 2000 },
          },
          {
            account_id: "a2",
            name: "Checking",
            official_name: null,
            mask: "0000",
            type: "depository",
            subtype: "checking",
            balances: { limit: null },
          },
          {
            account_id: "a3",
            name: "Store card",
            official_name: null,
            mask: null,
            type: "credit",
            subtype: null,
            balances: { limit: null },
          },
        ],
      });
    });
    const p = new PlaidConnector(
      "cid",
      "sec",
      "sandbox",
      fetchFn as unknown as typeof fetch,
    );
    expect(await p.createLinkToken("user-1")).toBe("link-sandbox-1");
    expect(await p.exchange("public-1")).toEqual({
      itemId: "item-1",
      accessToken: "access-1",
      institutionName: null,
    });
    expect(await p.sandboxPublicToken()).toBe("public-1");
    const r = await p.creditAccounts("access-1");
    expect(r.institutionName).toBe("Sandbox Bank");
    expect(r.accounts).toEqual([
      {
        externalId: "a1",
        name: "Plaid Credit Card",
        officialName: "Plaid Diamond 12.5% APR",
        mask: "3333",
        creditLimitCents: 200000,
      },
      {
        externalId: "a3",
        name: "Store card",
        officialName: null,
        mask: null,
        creditLimitCents: null,
      },
    ]);
    await p.remove("access-1");
    expect(calls[0][0]).toBe("https://sandbox.plaid.com/link/token/create");
    expect(calls[0][1]).toMatchObject({
      client_id: "cid",
      secret: "sec",
      products: ["liabilities", "transactions"],
      user: { client_user_id: "user-1" },
    });
  });

  it("maps provider errors to 502 without leaking the message; unknown env falls back to sandbox", async () => {
    const fetchFn = jest.fn(async () =>
      json(400, {
        error_code: "INVALID_PUBLIC_TOKEN",
        error_message: "secret detail",
      }),
    );
    const p = new PlaidConnector(
      "cid",
      "sec",
      "weird",
      fetchFn as unknown as typeof fetch,
    );
    await expect(p.exchange("bad")).rejects.toThrow(BadGatewayException);
    await expect(p.exchange("bad")).rejects.toThrow(
      "Bank provider error: INVALID_PUBLIC_TOKEN",
    );
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toMatch(
      /^https:\/\/sandbox\.plaid\.com/,
    );
    const p2 = new PlaidConnector("cid", "sec", "production", (async () => ({
      ok: false,
      status: 500,
      json: async () => {
        throw new Error("not json");
      },
    })) as unknown as typeof fetch);
    await expect(p2.remove("x")).rejects.toThrow("Bank provider error: 500");
  });

  it("transactionsSync maps Plaid transactions (sign, merchant, category, pending, removed, cursor)", async () => {
    const fetchFn = jest.fn(async () =>
      json(200, {
        added: [
          {
            transaction_id: "t1",
            account_id: "a1",
            amount: 23.45,
            date: "2026-11-02",
            name: "Uber 063015 SF**POOL**",
            merchant_name: "Uber",
            pending: false,
            personal_finance_category: {
              primary: "TRANSPORTATION",
              detailed: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
            },
          },
          {
            transaction_id: "t2",
            account_id: "a1",
            amount: -10,
            date: "2026-11-05",
            name: "UBER CASH CREDIT",
            pending: false,
            category: ["Transfer", "Credit"],
          },
        ],
        modified: [],
        removed: [{ transaction_id: "gone" }],
        next_cursor: "cur-2",
        has_more: false,
      }),
    );
    const p = new PlaidConnector(
      "cid",
      "sec",
      "sandbox",
      fetchFn as unknown as typeof fetch,
    );
    const page = await p.transactionsSync("access-1", "cur-1");
    expect(
      JSON.parse(
        (fetchFn.mock.calls[0] as unknown as [string, RequestInit])[1]
          .body as string,
      ),
    ).toMatchObject({ access_token: "access-1", cursor: "cur-1", count: 500 });
    expect(page.added[0]).toEqual({
      externalId: "plaid:t1",
      accountId: "a1",
      date: new Date("2026-11-02T00:00:00Z"),
      description: "Uber 063015 SF**POOL**",
      merchantName: "Uber",
      signedCents: 2345,
      category: "TRANSPORTATION_TAXIS_AND_RIDE_SHARES",
      pending: false,
    });
    expect(page.added[1]).toMatchObject({
      signedCents: -1000,
      category: "Transfer / Credit",
      merchantName: null,
    });
    expect(page).toMatchObject({
      removed: ["plaid:gone"],
      nextCursor: "cur-2",
      hasMore: false,
    });
  });

  it("connectorFromEnv needs BANK_PROVIDER=plaid and keys", () => {
    expect(connectorFromEnv({})).toBeNull();
    expect(
      connectorFromEnv({ BANK_PROVIDER: "plaid", PLAID_CLIENT_ID: "x" }),
    ).toBeNull();
    const c = connectorFromEnv({
      BANK_PROVIDER: "plaid",
      PLAID_CLIENT_ID: "x",
      PLAID_SECRET: "y",
    }) as PlaidConnector;
    expect(c.env).toBe("sandbox");
  });
});

describe("ConnectionsService", () => {
  let prisma: PrismaMock;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let connector: { [k: string]: any; env: string };
  const households = {
    primary: jest.fn(async () => ({ id: "p1", nickname: "Me" })),
  };
  let svc: ConnectionsService;
  const OLD = process.env.TOKEN_ENC_KEY;

  beforeAll(() => {
    process.env.TOKEN_ENC_KEY = KEY;
  });
  afterAll(() => {
    process.env.TOKEN_ENC_KEY = OLD;
  });
  beforeEach(() => {
    prisma = createPrismaMock();
    connector = {
      provider: "PLAID",
      env: "sandbox",
      createLinkToken: jest.fn(async () => "link-1"),
      exchange: jest.fn(async () => ({
        itemId: "item-1",
        accessToken: "access-1",
        institutionName: null,
      })),
      creditAccounts: jest.fn(async () => ({
        institutionName: "Sandbox Bank",
        accounts: [
          {
            externalId: "a1",
            name: "Card A",
            officialName: "Sandbox Card A",
            mask: "1111",
            creditLimitCents: 500000,
          },
          {
            externalId: "a2",
            name: "Card B",
            officialName: null,
            mask: "2222",
            creditLimitCents: null,
          },
          {
            externalId: "a3",
            name: "Card C",
            officialName: null,
            mask: "3333",
            creditLimitCents: null,
          },
        ],
      })),
      remove: jest.fn(async () => undefined),
      sandboxPublicToken: jest.fn(async () => "public-1"),
    };
    svc = new ConnectionsService(
      prisma as never,
      households as never,
      connector as unknown as BankConnector,
    );
    prisma.bankConnection.findUnique.mockResolvedValue({
      id: "c1",
      userId: "u1",
      accessTokenEnc: encryptSecret("access-1"),
      institutionName: null,
    });
    prisma.wallet.upsert.mockResolvedValue({ id: "w1" });
    prisma.subscription.findUnique.mockResolvedValue({
      plan: "FREE",
      status: "ACTIVE",
    });
    prisma.issuer.upsert.mockResolvedValue({ id: "i1" });
    prisma.rewardCurrency.findFirst.mockResolvedValue({ id: "cash" });
    prisma.creditCard.create.mockResolvedValue({ id: "card-new" });
  });

  it("status, link token and sandbox connect (token stored encrypted)", async () => {
    expect(svc.status()).toEqual({
      enabled: true,
      provider: "PLAID",
      environment: "sandbox",
      sandbox: true,
    });
    expect(await svc.linkToken("u1")).toEqual({ linkToken: "link-1" });
    prisma.bankConnection.upsert.mockResolvedValue({ id: "c1" });
    prisma.walletCard.findMany.mockResolvedValue([]);
    const r = await svc.connectSandbox("u1");
    expect(r).toMatchObject({ id: "c1", accounts: 3, created: 3 });
    const stored = prisma.bankConnection.upsert.mock.calls[0][0].create
      .accessTokenEnc as string;
    expect(stored).not.toContain("access-1");
    expect(decryptSecret(stored)).toBe("access-1");
  });

  it("sync: updates matched cards, creates new private cards, respects the plan limit", async () => {
    prisma.walletCard.findMany.mockResolvedValue([
      {
        id: "wc1",
        nickname: null,
        lastFour: "1111",
        source: "MANUAL",
        sourceRef: null,
        card: { name: "Sandbox Card A", issuer: { name: "Sandbox Bank" } },
      },
      {
        id: "wc2",
        nickname: null,
        lastFour: null,
        source: "BANK",
        sourceRef: "a2",
        card: { name: "Card B", issuer: { name: "Sandbox Bank" } },
      },
      {
        id: "x3",
        nickname: null,
        lastFour: null,
        source: "MANUAL",
        sourceRef: null,
        card: { name: "Other", issuer: { name: "Elsewhere" } },
      },
      {
        id: "x4",
        nickname: null,
        lastFour: null,
        source: "MANUAL",
        sourceRef: null,
        card: { name: "Other2", issuer: { name: "Elsewhere" } },
      },
      {
        id: "x5",
        nickname: null,
        lastFour: null,
        source: "MANUAL",
        sourceRef: null,
        card: { name: "Other3", issuer: { name: "Elsewhere" } },
      },
    ]);
    const r = await svc.sync("u1", "c1", new Date("2026-11-21T00:00:00Z"));
    expect(r).toMatchObject({
      accounts: 3,
      updated: 2,
      created: 0,
      skipped: 1,
    }); // free plan: 5 cards max
    expect(prisma.walletCard.update.mock.calls[0][0]).toMatchObject({
      where: { id: "wc1" },
      data: { creditLimitCents: 500000, lastFour: "1111" },
    });
    expect(
      prisma.walletCard.update.mock.calls[0][0].data.sourceRef,
    ).toBeUndefined(); // manual cards keep their source
    expect(prisma.walletCard.update.mock.calls[1][0]).toMatchObject({
      where: { id: "wc2" },
      data: { lastFour: "2222", sourceRef: "a2" },
    });
    expect(prisma.bankConnection.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { lastSyncedAt: expect.any(Date), institutionName: "Sandbox Bank" },
    });
  });

  it("sync creates cards as private (ownerId) with BANK source", async () => {
    prisma.walletCard.findMany.mockResolvedValue([]);
    prisma.subscription.findUnique.mockResolvedValue({
      plan: "PRO",
      status: "ACTIVE",
    });
    await svc.sync("u1", "c1");
    expect(prisma.creditCard.create.mock.calls[0][0].data).toMatchObject({
      ownerId: "u1",
      isActive: false,
      name: "Sandbox Card A",
    });
    expect(prisma.walletCard.create.mock.calls[0][0].data).toMatchObject({
      source: "BANK",
      sourceRef: "a1",
      profileId: "p1",
      lastFour: "1111",
    });
  });

  it("sync fails cleanly when the catalog is not seeded", async () => {
    prisma.walletCard.findMany.mockResolvedValue([]);
    prisma.rewardCurrency.findFirst.mockResolvedValue(null);
    await expect(svc.sync("u1", "c1")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("ownership, disconnect (provider failure tolerated) and syncAll", async () => {
    prisma.bankConnection.findUnique.mockResolvedValueOnce({
      id: "c1",
      userId: "someone-else",
    });
    await expect(svc.sync("u1", "c1")).rejects.toThrow(NotFoundException);
    connector.remove.mockRejectedValueOnce(new Error("provider down"));
    await svc.disconnect("u1", "c1");
    expect(prisma.bankConnection.delete).toHaveBeenCalledWith({
      where: { id: "c1" },
    });
    prisma.bankConnection.findMany.mockResolvedValue([
      { id: "c1", userId: "u1" },
      { id: "c2", userId: "u2" },
    ]);
    prisma.walletCard.findMany.mockResolvedValue([]);
    prisma.bankConnection.findUnique.mockImplementation(
      async ({ where }: { where: { id: string } }) =>
        where.id === "c1"
          ? {
              id: "c1",
              userId: "u1",
              accessTokenEnc: encryptSecret("access-1"),
            }
          : null,
    );
    expect(await svc.syncAll()).toBe(1);
  });

  it("list and sandbox guard", async () => {
    prisma.bankConnection.findMany.mockResolvedValue([{ id: "c1" }]);
    expect(await svc.list("u1")).toEqual([{ id: "c1" }]);
    connector.env = "production";
    await expect(svc.connectSandbox("u1")).rejects.toThrow(ForbiddenException);
  });

  it("without a connector everything provider-related is 503 and syncAll is a no-op", async () => {
    const off = new ConnectionsService(
      prisma as never,
      households as never,
      null,
    );
    expect(off.status()).toEqual({
      enabled: false,
      provider: null,
      environment: null,
      sandbox: false,
    });
    await expect(off.linkToken("u1")).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(await off.syncAll()).toBe(0);
    await off.disconnect("u1", "c1");
    expect(prisma.bankConnection.delete).toHaveBeenCalled();
  });
  it("sync pulls posted transactions into spend tracking (pending and unknown accounts skipped, removed deleted, cursor saved)", async () => {
    const tx = (
      id: string,
      accountId: string,
      signedCents: number,
      description: string,
      pending = false,
    ) => ({
      externalId: `plaid:${id}`,
      accountId,
      date: new Date("2026-11-02T00:00:00Z"),
      description,
      merchantName: null,
      signedCents,
      category: null,
      pending,
    });
    const spend = {
      ingest: jest.fn(async (_u: string, _wc: string, rows: unknown[]) => ({
        imported: rows.length,
        duplicates: 0,
        benefitUpdates: rows.map(() => ({})),
      })),
    };
    connector.transactionsSync = jest
      .fn()
      .mockResolvedValueOnce({
        added: [
          tx("t1", "a1", 2345, "UBER TRIP"),
          tx("t2", "a1", -1000, "UBER CASH CREDIT"),
          tx("t3", "a1", 500, "PENDING CHARGE", true),
          tx("t4", "zz", 100, "OTHER ACCOUNT"),
        ],
        modified: [],
        removed: [],
        nextCursor: "cur-1",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        added: [],
        modified: [tx("t5", "a2", 700, "COFFEE")],
        removed: ["plaid:old"],
        nextCursor: "cur-2",
        hasMore: false,
      });
    svc = new ConnectionsService(
      prisma as never,
      households as never,
      connector as unknown as BankConnector,
      spend as never,
    );
    prisma.walletCard.findMany.mockResolvedValue([]);
    prisma.wallet.findUnique.mockResolvedValue({
      cards: [
        {
          id: "wcA",
          sourceRef: null,
          sourceMeta: { accountId: "a1", connectionId: "c1" },
        },
        { id: "wcB", sourceRef: "a2", sourceMeta: null },
      ],
    });
    prisma.transaction.deleteMany.mockResolvedValue({ count: 1 });
    const r = await svc.sync("u1", "c1");
    expect(r.transactions).toEqual({
      imported: 3,
      removed: 1,
      benefitUpdates: 3,
      pages: 2,
    });
    expect(connector.transactionsSync).toHaveBeenNthCalledWith(
      1,
      "access-1",
      null,
    );
    expect(connector.transactionsSync).toHaveBeenNthCalledWith(
      2,
      "access-1",
      "cur-1",
    );
    const [, wc, rows, source] = spend.ingest.mock.calls[0] as unknown as [
      string,
      string,
      Array<{ kind: string; amountCents: number }>,
      string,
    ];
    expect([wc, source]).toEqual(["wcA", "BANK"]);
    expect(rows.map((x) => `${x.kind}:${x.amountCents}`)).toEqual([
      "PURCHASE:2345",
      "CREDIT:1000",
    ]);
    expect(prisma.transaction.deleteMany).toHaveBeenCalledWith({
      where: { userId: "u1", externalId: { in: ["plaid:old"] } },
    });
    expect(prisma.bankConnection.update).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: expect.objectContaining({
        txCursor: "cur-2",
        needsReauth: false,
        lastError: null,
      }),
    });
  });

  it("a failing transactions sync does not break the account sync", async () => {
    connector.transactionsSync = jest.fn(async () => {
      throw new Error("PRODUCT_NOT_READY");
    });
    svc = new ConnectionsService(
      prisma as never,
      households as never,
      connector as unknown as BankConnector,
      { ingest: jest.fn() } as never,
    );
    prisma.walletCard.findMany.mockResolvedValue([]);
    prisma.wallet.findUnique.mockResolvedValue({ cards: [] });
    const r = await svc.sync("u1", "c1");
    expect(r).toMatchObject({
      accounts: 3,
      transactions: { error: expect.stringMatching(/could not be synced/) },
    });
  });

  describe("Plaid webhook", () => {
    const { generateKeyPairSync, sign, createHash } =
      require("crypto") as typeof import("crypto");
    const { privateKey, publicKey } = generateKeyPairSync("ec", {
      namedCurve: "P-256",
    });
    const jwk = publicKey.export({ format: "jwk" });
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString("base64url");
    const jwt = (
      body: Buffer,
      over: { alg?: string; iat?: number; hash?: string } = {},
    ) => {
      const h = b64({ alg: over.alg ?? "ES256", kid: "k1", typ: "JWT" });
      const p = b64({
        iat: over.iat ?? Math.floor(Date.now() / 1000),
        request_body_sha256:
          over.hash ?? createHash("sha256").update(body).digest("hex"),
      });
      const s = sign("sha256", Buffer.from(`${h}.${p}`), {
        key: privateKey,
        dsaEncoding: "ieee-p1363",
      }).toString("base64url");
      return `${h}.${p}.${s}`;
    };
    const body = (o: object) => Buffer.from(JSON.stringify(o));

    beforeEach(() => {
      connector.webhookKey = jest.fn(async () => jwk);
      connector.transactionsSync = jest.fn(async () => ({
        added: [],
        modified: [],
        removed: [],
        nextCursor: "n",
        hasMore: false,
      }));
      svc = new ConnectionsService(
        prisma as never,
        households as never,
        connector as unknown as BankConnector,
        { ingest: jest.fn() } as never,
      );
      prisma.bankConnection.findFirst.mockResolvedValue({
        id: "c1",
        userId: "u1",
        accessTokenEnc: encryptSecret("access-1"),
        txCursor: "cur",
      });
      prisma.wallet.findUnique.mockResolvedValue({ cards: [] });
    });

    it("verified TRANSACTIONS webhook syncs new transactions; ITEM errors flag the connection for sign-in", async () => {
      const b = body({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "item-1",
      });
      expect(await svc.webhook(b, jwt(b))).toEqual({
        handled: true,
        type: "TRANSACTIONS/SYNC_UPDATES_AVAILABLE",
      });
      await new Promise((r) => setImmediate(r));
      expect(connector.transactionsSync).toHaveBeenCalledWith(
        "access-1",
        "cur",
      );
      const e = body({
        webhook_type: "ITEM",
        webhook_code: "ERROR",
        item_id: "item-1",
        error: { error_code: "ITEM_LOGIN_REQUIRED" },
      });
      await svc.webhook(e, jwt(e));
      expect(prisma.bankConnection.update).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: { needsReauth: true, lastError: "ITEM_LOGIN_REQUIRED" },
      });
      const fixed = body({
        webhook_type: "ITEM",
        webhook_code: "LOGIN_REPAIRED",
        item_id: "item-1",
      });
      await svc.webhook(fixed, jwt(fixed));
      expect(prisma.bankConnection.update).toHaveBeenLastCalledWith({
        where: { id: "c1" },
        data: { needsReauth: false, lastError: null },
      });
      expect(connector.webhookKey).toHaveBeenCalledTimes(1); // key cached
    });

    it("rejects missing, forged, stale, wrong-algorithm and body-mismatched webhooks", async () => {
      const b = body({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "item-1",
      });
      await expect(svc.webhook(b, undefined)).rejects.toThrow(
        ForbiddenException,
      );
      const good = jwt(b);
      const forged = `${good.split(".").slice(0, 2).join(".")}.${jwt(body({ other: true })).split(".")[2]}`;
      await expect(svc.webhook(b, forged)).rejects.toThrow(ForbiddenException);
      await expect(
        svc.webhook(b, jwt(b, { iat: Math.floor(Date.now() / 1000) - 600 })),
      ).rejects.toThrow(ForbiddenException);
      await expect(svc.webhook(b, jwt(b, { alg: "HS256" }))).rejects.toThrow(
        ForbiddenException,
      );
      await expect(svc.webhook(b, jwt(b, { hash: "abc" }))).rejects.toThrow(
        /does not match/,
      );
      await expect(svc.webhook(b, "not.a.jwt")).rejects.toThrow(
        ForbiddenException,
      );
      prisma.bankConnection.findFirst.mockResolvedValue(null);
      expect(await svc.webhook(b, jwt(b))).toEqual({ handled: false });
    });

    it("update-mode link token for re-linking", async () => {
      prisma.bankConnection.findUnique.mockResolvedValue({
        id: "c1",
        userId: "u1",
        accessTokenEnc: encryptSecret("access-1"),
      });
      expect(await svc.relinkToken("u1", "c1")).toEqual({
        linkToken: "link-1",
      });
      expect(connector.createLinkToken).toHaveBeenCalledWith("u1", {
        accessToken: "access-1",
      });
      await expect(svc.relinkToken("other", "c1")).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
