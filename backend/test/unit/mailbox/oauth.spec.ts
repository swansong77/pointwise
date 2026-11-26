import { GmailConnector, GraphConnector, OAuthSession } from "../../../src/mailbox/oauth.connectors";
import { buildAuthUrl, challengeFor, credentialsFor, exchangeCode, FetchLike, openState, OAuthError, PROVIDERS, redirectUri, refreshAccess, revokeToken, sealState } from "../../../src/mailbox/oauth";

process.env.TOKEN_ENC_KEY ??= "unit-test-token-enc-key-0123456789abcdef";
const creds = { clientId: "cid", clientSecret: "csecret" };
const allowed = ["alerts.chase.com", "aexp.com"];
const opts = { allowedDomains: allowed, sinceDays: 30, max: 50 };

type Route = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => { status?: number; json?: unknown; text?: string } | undefined;
function fakeFetch(route: Route) {
  const calls: Array<{ url: string; method: string; body?: string; auth?: string }> = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body, auth: init?.headers?.authorization });
    const r = route(url, init) ?? { status: 404 };
    const status = r.status ?? 200;
    const text = r.text ?? JSON.stringify(r.json ?? {});
    return { ok: status < 300, status, json: async () => (r.json ?? JSON.parse(text)), text: async () => text, arrayBuffer: async () => new TextEncoder().encode(text).buffer as ArrayBuffer };
  };
  return { f, calls };
}

describe("TC-OAUTH: authorization URL, state and credentials", () => {
  it("builds the Google URL with offline access, forced consent and the read-only Gmail scope", () => {
    const u = new URL(buildAuthUrl("GMAIL", "cid", "STATE"));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toContain("https://www.googleapis.com/auth/gmail.readonly");
    expect(u.searchParams.get("scope")).not.toMatch(/gmail\.modify|mail\.google\.com/);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("state")).toBe("STATE");
    expect(u.searchParams.get("redirect_uri")).toBe(redirectUri());
    expect(u.searchParams.has("code_challenge")).toBe(false);
  });
  it("builds the Microsoft URL with offline_access, Mail.Read and PKCE (S256)", () => {
    const u = new URL(buildAuthUrl("GRAPH", "cid", "S", "verifier-123"));
    expect(u.origin + u.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(u.searchParams.get("scope")).toBe("offline_access Mail.Read User.Read");
    expect(u.searchParams.get("code_challenge")).toBe(challengeFor("verifier-123"));
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("scope")).not.toMatch(/ReadWrite|Send/);
  });
  it("the redirect address follows APP_URL", () => {
    expect(redirectUri({ APP_URL: "https://pw.example.com/" } as never)).toBe("https://pw.example.com/api/v1/mailboxes/oauth/callback");
    expect(redirectUri({} as never)).toBe("http://localhost:3000/api/v1/mailboxes/oauth/callback");
  });
  it("state is sealed to one user, expires, and cannot be forged or altered", () => {
    const t = sealState({ userId: "u1", kind: "GMAIL" }, 1_000);
    expect(openState(t, 1_000 + 60_000)).toMatchObject({ userId: "u1", kind: "GMAIL" });
    expect(openState(t, 1_000 + 11 * 60_000)).toBeNull(); // expired
    expect(openState(t.slice(0, -4) + "AAAA", 2_000)).toBeNull(); // tampered
    expect(openState("garbage")).toBeNull();
    expect(openState(sealState({ userId: "", kind: "GMAIL" }))).toBeNull();
  });
  it("credentials come from the environment and both parts are required", () => {
    expect(credentialsFor("GMAIL", {} as never)).toBeNull();
    expect(credentialsFor("GMAIL", { GOOGLE_OAUTH_CLIENT_ID: "a" } as never)).toBeNull();
    expect(credentialsFor("GRAPH", { MICROSOFT_OAUTH_CLIENT_ID: " a ", MICROSOFT_OAUTH_CLIENT_SECRET: "b" } as never)).toEqual({ clientId: "a", clientSecret: "b" });
    expect(PROVIDERS.GRAPH.revokeUrl).toBeNull();
  });
});

describe("TC-OAUTH: token requests", () => {
  it("exchanges a code (with the PKCE verifier for Microsoft only) and returns the refresh token", async () => {
    const { f, calls } = fakeFetch(() => ({ json: { access_token: "AT", refresh_token: "RT", expires_in: 3599 } }));
    const t = await exchangeCode("GRAPH", "CODE", creds, "VERIF", f);
    expect(t).toEqual({ accessToken: "AT", refreshToken: "RT", expiresIn: 3599 });
    expect(calls[0].url).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(calls[0].body).toContain("code_verifier=VERIF");
    expect(calls[0].body).toContain("grant_type=authorization_code");
    await exchangeCode("GMAIL", "CODE", creds, "VERIF", f);
    expect(calls[1].body).not.toContain("code_verifier");
  });
  it("a revoked or expired grant is reported as needing reconnection", async () => {
    const { f } = fakeFetch(() => ({ status: 400, json: { error: "invalid_grant" } }));
    const e = await refreshAccess("GMAIL", "RT", creds, f).catch((x) => x);
    expect(e).toBeInstanceOf(OAuthError);
    expect(e.needsReconnect).toBe(true);
    expect(e.message).toMatch(/connect the mailbox again/);
    const other = await refreshAccess("GMAIL", "RT", creds, fakeFetch(() => ({ status: 500, json: {} })).f).catch((x) => x);
    expect(other.needsReconnect).toBe(false);
  });
  it("revokes at Google and does nothing for Microsoft", async () => {
    const g = fakeFetch(() => ({ status: 200 }));
    await revokeToken("GMAIL", "RT", g.f);
    expect(g.calls[0]).toMatchObject({ url: "https://oauth2.googleapis.com/revoke", method: "POST" });
    const m = fakeFetch(() => ({ status: 200 }));
    await revokeToken("GRAPH", "RT", m.f);
    expect(m.calls).toHaveLength(0);
  });
});

const b64url = (s: string) => Buffer.from(s).toString("base64url");
const session = (route: Route, kind: "GMAIL" | "GRAPH" = "GMAIL", onRotate?: (t: string) => Promise<void>): { s: OAuthSession; calls: ReturnType<typeof fakeFetch>["calls"] } => {
  const { f, calls } = fakeFetch((url, init) => {
    if (url.includes("/token")) return { json: { access_token: "AT", ...(kind === "GRAPH" ? { refresh_token: "RT2" } : {}) } };
    return route(url, init);
  });
  return { s: { kind, refreshToken: "RT", creds, fetch: f, onRotate }, calls };
};

describe("TC-GMAIL: connector", () => {
  const NOW = Date.now();
  it("searches by issuer sender with a day-granular after: and fetches raw messages newer than the cursor", async () => {
    const { s, calls } = session((url) => {
      if (url.includes("/messages?")) return { json: { messages: [{ id: "a" }, { id: "b" }, { id: "old" }] } };
      if (url.includes("/messages/a")) return { json: { id: "a", internalDate: String(NOW - 1000), raw: b64url("MSG-A") } };
      if (url.includes("/messages/b")) return { json: { id: "b", internalDate: String(NOW - 500), raw: b64url("MSG-B") } };
      if (url.includes("/messages/old")) return { json: { id: "old", internalDate: String(NOW - 40 * 86_400_000), raw: b64url("OLD") } };
      return undefined;
    });
    const r = await new GmailConnector(s).fetchNew(String(NOW - 5000), opts);
    expect(r.messages.map((m) => [m.id, m.raw.toString()])).toEqual([["a", "MSG-A"], ["b", "MSG-B"]]);
    expect(r.cursor).toBe(String(NOW - 500));
    expect(r.more).toBe(false);
    const list = new URL(calls.find((c) => c.url.includes("/messages?"))!.url);
    expect(list.searchParams.get("q")).toMatch(/^from:\(alerts\.chase\.com OR aexp\.com\) after:\d{4}\/\d{2}\/\d{2}$/);
    expect(calls.find((c) => c.url.includes("/messages/a"))!.url).toContain("format=raw");
    expect(calls.find((c) => c.url.includes("/messages/a"))!.auth).toBe("Bearer AT");
  });
  it("nothing new moves the window forward; a full batch says more is waiting", async () => {
    const empty = session(() => ({ json: {} }));
    const r = await new GmailConnector(empty.s).fetchNew(null, opts);
    expect(r.messages).toEqual([]);
    expect(Number(r.cursor)).toBeGreaterThan(Date.now() - 6 * 60_000);
    const many = session((url) => {
      if (url.includes("/messages?")) return { json: { messages: [{ id: "1" }, { id: "2" }, { id: "3" }] } };
      const id = /messages\/(\d)/.exec(url)![1];
      return { json: { id, internalDate: String(NOW - 1000 + Number(id)), raw: b64url(id) } };
    });
    const m = await new GmailConnector(many.s).fetchNew(String(NOW - 5000), { ...opts, max: 2 });
    expect(m.messages.map((x) => x.id)).toEqual(["1", "2"]);
    expect(m.more).toBe(true);
  });
  it("follows list pages, identifies the address, and surfaces access problems", async () => {
    let page = 0;
    const paged = session((url) => {
      if (url.includes("/messages?")) return { json: page++ === 0 ? { messages: [{ id: "1" }], nextPageToken: "N" } : { messages: [{ id: "2" }] } };
      if (url.endsWith("/profile")) return { json: { emailAddress: "me@gmail.com" } };
      const id = /messages\/(\d)/.exec(url)![1];
      return { json: { id, internalDate: String(NOW), raw: b64url(id) } };
    });
    expect((await new GmailConnector(paged.s).fetchNew(String(NOW - 5000), opts)).messages).toHaveLength(2);
    expect(await new GmailConnector(paged.s).address()).toBe("me@gmail.com");
    await expect(new GmailConnector(session(() => ({ status: 403 })).s).verify()).rejects.toMatchObject({ needsReconnect: true });
    await expect(new GmailConnector(session(() => ({ status: 429 })).s).verify()).rejects.toThrow(/rate-limiting/);
    await expect(new GmailConnector(session(() => ({ status: 500 })).s).verify()).rejects.toThrow(/failed \(500\)/);
  });
});

describe("TC-GRAPH: connector", () => {
  const msg = (id: string, from: string, at: string) => ({ id, receivedDateTime: at, from: { emailAddress: { address: from } } });
  it("lists new mail oldest first, opens only issuer mail, fetches MIME and advances the cursor past everything scanned", async () => {
    const { s, calls } = session((url) => {
      if (url.includes("/messages?"))
        return { json: { value: [msg("1", "no.reply@alerts.chase.com", "2026-11-25T10:00:00Z"), msg("2", "deals@promo.example.org", "2026-11-25T11:00:00Z"), msg("3", "x@aexp.com", "2026-11-25T12:00:00Z")] } };
      if (url.endsWith("/$value")) return { text: `MIME-${/messages\/(\w+)\//.exec(url)![1]}` };
      return undefined;
    }, "GRAPH");
    const r = await new GraphConnector(s).fetchNew("2026-11-25T09:00:00Z", opts);
    expect(r.messages.map((m) => [m.id, m.raw.toString()])).toEqual([["1", "MIME-1"], ["3", "MIME-3"]]);
    expect(r.cursor).toBe("2026-11-25T12:00:00Z");
    expect(calls.some((c) => c.url.includes("/messages/2/"))).toBe(false); // the stranger's message was never opened
    const q = new URL(calls.find((c) => c.url.includes("/messages?"))!.url).searchParams;
    expect(q.get("$filter")).toBe("receivedDateTime gt 2026-11-25T09:00:00Z");
    expect(q.get("$orderby")).toBe("receivedDateTime asc");
  });
  it("starts from the recent window when there is no cursor, follows nextLink, and stops at the page cap", async () => {
    let n = 0;
    const { s, calls } = session((url) => {
      if (url.includes("/messages?") || url.includes("page=")) return { json: { value: [msg(`m${n}`, "z@other.org", `2026-11-25T0${n}:00:00Z`)], "@odata.nextLink": `https://graph.microsoft.com/v1.0/me/messages?page=${++n}` } };
      return undefined;
    }, "GRAPH");
    const r = await new GraphConnector(s).fetchNew(null, opts);
    expect(r.more).toBe(true);
    expect(calls.filter((c) => c.url.includes("/messages")).length).toBe(3);
    expect(r.messages).toEqual([]);
  });
  it("a batch cut short stops the cursor at the last message read; the rotated refresh token is saved", async () => {
    const rotated: string[] = [];
    const { s } = session((url) => {
      if (url.includes("/messages?")) return { json: { value: [msg("1", "a@aexp.com", "2026-11-25T10:00:00Z"), msg("2", "a@aexp.com", "2026-11-25T11:00:00Z"), msg("3", "a@aexp.com", "2026-11-25T12:00:00Z")] } };
      return { text: "M" };
    }, "GRAPH", async (t) => void rotated.push(t));
    const r = await new GraphConnector(s).fetchNew("2026-11-25T00:00:00Z", { ...opts, max: 2 });
    expect(r.messages.map((m) => m.id)).toEqual(["1", "2"]);
    expect(r.more).toBe(true);
    expect(r.cursor).toBe("2026-11-25T11:00:00Z");
    expect(rotated).toEqual(["RT2"]);
  });
  it("identifies the address and reports a failing MIME fetch", async () => {
    const ok = session((url) => (url.includes("$select=mail") ? { json: { mail: "me@outlook.com" } } : undefined), "GRAPH");
    expect(await new GraphConnector(ok.s).address()).toBe("me@outlook.com");
    const upn = session((url) => (url.includes("$select=mail") ? { json: { userPrincipalName: "me@contoso.com" } } : undefined), "GRAPH");
    expect(await new GraphConnector(upn.s).address()).toBe("me@contoso.com");
    await expect(new GraphConnector(ok.s).verify()).resolves.toBeUndefined();
    const bad = session((url) => (url.includes("/messages?") ? { json: { value: [msg("1", "a@aexp.com", "2026-11-25T10:00:00Z")] } } : { status: 500 }), "GRAPH");
    await expect(new GraphConnector(bad.s).fetchNew("2026-11-25T00:00:00Z", opts)).rejects.toThrow(/failed \(500\)/);
  });
});
