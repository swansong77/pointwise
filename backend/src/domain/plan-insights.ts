/**
 * What to say about a set of purchase plans (pure): named strategies, what lapses before or soon after the planned date, the best
 * day to buy, and which household member should pay. Reads plans and dated value; invents nothing.
 */
import { Plan } from './purchase-plan';
import { normalizeDescriptor } from './spend';

export const PLAN_INSIGHTS_VERSION = 'plan-insights/1';

const DAY = 86_400_000;
const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const dayNum = (d: Date) => Math.floor(d.getTime() / DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);

// ───────────── labels ─────────────

/** "Hilton offer: $100 back on $500" or "Uber Eats offer: 10% back up to $20". Built from the terms, so it reads the same however the offer was entered. */
export function offerLabel(merchantName: string, o: { valueCents: number; percent: number | null; points?: number | null; minSpendCents: number | null }): string {
  const spend = o.minSpendCents ? ` on ${usd(o.minSpendCents).replace('.00', '')}` : '';
  if (o.percent != null) return `${merchantName} offer: ${o.percent}% back${o.valueCents ? ` up to ${usd(o.valueCents).replace('.00', '')}` : ''}`;
  if (o.points) return `${merchantName} offer: ${o.points.toLocaleString('en-US')} points${spend}`;
  return `${merchantName} offer: ${usd(o.valueCents).replace('.00', '')} back${spend}`;
}

// ───────────── strategies ─────────────

export type StrategyKey = 'BEST' | 'ALTERNATIVE' | 'CONSERVATIVE' | 'MAX_REWARDS';

export interface PlanStrategy {
  key: StrategyKey;
  label: string;
  /** index into the ranked plans */
  planIndex: number;
  expectedCents: number;
  /** return given up against the best plan */
  opportunityCostCents: number;
  /** one line on why this plan stands for the strategy */
  why: string;
}

const cardIds = (p: Plan) => p.legs.map((l) => l.walletCardId).sort().join(',');

/**
 * BEST: the highest expected return. ALTERNATIVE: the best plan on a different card (or cards). CONSERVATIVE: the most value from
 * dependable sources only (confidence 75+). MAX_REWARDS: the most value if everything pays out, including a points transfer.
 */
export function strategiesFor(plans: Plan[]): PlanStrategy[] {
  if (!plans.length) return [];
  const best = plans[0];
  const make = (key: StrategyKey, label: string, i: number, why: string): PlanStrategy => ({ key, label, planIndex: i, expectedCents: plans[i].expectedCents, opportunityCostCents: Math.max(0, best.expectedCents - plans[i].expectedCents), why });
  const out: PlanStrategy[] = [make('BEST', 'Best strategy', 0, 'Highest expected return after allowing for stacking risk.')];
  const alt = plans.findIndex((p) => cardIds(p) !== cardIds(best));
  if (alt > 0) out.push(make('ALTERNATIVE', 'Alternative strategy', alt, `Pay with ${plans[alt].legs.map((l) => l.cardName).join(' + ')} instead; it returns ${usd(Math.max(0, best.expectedCents - plans[alt].expectedCents))} less.`));
  let cons = 0;
  for (let i = 1; i < plans.length; i++) if (plans[i].sureCents > plans[cons].sureCents || (plans[i].sureCents === plans[cons].sureCents && plans[i].expectedCents > plans[cons].expectedCents)) cons = i;
  out.push(make('CONSERVATIVE', 'Conservative strategy', cons, `Counts only dependable sources: ${usd(plans[cons].sureCents)} you can rely on.`));
  let max = 0;
  for (let i = 1; i < plans.length; i++) if (plans[i].maxRewardsCents > plans[max].maxRewardsCents || (plans[i].maxRewardsCents === plans[max].maxRewardsCents && plans[i].expectedCents > plans[max].expectedCents)) max = i;
  out.push(make('MAX_REWARDS', 'Maximum rewards strategy', max, `Up to ${usd(plans[max].maxRewardsCents)} if every offer pays${plans[max].breakdown.transferUpliftCents > 0 ? ' and points are transferred' : ''}.`));
  return out;
}

// ───────────── dated value: expiry impact and best time to buy ─────────────

export interface DatedValue {
  kind: 'OFFER' | 'CREDIT' | 'CERTIFICATE';
  label: string;
  /** when it becomes usable (null = already) and when it lapses (null = never) */
  startsAt: Date | null;
  endsAt: Date | null;
  /** what it returns on this purchase */
  valueCents: number;
}

export interface ExpiryImpact {
  kind: DatedValue['kind'];
  label: string;
  endsAt: Date;
  /** days from today until it lapses */
  daysLeft: number;
  potentialLossCents: number;
  /** it lapses before the planned purchase date, so the plan cannot use it unless the purchase moves up */
  lapsesBeforePlanned: boolean;
  message: string;
}

/**
 * Value that lapses on or before the planned purchase, or within `horizonDays` after it. "Purchase before Dec 15: the Hilton offer
 * expires; potential loss $100". Items already lapsed are left out.
 */
export function expiryImpact(items: DatedValue[], plannedFor: Date | null, now: Date, horizonDays = 45): ExpiryImpact[] {
  const planned = plannedFor ?? now;
  const out: ExpiryImpact[] = [];
  for (const it of items) {
    if (!it.endsAt || it.valueCents <= 0) continue;
    const left = dayNum(it.endsAt) - dayNum(now);
    if (left < 0) continue;
    const before = dayNum(it.endsAt) < dayNum(planned);
    const soonAfter = !before && dayNum(it.endsAt) - dayNum(planned) <= horizonDays;
    if (!before && !soonAfter) continue;
    out.push({
      kind: it.kind,
      label: it.label,
      endsAt: it.endsAt,
      daysLeft: left,
      potentialLossCents: it.valueCents,
      lapsesBeforePlanned: before,
      message: before
        ? `${it.label} ends ${iso(it.endsAt)}, before your planned date. Buy by then to keep ${usd(it.valueCents)}.`
        : `Purchase before ${iso(it.endsAt)}: ${it.label} expires. Potential loss ${usd(it.valueCents)}.`,
    });
  }
  return out.sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime() || b.potentialLossCents - a.potentialLossCents);
}

export interface BestTime {
  /** the earliest day that gets the most value */
  date: Date;
  valueCents: number;
  /** what the planned day (or today) would get */
  plannedValueCents: number;
  gainCents: number;
  reason: string;
}

const usableOn = (it: DatedValue, day: number) => (!it.startsAt || dayNum(it.startsAt) <= day) && (!it.endsAt || day <= dayNum(it.endsAt));

/**
 * The best day to buy, from the dates value starts and stops: today, the planned day, the last day of each offer, credit or
 * certificate, and the first day of any that has not started. The earliest day with the most value wins. Null when nothing is dated.
 */
export function bestTimeToBuy(items: DatedValue[], plannedFor: Date | null, now: Date): BestTime | null {
  const live = items.filter((i) => i.valueCents > 0 && (!i.endsAt || dayNum(i.endsAt) >= dayNum(now)));
  if (!live.length) return null;
  const planned = plannedFor ?? now;
  const days = new Set<number>([dayNum(now), dayNum(planned)]);
  for (const i of live) {
    if (i.endsAt) days.add(dayNum(i.endsAt));
    if (i.startsAt && dayNum(i.startsAt) > dayNum(now)) days.add(dayNum(i.startsAt));
  }
  const valueOn = (d: number) => live.filter((i) => usableOn(i, d)).reduce((s, i) => s + i.valueCents, 0);
  let best = { d: dayNum(planned), v: valueOn(dayNum(planned)) };
  for (const d of [...days].filter((x) => x >= dayNum(now)).sort((a, b) => a - b)) {
    const v = valueOn(d);
    if (v > best.v) best = { d, v };
  }
  const plannedValue = valueOn(dayNum(planned));
  const date = new Date(best.d * DAY);
  const gain = best.v - plannedValue;
  const names = live.filter((i) => usableOn(i, best.d)).map((i) => i.label);
  return {
    date,
    valueCents: best.v,
    plannedValueCents: plannedValue,
    gainCents: gain,
    reason: gain > 0 ? `Buying on ${iso(date)} gets ${usd(best.v)} (${names.join(', ')}); your planned day gets ${usd(plannedValue)}.` : `Your planned day already gets the most: ${usd(plannedValue)}${names.length ? ` (${names.join(', ')})` : ''}.`,
  };
}

// ───────────── household: who should pay ─────────────

export interface MemberOption {
  member: string | null;
  planIndex: number;
  cardName: string;
  expectedCents: number;
  offerTitle: string | null;
}

export interface MemberAdvice {
  options: MemberOption[];
  best: MemberOption | null;
  /** how much better the best member is than the next one (0 when they tie or there is only one) */
  marginCents: number;
  reason: string;
}

const who = (m: string | null) => m ?? 'You';

/** The best single-card plan per member, ranked, and a plain reason for the winner. Split plans are not attributed to one member. */
export function memberAdvice(plans: Plan[]): MemberAdvice {
  const byMember = new Map<string | null, MemberOption>();
  plans.forEach((p, i) => {
    if (p.kind !== 'SINGLE') return;
    const cur = byMember.get(p.member);
    if (!cur || p.expectedCents > cur.expectedCents) byMember.set(p.member, { member: p.member, planIndex: i, cardName: p.legs[0].cardName, expectedCents: p.expectedCents, offerTitle: p.legs[0].offerTitle });
  });
  const options = [...byMember.values()].sort((a, b) => b.expectedCents - a.expectedCents || a.planIndex - b.planIndex);
  const best = options[0] ?? null;
  if (!best) return { options, best: null, marginCents: 0, reason: 'No card to compare.' };
  if (options.length === 1) return { options, best, marginCents: 0, reason: `Only ${who(best.member)} has a card that can be used.` };
  const next = options[1];
  const margin = best.expectedCents - next.expectedCents;
  const others = options.slice(1).map((o) => who(o.member));
  let reason: string;
  if (margin < 100) reason = `${who(best.member)} and ${who(next.member)} come out about the same (${usd(best.expectedCents)} vs ${usd(next.expectedCents)}); either can pay.`;
  else if (best.offerTitle && options.slice(1).every((o) => !o.offerTitle)) reason = `${who(best.member)} holds "${best.offerTitle}"; ${others.join(' and ')} ${others.length > 1 ? 'have' : 'has'} no matching offer. ${usd(margin)} more than ${who(next.member)}.`;
  else if (best.offerTitle && next.offerTitle) reason = `${who(best.member)}'s ${best.cardName} returns ${usd(margin)} more than ${who(next.member)}'s ${next.cardName}, both with an offer.`;
  else reason = `${who(best.member)}'s ${best.cardName} earns the most: ${usd(margin)} more than ${who(next.member)}'s ${next.cardName}.`;
  return { options, best, marginCents: margin, reason };
}

// ───────────── matching value the household holds to a purchase ─────────────

const hasWord = (text: string, word: string) => new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text);

export interface CreditRules {
  keywords: string[];
  categories: string[];
}

/** Whether a benefit credit's rules cover this purchase: a keyword in the merchant or item, or the purchase's category or its parent. */
export function creditMatches(rules: CreditRules, ctx: { merchantName: string | null; item: string | null; categorySlug: string | null; parentSlug: string | null }): boolean {
  const text = normalizeDescriptor(`${ctx.merchantName ?? ''} ${ctx.item ?? ''}`);
  if (text && rules.keywords.some((k) => k && hasWord(text, normalizeDescriptor(k)))) return true;
  const cats = [ctx.categorySlug, ctx.parentSlug].filter((x): x is string => !!x);
  return rules.categories.some((c) => cats.includes(c));
}

const GENERIC = new Set(['honors', 'rewards', 'club', 'world', 'points', 'miles', 'guest', 'bonvoy', 'privileges', 'one', 'plus', 'airlines', 'air', 'lines']);

/** Whether a certificate applies to a merchant: its program's brand word is in the merchant name, or the merchant is among the eligible brands. */
export function certificateMatches(c: { programName: string | null; eligible: string[] }, merchant: { name: string; parentCompany?: string | null }): boolean {
  const m = normalizeDescriptor(`${merchant.name} ${merchant.parentCompany ?? ''}`);
  if (!m) return false;
  const brand = normalizeDescriptor(c.programName ?? '').split(' ').find((w) => w.length >= 4 && !GENERIC.has(w));
  if (brand && hasWord(m, brand)) return true;
  return c.eligible.some((e) => {
    const t = normalizeDescriptor(e);
    return t.length >= 4 && (hasWord(m, t) || m.includes(t));
  });
}
