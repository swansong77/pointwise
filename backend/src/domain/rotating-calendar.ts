/**
 * Quarterly rotating categories (Chase Freedom Flex, Discover it Cash Back and similar). Pure code: quarter arithmetic and
 * validation of a calendar entry. The calendar itself is data (seed/rotating-calendar.ts, or an admin import); nothing here
 * contacts an issuer.
 */
export interface RotatingCategory {
  /** category slug */
  cat: string;
  /** rate in percent or points, e.g. 5 */
  mult: number;
  /** what the issuer says, e.g. "5% at grocery stores (not Walmart or Target)" */
  desc: string;
}

export interface RotatingEntry {
  /** card slugs the entry applies to (a family shares one calendar) */
  cards: string[];
  /** "2026-Q4" */
  quarter: string;
  categories: RotatingCategory[];
  /** quarterly spend cap in dollars, when the issuer states one */
  capDollars?: number;
  /** the issuer page that announces the quarter */
  sourceUrl: string;
  /** the date a person read that page (YYYY-MM-DD) */
  checkedOn: string;
}

export const QUARTER_RE = /^(20\d\d)-Q([1-4])$/;

export function quarterOf(d: Date): string {
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

export function nextQuarter(q: string): string {
  const m = QUARTER_RE.exec(q);
  if (!m) throw new Error(`bad quarter ${q}`);
  const y = Number(m[1]);
  const n = Number(m[2]);
  return n === 4 ? `${y + 1}-Q1` : `${y}-Q${n + 1}`;
}

/** First instant of the quarter and its last instant (UTC), as the engine's startsAt and endsAt. */
export function quarterBounds(q: string): { startsAt: Date; endsAt: Date } {
  const m = QUARTER_RE.exec(q);
  if (!m) throw new Error(`bad quarter ${q}`);
  const y = Number(m[1]);
  const first = (Number(m[2]) - 1) * 3;
  return { startsAt: new Date(Date.UTC(y, first, 1)), endsAt: new Date(Date.UTC(y, first + 3, 0, 23, 59, 59)) };
}

export function daysLeftInQuarter(now: Date): number {
  return Math.ceil((quarterBounds(quarterOf(now)).endsAt.getTime() - now.getTime()) / 86_400_000);
}

/** Returns the problems with an entry (empty when it is usable). */
export function validateEntry(e: RotatingEntry, knownCategories: Set<string>): string[] {
  const out: string[] = [];
  if (!QUARTER_RE.test(e.quarter)) out.push(`quarter "${e.quarter}" is not like 2026-Q4`);
  if (!e.cards?.length) out.push('no cards');
  if (!e.categories?.length) out.push('no categories');
  for (const c of e.categories ?? []) {
    if (!knownCategories.has(c.cat)) out.push(`unknown category "${c.cat}"`);
    if (!(c.mult > 0 && c.mult <= 10)) out.push(`rate ${c.mult} for ${c.cat} is not between 0 and 10`);
    if (!c.desc || c.desc.length < 8) out.push(`${c.cat}: describe the rate in words`);
  }
  if (e.capDollars !== undefined && !(e.capDollars > 0 && e.capDollars <= 100_000)) out.push(`cap ${e.capDollars} is not plausible`);
  if (!/^https:\/\//.test(e.sourceUrl ?? '')) out.push('the source must be an https page');
  if (!/^20\d\d-\d\d-\d\d$/.test(e.checkedOn ?? '')) out.push('checkedOn must be YYYY-MM-DD');
  const seen = new Set<string>();
  for (const c of e.categories ?? []) {
    if (seen.has(c.cat)) out.push(`category ${c.cat} twice`);
    seen.add(c.cat);
  }
  return out;
}
