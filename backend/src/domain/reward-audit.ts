/**
 * An audit of the category earning rates in the catalog. Pure code: it reads plain cards and returns findings, so it can be
 * unit-tested and run over the seed data (scripts/export-rewards-audit.ts writes docs/rewards-audit.md).
 *
 * It finds what can be found without asking an issuer: gaps, impossible or suspicious values, rates whose own description says
 * they depend on a condition, caps without a period, and rates that nobody has confirmed. It cannot say a rate is RIGHT.
 */
export interface AuditReward {
  cat?: string | null;
  merchant?: string | null;
  mult: number;
  desc: string;
  cap?: number | null;
  capPeriod?: string | null;
  conditional?: boolean;
  rotating?: boolean;
  /** an issuer page confirmed this rate (date) */
  verifiedOn?: string | null;
}

export interface AuditCard {
  slug: string;
  name: string;
  issuer: string;
  currency: string;
  feeDollars: number;
  rewards: AuditReward[];
  /** where the card comes from: the curated list, an issuer listing, or an issuer page check */
  source: 'CURATED' | 'LISTING';
  /** the curated list had a base rate that a listing replaced */
  curatedHadBase?: boolean;
}

export type Severity = 'error' | 'warn' | 'info';
export interface Finding {
  code: string;
  severity: Severity;
  slug: string;
  message: string;
}

export const BASE = 'everything-else';
export const HIGH_MULTIPLIER = 6;
export const HIGH_BASE = 3;
/** wording that says a rate depends on something a category match cannot know */
export const CONDITION_WORDS = /\bup to \d+(\.\d+)?\s*(x|%)|\bportal\b|\bthrough [A-Z][\w ]*(Travel|Portal|Center)\b|\b(choose|chosen|activate|rotating|first year|linked account)\b/i;

const key = (r: AuditReward) => `${r.cat ?? ''}|${r.merchant ?? ''}|${r.conditional ? 1 : 0}|${r.rotating ? 1 : 0}|${r.rotating ? (r.desc.match(/20\d\d/)?.[0] ?? '') : ''}`;

export function auditCard(c: AuditCard, knownCurrencies: Set<string>): Finding[] {
  const out: Finding[] = [];
  const add = (code: string, severity: Severity, message: string) => out.push({ code, severity, slug: c.slug, message });
  const live = c.rewards.filter((r) => !r.conditional);
  const base = live.find((r) => r.cat === BASE && !r.merchant);
  if (!c.rewards.length) add('NO_REWARDS', 'warn', 'the card has no earning rates at all, so it ranks last in every category');
  else if (!base) add(c.curatedHadBase ? 'BASE_REMOVED' : 'NO_BASE', 'error', c.curatedHadBase ? 'a listing replaced the curated rates and left no base ("everything else") rate' : 'no base ("everything else") rate');
  if (!knownCurrencies.has(c.currency)) add('NO_VALUATION', 'warn', `currency ${c.currency} has no valuation`);
  const seen = new Set<string>();
  for (const r of c.rewards) {
    const what = r.merchant ? `merchant ${r.merchant}` : (r.cat ?? 'no category');
    if (!r.cat && !r.merchant) add('NO_TARGET', 'error', `a rate of ${r.mult}x names neither a category nor a merchant`);
    if (!(r.mult > 0)) add('BAD_MULTIPLIER', 'error', `${what}: the rate is ${r.mult}`);
    if (r.mult > HIGH_MULTIPLIER && !r.conditional && !r.merchant && !r.verifiedOn) add('HIGH_MULTIPLIER', 'info', `${what}: ${r.mult}x is above ${HIGH_MULTIPLIER}x and not marked conditional; check it is a rate on the card, not a program or portal bonus`);
    if (r.cat === BASE && !r.merchant && !r.conditional && r.mult > HIGH_BASE && !r.verifiedOn) add('HIGH_BASE', 'warn', `the base rate of ${r.mult}x on everything is unusually high; check it is not a category or capped rate stored as the base`);
    if (r.cap && !r.capPeriod) add('CAP_NO_PERIOD', 'error', `${what}: a cap of $${r.cap} without a period`);
    if (r.cap && !base) add('CAP_NO_BASE', 'warn', `${what}: capped but the card has no base rate to fall back to`);
    if (!r.cap && /\bcombined\b/i.test(r.desc)) add('COMBINED_NO_CAP', 'warn', `${what}: the description says "combined" but no cap is stored`);
    if (r.cap && /\bcombined\b/i.test(r.desc)) add('COMBINED_CAP', 'info', `${what}: a combined cap is stored on each category, so each is limited separately here`);
    if (!r.conditional && !r.verifiedOn && CONDITION_WORDS.test(r.desc)) add('TEXT_CONDITION', 'warn', `${what}: the description says it depends on a condition ("${r.desc.slice(0, 70)}") but it is ranked as a plain rate`);
    if (base && r !== base && !r.conditional && r.cat !== BASE && r.mult <= base.mult && !r.merchant) add('RATE_LE_BASE', 'warn', `${what}: ${r.mult}x is not above the base rate ${base.mult}x`);
    const k = key(r);
    if (seen.has(k)) add('DUPLICATE', 'error', `${what}: the same rate is listed twice`);
    seen.add(k);
  }
  if (c.rewards.length && !c.rewards.some((r) => r.verifiedOn)) add('UNVERIFIED', 'info', 'no rate has been confirmed by an issuer page');
  return out;
}

export interface AuditResult {
  findings: Finding[];
  cards: number;
  verifiedCards: number;
  partiallyVerified: number;
  unverifiedCards: number;
  byCode: Record<string, number>;
  bySeverity: Record<Severity, number>;
}

export function auditAll(cards: AuditCard[], currencies: string[]): AuditResult {
  const known = new Set(currencies);
  const findings = cards.flatMap((c) => auditCard(c, known));
  const byCode: Record<string, number> = {};
  const bySeverity: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) {
    byCode[f.code] = (byCode[f.code] ?? 0) + 1;
    bySeverity[f.severity]++;
  }
  const state = (c: AuditCard) => {
    const live = c.rewards.filter((r) => !r.conditional);
    if (!live.length) return 'none';
    const n = live.filter((r) => r.verifiedOn).length;
    return n === live.length ? 'all' : n > 0 ? 'some' : 'none';
  };
  return {
    findings,
    cards: cards.length,
    verifiedCards: cards.filter((c) => state(c) === 'all').length,
    partiallyVerified: cards.filter((c) => state(c) === 'some').length,
    unverifiedCards: cards.filter((c) => state(c) === 'none').length,
    byCode,
    bySeverity,
  };
}

const TITLE: Record<string, string> = {
  BASE_REMOVED: 'A listing removed the base rate',
  NO_BASE: 'No base rate',
  NO_REWARDS: 'No earning rates at all',
  NO_VALUATION: 'Currency without a valuation',
  NO_TARGET: 'A rate with no category or merchant',
  BAD_MULTIPLIER: 'A rate that is not positive',
  HIGH_MULTIPLIER: 'Very high category multipliers',
  HIGH_BASE: 'An unusually high base rate',
  CAP_NO_PERIOD: 'A cap without a period',
  CAP_NO_BASE: 'A cap with nothing to fall back to',
  COMBINED_NO_CAP: 'Described as combined, no cap stored',
  COMBINED_CAP: 'Combined caps stored per category',
  TEXT_CONDITION: 'Described as conditional but ranked as plain',
  RATE_LE_BASE: 'A category rate not above the base rate',
  DUPLICATE: 'The same rate twice',
  UNVERIFIED: 'No rate confirmed by an issuer page',
};

/** The audit as a Markdown document. */
export function renderAudit(a: AuditResult, asOf: string, cards: AuditCard[]): string {
  const lines: string[] = [];
  lines.push('# Rewards audit', '', `Generated ${asOf} by \`backend/scripts/export-rewards-audit.ts\` over the curated list, the issuer listings and the issuer-page checks. It finds gaps, doubtful values and unconfirmed rates; it cannot prove a rate right. Verification means an issuer's own product or listing page was read and states the rate.`, '');
  lines.push('## Summary', '', '| | |', '|---|---|', `| Cards | ${a.cards} |`, `| Every rate confirmed by an issuer page | ${a.verifiedCards} |`, `| Some rates confirmed | ${a.partiallyVerified} |`, `| Nothing confirmed | ${a.unverifiedCards} |`, `| Errors | ${a.bySeverity.error} |`, `| Warnings | ${a.bySeverity.warn} |`, `| Notes | ${a.bySeverity.info} |`, '');
  lines.push('| Finding | Cards |', '|---|---|');
  for (const [code, n] of Object.entries(a.byCode).sort((x, y) => y[1] - x[1])) lines.push(`| ${TITLE[code] ?? code} (\`${code}\`) | ${n} |`);
  lines.push('');
  for (const sev of ['error', 'warn'] as const) {
    const of = a.findings.filter((f) => f.severity === sev);
    if (!of.length) continue;
    lines.push(sev === 'error' ? '## Errors' : '## Warnings', '');
    for (const code of [...new Set(of.map((f) => f.code))]) {
      const list = of.filter((f) => f.code === code);
      lines.push(`### ${TITLE[code] ?? code} (${list.length})`, '');
      for (const f of list.slice(0, 60)) lines.push(`- \`${f.slug}\`: ${f.message}`);
      if (list.length > 60) lines.push(`- … and ${list.length - 60} more`);
      lines.push('');
    }
  }
  const verified = cards.filter((c) => c.rewards.some((r) => r.verifiedOn));
  lines.push('## Confirmed against an issuer page', '', `${verified.length} card(s) have at least one rate confirmed:`, '');
  for (const c of verified.sort((x, y) => x.slug.localeCompare(y.slug))) lines.push(`- \`${c.slug}\` (${c.rewards.filter((r) => r.verifiedOn).length} of ${c.rewards.length} rates)`);
  lines.push('');
  return lines.join('\n');
}
