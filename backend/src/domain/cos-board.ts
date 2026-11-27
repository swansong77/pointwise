/**
 * The monthly board report (pure): the month in numbers, an honest account of what was missed, the annual fee verdicts, and how the
 * household is doing against its goals. It reports what was recorded; it never invents a figure.
 */
import { Briefing, BriefLine, BriefSection, BRIEF_VERSION, periodKey } from './copilot-brief';
import type { FeeVerdict, FeeTotals } from './cos-fees';
import { FEE_VERDICT_LABEL } from './cos-fees';
import { GRADE_LABEL, Outlook, ScoreCard } from './cos-scores';

const usd = (c: number) => (c < 0 ? '-$' : '$') + Math.abs(Math.round(c / 100)).toLocaleString('en-US');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface BoardSignals {
  /** credit received this month and last (offers and credits), from the savings summary */
  savedThisMonthCents: number;
  savedLastMonthCents: number;
  offersRedeemed: number;
  pointsEarned: number;
  pointsExpired: number;
  certificatesUsed: number;
  certificatesUsedCents: number;
  creditsUtilizedCents: number;
  missedCents: number;
  statusChanges: string[];
  /** points, certificates, status and memberships held now, and what the cards netted over 12 months */
  assetsCents: number;
  cardNetCents: number;
  household: { goalsTotal: number; goalsBehind: number; members: Array<{ member: string; count: number; underLimit: boolean }> };
}

export interface BoardArgs {
  signals: BoardSignals;
  verdicts: FeeVerdict[];
  totals: FeeTotals;
  scores: ScoreCard[];
  outlook: Outlook;
  now: Date;
}

const line = (text: string, tone: BriefLine['tone'], extra: Partial<BriefLine> = {}): BriefLine => ({ text, tone, ...extra });

export function boardReport(a: BoardArgs): Briefing {
  const s = a.signals;
  const month = `${MONTHS[a.now.getUTCMonth()]} ${a.now.getUTCFullYear()}`;
  const change = s.savedThisMonthCents - s.savedLastMonthCents;
  const net = s.assetsCents + s.cardNetCents;
  const actions = a.verdicts.filter((v) => v.verdict !== 'KEEP');
  const sections: BriefSection[] = [
    {
      key: 'savings',
      title: 'Savings realized',
      lines: [line(`${usd(s.savedThisMonthCents)} saved this month`, s.savedThisMonthCents > 0 ? 'good' : 'info', { detail: s.savedLastMonthCents ? `${change >= 0 ? 'Up' : 'Down'} ${usd(Math.abs(change))} from last month (${usd(s.savedLastMonthCents)}).` : undefined, valueCents: s.savedThisMonthCents, href: '/offers/inventory' }), line(`${plural(s.offersRedeemed, 'offer')} redeemed`, 'info', { href: '/offers/inventory' })],
      empty: 'No savings were recorded this month.',
    },
    {
      key: 'value',
      title: 'Points, certificates and credits',
      lines: [
        line(`${s.pointsEarned.toLocaleString('en-US')} points earned`, s.pointsEarned > 0 ? 'good' : 'info', { href: '/loyalty' }),
        line(`${plural(s.certificatesUsed, 'certificate')} used${s.certificatesUsedCents ? `, worth about ${usd(s.certificatesUsedCents)}` : ''}`, 'info', { href: '/loyalty' }),
        line(`${usd(s.creditsUtilizedCents)} in card credits used over the last 12 months`, 'info', { href: '/benefits' }),
        line(`${s.pointsExpired.toLocaleString('en-US')} points expired`, s.pointsExpired > 0 ? 'warn' : 'good', { href: '/loyalty' }),
      ],
      empty: '',
    },
    { key: 'missed', title: 'Missed opportunities', lines: s.missedCents > 0 ? [line(`About ${usd(s.missedCents)} of recommended offers expired unused`, 'warn', { valueCents: -s.missedCents, detail: 'A weekly look at the Action Center catches most of these.', href: '/chief-of-staff#recovery' })] : [], empty: 'Nothing slipped away this month.' },
    { key: 'status', title: 'Status changes', lines: s.statusChanges.slice(0, 5).map((t) => line(t, 'info', { href: '/loyalty' })), empty: 'No status changes this month.' },
    {
      key: 'net',
      title: 'Net portfolio value',
      lines: [line(`${usd(net)} net portfolio value`, net >= 0 ? 'good' : 'warn', { detail: `${usd(s.assetsCents)} in points, certificates, status and memberships held, plus ${usd(s.cardNetCents)} net from the cards over 12 months.`, valueCents: net, href: '/portfolio' })],
      empty: '',
    },
    {
      key: 'fees',
      title: 'Annual fee analysis',
      lines: actions.slice(0, 6).map((v) => line(`${FEE_VERDICT_LABEL[v.verdict]}: ${v.card}`, v.verdict === 'CANCEL' || v.verdict === 'REPLACE' ? 'urgent' : 'warn', { detail: v.justification, valueCents: v.impactCents, href: '/chief-of-staff#fees' })),
      empty: `Every card earns its place: ${a.totals.cards} reviewed, ${usd(a.totals.valueCents)} returned against ${usd(a.totals.feesCents)} in fees.`,
    },
    {
      key: 'household',
      title: 'Household progress',
      lines: [
        ...a.scores.map((c) => line(`${c.label}: ${c.score}/100 (${GRADE_LABEL[c.grade]})`, c.score >= 70 ? 'good' : c.score >= 50 ? 'info' : 'warn', { detail: c.reasons[0], href: c.key === 'HOUSEHOLD' ? '/household' : c.key === 'LOYALTY' ? '/loyalty' : c.key === 'OFFERS' ? '/offers/inventory' : c.key === 'TRAVEL' ? '/travel' : '/portfolio' })),
        line(`${s.household.goalsTotal - s.household.goalsBehind} of ${s.household.goalsTotal} goals on track`, s.household.goalsBehind ? 'warn' : 'good', { href: '/copilot#goals' }),
      ],
      empty: '',
    },
  ];
  return {
    version: BRIEF_VERSION,
    kind: 'BOARD',
    periodKey: periodKey('BOARD', a.now),
    generatedAt: a.now.toISOString(),
    headline: `Board report for ${month}: ${usd(s.savedThisMonthCents)} saved, ${usd(net)} net portfolio value`,
    summary: `${actions.length ? `${plural(actions.length, 'card')} to decide on. ` : 'Every card earns its place. '}Outlook for the year: about ${usd(a.outlook.netCents)} (range ${usd(a.outlook.lowCents)} to ${usd(a.outlook.highCents)}).`,
    sections,
    stats: { savedCents: s.savedThisMonthCents, netCents: net, missedCents: s.missedCents, cardsToDecide: actions.length, outlookCents: a.outlook.netCents, feeImpactCents: a.totals.impactCents },
    confidence: a.outlook.confidence,
    assumptions: ['Savings count offers and credits recorded as received.', 'Net portfolio value adds what you hold now to what the cards netted over 12 months.', ...a.outlook.assumptions.slice(0, 3)],
  };
}
