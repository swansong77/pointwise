/** Spending behavior from transactions (pure): per-merchant frequency, seasonality, subscriptions, category share. */

export interface BehaviorTxn {
  merchantId: string | null;
  categoryId?: string | null;
  profileId?: string | null;
  date: Date;
  amountCents: number;
}

export interface MerchantBehavior {
  merchantId: string;
  count: number;
  totalCents: number;
  avgCents: number;
  lastDate: Date;
  /** visits per month over the window */
  perMonth: number;
  /** purchases per calendar month, index 0 = January */
  seasonality: number[];
  isSubscription: boolean;
  /** distinct household members who spent here */
  members: number;
}

export interface Behavior {
  windowMonths: number;
  merchants: Map<string, MerchantBehavior>;
  categoryShare: Map<string, number>;
  totalCents: number;
}

const DAY = 86_400_000;

/** Same merchant, at least 3 purchases, roughly monthly gaps (25–35 days) and amounts within 15% of the median. */
export function looksLikeSubscription(dates: Date[], amounts: number[]): boolean {
  if (dates.length < 3) return false;
  const d = [...dates].sort((a, b) => a.getTime() - b.getTime());
  const gaps = d.slice(1).map((x, i) => (x.getTime() - d[i].getTime()) / DAY);
  if (!gaps.every((g) => g >= 25 && g <= 35)) return false;
  const sorted = [...amounts].sort((a, b) => a - b);
  const med = sorted[Math.floor(sorted.length / 2)];
  return med > 0 && amounts.every((a) => Math.abs(a - med) / med <= 0.15);
}

export function analyzeBehavior(txns: BehaviorTxn[], now: Date, windowMonths = 12): Behavior {
  const from = new Date(now.getTime() - windowMonths * 30.4375 * DAY);
  const within = txns.filter((t) => t.amountCents > 0 && t.date >= from && t.date <= now);
  const by = new Map<string, BehaviorTxn[]>();
  for (const t of within) if (t.merchantId) by.set(t.merchantId, [...(by.get(t.merchantId) ?? []), t]);
  const merchants = new Map<string, MerchantBehavior>();
  for (const [id, list] of by) {
    const total = list.reduce((s, t) => s + t.amountCents, 0);
    const season = new Array<number>(12).fill(0);
    for (const t of list) season[t.date.getUTCMonth()]++;
    merchants.set(id, {
      merchantId: id,
      count: list.length,
      totalCents: total,
      avgCents: Math.round(total / list.length),
      lastDate: new Date(Math.max(...list.map((t) => t.date.getTime()))),
      perMonth: Math.round((list.length / windowMonths) * 100) / 100,
      seasonality: season,
      isSubscription: looksLikeSubscription(list.map((t) => t.date), list.map((t) => t.amountCents)),
      members: new Set(list.map((t) => t.profileId ?? 'self')).size,
    });
  }
  const totalCents = within.reduce((s, t) => s + t.amountCents, 0);
  const cat = new Map<string, number>();
  for (const t of within) if (t.categoryId) cat.set(t.categoryId, (cat.get(t.categoryId) ?? 0) + t.amountCents);
  const categoryShare = new Map([...cat].map(([k, v]) => [k, totalCents ? v / totalCents : 0]));
  return { windowMonths, merchants, categoryShare, totalCents };
}
