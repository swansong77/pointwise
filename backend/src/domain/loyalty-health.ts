/**
 * Loyalty health score 0–100 (pure) at account, program and household level. Eight named factors with weights in
 * one versioned config; each returns its points and a plain reason, so the score can be explained
 * (same style as opportunity-score.ts).
 */
import { Freshness } from './loyalty-refresh';
import { RiskLevel } from './loyalty-expiration';

export const HEALTH_VERSION = 'loyalty-health/1';

export const HEALTH_WEIGHTS = {
  refresh: 20,
  expiration: 25,
  confidence: 10,
  certificates: 10,
  status: 10,
  transfer: 5,
  utilization: 10,
  credits: 10,
} as const;
export type HealthFactor = keyof typeof HEALTH_WEIGHTS;

export interface AccountHealthInput {
  freshness: Freshness;
  /** share of recent refreshes that succeeded (0–1), null without runs */
  syncSuccessRate: number | null;
  expirationLevel: RiskLevel;
  /** 0–100, source reliability decayed by age */
  refreshConfidence: number;
  /** certificates tied to this account that expire within 90 days */
  certificatesExpiring: number;
  statusRisk: RiskLevel | null;
  /** a transfer bonus worth acting on is open */
  transferOpportunityOpen: boolean;
  expiredValueCents: number;
  currentValueCents: number;
  creditsExpiringCents: number;
  creditsTotalCents: number;
}

export interface HealthFactorResult {
  factor: HealthFactor;
  weight: number;
  value: number;
  points: number;
  reason: string;
}

export type HealthLabel = 'HEALTHY' | 'NEEDS_ATTENTION' | 'AT_RISK';

export interface Health {
  score: number;
  label: HealthLabel;
  factors: HealthFactorResult[];
  version: string;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const FRESH: Record<Freshness, number> = { FRESH: 1, AGING: 0.6, STALE: 0.2, NEVER: 0 };
const EXPIRY: Record<RiskLevel, number> = { NONE: 1, LOW: 0.85, MEDIUM: 0.55, HIGH: 0.2, EXPIRED: 0 };
const STATUS: Record<RiskLevel, number> = { NONE: 1, LOW: 0.9, MEDIUM: 0.5, HIGH: 0.15, EXPIRED: 0 };
const usd = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;

export const labelFor = (score: number): HealthLabel => (score >= 80 ? 'HEALTHY' : score >= 50 ? 'NEEDS_ATTENTION' : 'AT_RISK');

export function accountHealth(i: AccountHealthInput, weights = HEALTH_WEIGHTS): Health {
  const f: Array<[HealthFactor, number, string]> = [];
  const fresh = FRESH[i.freshness];
  const refresh = i.syncSuccessRate == null ? fresh : 0.7 * fresh + 0.3 * i.syncSuccessRate;
  f.push(['refresh', refresh, `data is ${i.freshness.toLowerCase()}${i.syncSuccessRate == null ? '' : `, ${Math.round(i.syncSuccessRate * 100)}% of refreshes succeeded`}`]);
  f.push(['expiration', EXPIRY[i.expirationLevel], `expiration risk is ${i.expirationLevel.toLowerCase()}`]);
  f.push(['confidence', clamp(i.refreshConfidence / 100), `refresh confidence ${i.refreshConfidence}%`]);
  f.push(['certificates', 1 - Math.min(1, i.certificatesExpiring * 0.34), i.certificatesExpiring ? `${i.certificatesExpiring} certificate(s) expire within 90 days` : 'no certificates expiring soon']);
  f.push(['status', i.statusRisk == null ? 1 : STATUS[i.statusRisk], i.statusRisk == null ? 'no elite status to retain' : `status retention risk is ${i.statusRisk.toLowerCase()}`]);
  f.push(['transfer', i.transferOpportunityOpen ? 0.5 : 1, i.transferOpportunityOpen ? 'a transfer bonus is open and unused' : 'no open transfer opportunity']);
  const total = i.currentValueCents + i.expiredValueCents;
  f.push(['utilization', total <= 0 ? 1 : 1 - clamp(i.expiredValueCents / total), total <= 0 ? 'nothing to utilize yet' : `${usd(i.expiredValueCents)} of ${usd(total)} expired unused`]);
  f.push(['credits', i.creditsTotalCents <= 0 ? 1 : 1 - clamp(i.creditsExpiringCents / i.creditsTotalCents), i.creditsTotalCents <= 0 ? 'no travel credits' : `${usd(i.creditsExpiringCents)} of ${usd(i.creditsTotalCents)} in credits expire within 30 days`]);
  const factors: HealthFactorResult[] = f.map(([factor, value, reason]) => ({ factor, weight: weights[factor], value: Math.round(value * 100) / 100, points: Math.round(weights[factor] * value * 10) / 10, reason }));
  const sum = Object.values(weights).reduce((s, w) => s + w, 0);
  const score = Math.round((factors.reduce((s, x) => s + x.points, 0) / sum) * 100);
  return { score, label: labelFor(score), factors, version: HEALTH_VERSION };
}

export interface ScoredItem {
  id: string;
  label: string;
  score: number;
  /** weight for averaging, normally the asset value in cents */
  weight: number;
}

/** Value-weighted average (an unweighted one when everything is zero). */
export function aggregateHealth(items: ScoredItem[]): { score: number; label: HealthLabel; count: number } {
  if (!items.length) return { score: 100, label: 'HEALTHY', count: 0 };
  const w = items.reduce((s, x) => s + Math.max(0, x.weight), 0);
  const score = Math.round(w > 0 ? items.reduce((s, x) => s + x.score * Math.max(0, x.weight), 0) / w : items.reduce((s, x) => s + x.score, 0) / items.length);
  return { score, label: labelFor(score), count: items.length };
}

export interface HouseholdExtras {
  certificatesExpiring: number;
  certificatesTotal: number;
  creditsExpiringCents: number;
  creditsTotalCents: number;
}

/** 80% the accounts, 20% household-wide certificates and credits. */
export function householdHealth(accounts: ScoredItem[], extras: HouseholdExtras): { score: number; label: HealthLabel; accounts: number; reasons: string[] } {
  const base = aggregateHealth(accounts);
  const cert = extras.certificatesTotal > 0 ? 1 - clamp(extras.certificatesExpiring / extras.certificatesTotal) : 1;
  const cred = extras.creditsTotalCents > 0 ? 1 - clamp(extras.creditsExpiringCents / extras.creditsTotalCents) : 1;
  const score = Math.round(base.score * 0.8 + ((cert + cred) / 2) * 100 * 0.2);
  const reasons: string[] = [];
  if (extras.certificatesExpiring) reasons.push(`${extras.certificatesExpiring} of ${extras.certificatesTotal} certificates expire within 90 days`);
  if (extras.creditsExpiringCents) reasons.push(`${usd(extras.creditsExpiringCents)} of travel credits expire within 30 days`);
  const worst = [...accounts].sort((a, b) => a.score - b.score)[0];
  if (worst && worst.score < 80) reasons.push(`${worst.label} is the weakest account (${worst.score})`);
  return { score, label: labelFor(score), accounts: accounts.length, reasons };
}
