/**
 * Card refresh engine — pure parts (see docs/card-refresh-engine.md):
 * page text extraction, deterministic field extraction with evidence, evidence validation for
 * model output, diffing against the catalog, and offer-history analytics.
 * Only public issuer page text is processed here — never user data.
 */

export type BonusType = 'POINTS' | 'MILES' | 'CASH' | 'NIGHTS' | 'OTHER';

/** Fields the engine can propose. Money in cents. */
export interface ExtractedFields {
  annualFeeCents?: number;
  bonusType?: BonusType;
  bonusAmount?: number; // points / miles / nights, or cents for CASH
  bonusSpendCents?: number;
  bonusMonths?: number;
  foreignTxFee?: boolean;
  authorizedUserFeeCents?: number;
  offerExpiresAt?: string; // ISO date
}

export type FieldName = keyof ExtractedFields;
export const FIELD_NAMES: FieldName[] = ['annualFeeCents', 'bonusType', 'bonusAmount', 'bonusSpendCents', 'bonusMonths', 'foreignTxFee', 'authorizedUserFeeCents', 'offerExpiresAt'];

export interface FieldFinding<K extends FieldName = FieldName> {
  field: K;
  value: NonNullable<ExtractedFields[K]>;
  evidence: string;
  confidence: number;
}

// ───────────── HTML → text ─────────────

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', reg: '®', trade: '™', copy: '©' };

/** Visible text of an HTML page: drops script/style/noscript/svg/template, tags and comments; decodes entities. */
export function htmlToText(html: string, maxChars = 60_000): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, maxChars);
}

// ───────────── number helpers ─────────────

const NUM = String.raw`(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`;
const toInt = (s: string) => Number(s.replace(/,/g, ''));
const dollarsToCents = (whole: string, frac?: string) => toInt(whole) * 100 + (frac ? Number(frac.padEnd(2, '0')) : 0);
const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/** "75,000" → 75000; "75K" → 75000 */
function parseAmount(s: string): number {
  const m = /^(\d+(?:,\d{3})*)(?:\s*([kK]))?$/.exec(s.trim());
  if (!m) return NaN;
  return toInt(m[1]) * (m[2] ? 1000 : 1);
}

/** Sentence-ish window around a match, used as evidence. */
/** The sentence (or line) around a match, capped at 160 characters either side — the evidence quote. */
function window(text: string, index: number, length: number): string {
  let sentenceStart = 0;
  for (const s of text.slice(0, index).matchAll(/[.!?]\s+/g)) sentenceStart = (s.index ?? 0) + s[0].length;
  const after = /[.!?](?=\s|$)/.exec(text.slice(index + length));
  const sentenceEnd = after ? index + length + after.index + 1 : text.length;
  const start = Math.max(0, text.lastIndexOf('\n', index) + 1, index - 160, sentenceStart);
  const endNl = text.indexOf('\n', index + length);
  const end = Math.min(text.length, endNl === -1 ? text.length : endNl, index + length + 160, sentenceEnd);
  return text.slice(start, end).trim();
}

// ───────────── deterministic extraction ─────────────

/**
 * Regex extraction of the common phrasings on card product pages. Every finding carries the text
 * it came from. Used as the fallback when no AI model is available and to cross-check model output.
 */
export function heuristicExtract(text: string): FieldFinding[] {
  const out: FieldFinding[] = [];
  const push = <K extends FieldName>(field: K, value: NonNullable<ExtractedFields[K]>, m: RegExpExecArray, confidence: number) => {
    if (!out.some((f) => f.field === field)) out.push({ field, value, evidence: window(text, m.index, m[0].length), confidence });
  };
  let m: RegExpExecArray | null;

  // annual fee
  if ((m = /\b(?:no|\$0)\s+annual\s+fee\b/i.exec(text))) push('annualFeeCents', 0, m, 0.9);
  else if ((m = new RegExp(String.raw`\$${NUM}\s+annual\s+fee`, 'i').exec(text))) push('annualFeeCents', dollarsToCents(m[1], m[2]), m, 0.9);
  else if ((m = new RegExp(String.raw`annual\s+fee(?:\s+is|\s+of|:)?\s+\$${NUM}`, 'i').exec(text))) push('annualFeeCents', dollarsToCents(m[1], m[2]), m, 0.85);

  // welcome bonus: points / miles / nights
  // up to three brand words may sit between the amount and the unit ("90,000 Membership Rewards points")
  const bonusRe = /(?:earn|get|receive)\s+(?:an?\s+)?(?:extra\s+|bonus\s+of\s+)?(\d{1,3}(?:,\d{3})+|\d+\s*[kK]|\d+)\s*(?:[A-Za-z®&'’-]+\s+){0,3}?(points|miles|(?:free\s+)?nights?)\b/i;
  const bm = bonusRe.exec(text);
  const unit = bm?.[2].toLowerCase() ?? '';
  const amount = bm ? parseAmount(bm[1]) : NaN;
  // points/miles bonuses are at least 1,000 — "earn 3 points per dollar" is an earning rate, not a bonus
  if (bm && (unit.includes('night') || amount >= 1000)) {
    push('bonusType', unit.startsWith('mile') ? 'MILES' : unit.includes('night') ? 'NIGHTS' : 'POINTS', bm, 0.85);
    push('bonusAmount', amount, bm, 0.85);
  } else if ((m = new RegExp(String.raw`(?:earn|get)\s+(?:a\s+)?\$${NUM}\s+(?:cash\s+(?:back|bonus|rewards)|statement\s+credit|bonus)`, 'i').exec(text))) {
    push('bonusType', 'CASH', m, 0.85);
    push('bonusAmount', dollarsToCents(m[1], m[2]), m, 0.85);
  }

  // spend requirement: "after you spend $4,000 (on purchases) in the first 3 months"
  const spendRe = new RegExp(String.raw`(?:after\s+(?:you\s+)?(?:spend(?:ing)?|make)\s+|spend\s+)\$${NUM}(?:\s+(?:on|in)\s+(?:eligible\s+|net\s+)?purchases)?\s+(?:with(?:in)?|in)\s+(?:your\s+)?(?:the\s+)?first\s+(\d{1,2}|${Object.keys(WORD_NUM).join('|')})\s+months?`, 'i');
  if ((m = spendRe.exec(text))) {
    push('bonusSpendCents', dollarsToCents(m[1], m[2]), m, 0.85);
    const months = /^\d+$/.test(m[3]) ? Number(m[3]) : WORD_NUM[m[3].toLowerCase()];
    push('bonusMonths', months, m, 0.85);
  }

  // foreign transaction fee
  if ((m = /\bno\s+foreign\s+transaction\s+fees?\b/i.exec(text))) push('foreignTxFee', false, m, 0.9);
  else if ((m = /\b(\d(?:\.\d)?)%\s+(?:of\s+each\s+transaction\s+)?(?:foreign\s+transaction\s+fee|of\s+each\s+transaction\s+in\s+U\.?S\.?\s+dollars)/i.exec(text))) push('foreignTxFee', true, m, 0.8);

  // authorized user fee
  if ((m = /\bno\s+(?:annual\s+)?fee\s+(?:for|to\s+add)\s+(?:additional|authorized)\s+(?:card\s*members?|users?|cards?)/i.exec(text))) push('authorizedUserFeeCents', 0, m, 0.8);
  else if ((m = new RegExp(String.raw`\$${NUM}\s+(?:annual\s+fee\s+)?(?:for\s+)?(?:each|per)\s+(?:additional|authorized)\s+(?:card\s*members?|users?|cards?)`, 'i').exec(text))) push('authorizedUserFeeCents', dollarsToCents(m[1], m[2]), m, 0.8);

  // offer expiry: "offer ends 12/31/2026" / "offer expires on January 15, 2027"
  if ((m = /offer\s+(?:ends|expires)(?:\s+on)?\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text))) {
    const iso = isoDate(Number(m[3]), Number(m[1]), Number(m[2]));
    if (iso) push('offerExpiresAt', iso, m, 0.8);
  } else if ((m = /offer\s+(?:ends|expires)(?:\s+on)?\s+([A-Za-z]+)\.?\s+(\d{1,2}),\s+(\d{4})/i.exec(text))) {
    const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(m[1].slice(0, 3).toLowerCase());
    const iso = mon >= 0 ? isoDate(Number(m[3]), mon + 1, Number(m[2])) : null;
    if (iso) push('offerExpiresAt', iso, m, 0.8);
  }
  return out;
}

function isoDate(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}

// ───────────── validating model output ─────────────

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Every number that appears in a value, as it could be written on a page. */
function valueTokens(field: FieldName, value: unknown): string[] {
  if (typeof value === 'number') {
    if (field.endsWith('Cents')) {
      const dollars = value / 100;
      const whole = Math.floor(dollars);
      return value === 0 ? ['$0', 'no '] : [whole.toLocaleString('en-US'), String(whole)];
    }
    if (field === 'bonusAmount') return [value.toLocaleString('en-US'), String(value), `${value / 1000}k`];
    return [String(value)];
  }
  if (typeof value === 'boolean') return field === 'foreignTxFee' ? [value ? 'foreign transaction fee' : 'no foreign transaction fee'] : [];
  if (typeof value === 'string') {
    if (field === 'bonusType') return [{ POINTS: 'point', MILES: 'mile', CASH: '$', NIGHTS: 'night', OTHER: '' }[value] ?? ''];
    if (field === 'offerExpiresAt') {
      const [y, mo, d] = value.split('-').map(Number);
      return [String(y)].concat(mo && d ? [`${mo}/${d}/${y}`, String(d)] : []);
    }
  }
  return [];
}

/**
 * Accepts a model-proposed field only if its evidence is a verbatim excerpt of the page and
 * contains the value. Returns null for unsupported or out-of-range values.
 */
export function validateFinding(f: { field: string; value: unknown; evidence?: unknown; confidence?: unknown }, pageText: string): FieldFinding | null {
  if (!FIELD_NAMES.includes(f.field as FieldName)) return null;
  const field = f.field as FieldName;
  const evidence = typeof f.evidence === 'string' ? f.evidence.trim() : '';
  if (evidence.length < 4 || !norm(pageText).includes(norm(evidence))) return null;
  const v = f.value;
  const okType =
    (['annualFeeCents', 'bonusAmount', 'bonusSpendCents', 'bonusMonths', 'authorizedUserFeeCents'].includes(field) && typeof v === 'number' && Number.isInteger(v) && v >= 0) ||
    (field === 'foreignTxFee' && typeof v === 'boolean') ||
    (field === 'bonusType' && typeof v === 'string' && ['POINTS', 'MILES', 'CASH', 'NIGHTS', 'OTHER'].includes(v)) ||
    (field === 'offerExpiresAt' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)));
  if (!okType) return null;
  const range: Partial<Record<FieldName, [number, number]>> = { annualFeeCents: [0, 1_000_000], bonusAmount: [0, 10_000_000], bonusSpendCents: [0, 10_000_000], bonusMonths: [1, 24], authorizedUserFeeCents: [0, 100_000] };
  const r = range[field];
  if (r && typeof v === 'number' && (v < r[0] || v > r[1])) return null;
  const tokens = valueTokens(field, v).filter(Boolean);
  const ev = norm(evidence);
  if (field === 'foreignTxFee' && v === true && /\bno foreign transaction fee/.test(ev)) return null;
  if (tokens.length && !tokens.some((t) => ev.includes(norm(t)))) return null;
  const conf = typeof f.confidence === 'number' && f.confidence >= 0 && f.confidence <= 1 ? f.confidence : 0.7;
  return { field, value: v as never, evidence: evidence.slice(0, 500), confidence: conf };
}

/** Model findings that pass validation; heuristic findings fill fields the model missed. */
export function mergeFindings(model: FieldFinding[], heuristic: FieldFinding[]): FieldFinding[] {
  const out = [...model];
  for (const h of heuristic) {
    const m = out.find((x) => x.field === h.field);
    if (!m) out.push(h);
    else if (JSON.stringify(m.value) === JSON.stringify(h.value)) m.confidence = Math.min(1, Math.max(m.confidence, h.confidence) + 0.05);
    else m.confidence = Math.min(m.confidence, 0.5); // disagreement → needs careful review
  }
  return out;
}

// ───────────── diff vs catalog ─────────────

export interface CatalogCardFields {
  annualFeeCents: number;
  bonusType: BonusType | null;
  bonusPoints: number | null; // bonusAmount in the catalog
  bonusSpendCents: number | null;
  bonusMonths: number | null;
  foreignTxFee: boolean;
  authorizedUserFeeCents: number | null;
  offerExpiresAt: Date | null;
}

export function currentValue(card: CatalogCardFields, field: FieldName): unknown {
  switch (field) {
    case 'bonusAmount':
      return card.bonusPoints;
    case 'offerExpiresAt':
      return card.offerExpiresAt ? card.offerExpiresAt.toISOString().slice(0, 10) : null;
    default:
      return card[field] ?? null;
  }
}

export interface Proposal {
  field: FieldName;
  oldValue: unknown;
  newValue: unknown;
  evidence: string;
  confidence: number;
  largeChange: boolean;
}

/** Findings that differ from the catalog. Fee/bonus moves of more than 50 % lower the confidence. */
export function diffCard(card: CatalogCardFields, findings: FieldFinding[]): Proposal[] {
  const out: Proposal[] = [];
  for (const f of findings) {
    const old = currentValue(card, f.field);
    if (JSON.stringify(old) === JSON.stringify(f.value)) continue;
    const large = typeof old === 'number' && typeof f.value === 'number' && old > 0 && Math.abs(f.value - old) / old > 0.5;
    out.push({ field: f.field, oldValue: old, newValue: f.value, evidence: f.evidence, confidence: large ? Math.min(f.confidence, 0.6) : f.confidence, largeChange: large });
  }
  return out;
}

// ───────────── offer history analytics ─────────────

export interface OfferPoint {
  bonusAmount: number | null;
  valuationCents: number | null;
  validFrom: Date;
  validTo: Date | null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Elevated = at least `factor` × the median value of versions active in the previous `months`. */
export function isElevated(newValue: number | null, history: OfferPoint[], at: Date, months = 24, factor = 1.2): boolean {
  if (newValue == null) return false;
  const since = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() - months, at.getUTCDate()));
  const vals = history.filter((h) => (h.validTo ?? at) >= since && h.valuationCents != null).map((h) => h.valuationCents as number);
  const med = median(vals);
  return med != null && med > 0 && newValue >= med * factor;
}

/** Value of a bonus in cents at a cents-per-point valuation (CASH is already cents). */
export function bonusValueCents(type: BonusType | null, amount: number | null, centsPerPoint: number): number | null {
  if (amount == null || type == null) return null;
  if (type === 'CASH') return amount;
  if (type === 'NIGHTS' || type === 'OTHER') return null;
  return Math.round(amount * centsPerPoint);
}

/** "40K → 50K → 60K" style label. */
export function timelineLabel(points: Array<{ bonusAmount: number | null }>, type: BonusType | null): string {
  const fmt = (n: number | null) => (n == null ? '—' : type === 'CASH' ? `$${Math.round(n / 100)}` : n >= 1000 ? `${Math.round(n / 1000)}K` : String(n));
  return points.map((p) => fmt(p.bonusAmount)).join(' → ');
}
