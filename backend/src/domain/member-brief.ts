/**
 * A household member's own briefing (pure). It is built only from that member's own cards, benefits, offers, points and spending: what is
 * due today, what is coming, the money decisions, and for the week a short summary. It uses the same Briefing shape as the Copilot
 * briefings so the same page can show it, but it needs no AI and calls no model. It never suggests applying, transferring, booking or
 * cancelling anything.
 */
import { BRIEF_VERSION, BriefLine, BriefSection, Briefing, periodKey } from './copilot-brief';

export const MEMBER_BRIEF_KINDS = ['DAILY', 'WEEKLY'] as const;
export type MemberBriefKind = (typeof MEMBER_BRIEF_KINDS)[number];

export interface MemberBriefInput {
  /** the member's first name, used in the headline only */
  name: string;
  benefits: Array<{ name: string; card: string; remainingCents: number; daysLeft: number }>;
  offers: Array<{ title: string; card: string; daysLeft: number; valueCents: number | null }>;
  loyalty: Array<{ name: string; balance: number; expiresInDays: number | null }>;
  certificates: Array<{ name: string; daysLeft: number }>;
  renewals: Array<{ name: string; daysUntil: number; feeCents: number }>;
  bonuses: Array<{ name: string; spentCents: number; requiredCents: number; daysLeft: number }>;
  /** spending on the member's cards over the last 7 days (the weekly summary) */
  spend: { count: number; totalCents: number } | null;
  /** notifications Quiet Mode is holding for this member */
  held: number;
}

const usd = (c: number) => '$' + Math.round(c / 100).toLocaleString('en-US');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const inDays = (d: number) => (d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`);

/** within this many days an item is "due now" and within the second number it is "coming up" */
const WINDOW = { DAILY: { now: 3, soon: 14 }, WEEKLY: { now: 7, soon: 30 } } as const;

export function memberBrief(kind: MemberBriefKind, i: MemberBriefInput, now: Date): Briefing | null {
  const w = WINDOW[kind];
  // collected with their day count, then ordered by urgency: whatever ends first comes first, whatever kind it is
  const dueAt: Array<{ days: number; line: BriefLine }> = [];
  const soonAt: Array<{ days: number; line: BriefLine }> = [];
  const push = (days: number, urgent: BriefLine, later: BriefLine) => {
    if (days <= w.now) dueAt.push({ days, line: urgent });
    else if (days <= w.soon) soonAt.push({ days, line: later });
  };
  const byDays = (a: { days: number }, b: { days: number }) => a.days - b.days;

  for (const b of i.benefits.filter((x) => x.remainingCents > 0).sort((a, c) => a.daysLeft - c.daysLeft)) {
    const text = `${b.name}: ${usd(b.remainingCents)} left on ${b.card}`;
    push(b.daysLeft, { text, detail: `Use it ${inDays(b.daysLeft)}.`, tone: 'urgent', valueCents: b.remainingCents, href: '/my' }, { text, detail: `Resets ${inDays(b.daysLeft)}.`, tone: 'warn', valueCents: b.remainingCents, href: '/my' });
  }
  for (const o of i.offers.sort((a, c) => a.daysLeft - c.daysLeft)) {
    const text = `${o.title} on ${o.card}`;
    push(o.daysLeft, { text, detail: `Ends ${inDays(o.daysLeft)}.`, tone: 'urgent', valueCents: o.valueCents }, { text, detail: `Ends ${inDays(o.daysLeft)}.`, tone: 'warn', valueCents: o.valueCents });
  }
  for (const c of i.certificates.sort((a, b) => a.daysLeft - b.daysLeft)) {
    const text = `${c.name} expires`;
    push(c.daysLeft, { text, detail: `Expires ${inDays(c.daysLeft)}.`, tone: 'urgent' }, { text, detail: `Expires ${inDays(c.daysLeft)}.`, tone: 'warn' });
  }
  for (const l of i.loyalty.filter((x) => x.expiresInDays != null && x.balance > 0).sort((a, b) => (a.expiresInDays as number) - (b.expiresInDays as number))) {
    const days = l.expiresInDays as number;
    const text = `${l.balance.toLocaleString('en-US')} ${l.name} points may expire`;
    push(days, { text, detail: `Expires ${inDays(days)}. Earning or using any of them usually keeps the rest.`, tone: 'urgent' }, { text, detail: `Expires ${inDays(days)}.`, tone: 'warn' });
  }

  const due = dueAt.sort(byDays).map((x) => x.line);
  const soon = soonAt.sort(byDays).map((x) => x.line);

  const money: BriefLine[] = [
    ...i.renewals.filter((r) => r.daysUntil <= 30).sort((a, b) => a.daysUntil - b.daysUntil).map((r): BriefLine => ({ text: `${r.name} renews ${inDays(r.daysUntil)}`, detail: `The annual fee of ${usd(r.feeCents)} posts then. Decide whether to keep it.`, tone: r.daysUntil <= 7 ? 'urgent' : 'warn', valueCents: r.feeCents })),
    ...i.bonuses.map((b): BriefLine => ({ text: `Welcome bonus at risk: ${b.name}`, detail: `${usd(b.spentCents)} of ${usd(b.requiredCents)} spent, ${plural(b.daysLeft, 'day')} left.`, tone: b.daysLeft <= 14 ? 'urgent' : 'warn' })),
  ];

  const week: BriefLine[] = [];
  if (kind === 'WEEKLY') {
    if (i.spend && i.spend.count > 0) week.push({ text: `${plural(i.spend.count, 'transaction')} on your cards, ${usd(i.spend.totalCents)} in total`, tone: 'info' });
    for (const l of i.loyalty.filter((x) => x.balance > 0).slice(0, 4)) week.push({ text: `${l.name}: ${l.balance.toLocaleString('en-US')} points`, tone: 'info' });
  }

  const sections: BriefSection[] = [
    { key: 'today', title: kind === 'DAILY' ? 'Needs you now' : 'Needs you this week', lines: due.slice(0, 6), empty: 'Nothing is due.' },
    { key: 'soon', title: 'Coming up', lines: soon.slice(0, 6), empty: 'Nothing else is coming up.' },
    { key: 'money', title: 'Fees and bonuses', lines: money.slice(0, 4), empty: 'No fee or bonus decisions.' },
    ...(kind === 'WEEKLY' ? [{ key: 'week', title: 'Your week', lines: week, empty: 'Nothing to report.' }] : []),
  ];
  const actionable = due.length + soon.length + money.length;
  // a daily briefing is only worth sending when there is something to say; the weekly one also reports spending and balances
  if (kind === 'DAILY' && actionable === 0) return null;
  if (kind === 'WEEKLY' && actionable + week.length === 0) return null;

  const atRisk = [...i.benefits.filter((b) => b.daysLeft <= w.soon).map((b) => b.remainingCents), ...i.offers.filter((o) => o.daysLeft <= w.soon).map((o) => o.valueCents ?? 0)].reduce((a, b) => a + b, 0);
  const headline = due.length ? `${plural(due.length, 'thing')} to do ${kind === 'DAILY' ? 'now' : 'this week'}` : actionable ? 'Nothing urgent' : 'A quiet week';
  const summary = [
    soon.length ? `${plural(soon.length, 'thing')} coming up.` : '',
    money.length ? `${plural(money.length, 'fee or bonus decision')}.` : '',
    atRisk > 0 ? `About ${usd(atRisk)} is at stake.` : '',
    i.held > 0 ? `${plural(i.held, 'update')} held by Quiet Mode.` : '',
  ].filter(Boolean).join(' ');

  return {
    version: BRIEF_VERSION,
    kind,
    periodKey: periodKey(kind, now),
    generatedAt: now.toISOString(),
    headline: i.name ? `${i.name}: ${headline}` : headline,
    summary: summary || 'Everything is on track.',
    sections,
    stats: { due: due.length, soon: soon.length, money: money.length, atStakeCents: atRisk, held: i.held },
    confidence: 80,
    assumptions: ['Built from your own cards and accounts as they are recorded today; items nobody has entered are not included.'],
  };
}

/** The notification that announces a member's briefing. */
export function memberBriefNotice(b: Briefing): { title: string; body: string } {
  return { title: b.kind === 'DAILY' ? 'Your daily briefing' : 'Your weekly briefing', body: `${b.headline}. ${b.summary}`.slice(0, 220) };
}
