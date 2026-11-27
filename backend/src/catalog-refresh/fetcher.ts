import { BadRequestException } from "@nestjs/common";

/**
 * Polite fetcher for public issuer product pages.
 * - https only, to allow-listed issuer domains (CARD_SOURCE_ALLOWED_DOMAINS; plain http only for
 *   CARD_SOURCE_HTTP_HOSTS, meant for tests); every redirect hop is re-validated.
 * - honours robots.txt (User-agent "PointwiseBot" or "*"), one request per host per interval.
 * - conditional GET (ETag / Last-Modified), 2 MB cap, 15 s timeout, HTML/text only.
 * Sends no cookies, credentials or user information.
 */

export const USER_AGENT =
  "PointwiseBot/1.0 (+card catalog refresh; admin-reviewed)";
export const MAX_BYTES = 2 * 1024 * 1024;

export const DEFAULT_ISSUER_DOMAINS = [
  "americanexpress.com",
  "chase.com",
  "citi.com",
  "capitalone.com",
  "bankofamerica.com",
  "barclaycardus.com",
  "barclays.us",
  "wellsfargo.com",
  "discover.com",
  "penfed.org",
  "navyfederal.org",
  "usbank.com",
  "fnbo.com",
  "synchrony.com",
  "mysynchrony.com",
  "goldmansachs.com",
  "marcus.com",
  "td.com",
  "tdbank.com",
  "53.com",
  "pnc.com",
  "regions.com",
  "huntington.com",
  "bmo.com",
  "elanfinancialservices.com",
  // banks, credit unions and fintechs in the issuer registry (seed/real-catalog.more.ts)
  "citizensbank.com",
  "truist.com",
  "key.com",
  "breadfinancial.com",
  "apple.com",
  "alliantcreditunion.org",
  "becu.org",
  "schoolsfirstfcu.org",
  "golden1.com",
  "firsttechfed.com",
  "dcu.org",
  "ncsecu.org",
  "macu.com",
  "americafirst.com",
  "rbfcu.org",
  "ssfcu.org",
  "sdccu.com",
  "biltrewards.com",
  "bilt.com",
  "robinhood.com",
];

export function allowedDomains(env = process.env): string[] {
  const extra = (env.CARD_SOURCE_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return [...DEFAULT_ISSUER_DOMAINS, ...extra];
}

const httpHosts = (env = process.env) =>
  (env.CARD_SOURCE_HTTP_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

/** Hosts a source may be read from: issuer domains plus operator-allowed plain-http test hosts. */
export const allowedSourceHosts = (env = process.env): string[] => [...allowedDomains(env), ...httpHosts(env)];

/** Throws unless the URL points to an allow-listed issuer domain over https (or an allowed test host). */
export function validateSourceUrl(raw: string, env = process.env): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new BadRequestException("Not a valid URL");
  }
  const host = u.hostname.toLowerCase();
  if (u.username || u.password)
    throw new BadRequestException("Credentials in URLs are not allowed");
  const plainOk = u.protocol === "http:" && httpHosts(env).includes(host);
  if (u.protocol !== "https:" && !plainOk)
    throw new BadRequestException("Card sources must use https");
  const domainOk =
    plainOk ||
    allowedDomains(env).some((d) => host === d || host.endsWith(`.${d}`));
  if (!domainOk)
    throw new BadRequestException(
      `${host} is not an allow-listed issuer domain (CARD_SOURCE_ALLOWED_DOMAINS)`,
    );
  return u;
}

// ───────────── robots.txt ─────────────

interface RobotsGroup {
  agents: string[];
  rules: Array<{ allow: boolean; path: string }>;
}

export function parseRobots(text: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((key === "allow" || key === "disallow") && current) {
      if (value) current.rules.push({ allow: key === "allow", path: value });
      lastWasAgent = false;
    } else lastWasAgent = false;
  }
  return groups;
}

/** Longest matching rule wins (Allow on ties); a specific agent group beats "*". */
export function robotsAllows(
  groups: RobotsGroup[],
  path: string,
  agent = "pointwisebot",
): boolean {
  const group =
    groups.find((g) =>
      g.agents.some((a) => a !== "*" && agent.startsWith(a)),
    ) ?? groups.find((g) => g.agents.includes("*"));
  if (!group) return true;
  let best: { allow: boolean; len: number } | null = null;
  for (const r of group.rules) {
    const pattern = r.path
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\\\$$/, "$");
    const re = new RegExp(`^${pattern.endsWith("$") ? pattern : pattern}`);
    if (
      re.test(path) &&
      (!best ||
        r.path.length > best.len ||
        (r.path.length === best.len && r.allow))
    )
      best = { allow: r.allow, len: r.path.length };
  }
  return best ? best.allow : true;
}

// ───────────── fetch ─────────────

export interface FetchResult {
  status: "OK" | "NOT_MODIFIED" | "BLOCKED";
  url: string;
  body?: string;
  etag?: string | null;
  lastModified?: string | null;
  reason?: string;
}

export class PageFetcher {
  private readonly robotsCache = new Map<
    string,
    { groups: RobotsGroup[]; at: number }
  >();
  private readonly lastHit = new Map<string, number>();

  constructor(
    private readonly fetchFn: typeof fetch = fetch,
    private readonly minIntervalMs = Number(
      process.env.CARD_SOURCE_MIN_INTERVAL_MS ?? 5000,
    ),
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((r) => setTimeout(r, ms)),
    /** which addresses may be read (and followed to): issuer domains by default; the cash-back reader gives its own list */
    private readonly validate: (raw: string, env: NodeJS.ProcessEnv) => URL = validateSourceUrl,
    private readonly userAgent: string = USER_AGENT,
  ) {}

  private async politeWait(host: string) {
    const last = this.lastHit.get(host);
    const wait = last == null ? 0 : last + this.minIntervalMs - Date.now();
    if (wait > 0) await this.sleep(wait);
    this.lastHit.set(host, Date.now());
  }

  private async robots(u: URL): Promise<RobotsGroup[]> {
    const key = u.origin;
    const cached = this.robotsCache.get(key);
    if (cached && Date.now() - cached.at < 3_600_000) return cached.groups;
    let groups: RobotsGroup[] = [];
    try {
      await this.politeWait(u.host);
      const res = await this.fetchFn(`${u.origin}/robots.txt`, {
        headers: { "User-Agent": this.userAgent },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 200)
        groups = parseRobots((await res.text()).slice(0, 200_000));
      else if (res.status === 401 || res.status === 403)
        groups = [{ agents: ["*"], rules: [{ allow: false, path: "/" }] }];
    } catch {
      groups = []; // unreachable robots.txt → treat as allow (RFC 9309 §2.3.1.3 allows for 4xx; network errors handled by the page fetch)
    }
    this.robotsCache.set(key, { groups, at: Date.now() });
    return groups;
  }

  async fetch(
    rawUrl: string,
    cond: { etag?: string | null; lastModified?: string | null } = {},
  ): Promise<FetchResult> {
    let url = this.validate(rawUrl, this.env);
    for (let hop = 0; hop < 4; hop++) {
      if (!robotsAllows(await this.robots(url), url.pathname + url.search)) {
        return {
          status: "BLOCKED",
          url: url.href,
          reason: "Disallowed by robots.txt",
        };
      }
      await this.politeWait(url.host);
      const res = await this.fetchFn(url.href, {
        headers: {
          "User-Agent": this.userAgent,
          Accept: "text/html,text/plain;q=0.9",
          ...(hop === 0 && cond.etag && { "If-None-Match": cond.etag }),
          ...(hop === 0 &&
            cond.lastModified && { "If-Modified-Since": cond.lastModified }),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status >= 300 && res.status < 400 && res.status !== 304) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`Redirect without location (${res.status})`);
        url = this.validate(new URL(loc, url).href, this.env); // every hop must stay on an allowed domain
        continue;
      }
      if (res.status === 304) return { status: "NOT_MODIFIED", url: url.href };
      if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (type && !/text\/html|text\/plain|application\/xhtml/i.test(type))
        throw new Error(`Unsupported content type ${type}`);
      const length = Number(res.headers.get("content-length") ?? 0);
      if (length > MAX_BYTES) throw new Error("Page is larger than 2 MB");
      const body = await res.text();
      if (body.length > MAX_BYTES) throw new Error("Page is larger than 2 MB");
      return {
        status: "OK",
        url: url.href,
        body,
        etag: res.headers.get("etag"),
        lastModified: res.headers.get("last-modified"),
      };
    }
    throw new Error("Too many redirects");
  }
}
