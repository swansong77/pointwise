/**
 * AI Mode briefings and alerts (pure). A briefing is the plan the planner already builds, arranged for a moment (this morning, this week,
 * this month) with what changed and what to decide. Alerts are the few opportunities worth interrupting for. Nothing here calls a
 * model or changes anything, and it never proposes applying, transferring, booking or cancelling on the member's behalf.
 */
import type { CopilotPlan, PlanItem } from './copilot-plan';

export const BRIEF_VERSION = 'copilot-brief/1';
export type BriefKind = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'BOARD';
/** the kinds the scheduled briefings and the Briefings panel use; the board report is the Chief of Staff's own */
export const BRIEF_KINDS: BriefKind[] = ['DAILY', 'WEEKLY', 'MONTHLY'];
export const BRIEF_RETENTION_DAYS = 90;
export const MAX_ALERTS_PER_RUN = 3;

export interface BriefLine {
  text: string;
  detail?: string;
  href?: string;
  valueCents?: number | null;
  /** urgent: act now · warn: worth attention · good: going well · info: for your awareness */
  tone: 'urgent' | 'warn' | 'good' | 'info';
  /** the plan item behind it, so it can be snoozed or dismissed from the briefing */
  itemId?: string;
}

export interface BriefSection {
  key: string;
  title: string;
  lines: BriefLine[];
  /** what to say when there is nothing */
  empty: string;
}

export interface Briefing {
  version: string;
  kind: BriefKind;
  periodKey: string;
  generatedAt: string;
  headline: string;
  summary: string;
  sections: BriefSection[];
  stats: Record<string, number | string>;
  confidence: number;
  assumptions: string[];
  /** executive format only: the greeting and the numbers in the strip at the top */
  greeting?: string;
  exec?: { highPriority: number; valueAtRiskCents: number; pointsAtRisk: number; certificatesExpiring: number; newHighValueOffers: number; totalActions: number };
}

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const usd = (c: number) => '$' + Math.round(c / 100).toLocaleString('en-US');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** the day (daily), the Monday of the week (weekly) or the month (monthly) a briefing covers */
export function periodKey(kind: BriefKind, now: Date): string {
  if (kind === 'DAILY') return iso(now);
  if (kind === 'MONTHLY' || kind === 'BOARD') return iso(now).slice(0, 7);
  const back = (now.getUTCDay() + 6) % 7;
  return iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back)));
}

const toneFor = (i: PlanItem): BriefLine['tone'] => (i.horizon === 'TODAY' ? 'urgent' : i.horizon === 'WEEK' ? 'warn' : 'info');
const line = (i: PlanItem): BriefLine => ({ text: i.title, detail: i.recommendation, href: i.href, valueCents: i.expectedValueCents, tone: toneFor(i), itemId: i.id });
const section = (key: string, title: string, items: PlanItem[], empty: string, limit = 5): BriefSection => ({ key, title, lines: items.slice(0, limit).map(line), empty });

// ───────────── daily ─────────────

export interface DailySignals {
  newOffers: number;
  newOffersCents: number;
}

export function dailyBrief(plan: CopilotPlan, s: DailySignals, now: Date): Briefing {
  const items = plan.items;
  const by = (f: (i: PlanItem) => boolean) => items.filter(f);
  const travel = by((i) => i.lens === 'TRAVEL');
  const goals = by((i) => i.lens === 'GOAL');
  const household = by((i) => i.lens === 'PORTFOLIO' || i.lens === 'CARD_STRATEGY');
  const rest = by((i) => !['TRAVEL', 'GOAL', 'PORTFOLIO', 'CARD_STRATEGY'].includes(i.lens));
  const sections: BriefSection[] = [
    section('today', 'Today’s priorities', rest.filter((i) => i.horizon === 'TODAY'), 'Nothing is due today.'),
    section('week', 'This week', rest.filter((i) => i.horizon === 'WEEK'), 'Nothing else is due this week.'),
    section('month', 'This month', rest.filter((i) => i.horizon === 'MONTH' || i.horizon === 'LATER'), 'Nothing else is coming up this month.'),
    {
      key: 'new',
      title: 'New since yesterday',
      lines: s.newOffers > 0 ? [{ text: `${plural(s.newOffers, 'new offer')} found${s.newOffersCents > 0 ? `, worth about ${usd(s.newOffersCents)}` : ''}`, detail: 'Open the offer inbox to see which are worth adding.', href: '/offers/inventory', valueCents: s.newOffersCents || null, tone: 'info' }] : [],
      empty: 'No new offers.',
    },
    section('travel', 'Travel opportunities', travel, 'No travel opportunities right now.', 3),
    section('goals', 'Goals and status', goals, 'Your goals are on track.', 3),
    section('household', 'Household', household, 'No household decisions today.', 3),
  ];
  const total = plan.counts.TODAY + plan.counts.WEEK + plan.counts.MONTH + plan.counts.LATER;
  const headline = plan.counts.TODAY ? `${plural(plan.counts.TODAY, 'thing')} to do today` : plan.counts.WEEK ? `Nothing urgent today; ${plural(plan.counts.WEEK, 'thing')} this week` : total ? 'Nothing urgent; a few things to plan' : 'All clear today';
  return {
    version: BRIEF_VERSION,
    kind: 'DAILY',
    periodKey: periodKey('DAILY', now),
    generatedAt: now.toISOString(),
    headline,
    summary: `${plan.summary}${s.newOffers ? ` ${plural(s.newOffers, 'new offer')} arrived.` : ''}`.trim(),
    sections,
    stats: { today: plan.counts.TODAY, week: plan.counts.WEEK, month: plan.counts.MONTH, atStakeCents: plan.valueAtStakeCents, newOffers: s.newOffers },
    confidence: plan.confidence,
    assumptions: plan.assumptions.slice(0, 4),
  };
}

// ───────────── weekly ─────────────

export interface WeeklySignals {
  newOffers: number;
  newOffersCents: number;
  addedOffers: number;
  savedCents: number;
  redeemedOffers: number;
  missedCents: number;
  certsUsed: number;
  changes: Array<{ program: string; what: string }>;
  healthScore: number | null;
  healthLabel: string | null;
  healthReasons: string[];
}

export function weeklyBrief(plan: CopilotPlan, w: WeeklySignals, now: Date): Briefing {
  const changed: BriefLine[] = [
    ...(w.newOffers ? [{ text: `${plural(w.newOffers, 'new offer')} found${w.newOffersCents ? `, about ${usd(w.newOffersCents)}` : ''}`, href: '/offers/inventory', valueCents: w.newOffersCents || null, tone: 'info' as const }] : []),
    ...(w.addedOffers ? [{ text: `${plural(w.addedOffers, 'offer')} added`, href: '/offers/inventory', tone: 'good' as const }] : []),
    ...(w.redeemedOffers ? [{ text: `${plural(w.redeemedOffers, 'offer')} redeemed`, href: '/offers/inventory', tone: 'good' as const }] : []),
    ...(w.certsUsed ? [{ text: `${plural(w.certsUsed, 'certificate')} used`, href: '/loyalty', tone: 'good' as const }] : []),
    ...w.changes.slice(0, 4).map((c) => ({ text: `${c.program}: ${c.what}`, href: '/loyalty', tone: 'info' as const })),
  ];
  const sections: BriefSection[] = [
    { key: 'changed', title: 'What changed', lines: changed, empty: 'Nothing changed this week.' },
    {
      key: 'savings',
      title: 'Savings',
      lines: w.savedCents > 0 ? [{ text: `${usd(w.savedCents)} saved on offers you added this week`, tone: 'good', valueCents: w.savedCents, href: '/offers/inventory' }] : [],
      empty: 'No savings recorded this week.',
    },
    {
      key: 'missed',
      title: 'Missed',
      lines: w.missedCents > 0 ? [{ text: `About ${usd(w.missedCents)} of recommended offers expired unused`, detail: 'A weekly look at the offer inbox usually catches these.', tone: 'warn', valueCents: -w.missedCents, href: '/offers/inventory' }] : [],
      empty: 'Nothing slipped away this week.',
    },
    {
      key: 'health',
      title: 'Portfolio health',
      lines: w.healthScore != null ? [{ text: `Household loyalty health ${w.healthScore}/100${w.healthLabel ? ` (${w.healthLabel.toLowerCase().replace('_', ' ')})` : ''}`, detail: w.healthReasons.slice(0, 2).join('; ') || undefined, tone: w.healthScore >= 70 ? 'good' : w.healthScore >= 40 ? 'warn' : 'urgent', href: '/loyalty' }] : [],
      empty: 'Not enough loyalty data to score yet.',
    },
    section('recommendations', 'Recommendations for next week', plan.items, 'You are on track.', 5),
  ];
  return {
    version: BRIEF_VERSION,
    kind: 'WEEKLY',
    periodKey: periodKey('WEEKLY', now),
    generatedAt: now.toISOString(),
    headline: w.missedCents > 0 ? `A good week, with ${usd(w.missedCents)} that slipped away` : plan.items.length ? `${plural(plan.items.length, 'thing')} to focus on next week` : 'A quiet, on-track week',
    summary: `This week: ${plural(w.newOffers, 'new offer')}, ${plural(w.addedOffers, 'offer')} added, ${plural(w.certsUsed, 'certificate')} used${w.savedCents ? `, ${usd(w.savedCents)} saved` : ''}. ${plan.summary}`,
    sections,
    stats: { newOffers: w.newOffers, added: w.addedOffers, redeemed: w.redeemedOffers, savedCents: w.savedCents, missedCents: w.missedCents, certsUsed: w.certsUsed, health: w.healthScore ?? 'n/a' },
    confidence: plan.confidence,
    assumptions: ['Savings count only offers you added this week.', ...plan.assumptions.slice(0, 3)],
  };
}

// ───────────── monthly ─────────────

export interface CardReview {
  card: string;
  feeCents: number;
  /** credits you used plus rewards earned on your spend, last 12 months */
  valueCents: number;
  daysToRenewal: number | null;
  hasSiblingNoFee: boolean;
  openedMonths: number | null;
}

export type CardVerdictKind = 'KEEP' | 'REVIEW' | 'DOWNGRADE' | 'CANCEL';
export interface CardVerdict {
  card: string;
  verdict: CardVerdictKind;
  netCents: number;
  reason: string;
  daysToRenewal: number | null;
}

/** Keep, downgrade or consider cancelling: from what each card returned against its fee. Never an instruction to act automatically. */
export function cardVerdicts(cards: CardReview[]): CardVerdict[] {
  return cards.map((c) => {
    const net = c.valueCents - c.feeCents;
    const base = { card: c.card, netCents: net, daysToRenewal: c.daysToRenewal };
    if (c.feeCents === 0) return { ...base, verdict: 'KEEP' as const, reason: 'No annual fee, and keeping it preserves your credit history.' };
    if (net >= 0) return { ...base, verdict: 'KEEP' as const, reason: `It returned ${usd(c.valueCents)} against a ${usd(c.feeCents)} fee.` };
    if (c.hasSiblingNoFee) return { ...base, verdict: 'DOWNGRADE' as const, reason: `It returned ${usd(c.valueCents)} against a ${usd(c.feeCents)} fee; a no-fee card in the same family keeps the account open.` };
    if (c.valueCents * 2 < c.feeCents && (c.openedMonths ?? 0) >= 12) return { ...base, verdict: 'CANCEL' as const, reason: `It returned less than half its ${usd(c.feeCents)} fee. Ask for a retention offer first.` };
    return { ...base, verdict: 'REVIEW' as const, reason: `It returned ${usd(c.valueCents)} against a ${usd(c.feeCents)} fee, which is close. Decide whether you will use its benefits${c.daysToRenewal != null ? ` before it renews in ${plural(c.daysToRenewal, 'day')}` : ''}.` };
  });
}

export interface MonthlySignals {
  cards: CardReview[];
  /** the best next card across the household, when someone is eligible */
  applyPick: { member: string; card: string; firstYearCents: number; usesSlot: boolean } | null;
  members: Array<{ member: string; count: number; underLimit: boolean; nextSlotAt: Date | null }>;
  feesCents: number;
  valueCents: number;
}

export function monthlyBrief(plan: CopilotPlan, m: MonthlySignals, now: Date): Briefing {
  const verdicts = cardVerdicts(m.cards).sort((a, b) => ['CANCEL', 'DOWNGRADE', 'REVIEW', 'KEEP'].indexOf(a.verdict) - ['CANCEL', 'DOWNGRADE', 'REVIEW', 'KEEP'].indexOf(b.verdict));
  const verdictLine = (v: CardVerdict): BriefLine => ({
    text: `${v.verdict === 'KEEP' ? 'Keep' : v.verdict === 'DOWNGRADE' ? 'Consider downgrading' : v.verdict === 'CANCEL' ? 'Consider cancelling' : 'Review'} ${v.card}`,
    detail: v.reason,
    valueCents: v.netCents,
    href: '/portfolio',
    tone: v.verdict === 'KEEP' ? 'good' : v.verdict === 'REVIEW' ? 'warn' : 'urgent',
  });
  const waiting = m.members.filter((x) => !x.underLimit);
  const transfer = plan.items.filter((i) => i.facts.kind === 'TRANSFER_BONUS');
  const redeem = plan.items.filter((i) => ['CERTIFICATE_EXPIRING', 'CREDIT_UNUSED', 'LOYALTY_AT_RISK'].includes(i.facts.kind));
  const sections: BriefSection[] = [
    { key: 'cards', title: 'Keep, downgrade or cancel', lines: verdicts.map(verdictLine), empty: 'You have no cards to review yet.' },
    {
      key: 'fees',
      title: 'Annual fees',
      lines: m.feesCents > 0 ? [{ text: `${usd(m.feesCents)} in annual fees; the cards returned ${usd(m.valueCents)} in credits and rewards`, tone: m.valueCents >= m.feesCents ? 'good' : 'warn', valueCents: m.valueCents - m.feesCents, href: '/portfolio' }] : [],
      empty: 'You pay no annual fees.',
    },
    {
      key: 'apply',
      title: 'Apply',
      lines: m.applyPick ? [{ text: `${m.applyPick.member} could apply for ${m.applyPick.card}`, detail: `About ${usd(m.applyPick.firstYearCents)} in the first year${m.applyPick.usesSlot ? '; it uses a 5/24 slot' : ''}. This is a suggestion; you decide whether and when.`, tone: 'info', valueCents: m.applyPick.firstYearCents, href: '/next-card' }] : [],
      empty: 'No one in the household has a card worth applying for right now.',
    },
    section('transfer', 'Transfer', transfer, 'No transfer bonus is worth acting on.', 3),
    section('redeem', 'Redeem', redeem, 'Nothing is close to expiring.', 5),
    {
      key: 'wait',
      title: 'Wait',
      lines: waiting.map((x) => ({ text: `${x.member} is at ${x.count}/24`, detail: x.nextSlotAt ? `A slot opens ${iso(x.nextSlotAt)}. Hold new personal-card applications until then.` : 'Hold new personal-card applications for now.', tone: 'warn' as const, href: '/five24' })),
      empty: 'Everyone is under the 5/24 limit.',
    },
    section('goals', 'Goals', plan.items.filter((i) => i.lens === 'GOAL'), 'Your goals are on track.', 4),
  ];
  const actions = verdicts.filter((v) => v.verdict !== 'KEEP').length;
  return {
    version: BRIEF_VERSION,
    kind: 'MONTHLY',
    periodKey: periodKey('MONTHLY', now),
    generatedAt: now.toISOString(),
    headline: actions ? `${plural(actions, 'card')} worth a decision this month` : 'Your cards are all earning their place',
    summary: `${plural(m.cards.length, 'card')} reviewed: ${verdicts.filter((v) => v.verdict === 'KEEP').length} keep, ${verdicts.filter((v) => v.verdict === 'DOWNGRADE').length} downgrade, ${verdicts.filter((v) => v.verdict === 'CANCEL').length} cancel, ${verdicts.filter((v) => v.verdict === 'REVIEW').length} to review.`,
    sections,
    stats: { cards: m.cards.length, feesCents: m.feesCents, valueCents: m.valueCents, decisions: actions },
    confidence: Math.min(plan.confidence, m.cards.length ? 75 : 40),
    assumptions: ['Value counts credits you used and rewards on your logged spend over 12 months.', 'A recommendation to cancel or downgrade is a suggestion; nothing is done for you.', ...plan.assumptions.slice(0, 2)],
  };
}

// ───────────── proactive alerts ─────────────

export interface AlertSignals {
  /** offers you could still add or use, and what they are worth */
  offersAvailableCents: number;
  offersAvailableCount: number;
  topOffers: string[];
  applyPick: { member: string; card: string; slug: string; firstYearCents: number; memberIsPrimary: boolean; usesSlot: boolean } | null;
  goalsNeedingAttention: Array<{ id: string; title: string; detail: string }>;
  /** credits with time left in the current month that have not been used */
  creditsUnusedCents: number;
  daysLeftInMonth: number;
}

export interface Alert {
  key: string;
  priority: number;
  title: string;
  body: string;
  link: string;
  /** one notification per key; asking twice makes one */
  dedupeKey: string;
}

export const ALERT_MIN_SAVINGS_CENTS = 5_000;
export const ALERT_MIN_APPLY_CENTS = 30_000;
export const ALERT_MIN_CREDITS_CENTS = 3_000;

export function alertsFor(s: AlertSignals, now: Date): Alert[] {
  const week = periodKey('WEEKLY', now);
  const month = periodKey('MONTHLY', now);
  const out: Alert[] = [];
  if (s.offersAvailableCents >= ALERT_MIN_SAVINGS_CENTS && s.offersAvailableCount > 0) {
    out.push({ key: 'savings', priority: 3, title: `You can save about ${usd(s.offersAvailableCents)} using available offers`, body: `${plural(s.offersAvailableCount, 'offer')} on your cards${s.topOffers.length ? `, including ${s.topOffers.slice(0, 2).join(' and ')}` : ''}. Open your offer inbox to see which are worth adding.`, link: '/offers/inventory', dedupeKey: `copilot:savings:${week}` });
  }
  if (s.applyPick && !s.applyPick.memberIsPrimary && s.applyPick.firstYearCents >= ALERT_MIN_APPLY_CENTS) {
    out.push({ key: 'apply', priority: 2, title: `${s.applyPick.member} is the best person to apply for ${s.applyPick.card}`, body: `About ${usd(s.applyPick.firstYearCents)} in the first year${s.applyPick.usesSlot ? ', and it uses one of their 5/24 slots' : ''}. This is a suggestion; whether and when to apply is yours to decide.`, link: '/next-card', dedupeKey: `copilot:apply:${s.applyPick.slug}:${month}` });
  }
  for (const g of s.goalsNeedingAttention.slice(0, 1)) {
    out.push({ key: 'goal:' + g.id, priority: 4, title: `Your goal “${g.title}” needs attention`, body: g.detail, link: '/copilot#goals', dedupeKey: `copilot:goal:${g.id}:${week}` });
  }
  if (s.creditsUnusedCents >= ALERT_MIN_CREDITS_CENTS && s.daysLeftInMonth <= 7) {
    out.push({ key: 'credits', priority: 5, title: `You have not used ${usd(s.creditsUnusedCents)} of this month’s credits`, body: `${plural(s.daysLeftInMonth, 'day')} left in the month. Open Benefits to see which to use.`, link: '/benefits', dedupeKey: `copilot:credits:${month}` });
  }
  return out.sort((a, b) => b.priority - a.priority || a.key.localeCompare(b.key)).slice(0, MAX_ALERTS_PER_RUN);
}

/** a briefing as the notification that points to it */
export function notificationFor(b: Briefing): { title: string; body: string } {
  const name = b.kind === 'DAILY' ? 'daily' : b.kind === 'WEEKLY' ? 'weekly' : 'monthly';
  return { title: `Your ${name} Copilot briefing`, body: b.headline + '. ' + b.summary.slice(0, 160) };
}

export const daysLeftInMonth = (now: Date): number => Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / DAY) - 1;
