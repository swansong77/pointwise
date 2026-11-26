/**
 * What the household's offers and plans have saved, and are expected to (pure): totals, by card, member and merchant, by month, and how
 * well saved plans matched what was actually returned. Reads inventory rows; invents nothing.
 */
import { InventoryRow, LIVE_STATES } from './offer-lifecycle';

export const SAVINGS_VERSION = 'savings-summary/1';

export interface PlannedOutcome {
  status: 'PLANNED' | 'DONE' | 'CANCELLED';
  expectedCents: number | null;
  actualCents: number | null;
}

export interface CreditUse {
  walletCardId: string;
  card: string;
  cardholder: string | null;
  profileId: string | null;
  usedThisYearCents: number;
}

export interface SavingsLine {
  key: string;
  label: string;
  /** received so far */
  actualCents: number;
  /** still expected from offers that are earning */
  expectedCents: number;
  count: number;
}

export interface SavingsSummary {
  totals: {
    actualCents: number;
    expectedCents: number;
    missedCents: number;
    creditsThisYearCents: number;
    /** offers received plus credits used this year */
    savedCents: number;
  };
  byCard: SavingsLine[];
  byMember: SavingsLine[];
  byMerchant: SavingsLine[];
  /** credit received per month (YYYY-MM), oldest first, last twelve months, from the redeemed (else added) date */
  byMonth: Array<{ month: string; actualCents: number }>;
  plans: { done: number; expectedCents: number; actualCents: number; metCount: number; hitRate: number | null };
}

const line = (map: Map<string, SavingsLine>, key: string, label: string): SavingsLine => {
  let l = map.get(key);
  if (!l) map.set(key, (l = { key, label, actualCents: 0, expectedCents: 0, count: 0 }));
  return l;
};

const ym = (d: Date) => d.toISOString().slice(0, 7);

export function summarizeSavings(rows: InventoryRow[], planned: PlannedOutcome[], credits: CreditUse[], missedCents: number, now: Date): SavingsSummary {
  const cards = new Map<string, SavingsLine>();
  const members = new Map<string, SavingsLine>();
  const merchants = new Map<string, SavingsLine>();
  const months = new Map<string, number>();
  let actual = 0;
  let expected = 0;
  for (const r of rows) {
    const live = LIVE_STATES.includes(r.state);
    const exp = live ? r.expectedSavingsCents : 0;
    actual += r.actualSavingsCents;
    expected += exp;
    if (r.actualSavingsCents === 0 && exp === 0) continue;
    const targets: SavingsLine[] = [
      line(cards, r.walletCardId ?? 'none', r.card ?? 'Not on a card'),
      line(members, r.profileId ?? 'none', r.cardholder ?? 'Unassigned'),
      line(merchants, r.merchant?.id ?? r.merchantText.toLowerCase(), r.merchant?.name ?? r.merchantText),
    ];
    for (const t of targets) {
      t.actualCents += r.actualSavingsCents;
      t.expectedCents += exp;
      t.count++;
    }
    if (r.actualSavingsCents > 0) {
      const when = r.redeemedAt ?? r.activatedAt ?? r.addedAt;
      if (when) months.set(ym(when), (months.get(ym(when)) ?? 0) + r.actualSavingsCents);
    }
  }
  // credits used this year belong to their card and member too
  let creditsTotal = 0;
  for (const c of credits) {
    if (c.usedThisYearCents <= 0) continue;
    creditsTotal += c.usedThisYearCents;
    line(cards, c.walletCardId, c.card).actualCents += c.usedThisYearCents;
    line(members, c.profileId ?? 'none', c.cardholder ?? 'Unassigned').actualCents += c.usedThisYearCents;
  }
  const rank = (m: Map<string, SavingsLine>, top?: number) =>
    [...m.values()].sort((a, b) => b.actualCents + b.expectedCents - (a.actualCents + a.expectedCents) || a.label.localeCompare(b.label)).slice(0, top);

  // the last twelve months, oldest first, with empty months shown so the chart has no gaps
  const series: SavingsSummary['byMonth'] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    series.push({ month: ym(d), actualCents: months.get(ym(d)) ?? 0 });
  }

  const done = planned.filter((p) => p.status === 'DONE' && p.actualCents != null && p.expectedCents != null);
  const met = done.filter((p) => (p.actualCents as number) >= (p.expectedCents as number));
  return {
    totals: { actualCents: actual, expectedCents: expected, missedCents, creditsThisYearCents: creditsTotal, savedCents: actual + creditsTotal },
    byCard: rank(cards),
    byMember: rank(members),
    byMerchant: rank(merchants, 10),
    byMonth: series,
    plans: {
      done: done.length,
      expectedCents: done.reduce((s, p) => s + (p.expectedCents as number), 0),
      actualCents: done.reduce((s, p) => s + (p.actualCents as number), 0),
      metCount: met.length,
      hitRate: done.length ? Math.round((met.length / done.length) * 100) : null,
    },
  };
}
