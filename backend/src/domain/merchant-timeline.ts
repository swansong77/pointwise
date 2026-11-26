/** Merchant offer timeline (pure): how often a merchant runs offers, how good they are, and where today's sits. */

export interface TimelineOffer {
  id: string;
  issuer: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  createdAt: Date;
  valueCents: number;
  percent: number | null;
}

export interface Timeline {
  count: number;
  active: number;
  averageValueCents: number;
  best: { id: string; valueCents: number; issuer: string | null } | null;
  /** offers per year over the observed span */
  perYear: number;
  /** offers started per calendar month, index 0 = January */
  seasonality: number[];
  /** percentile (0–100) of the best active offer among all offers by value; null when none is active */
  currentRank: number | null;
  entries: Array<{ id: string; issuer: string | null; start: Date; end: Date | null; valueCents: number; percent: number | null; active: boolean }>;
}

const DAY = 86_400_000;

export function buildTimeline(offers: TimelineOffer[], now: Date): Timeline {
  const entries = offers
    .map((o) => {
      const start = o.startsAt ?? o.createdAt;
      return { id: o.id, issuer: o.issuer, start, end: o.endsAt, valueCents: o.valueCents, percent: o.percent, active: (!o.endsAt || o.endsAt >= now) && start <= now };
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime());
  const values = entries.map((e) => e.valueCents);
  const seasonality = new Array<number>(12).fill(0);
  for (const e of entries) seasonality[e.start.getUTCMonth()]++;
  const best = entries.length ? entries.reduce((m, e) => (e.valueCents > m.valueCents ? e : m)) : null;
  const span = entries.length > 1 ? Math.max((now.getTime() - entries[0].start.getTime()) / DAY / 365.25, 1 / 12) : 1;
  const active = entries.filter((e) => e.active);
  const topActive = active.length ? Math.max(...active.map((e) => e.valueCents)) : null;
  const currentRank = topActive == null ? null : Math.round((values.filter((v) => v <= topActive).length / values.length) * 100);
  return {
    count: entries.length,
    active: active.length,
    averageValueCents: values.length ? Math.round(values.reduce((s, v) => s + v, 0) / values.length) : 0,
    best: best ? { id: best.id, valueCents: best.valueCents, issuer: best.issuer } : null,
    perYear: entries.length ? Math.round((entries.length / span) * 10) / 10 : 0,
    seasonality,
    currentRank,
    entries,
  };
}
