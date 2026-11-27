/**
 * Cash-back and points shopping sites (pure, no database): how a rate is read from text, how fresh and dependable a rate is, whether a
 * site looks reachable, and which site to use for a purchase. Free sites only; nothing here signs in to anything or changes any account.
 */

export type RateMethod = 'MANUAL' | 'CSV' | 'PASTE' | 'AUTO';
export type Freshness = 'FRESH' | 'RECENT' | 'AGING' | 'STALE';
export type Health = 'UP' | 'DOWN' | 'UNKNOWN';

const DAY = 86_400_000;
/** an "up to X%" rate is the best case; the plan counts this share of it */
export const UP_TO_FACTOR = 0.6;
/** a site is called DOWN only after this many failed checks in a row, so one blip does not alarm */
export const DOWN_AFTER_FAILURES = 2;

// ───────────── reading rates from text ─────────────

export interface ReadRate {
  ratePercent: number | null;
  pointsPerDollar: number | null;
  upTo: boolean;
  /** the words the rate was read from */
  evidence: string;
  /** other rates on the same page (often a promotion on selected items), kept as a note and never used as the store rate */
  alsoSeen: string[];
}

const PCT = /(up\s+to\s+)?(?<![\d.])(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(?:cash\s*back|of\s+the\s+price\s+back|back|cashback|rewards?)/gi;
const PTS = /(up\s+to\s+)?(?<![\d.])(\d{1,3}(?:\.\d{1,2})?)\s*(?:points?|pts|miles?)\s*(?:per|\/|for\s+every)\s*\$\s*1\b/gi;
const NONE = /\bno\s+cash\s*back\b|\bno\s+rewards?\b/i;

/**
 * The store rate on a page of text (a pasted rates page, or a store page read by the reader). The first rate that is stated wins: pages
 * lead with the store-wide rate and mention promotions and category rates after it. "Up to" marks a best case.
 */
export function readRateText(text: string): ReadRate | null {
  const t = text.replace(/\s+/g, ' ').slice(0, 20_000);
  type Hit = { index: number; percent?: number; points?: number; upTo: boolean; raw: string };
  const hits: Hit[] = [];
  for (const m of t.matchAll(PCT)) hits.push({ index: m.index ?? 0, percent: Number(m[2]), upTo: !!m[1], raw: m[0].trim() });
  for (const m of t.matchAll(PTS)) hits.push({ index: m.index ?? 0, points: Number(m[2]), upTo: !!m[1], raw: m[0].trim() });
  const none = NONE.exec(t);
  if (none && (!hits.length || (none.index ?? 0) < Math.min(...hits.map((h) => h.index)))) {
    return { ratePercent: 0, pointsPerDollar: null, upTo: false, evidence: none[0], alsoSeen: hits.map((h) => h.raw).slice(0, 3) };
  }
  if (!hits.length) return null;
  hits.sort((a, b) => a.index - b.index);
  const first = hits[0];
  if ((first.percent ?? first.points ?? 0) > 100) return null;
  return {
    ratePercent: first.percent ?? null,
    pointsPerDollar: first.points ?? null,
    upTo: first.upTo,
    evidence: first.raw,
    alsoSeen: [...new Set(hits.slice(1).map((h) => h.raw))].slice(0, 3),
  };
}

// ───────────── a comparison page (Cashback Monitor and similar) ─────────────

/** The names a comparison page uses for each site we know, so one pasted page can fill in many sites at once. */
export const SITE_ALIASES: Array<{ code: string; names: string[] }> = [
  { code: 'rakuten', names: ['Rakuten', 'Rakuten Rewards', 'Ebates'] },
  { code: 'topcashback', names: ['TopCashback', 'Top Cashback'] },
  { code: 'befrugal', names: ['BeFrugal'] },
  { code: 'mrrebates', names: ['Mr. Rebates', 'Mr Rebates', 'MrRebates'] },
  { code: 'extrabux', names: ['ExtraBux', 'Extrabux'] },
  { code: 'shopback', names: ['ShopBack'] },
  { code: 'retailmenot', names: ['RetailMeNot'] },
  { code: 'couponfollow', names: ['CouponFollow'] },
  { code: 'rebatesme', names: ['RebatesMe'] },
  { code: 'inboxdollars', names: ['InboxDollars'] },
  { code: 'goodshop', names: ['Goodshop'] },
  { code: 'mypoints', names: ['MyPoints'] },
  { code: 'swagbucks', names: ['Swagbucks'] },
  { code: 'upromise', names: ['Upromise', 'UPromise'] },
  { code: 'capitalone-shopping', names: ['Capital One Shopping'] },
  { code: 'aadvantage-eshopping', names: ['AAdvantage eShopping', 'American AAdvantage'] },
  { code: 'united-shopping', names: ['United MileagePlus Shopping', 'United Mileage Plus'] },
  { code: 'delta-shopping', names: ['Delta SkyMiles Shopping'] },
  { code: 'southwest-shopping', names: ['Southwest Rapid Rewards Shopping'] },
];

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = new Map<string, string>();
for (const a of SITE_ALIASES) for (const n of a.names) ALIAS.set(norm(n), a.code);
/** longest first, so "Capital One Shopping" is matched before anything shorter inside it */
const ALIAS_KEYS = [...ALIAS.keys()].sort((a, b) => b.length - a.length);

/** The site code for a name as a comparison page writes it ("Top Cashback" is topcashback), or null. */
export function siteCodeFor(name: string): string | null {
  return ALIAS.get(norm(name)) ?? null;
}

/** The store's page on Cashback Monitor, where every site's current rate for it is compared. Their addresses are the store's name, lower-cased, with dashes. */
export function monitorUrl(merchantName: string): string {
  const slug = merchantName.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `https://www.cashbackmonitor.com/cashback-store/${slug}/`;
}

// ───────────── reading a public store page ─────────────

/** The store's name as the sites write it in addresses: lower-case, with dashes ("Best Buy" is best-buy). */
export const slugOf = (name: string): string => name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** A site's public page for a store, from the site's address pattern: {host} is the store's web address, {slug} its dashed name. */
export function storeUrl(template: string | null, m: { name: string; hosts: string[] }): string | null {
  if (!template) return null;
  const host = [...m.hosts].sort((a, b) => a.length - b.length)[0];
  if (template.includes('{host}') && !host) return null;
  return template.replace('{host}', host ?? '').replace('{slug}', slugOf(m.name));
}

const stripTags = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function between(html: string, re: RegExp): string | null {
  const m = re.exec(html);
  return m ? stripTags(m[1]) : null;
}

export interface StoreRead extends ReadRate {
  /** which part of the page it was read from */
  where: 'title' | 'heading' | 'description' | 'text';
}

/**
 * The store-wide rate on a site's public store page. The page's title, then its main heading and description, are tried first because they
 * state the store's own rate; only then the text around the store's name. A banner far from the store's name (such as "up to 40% at hundreds of
 * stores") is never read as the store's rate.
 */
export function readStorePage(html: string, merchantName: string): StoreRead | null {
  const parts: Array<[StoreRead['where'], string | null]> = [
    ['title', between(html, /<title[^>]*>([\s\S]*?)<\/title>/i)],
    ['heading', between(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)],
    ['description', (/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']*)["']/i.exec(html) ?? /<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["'](?:og:)?description["']/i.exec(html))?.[1] ?? null],
  ];
  for (const [where, text] of parts) {
    if (!text || !text.toLowerCase().includes(merchantName.toLowerCase().split(/\s+/)[0])) continue;
    const r = readRateText(text);
    if (r) return { ...r, where };
  }
  // loose text is the weakest evidence: the page body only (not its head), a short way after the store's name, and never an "up to" claim,
  // because a site-wide banner ("up to 40% at over 3,500 stores") looks exactly like that
  const bodyHtml = html.replace(/<head[\s\S]*?<\/head>/i, ' ').replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const body = stripTags(bodyHtml);
  const at = body.toLowerCase().indexOf(merchantName.toLowerCase());
  if (at < 0) return null;
  const r = readRateText(body.slice(at, at + 300));
  return r && !r.upTo ? { ...r, where: 'text' } : null;
}

/** The best rate a comparison page headlines across all sites: the first percentage in its title ("Target ... 5% ($10**)"). */
export function readMonitorBest(html: string): number | null {
  const title = between(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const m = title ? /(?<![\d.])(\d{1,2}(?:\.\d{1,2})?)\s*%/.exec(title) : null;
  return m ? Number(m[1]) : null;
}

export interface ComparisonRate {
  site: string;
  siteName: string;
  ratePercent: number | null;
  pointsPerDollar: number | null;
  upTo: boolean;
  /** why the rate is only a best case (a star on the rate means a special or "up to" rate) */
  note: string | null;
  evidence: string;
}

const CELL_PCT = /(up\s+to\s+)?(?<![\d.])(\d{1,2}(?:\.\d{1,2})?)\s*%\s*(\*+)?/i;
const CELL_PTS = /(?<![\d.])(\d{1,3}(?:\.\d{1,2})?)\s*(?:mi\.?|miles?|pts?|points?)\s*\/\s*\$/i;

/**
 * A pasted comparison page: one store, many sites, each with its rate. Reads every line that names a site we know and takes the rate on the
 * same line or the next lines before another site is named. A star after a rate means "special rate for new members, or an up-to rate", so it
 * is counted as an "up to". Names it does not know are returned so the administrator can add them. Layout of the live page was not verified.
 */
export function readComparisonText(text: string): { rates: ComparisonRate[]; unknown: string[] } {
  // pasted from a browser it is plain text; from a saved page it can be markdown links and images: keep the link text only
  const lines = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const findSite = (line: string) => {
    const n = norm(line.replace(/[0-9.%*()$]/g, ' '));
    // the site name is at the start of the line or stands alone: a rate never starts a name
    for (const k of ALIAS_KEYS) if (n.startsWith(k)) return { code: ALIAS.get(k) as string, key: k };
    return null;
  };
  const rates: ComparisonRate[] = [];
  const unknown = new Set<string>();
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const site = findSite(lines[i]);
    if (!site) {
      const m = /^([A-Za-z][A-Za-z0-9 .&'-]{2,30}?)\s+(?:up\s+to\s+)?\d{1,2}(?:\.\d+)?\s*%/i.exec(lines[i]);
      if (m && !/(cash\s*back|price back|rate|store|best)/i.test(m[1])) unknown.add(m[1].trim());
      continue;
    }
    if (seen.has(site.code)) continue;
    // the rate: on this line after the name, else on the next lines until another site is named
    let hit: RegExpExecArray | null = null;
    let pts: RegExpExecArray | null = null;
    let at = lines[i];
    for (let j = i; j < Math.min(lines.length, i + 4) && !hit && !pts; j++) {
      if (j > i && findSite(lines[j])) break;
      at = lines[j];
      hit = CELL_PCT.exec(lines[j]);
      pts = hit ? null : CELL_PTS.exec(lines[j]);
    }
    if (!hit && !pts) continue;
    seen.add(site.code);
    const siteName = SITE_ALIASES.find((a) => a.code === site.code)!.names[0];
    if (hit) {
      const star = !!hit[3];
      rates.push({ site: site.code, siteName, ratePercent: Number(hit[2]), pointsPerDollar: null, upTo: !!hit[1] || star, note: star ? 'A special rate for new members, or an "up to" rate.' : null, evidence: at.slice(0, 80) });
    } else if (pts) {
      rates.push({ site: site.code, siteName, ratePercent: null, pointsPerDollar: Number(pts[1]), upTo: false, note: null, evidence: at.slice(0, 80) });
    }
  }
  return { rates, unknown: [...unknown].slice(0, 20) };
}

export interface CsvRate {
  line: number;
  site: string;
  merchant: string;
  ratePercent: number | null;
  pointsPerDollar: number | null;
  upTo: boolean;
  expiresAt: Date | null;
  conditions: string | null;
  source: string | null;
}
export interface CsvResult {
  rows: CsvRate[];
  errors: Array<{ line: number; message: string }>;
}

function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

const HEAD: Record<string, string> = {
  site: 'site', portal: 'site', 'cash back site': 'site', 'cashback site': 'site',
  merchant: 'merchant', store: 'merchant', retailer: 'merchant',
  rate: 'rate', percent: 'rate', 'cash back': 'rate', cashback: 'rate',
  points: 'points', 'points per dollar': 'points', 'points per $1': 'points', ppd: 'points',
  expires: 'expires', 'expires on': 'expires', expiry: 'expires', 'ends': 'expires',
  conditions: 'conditions', terms: 'conditions', notes: 'conditions',
  source: 'source',
};

/** A rates spreadsheet saved as CSV: site, merchant, rate (5%, up to 5%), points (per dollar), expires, conditions, source. */
export function parseRatesCsv(text: string, now: Date = new Date()): CsvResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const result: CsvResult = { rows: [], errors: [] };
  if (!lines.length) return result;
  const headers = csvLine(lines[0]).map((h) => HEAD[h.toLowerCase()] ?? '');
  if (!headers.includes('site') || !headers.includes('merchant') || !(headers.includes('rate') || headers.includes('points'))) {
    result.errors.push({ line: 1, message: 'The first row must name the columns: site, merchant, and rate (or points).' });
    return result;
  }
  lines.slice(1).forEach((l, idx) => {
    const line = idx + 2;
    const cells = csvLine(l);
    const get = (k: string) => (cells[headers.indexOf(k)] ?? '').trim();
    const site = get('site');
    const merchant = get('merchant');
    if (!site || !merchant) return result.errors.push({ line, message: 'A row needs both a site and a merchant.' });
    let ratePercent: number | null = null;
    let upTo = false;
    const rateText = get('rate');
    if (rateText) {
      const m = /^(up\s+to\s+)?(\d{1,2}(?:\.\d{1,2})?)\s*%?$/i.exec(rateText);
      if (!m || Number(m[2]) > 100) return result.errors.push({ line, message: `"${rateText}" is not a rate (use 5, 5% or up to 5%).` });
      ratePercent = Number(m[2]);
      upTo = !!m[1];
    }
    let pointsPerDollar: number | null = null;
    if (get('points')) {
      const n = Number(get('points').replace(/[^\d.]/g, ''));
      if (!Number.isFinite(n) || n <= 0 || n > 200) return result.errors.push({ line, message: `"${get('points')}" is not a points rate.` });
      pointsPerDollar = n;
    }
    if (ratePercent == null && pointsPerDollar == null) return result.errors.push({ line, message: 'A row needs a rate or a points rate.' });
    let expiresAt: Date | null = null;
    if (get('expires')) {
      const d = new Date(get('expires'));
      if (Number.isNaN(d.getTime())) return result.errors.push({ line, message: `"${get('expires')}" is not a date (use 2026-12-31).` });
      expiresAt = d;
    }
    result.rows.push({ line, site, merchant, ratePercent, pointsPerDollar, upTo, expiresAt, conditions: get('conditions') || null, source: get('source') || null });
  });
  void now;
  return result;
}

// ───────────── freshness, reliability, health ─────────────

export function freshness(observedAt: Date, now: Date): Freshness {
  const days = (now.getTime() - observedAt.getTime()) / DAY;
  return days <= 3 ? 'FRESH' : days <= 14 ? 'RECENT' : days <= 30 ? 'AGING' : 'STALE';
}

const METHOD_BASE: Record<string, number> = { AUTO: 75, PASTE: 65, CSV: 60, MANUAL: 60 };
const STALE_PENALTY: Record<Freshness, number> = { FRESH: 0, RECENT: 8, AGING: 20, STALE: 40 };

export interface RateRow {
  site: string;
  ratePercent: number | null;
  pointsPerDollar: number | null;
  upTo: boolean;
  observedAt: Date;
  expiresAt: Date | null;
  method: string;
  source: string;
  conditions: string | null;
  merchant?: string;
}

/** 0 to 100: how far to trust a rate. How it was learned, how old it is, and whether it is only an "up to". An expired rate is 0. */
export function rateReliability(r: Pick<RateRow, 'method' | 'observedAt' | 'upTo' | 'expiresAt'>, now: Date): number {
  if (r.expiresAt && r.expiresAt.getTime() < now.getTime()) return 0;
  const v = (METHOD_BASE[r.method] ?? 55) - STALE_PENALTY[freshness(r.observedAt, now)] - (r.upTo ? 15 : 0);
  return Math.max(5, Math.min(100, v));
}

export interface SiteInfo {
  code: string;
  name: string;
  kind: 'CASHBACK' | 'POINTS';
  homeUrl: string;
  pointCents: number | null;
  isActive: boolean;
  reachable: boolean | null;
  lastCheckedAt: Date | null;
  failures: number;
  autoRead?: boolean;
  lastReadAt?: Date | null;
}

export function siteHealth(s: Pick<SiteInfo, 'reachable' | 'lastCheckedAt' | 'failures'>, now: Date): { state: Health; note: string } {
  if (!s.lastCheckedAt || s.reachable == null) return { state: 'UNKNOWN', note: 'Not checked yet.' };
  const days = Math.floor((now.getTime() - s.lastCheckedAt.getTime()) / DAY);
  if (s.reachable === false) {
    return s.failures >= DOWN_AFTER_FAILURES
      ? { state: 'DOWN', note: `Did not answer the last ${s.failures} checks.` }
      : { state: 'UNKNOWN', note: 'One check failed; checking again.' };
  }
  if (days > 7) return { state: 'UNKNOWN', note: `Last checked ${days} days ago.` };
  return { state: 'UP', note: days <= 0 ? 'Answered today.' : `Answered ${days} day${days === 1 ? '' : 's'} ago.` };
}

// ───────────── ranking and the recommendation ─────────────

export interface RankedSite {
  site: string;
  name: string;
  kind: 'CASHBACK' | 'POINTS';
  /** the rate as the site states it */
  label: string;
  percent: number;
  upTo: boolean;
  /** what the plan counts: an "up to" rate at a haircut, points at their value */
  expectedPercent: number;
  expectedCents: number;
  reliability: number;
  freshness: Freshness;
  health: Health;
  healthNote: string;
  /** can be relied on right now (not expired, site not down) */
  usable: boolean;
  hasAccount: boolean;
  /** who in the household has an account */
  holders: string[];
  conditions: string | null;
  observedAt: string;
  method: string;
  url: string;
  warnings: string[];
}

export interface CashbackInput {
  amountCents: number;
  merchantName: string;
  rates: RateRow[];
  sites: SiteInfo[];
  /** site code -> household members who have an account there */
  accounts: Map<string, string[]>;
  /** the card the plan pays with, for the steps */
  payWith?: string | null;
  /** the best rate a comparison site headlines for this store across all sites */
  benchmark?: { source: string; bestPercent: number; observedAt: Date; url: string } | null;
  now: Date;
}

export interface CashbackRecommendation {
  /** the household has told PointWise which sites they use */
  haveAccounts: boolean;
  /** the site to use: the best usable one among the household's accounts, or (when none are recorded) the best usable one overall */
  pick: RankedSite | null;
  /** a usable site nobody in the household has joined that would return noticeably more than the pick */
  consider: (RankedSite & { extraCents: number }) | null;
  ranked: RankedSite[];
  steps: string[];
  warnings: string[];
  /** what a comparison site headlines as the best rate for this store, when it was read recently */
  benchmark: { source: string; bestPercent: number; observedAt: string; url: string } | null;
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0$/, '')}%`;

export function rankSites(i: CashbackInput): RankedSite[] {
  const sites = new Map(i.sites.filter((s) => s.isActive).map((s) => [s.code, s]));
  const out: RankedSite[] = [];
  for (const r of i.rates) {
    const s = sites.get(r.site);
    if (!s) continue;
    const expired = !!r.expiresAt && r.expiresAt.getTime() < i.now.getTime();
    const isPoints = r.ratePercent == null && r.pointsPerDollar != null;
    const headline = r.ratePercent ?? (r.pointsPerDollar as number) * (s.pointCents ?? 1);
    const expectedPercent = r.upTo ? headline * UP_TO_FACTOR : headline;
    const h = siteHealth(s, i.now);
    const fresh = freshness(r.observedAt, i.now);
    const warnings: string[] = [];
    if (expired) warnings.push('This rate has expired.');
    if (h.state === 'DOWN') warnings.push(`${s.name} looks unreachable right now. ${h.note}`);
    if (fresh === 'STALE') warnings.push(`This rate was last confirmed ${Math.floor((i.now.getTime() - r.observedAt.getTime()) / DAY)} days ago; check it on the site.`);
    else if (fresh === 'AGING') warnings.push('This rate has not been confirmed for a few weeks.');
    if (r.upTo) warnings.push('"Up to" is the best case; the plan counts a lower share of it.');
    if (r.conditions) warnings.push(r.conditions);
    const holders = i.accounts.get(r.site) ?? [];
    out.push({
      site: r.site,
      name: s.name,
      kind: s.kind,
      label: isPoints ? `${r.upTo ? 'up to ' : ''}${r.pointsPerDollar} point${r.pointsPerDollar === 1 ? '' : 's'} per $1` : headline === 0 ? 'no cash back' : `${r.upTo ? 'up to ' : ''}${pct(headline)} ${s.kind === 'POINTS' ? 'back in points' : 'cash back'}`,
      percent: headline,
      upTo: r.upTo,
      expectedPercent,
      expectedCents: expired ? 0 : Math.round((i.amountCents * expectedPercent) / 100),
      reliability: rateReliability(r, i.now),
      freshness: fresh,
      health: h.state,
      healthNote: h.note,
      usable: !expired && h.state !== 'DOWN' && headline > 0,
      hasAccount: holders.length > 0,
      holders,
      conditions: r.conditions,
      observedAt: r.observedAt.toISOString(),
      method: r.method,
      url: s.homeUrl,
      warnings,
    });
  }
  return out.sort((a, b) => Number(b.usable) - Number(a.usable) || b.expectedCents - a.expectedCents || b.reliability - a.reliability || a.name.localeCompare(b.name));
}

/** What to do, in order, once a site is chosen. The card is whatever the plan pays with. */
export function cashbackSteps(rec: { pick: RankedSite | null }, merchantName: string, payWith: string | null): string[] {
  const pick = rec.pick;
  if (!pick) return [];
  const who = pick.holders.length ? ` (${pick.holders.join(' or ')} has the account)` : '';
  return [
    `Sign in to ${pick.name}${who} and open ${merchantName} from there.`,
    'Use that visit to shop: leave other cash-back sites and coupon extensions off, since they can cancel the tracking.',
    `${payWith ? `Pay with ${payWith}` : 'Pay with the card the plan recommends'} in the same session; ${pick.name} pays on the purchase, the card earns on top.`,
    'The cash back normally shows as pending first. Check that it appears, and keep the order e-mail until it is paid.',
  ];
}

/** Which site to use for this purchase, with the steps. Sites nobody has joined are suggested, never counted as if they were used. */
export function recommendCashback(i: CashbackInput): CashbackRecommendation {
  const ranked = rankSites(i);
  const haveAccounts = [...i.accounts.values()].some((h) => h.length > 0);
  const usable = ranked.filter((r) => r.usable);
  const pool = haveAccounts ? usable.filter((r) => r.hasAccount) : usable;
  const pick = pool[0] ?? null;
  const warnings: string[] = [];
  const better = haveAccounts ? usable.find((r) => !r.hasAccount && r.expectedCents >= (pick?.expectedCents ?? 0) + 100) : undefined;
  const consider = better ? { ...better, extraCents: better.expectedCents - (pick?.expectedCents ?? 0) } : null;
  if (!ranked.length) warnings.push(`No cash-back rate is on file for ${i.merchantName}.`);
  else if (!usable.length) warnings.push(`No usable cash-back rate for ${i.merchantName} right now.`);
  else if (haveAccounts && !pick) warnings.push(`None of the sites you use has a rate for ${i.merchantName}.`);
  if (!haveAccounts && usable.length) warnings.push('PointWise does not know which of these sites you use. Mark them under Cash-back sites so it recommends only yours.');
  const steps = cashbackSteps({ pick }, i.merchantName, i.payWith ?? null);
  // a comparison site's best rate across ALL sites, as a check that the rates on file have not gone stale
  let benchmark: CashbackRecommendation['benchmark'] = null;
  const b = i.benchmark;
  if (b && (i.now.getTime() - b.observedAt.getTime()) / DAY <= 14) {
    benchmark = { source: b.source, bestPercent: b.bestPercent, observedAt: b.observedAt.toISOString(), url: b.url };
    const bestOnFile = Math.max(0, ...usable.map((r) => r.percent));
    if (b.bestPercent >= bestOnFile + 2 && (i.amountCents * (b.bestPercent - bestOnFile)) / 100 >= 100) {
      warnings.push(`${b.source} lists a best rate of ${pct(b.bestPercent)} at ${i.merchantName} across all sites; the best on file here is ${pct(bestOnFile)}. A rate here may be out of date, or a site PointWise does not track pays more.`);
    }
  }
  return { haveAccounts, pick, consider, ranked, steps, warnings, benchmark };
}

/** What the shopping planner counts: the sites the household uses (or all usable ones if none are recorded), with the expected, not the headline, rate. */
export function plannerRates(rec: CashbackRecommendation): Array<{ portal: string; ratePercent: number; source: string; reliability: number }> {
  const pool = rec.ranked.filter((r) => r.usable && (!rec.haveAccounts || r.hasAccount));
  return pool.map((r) => ({
    portal: r.name,
    ratePercent: r.expectedPercent,
    source: `${r.label} (${r.method.toLowerCase()}, seen ${r.observedAt.slice(0, 10)})`,
    reliability: r.reliability,
  }));
}

export const money = usd;
