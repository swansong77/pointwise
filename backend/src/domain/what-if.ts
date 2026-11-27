/**
 * What-if analysis (pure). Each scenario compares today with the world where one thing changes and says what moves: money, points,
 * benefits, 5/24 and the household. Nothing here changes anything; the numbers come from the engines the planner already uses and every
 * outcome lists what it assumed and what could go wrong. "Cancel", "apply" and "transfer" are only ever analysed, never done.
 */
import type { Understanding } from './query-understanding';

export const WHATIF_VERSION = 'what-if/1';

export type Dimension = 'FINANCIAL' | 'POINTS' | 'BENEFITS' | 'FIVE24' | 'HOUSEHOLD';
export const DIMENSION_LABEL: Record<Dimension, string> = { FINANCIAL: 'Financial', POINTS: 'Points', BENEFITS: 'Benefits', FIVE24: '5/24', HOUSEHOLD: 'Household' };
export type Direction = 'BETTER' | 'WORSE' | 'SAME' | 'UNKNOWN';
export type Verdict = 'FAVORABLE' | 'UNFAVORABLE' | 'MIXED' | 'NEUTRAL';
export type ScenarioType = 'APPLY' | 'WAIT' | 'TRANSFER' | 'CANCEL' | 'CHANGE';

export interface Delta {
  dimension: Dimension;
  label: string;
  before: string;
  after: string;
  change: string;
  direction: Direction;
}

export interface WhatIfOutcome {
  version: string;
  scenario: ScenarioType;
  title: string;
  summary: string;
  verdict: Verdict;
  recommendation: string;
  deltas: Delta[];
  /** the money difference over a year (or first year for an application), when it can be stated */
  netCents: number | null;
  assumptions: string[];
  risks: string[];
  alternatives: string[];
  evidence: string[];
  /** 0–100 */
  confidence: number;
}

const usd = (c: number) => `${c < 0 ? '-' : ''}$${Math.abs(Math.round(c / 100)).toLocaleString('en-US')}`;
const signed = (c: number) => `${c > 0 ? '+' : c < 0 ? '-' : ''}$${Math.abs(Math.round(c / 100)).toLocaleString('en-US')}`;
const num = (n: number) => Math.round(n).toLocaleString('en-US');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const dir = (cents: number, tol = 500): Direction => (cents > tol ? 'BETTER' : cents < -tol ? 'WORSE' : 'SAME');
export const addMonths = (d: Date, m: number): Date => {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, 1, d.getUTCHours(), d.getUTCMinutes()));
  const last = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(d.getUTCDate(), last));
  return out;
};
const day = (d: Date) => d.toISOString().slice(0, 10);

function verdictOf(netCents: number | null, extra: { mixed?: boolean } = {}): Verdict {
  if (extra.mixed) return 'MIXED';
  if (netCents == null) return 'NEUTRAL';
  return netCents > 5000 ? 'FAVORABLE' : netCents < -5000 ? 'UNFAVORABLE' : 'NEUTRAL';
}

// ───────────── 1. someone applies (a spouse instead of me, or whoever) ─────────────

export interface ApplyRow {
  profileId: string;
  member: string;
  eligible: boolean;
  blockers: string[];
  firstYearValueCents: number;
  longTermValueCents: number;
  benefitsCents: number;
  five24: { before: number; after: number; countsToward: boolean; slotCostCents: number };
  confidence: number;
}

/** `ranking` is the scorer's ranking for one card; `baseline` is who would apply by default, `target` is who the question asks about. */
export function applyOutcome(card: string, baseline: ApplyRow | null, target: ApplyRow, others: ApplyRow[] = []): WhatIfOutcome {
  const base = baseline ?? null;
  const same = base && base.profileId === target.profileId;
  const net = base && !same ? target.firstYearValueCents - base.firstYearValueCents : null;
  const deltas: Delta[] = [];
  if (base && !same) {
    deltas.push({ dimension: 'FINANCIAL', label: 'First-year value', before: usd(base.firstYearValueCents), after: usd(target.firstYearValueCents), change: signed(target.firstYearValueCents - base.firstYearValueCents), direction: dir(target.firstYearValueCents - base.firstYearValueCents) });
    deltas.push({ dimension: 'FINANCIAL', label: 'Yearly value after the first year', before: usd(base.longTermValueCents), after: usd(target.longTermValueCents), change: signed(target.longTermValueCents - base.longTermValueCents), direction: dir(target.longTermValueCents - base.longTermValueCents) });
    deltas.push({ dimension: 'BENEFITS', label: 'Benefits counted', before: usd(base.benefitsCents), after: usd(target.benefitsCents), change: signed(target.benefitsCents - base.benefitsCents), direction: dir(target.benefitsCents - base.benefitsCents) });
  }
  const slotLine = (r: ApplyRow) => (r.five24.countsToward ? `${r.five24.before}/24 → ${r.five24.after}/24` : 'does not count toward 5/24');
  deltas.push({
    dimension: 'FIVE24',
    label: `${target.member}'s 5/24`,
    before: `${target.five24.before}/24`,
    after: target.five24.countsToward ? `${target.five24.after}/24` : `${target.five24.before}/24 (not counted)`,
    change: target.five24.countsToward ? `+${target.five24.after - target.five24.before} slot used` : 'no slot used',
    direction: target.five24.countsToward && target.five24.slotCostCents > 0 ? 'WORSE' : 'SAME',
  });
  if (base && !same && base.profileId !== target.profileId) {
    deltas.push({ dimension: 'FIVE24', label: `${base.member}'s 5/24`, before: slotLine(base), after: `${base.five24.before}/24 (keeps the slot)`, change: base.five24.countsToward ? 'slot kept' : 'unchanged', direction: base.five24.countsToward ? 'BETTER' : 'SAME' });
  }
  deltas.push({ dimension: 'HOUSEHOLD', label: 'Who holds it', before: base ? base.member : 'no one eligible', after: target.member, change: same ? 'no change' : `${target.member} instead of ${base?.member ?? 'no one'}`, direction: 'UNKNOWN' });

  let summary: string;
  let verdict: Verdict;
  let rec: string;
  if (!target.eligible) {
    summary = `${target.member} is not a good fit for ${card} right now: ${target.blockers[0] ?? 'not eligible'}.`;
    verdict = 'UNFAVORABLE';
    rec = base ? `${base.member} is the better applicant${base.eligible ? '' : ', once their blockers clear'}.` : 'No one in the household is eligible for it right now.';
  } else if (same) {
    summary = `${target.member} is already the best person to apply for ${card}, so nothing changes.`;
    verdict = 'NEUTRAL';
    rec = `${target.member} should apply${target.five24.countsToward ? ` (it uses a 5/24 slot, ${target.five24.before}/24 → ${target.five24.after}/24)` : ''}.`;
  } else {
    const better = (net ?? 0) > 0;
    summary = `If ${target.member} applies for ${card} instead of ${base?.member ?? 'no one'}, the first-year value is ${usd(target.firstYearValueCents)} versus ${base ? usd(base.firstYearValueCents) : 'n/a'} (${net != null ? signed(net) : 'n/a'}); it uses ${target.five24.countsToward ? 'one of their 5/24 slots' : 'no 5/24 slot'}.`;
    verdict = verdictOf(net);
    rec = better ? `${target.member} is the better applicant for ${card}.` : base ? `${base.member} is still the better applicant for ${card}.` : `${target.member} could apply.`;
  }
  const alt = others.filter((o) => o.profileId !== target.profileId && o.eligible).slice(0, 2).map((o) => `${o.member}: ${usd(o.firstYearValueCents)} first-year value`);
  return {
    version: WHATIF_VERSION,
    scenario: 'APPLY',
    title: `What if ${target.member} applies for ${card}?`,
    summary,
    verdict,
    recommendation: rec,
    deltas,
    netCents: net,
    assumptions: ['Spending is split as in your spend profile.', 'The welcome offer is the one currently listed and would be earned.', `Approval is not guaranteed; odds depend on credit and issuer rules.`],
    risks: [target.five24.countsToward ? 'A new personal card counts toward Chase 5/24 for 24 months.' : 'Issuer rules can change.', 'Applying adds a hard inquiry.'],
    alternatives: alt,
    evidence: [`Next-card scorer: ${target.member} ${usd(target.firstYearValueCents)} first year`, base && !same ? `Next-card scorer: ${base.member} ${usd(base.firstYearValueCents)} first year` : 'Next-card scorer'],
    confidence: Math.max(20, Math.min(target.confidence, base?.confidence ?? 100)),
  };
}

// ───────────── 2. wait a while ─────────────

export interface WaitMember {
  member: string;
  count: number;
  /** when each counted card stops counting */
  drops: Date[];
}
export interface WaitItem {
  label: string;
  endsAt: Date;
  valueCents: number;
}
export interface WaitRenewal {
  card: string;
  renewsOn: Date;
  feeCents: number;
}

export function waitOutcome(args: { days: number; now: Date; members: WaitMember[]; items: WaitItem[]; renewals: WaitRenewal[]; limit?: number }): WhatIfOutcome {
  const { days, now, members, items, renewals } = args;
  const limit = args.limit ?? 5;
  const later = new Date(now.getTime() + days * 86_400_000);
  const span = days % 30 === 0 && days >= 30 ? plural(days / 30, 'month') : plural(days, 'day');
  const deltas: Delta[] = [];
  let slotsOpened = 0;
  for (const m of members) {
    const after = m.drops.filter((d) => d.getTime() > later.getTime()).length;
    if (after === m.count && m.count < limit) continue;
    const opened = m.count >= limit && after < limit;
    if (opened) slotsOpened++;
    deltas.push({ dimension: 'FIVE24', label: `${m.member}'s 5/24`, before: `${m.count}/24`, after: `${after}/24`, change: after < m.count ? `${plural(m.count - after, 'card')} drop${m.count - after === 1 ? 's' : ''} off${opened ? ', a slot opens' : ''}` : 'unchanged', direction: after < m.count ? 'BETTER' : 'SAME' });
  }
  const lost = items.filter((i) => i.endsAt.getTime() <= later.getTime() && i.valueCents > 0).sort((a, b) => b.valueCents - a.valueCents);
  const lostCents = lost.reduce((s, i) => s + i.valueCents, 0);
  deltas.push({
    dimension: 'FINANCIAL',
    label: 'Offers, credits and certificates that lapse',
    before: usd(lostCents) + ' still usable',
    after: lostCents > 0 ? `${usd(0)} (${plural(lost.length, 'item')} expire)` : 'nothing lapses',
    change: lostCents > 0 ? `-${usd(lostCents)}` : 'no loss',
    direction: lostCents > 0 ? 'WORSE' : 'SAME',
  });
  const fees = renewals.filter((r) => r.renewsOn.getTime() <= later.getTime());
  if (fees.length) {
    const feeCents = fees.reduce((s, r) => s + r.feeCents, 0);
    deltas.push({ dimension: 'FINANCIAL', label: 'Annual fees that post while you wait', before: usd(0), after: usd(feeCents), change: `-${usd(feeCents)}`, direction: 'WORSE' });
  }
  deltas.push({ dimension: 'HOUSEHOLD', label: 'Decisions that get made for you', before: 'open', after: lost.length ? `${plural(lost.length, 'item')} lapse` : 'none lapse', change: lost.length ? 'you lose the choice' : 'no change', direction: lost.length ? 'WORSE' : 'SAME' });

  const mixed = slotsOpened > 0 && lostCents > 0;
  const verdict: Verdict = mixed ? 'MIXED' : lostCents >= 5000 ? 'UNFAVORABLE' : slotsOpened > 0 ? 'FAVORABLE' : 'NEUTRAL';
  const parts: string[] = [];
  if (slotsOpened) parts.push(`${plural(slotsOpened, 'member')} gain${slotsOpened === 1 ? 's' : ''} a 5/24 slot`);
  if (lostCents > 0) parts.push(`${usd(lostCents)} of offers and credits lapse (${lost.slice(0, 2).map((i) => i.label).join(', ')}${lost.length > 2 ? '…' : ''})`);
  if (!parts.length) parts.push('nothing important changes');
  return {
    version: WHATIF_VERSION,
    scenario: 'WAIT',
    title: `What if you wait ${span}?`,
    summary: `Waiting ${span} (until ${day(later)}): ${parts.join('; ')}.`,
    verdict,
    recommendation: lostCents > 0 ? `Use what expires first (${lost[0].label}), then wait if you are holding a slot for a better card.` : slotsOpened ? 'Waiting costs nothing you would otherwise use, so it is a reasonable choice.' : 'Waiting changes little; decide on the card itself.',
    deltas,
    netCents: -lostCents - fees.reduce((s, r) => s + r.feeCents, 0),
    assumptions: ['No new accounts are opened while you wait.', 'Offers, credits and certificates that are not used by their end date are lost.', 'Opening dates are as you entered them.'],
    risks: ['A welcome offer can end or change while you wait.', 'Issuers can change 5/24 style rules.'],
    alternatives: lost.length ? ['Use or activate the expiring items first, then decide about the application.'] : [],
    evidence: ['5/24: drop-off dates of cards you hold', 'Expirations: items ending within the window'],
    confidence: 80,
  };
}

// ───────────── 3. transfer points ─────────────

export interface TransferPlanLike {
  program: { name: string };
  pointsNeeded: number;
  covered: number;
  shortfall: number;
  totalCostCents: number;
  awardValueCents: number;
  maxTransferDays: number;
  warnings: string[];
  summary: string;
  steps: Array<{ summary?: string }>;
}

export function transferOutcome(plan: TransferPlanLike, balanceBefore: number): WhatIfOutcome {
  const covered = plan.covered;
  const net = plan.awardValueCents - plan.totalCostCents;
  const deltas: Delta[] = [
    { dimension: 'POINTS', label: `${plan.program.name} points`, before: num(Math.max(0, plan.pointsNeeded - plan.covered)) + ' short', after: plan.shortfall > 0 ? `${num(plan.shortfall)} short` : 'covered', change: plan.shortfall > 0 ? `${num(covered)} of ${num(plan.pointsNeeded)} covered` : 'fully covered', direction: plan.shortfall > 0 ? 'WORSE' : 'BETTER' },
    { dimension: 'FINANCIAL', label: 'Award value minus what it costs', before: usd(0), after: usd(net), change: signed(net), direction: dir(net) },
    { dimension: 'HOUSEHOLD', label: 'Time to arrive', before: 'n/a', after: plan.maxTransferDays ? `up to ${plural(plan.maxTransferDays, 'day')}` : 'instant', change: plan.maxTransferDays ? 'wait for the transfer' : 'none', direction: plan.maxTransferDays > 2 ? 'WORSE' : 'SAME' },
  ];
  void balanceBefore;
  return {
    version: WHATIF_VERSION,
    scenario: 'TRANSFER',
    title: `What if you transfer points to ${plan.program.name}?`,
    summary: plan.summary,
    verdict: plan.shortfall > 0 ? 'MIXED' : net > 0 ? 'FAVORABLE' : 'NEUTRAL',
    recommendation: 'Only transfer once the award you want is available to book: transfers are irreversible and PointWise never makes one for you.',
    deltas,
    netCents: net,
    assumptions: ['The award price used is an estimate; check the program before transferring.', 'The transfer bonus shown is the one currently listed.'],
    risks: ['Transfers cannot be undone.', 'Award space can disappear before the points arrive.', ...plan.warnings.slice(0, 3)],
    alternatives: plan.shortfall > 0 ? ['Pool points from another household member if the program allows it.'] : [],
    evidence: ['Transfer planner: partners, ratios and bonuses'],
    confidence: 65,
  };
}

// ───────────── 4. cancel a card ─────────────

export interface CancelInput {
  card: string;
  feeCents: number;
  /** what the card's rewards are worth on your spend, from the calculator with and without it */
  rewardsLostCents: number;
  /** credits and benefits you actually used in the last 12 months */
  benefitsUsedCents: number;
  benefitsAnnualCents: number;
  daysToRenewal: number | null;
  pointsOnCard: number | null;
  currency: string | null;
  /** categories whose best card changes */
  categoryChanges: Array<{ category: string; before: number; after: number }>;
  openedWithinMonths: number | null;
  hasSiblingNoFee: boolean;
}

export function cancelOutcome(i: CancelInput): WhatIfOutcome {
  const net = i.feeCents - i.rewardsLostCents - i.benefitsUsedCents;
  const deltas: Delta[] = [
    { dimension: 'FINANCIAL', label: 'Annual fee', before: usd(i.feeCents), after: usd(0), change: `+${usd(i.feeCents)} saved`, direction: i.feeCents > 0 ? 'BETTER' : 'SAME' },
    { dimension: 'FINANCIAL', label: 'Rewards on your spend', before: usd(i.rewardsLostCents), after: usd(0), change: `-${usd(i.rewardsLostCents)}`, direction: i.rewardsLostCents > 0 ? 'WORSE' : 'SAME' },
    { dimension: 'BENEFITS', label: 'Credits and benefits used (12 months)', before: usd(i.benefitsUsedCents), after: usd(0), change: `-${usd(i.benefitsUsedCents)}`, direction: i.benefitsUsedCents > 0 ? 'WORSE' : 'SAME' },
    { dimension: 'FINANCIAL', label: 'Net per year', before: usd(0), after: signed(net), change: signed(net), direction: dir(net) },
    { dimension: 'FIVE24', label: '5/24', before: 'counts', after: 'still counts', change: 'closing does not remove it for 24 months', direction: 'SAME' },
    { dimension: 'POINTS', label: i.currency ? `${i.currency} points` : 'Points', before: i.pointsOnCard != null ? num(i.pointsOnCard) : 'unknown', after: 'may be forfeited', change: 'move them first', direction: i.pointsOnCard ? 'WORSE' : 'UNKNOWN' },
  ];
  for (const c of i.categoryChanges.slice(0, 3)) deltas.push({ dimension: 'HOUSEHOLD', label: `${c.category}: best card`, before: `${c.before}¢/$`, after: `${c.after}¢/$`, change: `${(c.after - c.before).toFixed(1)}¢/$`, direction: c.after < c.before ? 'WORSE' : 'SAME' });
  const alt: string[] = ['Ask for a retention offer before cancelling.'];
  if (i.hasSiblingNoFee) alt.push('Downgrade to a no-fee card in the same family: it keeps the account and your credit history open.');
  const verdict = net > 5000 ? 'FAVORABLE' : net < -5000 ? 'UNFAVORABLE' : 'NEUTRAL';
  return {
    version: WHATIF_VERSION,
    scenario: 'CANCEL',
    title: `What if you cancel ${i.card}?`,
    summary: `Cancelling ${i.card} would ${net >= 0 ? 'save' : 'cost'} about ${usd(Math.abs(net))} a year: you save the ${usd(i.feeCents)} fee but give up about ${usd(i.rewardsLostCents)} in rewards on your spend and ${usd(i.benefitsUsedCents)} in credits you actually used. It does not lower your 5/24 count.`,
    verdict,
    recommendation: net > 5000 ? `Cancelling looks better than keeping it, but ask for a retention offer or a no-fee downgrade first${i.daysToRenewal != null ? `, and decide before it renews in ${plural(i.daysToRenewal, 'day')}` : ''}.` : net < -5000 ? `Keep it: it returns more than its fee.` : 'It is close to break-even, so the choice comes down to whether you will use its benefits.',
    deltas,
    netCents: net,
    assumptions: ['Rewards are what the calculator finds with your spend profile and the next-best card for each category.', 'Benefits are what you logged as used in the last 12 months.', 'Another card in your wallet earns the spend instead.'],
    risks: ['Closing can lower your total available credit and, over time, your average account age.', 'Points may be forfeited if you close without moving them first.', ...(i.openedWithinMonths != null && i.openedWithinMonths < 12 ? ['Cancelling within the first year can forfeit the welcome bonus, and issuers can claw it back.'] : [])],
    alternatives: alt,
    evidence: ['Wallet calculator: rewards with and without the card', 'Benefit tracking: credits used in the last 12 months'],
    confidence: i.benefitsUsedCents > 0 || i.rewardsLostCents > 0 ? 70 : 50,
  };
}

// ───────────── 5. upgrade or downgrade (product change) ─────────────

export interface ChangeInput {
  from: string;
  to: string;
  feeBeforeCents: number;
  feeAfterCents: number;
  rewardsBeforeCents: number;
  rewardsAfterCents: number;
  benefitsBeforeCents: number;
  benefitsAfterCents: number;
  /** share of credits expected to be used */
  useRate: number;
  sameFamily: boolean;
}

export function changeOutcome(i: ChangeInput): WhatIfOutcome {
  const rewards = i.rewardsAfterCents - i.rewardsBeforeCents;
  const benefits = Math.round((i.benefitsAfterCents - i.benefitsBeforeCents) * i.useRate);
  const fee = i.feeAfterCents - i.feeBeforeCents;
  const net = rewards + benefits - fee;
  const deltas: Delta[] = [
    { dimension: 'FINANCIAL', label: 'Annual fee', before: usd(i.feeBeforeCents), after: usd(i.feeAfterCents), change: signed(-fee), direction: dir(-fee, 0) },
    { dimension: 'FINANCIAL', label: 'Rewards on your spend', before: usd(i.rewardsBeforeCents), after: usd(i.rewardsAfterCents), change: signed(rewards), direction: dir(rewards) },
    { dimension: 'BENEFITS', label: `Credits (counting ${Math.round(i.useRate * 100)}% as used)`, before: usd(Math.round(i.benefitsBeforeCents * i.useRate)), after: usd(Math.round(i.benefitsAfterCents * i.useRate)), change: signed(benefits), direction: dir(benefits) },
    { dimension: 'FINANCIAL', label: 'Net per year', before: usd(0), after: signed(net), change: signed(net), direction: dir(net) },
    { dimension: 'FIVE24', label: '5/24', before: 'unchanged', after: i.sameFamily ? 'unchanged (same account)' : 'issuer may treat it as new', change: i.sameFamily ? 'usually no new account' : 'check the issuer', direction: 'SAME' },
  ];
  return {
    version: WHATIF_VERSION,
    scenario: 'CHANGE',
    title: `What if you change ${i.from} to ${i.to}?`,
    summary: `Changing ${i.from} to ${i.to} would be worth ${signed(net)} a year: fee ${signed(-fee)}, rewards ${signed(rewards)}, credits ${signed(benefits)}.`,
    verdict: verdictOf(net),
    recommendation: net > 5000 ? 'The change comes out ahead on your spending.' : net < -5000 ? 'Staying put is better on your spending.' : 'It is close; choose by which benefits you will really use.',
    deltas,
    netCents: net,
    assumptions: ['Your spend profile stays the same.', `You use ${Math.round(i.useRate * 100)}% of the credits.`, 'The card keeps its account age and open date.'],
    risks: ['Product changes are at the issuer’s discretion and may reset the welcome offer eligibility.', 'Downgrading can forfeit rewards points unless they are moved first.'],
    alternatives: [],
    evidence: ['Wallet calculator: rewards before and after', 'Catalog: fees and credits of both cards'],
    confidence: 65,
  };
}

// ───────────── reading the question ─────────────

export type WhatIfRequest =
  | { type: 'APPLY'; card: { id: string; name: string; slug?: string } | null; memberId: string | null; memberName: string | null }
  | { type: 'WAIT'; days: number }
  | { type: 'TRANSFER'; program: string | null; points: number | null }
  | { type: 'CANCEL'; card: { name: string; walletCardId: string | null } | null }
  | { type: 'CHANGE'; card: { name: string; walletCardId: string | null } | null; to: { id: string; name: string; slug?: string } | null };

export interface ParsedWhatIf {
  request: WhatIfRequest;
  /** what the question left out, in words for the person */
  needs: string[];
}

const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

export function parseSpan(t: string): number | null {
  const m = /\b(\d{1,3}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:more\s*)?(day|week|month|year)s?\b/.exec(t);
  if (!m) return null;
  const n = /^\d/.test(m[1]) ? Number(m[1]) : (WORD_NUM[m[1]] ?? 1);
  const per = { day: 1, week: 7, month: 30, year: 365 }[m[2] as 'day' | 'week' | 'month' | 'year'];
  const days = n * per;
  return days >= 1 && days <= 730 ? days : null;
}

export function isWhatIf(q: string): boolean {
  const t = q.toLowerCase();
  return /\bwhat if\b|\bwhat would happen if\b|\bwhat happens if\b|\bsuppose\b|\bhow would (that|it|things) change if\b|\bif (i|we|my \w+) (cancel|close|wait|transfer|apply|upgrade|downgrade|convert|product.?change)/.test(t);
}

export function parseWhatIf(q: string, u: Understanding): ParsedWhatIf | null {
  if (!isWhatIf(q)) return null;
  const t = q.toLowerCase();
  const e = u.entities;
  const card = e.cards[0];
  if (/\b(cancel|close|closing|get rid of|drop)\b/.test(t)) {
    return { request: { type: 'CANCEL', card: card ? { name: card.name, walletCardId: card.walletCardId } : null }, needs: card ? [] : ['which card to cancel (for example “What if I cancel Venture X?”)'] };
  }
  if (/\b(upgrade|downgrade|product.?change|convert)\b/.test(t)) {
    const to = e.cards[1];
    return {
      request: { type: 'CHANGE', card: card ? { name: card.name, walletCardId: card.walletCardId } : null, to: to ? { id: to.id, name: to.name, slug: to.slug } : null },
      needs: [...(card ? [] : ['which card to change']), ...(to ? [] : ['which card to change it to (for example “What if I upgrade Freedom Flex to Sapphire Preferred?”)'])],
    };
  }
  if (/\b(transfer|move|send)\b/.test(t) && /\bpoints?|miles?|\btransfer\b/.test(t)) {
    const prog = e.programs[0]?.name ?? null;
    return { request: { type: 'TRANSFER', program: prog, points: e.points }, needs: [...(prog ? [] : ['which program to transfer to']), ...(e.points ? [] : ['how many points'])] };
  }
  if (/\b(wait|waiting|hold off|delay|postpone|later)\b/.test(t)) {
    const days = parseSpan(t);
    return { request: { type: 'WAIT', days: days ?? 90 }, needs: days ? [] : [] };
  }
  if (/\bappl(y|ies|ied|ying|ication)\b/.test(t) || /\binstead\b/.test(t)) {
    const member = e.members[0];
    const cat = card ?? null;
    return { request: { type: 'APPLY', card: cat ? { id: cat.id, name: cat.name, slug: cat.slug } : null, memberId: member?.id ?? null, memberName: member?.name ?? null }, needs: member ? [] : ['who would apply (for example “What if my spouse applies instead?”)'] };
  }
  return null;
}
