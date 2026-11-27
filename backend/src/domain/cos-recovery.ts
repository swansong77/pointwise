/**
 * Value recovery (pure): what has already been lost, what is still at risk, and what can be recovered, with the recommendations that
 * would recover it. It reads what the engines found; it never claims value that was not recorded.
 */
import type { ExecItem } from './cos-score';

export const RECOVERY_VERSION = 'cos-recovery/1';
const usd = (c: number) => '$' + Math.round(c / 100).toLocaleString('en-US');

export interface RecoverySignals {
  /** recommended offers that expired unused */
  expiredOffers: Array<{ label: string; cents: number }>;
  /** credits that went unused this year, by card */
  missedCredits: Array<{ card: string; cents: number }>;
  /** points and certificates that already expired */
  expiredAssetsCents: number;
  /** value that was at risk and was saved */
  recoveredCents: number;
}

export interface RecoveryLine {
  kind: 'OFFER' | 'CREDIT' | 'POINTS_AND_CERTIFICATES';
  label: string;
  cents: number;
}

export interface Recoverable {
  id: string;
  title: string;
  recommendation: string;
  cents: number;
  href: string;
  deadline: string | null;
  band: string;
  score: number;
}

export interface Recovery {
  version: string;
  headline: string;
  lostCents: number;
  lines: RecoveryLine[];
  /** what is still at risk and can be saved */
  atRiskCents: number;
  recoverable: Recoverable[];
  recoveredCents: number;
}

export function recoveryOf(sig: RecoverySignals, items: ExecItem[]): Recovery {
  const lines: RecoveryLine[] = [
    ...sig.expiredOffers.filter((o) => o.cents > 0).map((o) => ({ kind: 'OFFER' as const, label: `Expired offer: ${o.label}`, cents: o.cents })),
    ...sig.missedCredits.filter((c) => c.cents > 0).map((c) => ({ kind: 'CREDIT' as const, label: `Unused credits on ${c.card}`, cents: c.cents })),
    ...(sig.expiredAssetsCents > 0 ? [{ kind: 'POINTS_AND_CERTIFICATES' as const, label: 'Expired points and certificates', cents: sig.expiredAssetsCents }] : []),
  ].sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
  const lost = lines.reduce((s, l) => s + l.cents, 0);
  const recoverable = items
    .filter((i) => i.impact.atRiskCents > 0)
    .sort((a, b) => b.score - a.score || b.impact.atRiskCents - a.impact.atRiskCents || a.id.localeCompare(b.id))
    .slice(0, 8)
    .map((i) => ({ id: i.id, title: i.title, recommendation: i.recommendation, cents: i.impact.atRiskCents, href: i.href, deadline: i.deadline, band: i.band, score: i.score }));
  const atRisk = items.reduce((s, i) => s + i.impact.atRiskCents, 0);
  const headline = lost === 0 && atRisk === 0 ? 'No value has been lost and none is at risk.' : `${usd(lost)} lost so far; ${usd(atRisk)} can still be saved.`;
  return { version: RECOVERY_VERSION, headline, lostCents: lost, lines, atRiskCents: atRisk, recoverable, recoveredCents: sig.recoveredCents };
}
