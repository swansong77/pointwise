/**
 * Natural-language query understanding (pure, deterministic, no model): turns what someone typed into entities (amounts, dates,
 * merchants, cards, members, programs, destinations…) and one intent with a confidence. Nothing here sees user data beyond the names
 * passed in `Dictionaries`, and nothing leaves the process. Rules are data so they can be tested against every phrasing we support.
 */
import { productTokens } from './import';
import { hintForItem } from './item-category';
import { MerchantIdentity, resolveMerchant } from './merchant-resolve';
import { expandConcepts, norm } from './nicknames';
import { AIRLINES, BANK_PROGRAMS, DESTINATIONS, HOTELS, ISSUERS, NamedEntity, RELATION_WORDS, Relationship, TRAVEL_WORDS } from './travel-entities';

export const UNDERSTANDING_VERSION = 'query-understanding/1';

const DAY = 86_400_000;

export type QueryKind = 'QUESTION' | 'COMMAND' | 'SEARCH' | 'SHOPPING' | 'TRAVEL' | 'PLANNING' | 'ANALYTICS' | 'ADMIN';

export type Intent =
  | 'SHOPPING'
  | 'OFFER_SEARCH'
  | 'EXPIRATION_REVIEW'
  | 'POINTS_LOOKUP'
  | 'CERTIFICATE_REVIEW'
  | 'STATUS_REVIEW'
  | 'CARD_RECOMMENDATION'
  | 'BENEFIT_LOOKUP'
  | 'ANNUAL_FEE_REVIEW'
  | 'PORTFOLIO_REVIEW'
  | 'SPENDING'
  | 'TRAVEL'
  | 'REDEMPTION'
  | 'SYNC_OFFERS'
  | 'NEW_OFFERS'
  | 'UNKNOWN';

export interface Ref {
  id: string;
  name: string;
  confidence: number;
  /** a merchant's page address, when the reference is a merchant */
  slug?: string;
}

export interface DateWindow {
  from: Date;
  to: Date;
  /** whole days from today to the end of the window (0 for a single day) */
  days: number;
  label: string;
  /** true when the person named one day, not a range */
  single: boolean;
}

export interface Dictionaries {
  merchants: MerchantIdentity[];
  cards: Array<{ id: string; name: string; walletCardId: string | null }>;
  members: Array<{ id: string; nickname: string; relationship: Relationship | 'SELF' }>;
  programs: Array<{ id: string; name: string; kind: string }>;
}

export interface MemberRef extends Ref {
  via: 'NAME' | 'RELATION';
  relationship: Relationship | 'SELF' | null;
}

export interface Entities {
  amountCents: number | null;
  points: number | null;
  nights: number | null;
  window: DateWindow | null;
  merchants: Ref[];
  cards: Array<Ref & { walletCardId: string | null }>;
  members: MemberRef[];
  airlines: string[];
  hotels: string[];
  programs: Array<Ref & { kind: string }>;
  issuer: string | null;
  destination: string | null;
  item: string | null;
  certificateKind: 'FREE_NIGHT' | 'COMPANION' | 'UPGRADE' | null;
  cabin: 'ECONOMY' | 'PREMIUM_ECONOMY' | 'BUSINESS' | 'FIRST' | null;
}

export interface Understanding {
  text: string;
  normalized: string;
  kind: QueryKind;
  intent: Intent;
  /** 0–1: how sure the intent is (the margin over the next best reading counts) */
  confidence: number;
  alternatives: Array<{ intent: Intent; score: number }>;
  entities: Entities;
  /** what the question needs that it did not say */
  missing: string[];
  /** which part of the data the question is about, for expiry and offer questions */
  scope: 'OFFERS' | 'POINTS' | 'CERTIFICATES' | 'BENEFITS' | 'ALL';
  version: string;
}

// ───────────── quantities ─────────────

const MULT: Record<string, number> = { k: 1_000, m: 1_000_000 };
const toNumber = (digits: string, suffix?: string): number => parseFloat(digits.replace(/,/g, '')) * (suffix ? MULT[suffix.toLowerCase()] : 1);

export interface Quantities {
  amountCents: number | null;
  points: number | null;
  nights: number | null;
  /** the text with the matched quantities removed, so a number is never read twice */
  rest: string;
}

/** "$1,500", "2.5k dollars", "3 nights", "50,000 points", and a bare "1200" once dates and units are out of the way. */
export function parseQuantities(text: string): Quantities {
  let t = text;
  let nights: number | null = null;
  let points: number | null = null;
  let amount: number | null = null;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => void) => {
    const m = t.match(re);
    if (!m) return;
    fn(m);
    t = t.replace(m[0], ' ');
  };
  take(/(\d+)\s*-?\s*nights?\b/i, (m) => (nights = parseInt(m[1], 10)));
  take(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:points|pts|miles)\b/i, (m) => (points = Math.round(toNumber(m[1], m[2]))));
  take(/\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?/i, (m) => (amount = toNumber(m[1], m[2])));
  if (amount == null) take(/(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(?:dollars|usd|bucks)\b/i, (m) => (amount = toNumber(m[1], m[2])));
  if (amount == null) {
    // a bare number: not a year, not a count of something, not part of 5/24 or a date
    const m = t.match(/(?<![\w/.\-])(\d[\d,]{1,8})(?![\w/%.\-])(?!\s*(?:months?|years?|days?|weeks?|cards?|x\b|%))/);
    if (m) {
      const v = toNumber(m[1]);
      if (v >= 20 && !(v >= 1900 && v <= 2100)) {
        amount = v;
        t = t.replace(m[0], ' ');
      }
    }
  }
  return { amountCents: amount == null ? null : Math.round((amount as number) * 100), points, nights, rest: t.replace(/\s+/g, ' ').trim() };
}

// ───────────── dates ─────────────

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RE = '(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)';
const monthIndex = (s: string) => MONTHS.findIndex((m) => m.startsWith(s.slice(0, 3)));
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const endOfDay = (d: Date) => new Date(startOfDay(d).getTime() + DAY - 1);
const endOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));

export function parseWindow(text: string, now: Date): { window: DateWindow | null; rest: string } {
  const lower = text.toLowerCase();
  const today = startOfDay(now);
  const win = (from: Date, to: Date, label: string, single = false): DateWindow => ({ from, to, days: Math.max(0, Math.floor((to.getTime() - today.getTime()) / DAY)), label, single });
  const strip = (m: RegExpMatchArray) => text.replace(new RegExp(m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ').replace(/\s+/g, ' ').trim();

  let m = lower.match(/\b(?:in the next|over the next|within the next|within|next|in)\s+(\d+)\s*(day|week|month)s?\b/);
  if (m) {
    const n = parseInt(m[1], 10) * ({ day: 1, week: 7, month: 30 } as Record<string, number>)[m[2]];
    return { window: win(today, endOfDay(new Date(today.getTime() + n * DAY)), `next ${m[1]} ${m[2]}${m[1] === '1' ? '' : 's'}`), rest: strip(m) };
  }
  if ((m = lower.match(/\btoday\b/))) return { window: win(today, endOfDay(today), 'today', true), rest: strip(m) };
  if ((m = lower.match(/\btomorrow\b/))) {
    const d = new Date(today.getTime() + DAY);
    return { window: win(d, endOfDay(d), 'tomorrow', true), rest: strip(m) };
  }
  if ((m = lower.match(/\bthis week\b/))) {
    const toSunday = (7 - today.getUTCDay()) % 7;
    return { window: win(today, endOfDay(new Date(today.getTime() + toSunday * DAY)), 'this week'), rest: strip(m) };
  }
  if ((m = lower.match(/\bnext week\b/))) {
    const toSunday = (7 - today.getUTCDay()) % 7;
    const from = new Date(today.getTime() + (toSunday + 1) * DAY);
    return { window: win(from, endOfDay(new Date(from.getTime() + 6 * DAY)), 'next week'), rest: strip(m) };
  }
  if ((m = lower.match(/\bthis month\b/))) return { window: win(today, endOfMonth(today.getUTCFullYear(), today.getUTCMonth()), 'this month'), rest: strip(m) };
  if ((m = lower.match(/\bnext month\b/))) {
    const y = today.getUTCFullYear() + (today.getUTCMonth() === 11 ? 1 : 0);
    const mo = (today.getUTCMonth() + 1) % 12;
    return { window: win(new Date(Date.UTC(y, mo, 1)), endOfMonth(y, mo), 'next month'), rest: strip(m) };
  }
  if ((m = lower.match(/\bthis year\b/))) return { window: win(today, endOfMonth(today.getUTCFullYear(), 11), 'this year'), rest: strip(m) };
  if ((m = lower.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/))) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return { window: win(d, endOfDay(d), m[0], true), rest: strip(m) };
  }
  if ((m = lower.match(new RegExp(`\\b(?:in|by|for|during|on)?\\s*${MONTH_RE}(?:\\s+(\\d{1,2})(?:st|nd|rd|th)?)?\\b`)))) {
    const mi = monthIndex(m[1]);
    if (mi >= 0 && !(m[1] === 'may' && !/\b(in|by|for|during|on)\s+may\b|may\s+\d/.test(lower))) {
      let y = today.getUTCFullYear();
      if (m[2]) {
        let d = new Date(Date.UTC(y, mi, +m[2]));
        if (d.getTime() < today.getTime()) d = new Date(Date.UTC(y + 1, mi, +m[2]));
        return { window: win(d, endOfDay(d), `${MONTHS[mi]} ${m[2]}`, true), rest: strip(m) };
      }
      const sameMonth = mi === today.getUTCMonth();
      if (mi < today.getUTCMonth()) y += 1;
      return { window: win(sameMonth ? today : new Date(Date.UTC(y, mi, 1)), endOfMonth(y, mi), MONTHS[mi]), rest: strip(m) };
    }
  }
  if ((m = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/)) && !(m[1] === '5' && m[2] === '24') && +m[1] <= 12 && +m[2] <= 31) {
    let y = m[3] ? (m[3].length === 2 ? 2000 + +m[3] : +m[3]) : today.getUTCFullYear();
    let d = new Date(Date.UTC(y, +m[1] - 1, +m[2]));
    if (!m[3] && d.getTime() < today.getTime()) d = new Date(Date.UTC(y + 1, +m[1] - 1, +m[2]));
    return { window: win(d, endOfDay(d), m[0], true), rest: strip(m) };
  }
  return { window: null, rest: text };
}

// ───────────── entities ─────────────

const hasWord = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text);

const matchNamed = (list: NamedEntity[], text: string): string[] =>
  list.filter((e) => [e.name.toLowerCase(), ...e.aliases].some((a) => a.length >= 2 && hasWord(text, a))).map((e) => e.name);

/** words every card name carries that say nothing about which card it is */
const GENERIC_CARD_WORDS = new Set(['rewards', 'reward', 'card', 'credit', 'visa', 'signature', 'mastercard', 'world', 'the']);
const ISSUER_TOKENS = new Set(['american', 'express', 'chase', 'citi', 'capital', 'one', 'bank', 'of', 'america', 'wells', 'fargo', 'discover', 'barclays', 'us', 'card', 'credit', 'visa', 'mastercard', 'the']);

function findCards(text: string, cards: Dictionaries['cards']): Entities['cards'] {
  const q = new Set(norm(text).split(' ').filter(Boolean));
  const hits: Array<{ id: string; name: string; walletCardId: string | null; tokens: Set<string>; issuer: boolean }> = [];
  for (const c of cards) {
    const tokens = new Set([...productTokens(c.name)].filter((t) => !ISSUER_TOKENS.has(t) && !GENERIC_CARD_WORDS.has(t)));
    if (tokens.size === 0 || ![...tokens].every((t) => q.has(t))) continue;
    hits.push({ id: c.id, name: c.name, walletCardId: c.walletCardId, tokens, issuer: [...productTokens(c.name)].some((t) => ISSUER_TOKENS.has(t) && q.has(t)) });
  }
  // "Venture X" beats "Venture" when both match; a card in the wallet beats the same product in the catalog
  const kept = hits.filter((h) => !hits.some((o) => o !== h && o.tokens.size > h.tokens.size && [...h.tokens].every((t) => o.tokens.has(t))));
  const byName = new Map<string, (typeof kept)[number]>();
  for (const h of kept) {
    const key = [...h.tokens].sort().join(' ');
    const cur = byName.get(key);
    if (!cur || (h.walletCardId && !cur.walletCardId)) byName.set(key, h);
  }
  return [...byName.values()].slice(0, 3).map((h) => ({ id: h.id, name: h.name, walletCardId: h.walletCardId, confidence: h.issuer ? 0.9 : 0.75 }));
}

function findMembers(text: string, members: Dictionaries['members']): MemberRef[] {
  const lower = text.toLowerCase();
  const out: MemberRef[] = [];
  for (const m of members) if (m.nickname.length >= 2 && hasWord(lower, m.nickname.toLowerCase())) out.push({ id: m.id, name: m.nickname, confidence: 0.95, via: 'NAME', relationship: m.relationship });
  for (const [word, rel] of Object.entries(RELATION_WORDS)) {
    if (!hasWord(lower, word)) continue;
    const matches = members.filter((m) => m.relationship === rel && !out.some((o) => o.id === m.id));
    if (matches.length) for (const m of matches) out.push({ id: m.id, name: m.nickname, confidence: matches.length === 1 ? 0.9 : 0.6, via: 'RELATION', relationship: rel });
    else if (!out.some((o) => o.relationship === rel)) out.push({ id: '', name: word, confidence: 0.3, via: 'RELATION', relationship: rel });
  }
  return out;
}

function findDestination(raw: string, lower: string): string | null {
  const hit = [...DESTINATIONS].sort((a, b) => b.length - a.length).find((d) => hasWord(lower, d.toLowerCase()));
  if (hit) return hit;
  const m = raw.match(/\b(?:to|visit|visiting|trip to|flight to|fly to)\s+((?:[A-Z][a-zA-Z.]+)(?:\s+[A-Z][a-zA-Z.]+){0,2})/);
  return m ? m[1] : null;
}

const STOP = new Set(['what', 'which', 'card', 'cards', 'should', 'i', 'we', 'use', 'for', 'at', 'best', 'the', 'a', 'an', 'my', 'to', 'buy', 'get', 'is', 'on', 'of', 'in', 'will', 'cost', 'it', 'that', 'this', 'how', 'much', 'show', 'me', 'do', 'does', 'can', 'pay', 'with', 'and', 'or', 'about', 'if', 'would', 'be', 'am', 'are', 'need', 'needs', 'want', 'plan', 'planning', 'going', 'looking']);

/** What is left of the question once the words about asking and paying are gone: "macbook pro m5", "hilton stay". */
function leftover(text: string): string {
  return norm(text)
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .join(' ');
}

export function extractEntities(text: string, dict: Dictionaries, now: Date): Entities & { rest: string } {
  const w = parseWindow(text, now);
  const q = parseQuantities(w.rest);
  const lower = text.toLowerCase();
  const expanded = expandConcepts(text);

  // merchants: the best two the identity resolver finds (after the first is taken out, look again)
  const merchants: Ref[] = [];
  let probe = q.rest;
  for (let i = 0; i < 2; i++) {
    const r = resolveMerchant(probe, dict.merchants);
    if (!r || r.via === 'FUZZY' || r.confidence < 0.7) break;
    merchants.push({ id: r.merchantId, name: r.name, confidence: r.confidence, slug: r.slug });
    probe = probe.replace(new RegExp(r.matched.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
  }

  const airlines = matchNamed(AIRLINES, lower);
  const hotels = matchNamed(HOTELS, lower);
  const programs: Entities['programs'] = [];
  for (const p of dict.programs) if (p.name.length >= 3 && hasWord(lower, p.name.toLowerCase())) programs.push({ id: p.id, name: p.name, kind: p.kind, confidence: 0.9 });
  for (const e of [...AIRLINES, ...HOTELS]) {
    if (![e.name.toLowerCase(), ...e.aliases].some((a) => hasWord(lower, a))) continue;
    if (programs.some((p) => p.name.toLowerCase().includes(e.name.toLowerCase()))) continue;
    const known = dict.programs.find((p) => p.name.toLowerCase().includes(e.name.toLowerCase()));
    programs.push({ id: known?.id ?? e.name, name: known?.name ?? e.name, kind: AIRLINES.includes(e) ? 'AIRLINE' : 'HOTEL', confidence: known ? 0.85 : 0.6 });
  }
  for (const e of BANK_PROGRAMS) if ([e.name.toLowerCase(), ...e.aliases].some((a) => a.length > 2 && hasWord(lower, a))) programs.push({ id: e.name, name: e.name, kind: 'BANK', confidence: 0.8 });

  const issuer = ISSUERS.find((i) => i.aliases.some((a) => hasWord(lower, a)))?.name ?? null;
  const destination = findDestination(text, lower);
  const item = (() => {
    const l = leftover(q.rest);
    return l && hintForItem(l) ? l : null;
  })();

  const cabin: Entities['cabin'] = /\bfirst class\b/.test(lower) ? 'FIRST' : /\bbusiness( class)?\b/.test(lower) ? 'BUSINESS' : /\bpremium economy\b/.test(lower) ? 'PREMIUM_ECONOMY' : /\beconomy|coach\b/.test(lower) ? 'ECONOMY' : null;
  const certificateKind: Entities['certificateKind'] = /\bfree nights?\b/.test(lower) ? 'FREE_NIGHT' : /\bcompanion\b/.test(lower) ? 'COMPANION' : /\bupgrade\b/.test(lower) ? 'UPGRADE' : null;

  return {
    amountCents: q.amountCents,
    points: q.points,
    nights: q.nights,
    window: w.window,
    merchants,
    cards: findCards(expanded, dict.cards),
    members: findMembers(text, dict.members),
    airlines,
    hotels,
    programs,
    issuer,
    destination,
    item,
    certificateKind,
    cabin,
    rest: q.rest,
  };
}

// ───────────── intent ─────────────

interface Ctx {
  /** lower case, punctuation kept ("5/24") */
  raw: string;
  /** issuer nicknames and concepts spelled out */
  n: string;
  e: Entities;
}

type Rule = [intent: Intent, score: (c: Ctx) => number];

const has = (re: RegExp, s: string) => re.test(s);
const isHotelOrAirline = (c: Ctx) => c.e.hotels.length > 0 || c.e.airlines.length > 0;

const RULES: Rule[] = [
  ['SYNC_OFFERS', (c) => (has(/\b(sync|refresh|update)\b.*\b(offers?|accounts?)\b|\bsync all\b/, c.n) ? 96 : 0)],
  ['NEW_OFFERS', (c) => (has(/\bnew offers?\b|\boffers? (that are )?new\b/, c.n) ? 92 : 0)],
  [
    'ANNUAL_FEE_REVIEW',
    (c) => {
      if (has(/\bannual fees?\b|\brenewals?\b|\bfee review\b/, c.n)) return 90;
      if (has(/\b(keep|cancel|downgrade|close|product change)\b/, c.n) && (c.e.cards.length > 0 || has(/\bcard\b/, c.n))) return 92;
      if (has(/\bshould (i|we) (keep|cancel|close|downgrade)\b/, c.n)) return 88; // even when the card's name is not recognised
      return 0;
    },
  ],
  [
    'CERTIFICATE_REVIEW',
    (c) => {
      if (c.e.certificateKind || has(/\bcertificates?\b|\bcompanion (pass|ticket)\b/, c.n)) return 88 + (has(/\bexpir/, c.n) ? 3 : 0);
      return 0;
    },
  ],
  [
    'EXPIRATION_REVIEW',
    (c) => {
      if (!has(/\bexpir\w*|\bending soon\b|\babout to (end|lapse)\b|\blapse\b|\brunning out\b|\bdeadline/, c.n)) return 0;
      return 88;
    },
  ],
  [
    'POINTS_LOOKUP',
    (c) => {
      if (has(/\bhow many\b.*\b(points|balance)\b|\bmy\b(\s+\w+){0,3}\s+(points|balances?)\b|\bpoints? balances?\b|\bmost valuable points\b|\bloyalty (assets|accounts?|programs?)\b|\bbalances?\b/, c.n)) return 86;
      if (c.e.points != null && has(/\b(points|balance)\b/, c.n)) return 40;
      return 0;
    },
  ],
  [
    'STATUS_REVIEW',
    (c) => {
      if (has(/5\/24|\bopened\b.*\b24 months\b|\bcards? (have )?i opened\b/, c.n)) return 92;
      if (has(/\b(elite|status level|tier)\b|\bstatus\b/, c.n) && !has(/\bstatus of (my )?offers?\b/, c.n)) return 86;
      return 0;
    },
  ],
  [
    'CARD_RECOMMENDATION',
    (c) => {
      if (has(/\b(apply|sign up|open)\b.*\b(next|for)\b|\bnext card\b|\bnew card\b|\bwhat should i apply\b|\bshould i (get|apply|open)\b|\bwhich cards? should (i|we) (get|apply|open)\b|\brecommend\b.*\bcards?\b|\bwhat card should i get\b/, c.n)) return 89;
      return 0;
    },
  ],
  ['BENEFIT_LOOKUP', (c) => (has(/\bbenefits?\b|\bstatement credits?\b|\bcredits?\b|\bunused\b|\bhaven'?t used\b|\bperks?\b/, c.n) && !has(/\bannual fees?\b/, c.n) ? 74 : 0)],
  [
    'SPENDING',
    (c) => {
      if (has(/\bhow much (have i|did i|do i|are we|have we) spen[dt]\b|\bwhat (have|did) i spen[dt]\b/, c.n)) return 85;
      return has(/\bspend(ing)?\b/, c.n) && c.e.amountCents == null ? 66 : 0;
    },
  ],
  ['PORTFOLIO_REVIEW', (c) => (has(/\bportfolio\b|\bhousehold\b|\bfamily\b|\bhow are my cards\b|\bvalue of my cards\b|\banaly[sz]e\b/, c.n) ? 80 : 0)],
  [
    'REDEMPTION',
    (c) => (has(/\bredeem\b|\bredemption\b|\buse (my )?points (for|on|to)\b|\baward (booking|flight|ticket)s?\b/, c.n) ? 85 : 0),
  ],
  [
    'OFFER_SEARCH',
    (c) => {
      if (!has(/\boffers?\b/, c.n)) return 0;
      // "offers expiring this month" is an expiry question about offers
      if (has(/\bexpir\w*|\bending soon\b/, c.n)) return 70;
      return has(/\b(show|list|see|find|what|which|my|all|best|available|have|any)\b/, c.n) ? 86 : 76;
    },
  ],
  [
    'TRAVEL',
    (c) => {
      const travelWord = has(TRAVEL_WORDS, c.raw);
      if (!travelWord) return 0;
      let s = 0;
      if (isHotelOrAirline(c)) s = 88;
      else if (c.e.destination) s = 86;
      else if (c.e.cabin) s = 84;
      else s = 70;
      if (c.e.members.length && c.e.destination) s += 2;
      return s;
    },
  ],
  [
    'SHOPPING',
    (c) => {
      let s = 0;
      if (has(/\b(what|which|best)\b.*\bcards?\b.*\b(use|pay|for|at)\b|\bbest cards?\b|\bwhich card\b.*\bshould\b.*\buse\b/, c.n)) s = 90;
      const named = c.e.merchants.length > 0 || c.e.cards.length > 0;
      if ((named || c.e.item) && c.e.amountCents != null) s = Math.max(s, 88);
      if (c.e.item && has(/\b(buy|buying|purchase|get|need|want)\b/, c.n)) s = Math.max(s, 82);
      if (c.e.item && !named) s = Math.max(s, 80); // an item on its own ("MacBook Pro M5")
      if (s === 0 && c.e.merchants.length > 0 && c.n.split(' ').length <= 4) s = 55;
      return s;
    },
  ],
];

const COMMAND_INTENTS: Intent[] = ['SYNC_OFFERS', 'NEW_OFFERS'];
const IMPERATIVE = /^(sync|refresh|check|review|show|list|analy[sz]e|run|create|generate|recommend|open|find|search)\b/;
const QUESTION = /^(what|which|who|when|where|why|how|do|does|did|should|can|could|is|are|am|will|would|have|has)\b/;

export function classify(raw: string, n: string, e: Entities): { intent: Intent; confidence: number; alternatives: Array<{ intent: Intent; score: number }> } {
  const ctx: Ctx = { raw, n, e };
  const scored = RULES.map(([intent, fn]) => ({ intent, score: fn(ctx) }))
    .filter((r) => r.score > 0)
    // a more specific reading wins a tie: a hotel or airline with an amount is a trip
    .map((r) => (r.intent === 'TRAVEL' && isHotelOrAirline(ctx) && e.amountCents != null ? { ...r, score: r.score + 1 } : r))
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { intent: 'UNKNOWN', confidence: 0, alternatives: [] };
  const [top, second] = scored;
  const confidence = Math.max(0.2, Math.min(0.99, (top.score - 0.35 * (second?.score ?? 0) + 8) / 100));
  return { intent: top.intent, confidence: Math.round(confidence * 100) / 100, alternatives: scored.slice(1, 4) };
}

function kindOf(raw: string, intent: Intent, n: string): QueryKind {
  if (/\b(admin|backup|restore|card data catalog|operations|user management)\b/.test(n)) return 'ADMIN';
  if (COMMAND_INTENTS.includes(intent) || (IMPERATIVE.test(raw) && ['PORTFOLIO_REVIEW', 'ANNUAL_FEE_REVIEW', 'BENEFIT_LOOKUP', 'CERTIFICATE_REVIEW', 'CARD_RECOMMENDATION', 'REDEMPTION', 'TRAVEL'].includes(intent) && !QUESTION.test(raw))) return 'COMMAND';
  if (intent === 'SHOPPING') return 'SHOPPING';
  if (intent === 'TRAVEL' || intent === 'REDEMPTION') return 'TRAVEL';
  if (intent === 'CARD_RECOMMENDATION' || intent === 'ANNUAL_FEE_REVIEW') return 'PLANNING';
  if (intent === 'PORTFOLIO_REVIEW' || intent === 'SPENDING' || intent === 'BENEFIT_LOOKUP') return 'ANALYTICS';
  if (QUESTION.test(raw)) return 'QUESTION';
  return 'SEARCH';
}

function scopeOf(n: string, e: Entities): Understanding['scope'] {
  if (e.certificateKind || /\bcertificates?\b/.test(n)) return 'CERTIFICATES';
  if (/\b(points|balances?|loyalty)\b/.test(n)) return 'POINTS';
  if (/\b(benefits?|credits?)\b/.test(n)) return 'BENEFITS';
  if (/\boffers?\b/.test(n)) return 'OFFERS';
  return 'ALL';
}

export function understand(text: string, dict: Dictionaries, now: Date): Understanding {
  const trimmed = text.trim().slice(0, 300);
  const { rest: _rest, ...entities } = extractEntities(trimmed, dict, now);
  const raw = trimmed.toLowerCase().replace(/\s+/g, ' ');
  const n = expandConcepts(trimmed);
  const c = classify(raw, n, entities);
  const missing: string[] = [];
  if (c.intent === 'SHOPPING' && !entities.merchants.length && !entities.item && !entities.cards.length) missing.push('merchant or item');
  if (c.intent === 'SHOPPING' && entities.amountCents == null) missing.push('amount');
  if (c.intent === 'TRAVEL' && !entities.destination && !entities.hotels.length && !entities.airlines.length) missing.push('destination');
  return { text: trimmed, normalized: norm(trimmed), kind: kindOf(raw, c.intent, n), intent: c.intent, confidence: c.confidence, alternatives: c.alternatives, entities, missing, scope: scopeOf(n, entities), version: UNDERSTANDING_VERSION };
}
