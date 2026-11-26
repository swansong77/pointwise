/**
 * Merchant-offer intake (pure): source reliability and a deterministic parser for offers the user pastes or
 * imports ("Hilton: spend $500, get $100 back, expires 12/31/2026"). Offers that arrive any other way go
 * through the same source/reliability model (ADR-009). No model is involved.
 */

export type OfferSourceKind = 'ISSUER_OFFICIAL' | 'ACCOUNT_DATA' | 'EMAIL' | 'PUBLIC_PAGE' | 'AI_INFERRED' | 'USER_ENTERED' | 'ADMIN' | 'PORTAL';
export type OfferTypeKind = 'STATEMENT_CREDIT' | 'CASHBACK_PERCENT' | 'POINTS_BONUS' | 'SPEND_GET' | 'PORTAL_RATE' | 'COUPON';
export type VerificationKind = 'UNVERIFIED' | 'VERIFIED' | 'DISPUTED';

/** 100 official issuer data · 90 account data · 75 email / public page / curated · 50 AI-inferred · 25 user-entered. */
export const SOURCE_RELIABILITY: Record<OfferSourceKind, number> = {
  ISSUER_OFFICIAL: 100,
  ACCOUNT_DATA: 90,
  EMAIL: 75,
  PUBLIC_PAGE: 75,
  ADMIN: 75,
  PORTAL: 50,
  AI_INFERRED: 50,
  USER_ENTERED: 25,
};

export const reliabilityOf = (s: OfferSourceKind): number => SOURCE_RELIABILITY[s];

/**
 * Highest confidence (0–100) a recommendation may claim from this offer: its source's reliability, lifted
 * to the account-data level when verified (e.g. a statement credit confirmed it) and zeroed when disputed.
 */
export function confidenceCap(source: OfferSourceKind, verification: VerificationKind): number {
  if (verification === 'DISPUTED') return 0;
  const base = SOURCE_RELIABILITY[source];
  return verification === 'VERIFIED' ? Math.max(base, SOURCE_RELIABILITY.ACCOUNT_DATA) : base;
}

export interface ParsedOffer {
  merchantText: string;
  offerType: OfferTypeKind;
  /** flat reward in cents (cash back / statement credit) */
  valueCents: number;
  /** percent back, e.g. 10 */
  percent: number | null;
  /** cap on a percent offer, in cents */
  maxRewardCents: number | null;
  points: number | null;
  minSpendCents: number | null;
  endsAt: Date | null;
  raw: string;
  /** things the parser could not read; the offer is still kept when it has a merchant and a reward */
  issues: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const money = (s: string) => Math.round(Number(s.replace(/,/g, '')) * 100);

/** "12/31/2026", "12/31/26", "2026-12-31", "Dec 31, 2026", "December 31 2026" → UTC date, or null. */
export function parseOfferDate(text: string): Date | null {
  let m = /\b(\d{4})-(\d{2})-(\d{2})\b/.exec(text);
  if (m) return utc(+m[1], +m[2] - 1, +m[3]);
  m = /\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/.exec(text);
  if (m) return utc(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]);
  m = /\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/.exec(text);
  if (m) {
    const mi = MONTHS.indexOf(m[1].toLowerCase());
    return mi >= 0 ? utc(+m[3], mi, +m[2]) : null;
  }
  return null;
}

function utc(y: number, mo: number, d: number): Date | null {
  const x = new Date(Date.UTC(y, mo, d));
  return x.getUTCFullYear() === y && x.getUTCMonth() === mo && x.getUTCDate() === d ? x : null;
}

/**
 * One offer per line. Accepted shapes (merchant first, then the terms in any order):
 *   "Hilton: Spend $500, get $100 back, expires 12/31/2026"
 *   "Uber Eats - 10% back up to $20 - ends Jan 15, 2027"
 *   "Delta: earn 2,000 points on $300+ through 3/1/27"
 *   "Spend $50 or more, get $10 back at Chipotle, expires 2026-12-31"
 */
export function parseOfferLine(line: string): ParsedOffer | null {
  const raw = line.trim();
  if (raw.length < 6) return null;
  const issues: string[] = [];
  const endsAt = parseOfferDate(raw);
  const expiryTail = /\b(?:expires?|ends?|through|until|valid (?:through|until)|by)\b.*$/i;
  let text = raw.replace(expiryTail, '').replace(/[,;.\s]+$/, '');

  // merchant: before the first ":" or " - ", else after " at "
  let merchant = '';
  const head = /^(.{2,60}?)\s*(?::|\s[-–—]\s)\s*(.+)$/.exec(text);
  const at = /\bat\s+([A-Z][\w&'.+ -]{1,40}?)(?=$|,|;|\.| -| –)/.exec(text);
  let terms = text;
  if (head && !/^(spend|earn|get|save)\b/i.test(head[1])) {
    merchant = head[1];
    terms = head[2];
  } else if (at) {
    merchant = at[1];
    terms = text.replace(at[0], '');
  }
  merchant = merchant.replace(/["']/g, '').trim();

  const minSpend = /(?:spend|purchase|min(?:imum)?(?: spend)?)\D{0,12}\$\s?([\d,]+(?:\.\d{2})?)/i.exec(terms) ?? /\$\s?([\d,]+(?:\.\d{2})?)\s*\+/.exec(terms);
  const pct = /(\d{1,3}(?:\.\d+)?)\s*%/.exec(terms);
  const cap = /(?:up to|max(?:imum)?|capped at)\s*\$\s?([\d,]+(?:\.\d{2})?)/i.exec(terms);
  const pts = /([\d,]+)\s*(?:bonus\s+)?(?:points|pts|miles)\b/i.exec(terms);
  const flat = /(?:get|earn|receive|save|credit(?:ed)?)\D{0,12}\$\s?([\d,]+(?:\.\d{2})?)(?!\s*\+)/i.exec(terms) ?? /\$\s?([\d,]+(?:\.\d{2})?)\s*(?:back|credit|off|cash ?back|statement credit)/i.exec(terms);

  let offerType: OfferTypeKind = 'STATEMENT_CREDIT';
  let valueCents = 0;
  let percent: number | null = null;
  let maxReward: number | null = null;
  let points: number | null = null;
  if (pct) {
    offerType = 'CASHBACK_PERCENT';
    percent = Number(pct[1]);
    maxReward = cap ? money(cap[1]) : null;
    valueCents = maxReward ?? 0;
  } else if (pts) {
    offerType = 'POINTS_BONUS';
    points = Number(pts[1].replace(/,/g, ''));
  } else if (flat) {
    valueCents = money(flat[1]);
    offerType = minSpend ? 'SPEND_GET' : 'STATEMENT_CREDIT';
  }
  if (/\bcoupon|promo code\b/i.test(raw)) offerType = 'COUPON';
  if (!merchant) issues.push('merchant not found');
  if (!pct && !pts && !flat) issues.push('reward not found');
  if (!endsAt) issues.push('no expiry date');
  if (!merchant || (!pct && !pts && !flat)) return issues.length ? { merchantText: merchant, offerType, valueCents, percent, maxRewardCents: maxReward, points, minSpendCents: minSpend ? money(minSpend[1]) : null, endsAt, raw, issues } : null;
  return { merchantText: merchant, offerType, valueCents, percent, maxRewardCents: maxReward, points, minSpendCents: minSpend ? money(minSpend[1]) : null, endsAt, raw, issues };
}

export interface ImportResult {
  offers: ParsedOffer[];
  /** lines that could not be turned into an offer, with the reason */
  rejected: Array<{ line: number; text: string; reason: string }>;
}

/** Parses a pasted block (one offer per line; blank lines and "#" comments are skipped). */
export function parseOfferText(text: string, max = 200): ImportResult {
  const offers: ParsedOffer[] = [];
  const rejected: ImportResult['rejected'] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && offers.length + rejected.length < max; i++) {
    const l = lines[i].trim();
    if (!l || l.startsWith('#')) continue;
    const p = parseOfferLine(l);
    if (p && p.merchantText && p.issues.every((x) => x === 'no expiry date')) offers.push(p);
    else rejected.push({ line: i + 1, text: l.slice(0, 120), reason: p?.issues.filter((x) => x !== 'no expiry date').join('; ') || 'not recognised as an offer' });
  }
  return { offers, rejected };
}

/** Stable key so importing the same offer twice does not create a second one. */
export function offerKey(o: { merchantKey: string; offerType: string; valueCents: number; percent: number | null; points: number | null; minSpendCents: number | null; endsAt: Date | null }): string {
  return [o.merchantKey, o.offerType, o.valueCents, o.percent ?? '', o.points ?? '', o.minSpendCents ?? '', o.endsAt ? o.endsAt.toISOString().slice(0, 10) : ''].join('|');
}
