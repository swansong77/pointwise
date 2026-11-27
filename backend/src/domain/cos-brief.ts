/**
 * The executive daily briefing (pure): a greeting, the few numbers that matter, and the top actions each with what it is worth, how long
 * it takes, how risky it is and how high it ranks. Built from scored items; it never proposes anything automatic.
 */
import { Briefing, BriefLine, BriefSection, BRIEF_VERSION, periodKey } from './copilot-brief';
import type { Recovery } from './cos-recovery';
import { BAND_LABEL, ExecItem } from './cos-score';

const usd = (c: number) => '$' + Math.round(c / 100).toLocaleString('en-US');
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const HIGH = new Set(['CRITICAL', 'HIGH']);

export interface ExecSummary {
  highPriority: number;
  valueAtRiskCents: number;
  pointsAtRisk: number;
  certificatesExpiring: number;
  newHighValueOffers: number;
  totalActions: number;
}

export function summarize(items: ExecItem[], newHighValueOffers: number): ExecSummary {
  return {
    highPriority: items.filter((i) => HIGH.has(i.band)).length,
    valueAtRiskCents: items.reduce((s, i) => s + i.impact.atRiskCents, 0),
    pointsAtRisk: items.filter((i) => i.facts.kind === 'LOYALTY_AT_RISK').reduce((s, i) => s + (i.facts.points ?? 0), 0),
    certificatesExpiring: items.filter((i) => i.facts.kind === 'CERTIFICATE_EXPIRING').length,
    newHighValueOffers,
    totalActions: items.length,
  };
}

/** "Potential value $100 · Time ~10 min · Risk Low · Priority High (62)" */
export function factLine(i: ExecItem): string {
  const value = i.expectedValueCents ? `${i.expectedValueCents < 0 ? 'Cost' : 'Potential value'} ${usd(Math.abs(i.expectedValueCents))}` : 'No dollar value';
  return `${value} · Time ~${i.timeMinutes} min · Risk ${i.risk.level[0] + i.risk.level.slice(1).toLowerCase()} · Priority ${BAND_LABEL[i.band]} (${i.score})`;
}

const tone = (i: ExecItem): BriefLine['tone'] => (i.band === 'CRITICAL' ? 'urgent' : i.band === 'HIGH' ? 'warn' : 'info');

export interface ExecBriefArgs {
  /** the first name to greet, from the member's own account; used on this page only */
  name: string | null;
  items: ExecItem[];
  summary: ExecSummary;
  recovery: Recovery;
  /** what Quiet Mode is holding, if it is on */
  held: { total: number; byType: Array<{ type: string; count: number }> } | null;
  confidence: number;
  now: Date;
}

const TYPE_WORD: Record<string, string> = {
  OFFER_EXPIRING: 'expiring offers',
  OFFER_ALERT: 'offer alerts',
  OFFER_NEW_HIGH_VALUE: 'new high-value offers',
  OFFER_AUTO_ENROLLED: 'auto-enrolled offers',
  OFFER_SAVINGS_DIGEST: 'offer summaries',
  TRANSFER_BONUS: 'transfer bonuses',
  LOYALTY_STALE: 'stale balances',
};

export function executiveBrief(a: ExecBriefArgs): Briefing {
  const { items, summary: s } = a;
  const top = items.slice(0, 5);
  const greet = a.name ? `Good morning ${a.name}.` : 'Good morning.';
  const headline = s.highPriority ? `${greet} You have ${plural(s.highPriority, 'high-priority action')}.` : `${greet} Nothing urgent today.`;
  const stripe = `Potential value at risk: ${usd(s.valueAtRiskCents)} · Points at risk: ${s.pointsAtRisk.toLocaleString('en-US')} · Certificates expiring: ${s.certificatesExpiring} · New high-value offers: ${s.newHighValueOffers}`;
  const sections: BriefSection[] = [
    {
      key: 'actions',
      title: 'Recommended actions',
      lines: top.map((i, n) => ({ text: `${n + 1}. ${i.title}`, detail: `${i.recommendation} ${factLine(i)}`, href: i.href, valueCents: i.expectedValueCents, tone: tone(i), itemId: i.id })),
      empty: 'Nothing needs your attention today.',
    },
    {
      key: 'recovery',
      title: 'Value recovery',
      lines: a.recovery.lostCents > 0 || a.recovery.atRiskCents > 0 ? [{ text: a.recovery.headline, detail: a.recovery.lines.slice(0, 2).map((l) => `${l.label} ${usd(l.cents)}`).join('; ') || undefined, tone: a.recovery.lostCents > 0 ? 'warn' : 'info', valueCents: -a.recovery.lostCents || null, href: '/chief-of-staff#recovery' }] : [],
      empty: 'No value has been lost and none is at risk.',
    },
  ];
  if (a.held) {
    sections.push({
      key: 'held',
      title: 'Held by Quiet Mode',
      lines: a.held.total > 0 ? [{ text: `${plural(a.held.total, 'update')} held for this briefing`, detail: a.held.byType.slice(0, 4).map((t) => `${t.count} ${TYPE_WORD[t.type] ?? t.type.toLowerCase().replace(/_/g, ' ')}`).join(', '), href: '/notifications', tone: 'info' }] : [],
      empty: 'Nothing is being held.',
    });
  }
  return {
    version: BRIEF_VERSION,
    kind: 'DAILY',
    periodKey: periodKey('DAILY', a.now),
    generatedAt: a.now.toISOString(),
    headline,
    summary: stripe,
    sections,
    stats: { highPriority: s.highPriority, valueAtRiskCents: s.valueAtRiskCents, pointsAtRisk: s.pointsAtRisk, certificatesExpiring: s.certificatesExpiring, newHighValueOffers: s.newHighValueOffers, lostCents: a.recovery.lostCents, held: a.held?.total ?? 0 },
    confidence: a.confidence,
    assumptions: ['Time and value figures are estimates.', 'Priority is a 0–100 score from value, deadline, effort, confidence and impact.'],
    greeting: greet,
    exec: s,
  };
}
