import { quarterOf } from './rotating-calendar';

/**
 * Reads the quarter's bonus categories out of the text of a public issuer page. Deliberately conservative: it returns a result
 * only when the page states ONE quarter and ONE rate in sentences that name recognised categories, and otherwise says why not
 * (an admin is told and can import the quarter by hand). A wrong calendar is worse than a missing one.
 */
export interface ParsedQuarter {
  quarter: string;
  mult: number;
  categories: Array<{ cat: string; desc: string }>;
  capDollars?: number;
}
export type ParseOutcome = { ok: true; parsed: ParsedQuarter } | { ok: false; reason: string };

/** Category slug -> words that name it on an issuer page. */
export const CATEGORY_WORDS: Record<string, RegExp> = {
  groceries: /\bgrocery|\bsupermarket/i,
  dining: /\brestaurant|\bdining\b/i,
  gas: /\bgas stations?\b|\bgas and ev\b|\bev charging\b/i,
  streaming: /\bstreaming\b/i,
  'online-shopping': /\bonline (shopping|retail)\b/i,
  drugstores: /\bdrugstores?\b|\bpharmac/i,
  'home-improvement': /\bhome improvement\b/i,
  'wholesale-clubs': /\bwholesale clubs?\b/i,
  transit: /\btransit\b|\bcommut/i,
  entertainment: /\bmovie|\bentertainment\b/i,
};

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_RANGE = new RegExp(`\\b(${MONTHS.join('|')})\\b\\s*(?:1(?:st)?\\s*)?(?:-|–|—|to|through)\\s*(${MONTHS.join('|')})\\b(?:\\s*,?\\s*(20\\d\\d))?`, 'i');

/** "2026-Q4" from "Q4 2026", "Q4", or "October - December 2026"; null when the sentence names none. */
export function quarterIn(sentence: string, now: Date): string | null {
  const q = /\bQ([1-4])\s*,?\s*(20\d\d)?/i.exec(sentence);
  if (q) return `${q[2] ?? now.getUTCFullYear()}-Q${q[1]}`;
  const m = MONTH_RANGE.exec(sentence);
  if (m) {
    const start = MONTHS.indexOf(m[1].toLowerCase());
    const end = MONTHS.indexOf(m[2].toLowerCase());
    if (start % 3 === 0 && end === start + 2) return `${m[3] ?? now.getUTCFullYear()}-Q${start / 3 + 1}`;
  }
  return null;
}

export function parseRotating(text: string, now: Date): ParseOutcome {
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
  const hits = sentences
    .map((s) => ({ s, quarter: quarterIn(s, now), rate: /(\d+(?:\.\d+)?)\s*%/.exec(s), cats: Object.entries(CATEGORY_WORDS).filter(([, re]) => re.test(s)).map(([k]) => k) }))
    .filter((h) => h.quarter && h.rate && h.cats.length && /quarter|bonus|rotating|activate|categor/i.test(h.s));
  if (!hits.length) return { ok: false, reason: 'the page text states no quarter with a rate and a recognised category (the calendar may be loaded by script)' };
  const quarters = new Set(hits.map((h) => h.quarter));
  if (quarters.size > 1) return { ok: false, reason: `the page states more than one quarter (${[...quarters].join(', ')})` };
  const rates = new Set(hits.map((h) => Number(h.rate![1])));
  if (rates.size > 1) return { ok: false, reason: `the page states more than one rate (${[...rates].join(', ')}%)` };
  const cats = new Map<string, string>();
  for (const h of hits) for (const c of h.cats) if (!cats.has(c)) cats.set(c, h.s.trim().slice(0, 240));
  const cap = /\$\s?([\d,]{3,7})\b[^.]{0,60}(?:each|a|per) quarter|(?:each|a|per) quarter[^.]{0,60}\$\s?([\d,]{3,7})\b|\bup to \$\s?([\d,]{3,7})\b/i.exec(text.replace(/\s+/g, ' '));
  const capDollars = cap ? Number((cap[1] ?? cap[2] ?? cap[3]).replace(/,/g, '')) : undefined;
  return { ok: true, parsed: { quarter: [...quarters][0]!, mult: [...rates][0], categories: [...cats].map(([cat, desc]) => ({ cat, desc })), capDollars } };
}

export const isCurrentOrNext = (q: string, now: Date, next: string) => q === quarterOf(now) || q === next;
