/**
 * Roadmaps (pure): the next 90 days or the year as a timeline of what is coming, grouped into phases, with the three areas to focus on.
 * It lays out dates and value that other engines found; it never schedules anything.
 */
export const ROADMAP_VERSION = 'cos-roadmap/1';
const usd = (c: number) => '$' + Math.round(Math.abs(c) / 100).toLocaleString('en-US');
const day = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;

export type RoadArea = 'OFFERS' | 'POINTS' | 'CARDS' | 'APPLICATIONS' | 'GOALS' | 'LIFE';
export const AREA_LABEL: Record<RoadArea, string> = { OFFERS: 'Offers and credits', POINTS: 'Points, certificates and status', CARDS: 'Cards and annual fees', APPLICATIONS: 'Applications and 5/24', GOALS: 'Goals', LIFE: 'Life events' };
const AREA_ADVICE: Record<RoadArea, string> = {
  OFFERS: 'Use or activate what is about to lapse, and keep the offer inbox short.',
  POINTS: 'Use the certificates and balances that expire first; check transfer bonuses before you move anything.',
  CARDS: 'Decide each fee before the card renews: keep, ask for a retention offer, change the product or cancel.',
  APPLICATIONS: 'Plan applications around 5/24 slot dates and put them on the member who benefits most.',
  GOALS: 'Put the next step toward each goal on the calendar.',
  LIFE: 'Line up the cards, certificates and credits for each event before you book.',
};

export interface RoadEvent {
  date: Date;
  title: string;
  area: RoadArea;
  /** what is at stake or on offer */
  valueCents: number;
  /** lost if nothing is done */
  atRisk: boolean;
  href: string;
}

export interface Phase {
  label: string;
  from: string;
  to: string;
  events: Array<{ date: string; title: string; area: RoadArea; valueCents: number; atRisk: boolean; href: string }>;
  valueCents: number;
  atRiskCents: number;
}

export interface Focus {
  area: RoadArea;
  label: string;
  advice: string;
  events: number;
  valueCents: number;
}

export interface Roadmap {
  version: string;
  span: 90 | 365;
  headline: string;
  phases: Phase[];
  focus: Focus[];
  totalValueCents: number;
  atRiskCents: number;
  eventCount: number;
}

/** 90 days → three 30-day phases; a year → four quarters */
export function phasesFor(span: 90 | 365, now: Date): Array<{ label: string; from: Date; to: Date }> {
  const n = span === 90 ? 3 : 4;
  const len = span / n;
  return Array.from({ length: n }, (_, i) => {
    const from = new Date(now.getTime() + i * len * DAY);
    const to = new Date(now.getTime() + (i + 1) * len * DAY);
    const label = span === 90 ? (i === 0 ? 'Next 30 days' : i === 1 ? 'Days 31–60' : 'Days 61–90') : `Quarter ${i + 1}`;
    return { label, from, to };
  });
}

export function roadmap(events: RoadEvent[], span: 90 | 365, now: Date): Roadmap {
  const end = now.getTime() + span * DAY;
  const inRange = events.filter((e) => e.date.getTime() >= now.getTime() - DAY && e.date.getTime() < end).sort((a, b) => a.date.getTime() - b.date.getTime() || b.valueCents - a.valueCents || a.title.localeCompare(b.title));
  const phases: Phase[] = phasesFor(span, now).map((p) => {
    const evs = inRange.filter((e) => e.date.getTime() < p.to.getTime() && (e.date.getTime() >= p.from.getTime() || p.from.getTime() === now.getTime()));
    return { label: p.label, from: day(p.from), to: day(new Date(p.to.getTime() - DAY)), events: evs.map((e) => ({ date: day(e.date), title: e.title, area: e.area, valueCents: e.valueCents, atRisk: e.atRisk, href: e.href })), valueCents: evs.reduce((s, e) => s + e.valueCents, 0), atRiskCents: evs.filter((e) => e.atRisk).reduce((s, e) => s + e.valueCents, 0) };
  });
  // an event that was a day late (just lapsed) belongs to the first phase, not to none
  const byArea = new Map<RoadArea, Focus>();
  for (const e of inRange) {
    const f = byArea.get(e.area) ?? { area: e.area, label: AREA_LABEL[e.area], advice: AREA_ADVICE[e.area], events: 0, valueCents: 0 };
    f.events++;
    f.valueCents += e.valueCents;
    byArea.set(e.area, f);
  }
  const focus = [...byArea.values()].sort((a, b) => b.valueCents - a.valueCents || b.events - a.events || a.label.localeCompare(b.label)).slice(0, 3);
  const total = inRange.reduce((s, e) => s + e.valueCents, 0);
  const risk = inRange.filter((e) => e.atRisk).reduce((s, e) => s + e.valueCents, 0);
  const what = span === 90 ? 'the next 90 days' : 'the year ahead';
  return {
    version: ROADMAP_VERSION,
    span,
    headline: inRange.length ? `${inRange.length} thing${inRange.length === 1 ? '' : 's'} on the calendar for ${what}, worth about ${usd(total)}${risk ? `; ${usd(risk)} of it is lost if nothing is done` : ''}.` : `Nothing is scheduled for ${what}.`,
    phases,
    focus,
    totalValueCents: total,
    atRiskCents: risk,
    eventCount: inRange.length,
  };
}

/** "What should I do over the next 90 days?", "What should I focus on this year?", "How do I maximize value from my cards?" */
export function roadmapSpan(q: string): 90 | 365 | null {
  const t = q.toLowerCase();
  if (/\bnext (90|ninety) days\b|\b(90|ninety)[- ]day\b|\bnext (3|three) months\b|\bthis quarter\b|\bnext quarter\b/.test(t)) return 90;
  if (/\bmaximi[sz]e (the )?value\b|\bget the most (out )?of my cards\b|\bhow do i maximi[sz]e\b/.test(t)) return 365;
  // "this year" alone is not enough: "what card should I use this year at Costco" is a shopping question
  if (/\bthis year\b|\bnext (12|twelve) months\b|\bnext year\b|\bover the year\b|\bannual (plan|roadmap|review)\b/.test(t) && /\b(focus on|plan|roadmap|priorit\w*|strategy|goals?)\b|what should i (do|focus)|what do i (need to )?do/.test(t)) return 365;
  return null;
}
