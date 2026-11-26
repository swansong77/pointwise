/**
 * What is about to lapse (pure): offers, benefit credits and certificates sorted into "this week / two weeks / this month /
 * next two months" with what is lost if each is missed. Reads dated value; invents nothing.
 */
export const EXPIRATION_VERSION = 'expiration-buckets/1';

const DAY = 86_400_000;
const dayNum = (d: Date) => Math.floor(d.getTime() / DAY);

export type ExpiringKind = 'OFFER' | 'CREDIT' | 'CERTIFICATE';

export interface ExpiringItem {
  kind: ExpiringKind;
  id: string;
  label: string;
  cardholder: string | null;
  card: string | null;
  walletCardId: string | null;
  merchant: string | null;
  endsAt: Date;
  /** value lost if it lapses unused */
  valueCents: number;
  /** what the item needs next ("Activate it", "Use it before…") */
  action: string;
}

export interface ExpiringRow extends ExpiringItem {
  daysLeft: number;
}

export interface ExpirationBucket {
  key: string;
  label: string;
  /** inclusive bounds in days from today */
  fromDays: number;
  toDays: number;
  items: ExpiringRow[];
  totalCents: number;
}

export interface ExpirationSummary {
  buckets: ExpirationBucket[];
  /** everything inside the widest bucket */
  count: number;
  totalCents: number;
  /** lost if nothing is done this week */
  urgentCents: number;
  byKind: Record<ExpiringKind, { count: number; cents: number }>;
  nextDeadline: ExpiringRow | null;
}

export const DEFAULT_BUCKETS: Array<{ key: string; label: string; toDays: number }> = [
  { key: 'WEEK', label: 'This week', toDays: 7 },
  { key: 'TWO_WEEKS', label: 'Next week', toDays: 14 },
  { key: 'MONTH', label: 'Within 30 days', toDays: 30 },
  { key: 'TWO_MONTHS', label: 'Within 60 days', toDays: 60 },
];

/** Items that lapse from today up to the last bucket's bound, in buckets, soonest first. Already-lapsed items are left out. */
export function bucketExpirations(items: ExpiringItem[], now: Date, bounds = DEFAULT_BUCKETS): ExpirationSummary {
  const rows: ExpiringRow[] = items
    .filter((i) => i.valueCents > 0)
    .map((i) => ({ ...i, daysLeft: dayNum(i.endsAt) - dayNum(now) }))
    .filter((r) => r.daysLeft >= 0)
    .sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime() || b.valueCents - a.valueCents || a.id.localeCompare(b.id));
  let from = 0;
  const buckets: ExpirationBucket[] = bounds.map((b) => {
    const inB = rows.filter((r) => r.daysLeft >= from && r.daysLeft <= b.toDays);
    const out: ExpirationBucket = { key: b.key, label: b.label, fromDays: from, toDays: b.toDays, items: inB, totalCents: inB.reduce((s, r) => s + r.valueCents, 0) };
    from = b.toDays + 1;
    return out;
  });
  const inside = buckets.flatMap((b) => b.items);
  const byKind = { OFFER: { count: 0, cents: 0 }, CREDIT: { count: 0, cents: 0 }, CERTIFICATE: { count: 0, cents: 0 } } as ExpirationSummary['byKind'];
  for (const r of inside) {
    byKind[r.kind].count++;
    byKind[r.kind].cents += r.valueCents;
  }
  return {
    buckets,
    count: inside.length,
    totalCents: inside.reduce((s, r) => s + r.valueCents, 0),
    urgentCents: buckets[0]?.totalCents ?? 0,
    byKind,
    nextDeadline: inside[0] ?? null,
  };
}
