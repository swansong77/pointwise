/**
 * Refresh strategy (pure). Pointwise never logs in to a program, so a "refresh" means getting fresh data from the
 * member's own sources: syncing their mailbox, a statement, or a page capture. This module decides how urgent each
 * account is, when it is next due, how stale its data is, and what the member (or the mailbox sync) must do.
 */
import { refreshConfidence, SourceType } from './loyalty-provenance';

export const REFRESH_VERSION = 'loyalty-refresh/1';

export type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
export type Freshness = 'FRESH' | 'AGING' | 'STALE' | 'NEVER';

/** Hours between refreshes by priority: CRITICAL daily, HIGH every 3 days, NORMAL weekly, LOW monthly. */
export const REFRESH_INTERVAL_HOURS: Record<Priority, number> = { CRITICAL: 24, HIGH: 72, NORMAL: 168, LOW: 720 };
export type Cadence = 'EVENT' | 'DAILY' | 'WEEKLY' | 'SCHEDULED' | 'MANUAL';
export const CADENCE_OF: Record<Priority, Cadence> = { CRITICAL: 'DAILY', HIGH: 'DAILY', NORMAL: 'WEEKLY', LOW: 'SCHEDULED' };

const HOUR = 3_600_000;

export interface RefreshInput {
  balance: number;
  /** when any source last reported this account */
  lastObservedAt: Date | null;
  lastSuccessAt: Date | null;
  sourceType: SourceType | null;
  reliability: number;
  /** from the expiration engine */
  daysToExpiry: number | null;
  /** unresolved conflicts or pending observations */
  pendingObservations: number;
  /** a transfer bonus is active on a currency this account holds */
  transferBonusActive: boolean;
  /** elite status at risk of lapsing */
  statusAtRisk: boolean;
  /** a certificate on this account expires within 60 days */
  certificateExpiringSoon: boolean;
  now: Date;
}

export interface PriorityResult {
  priority: Priority;
  reasons: string[];
}

export function refreshPriority(i: RefreshInput): PriorityResult {
  const critical: string[] = [];
  const high: string[] = [];
  if (i.daysToExpiry != null && i.daysToExpiry <= 30 && i.balance > 0) critical.push(i.daysToExpiry < 0 ? 'points may already have expired' : `points expire in ${i.daysToExpiry} day(s)`);
  if (i.pendingObservations > 0) critical.push(`${i.pendingObservations} change(s) need your decision`);
  if (i.transferBonusActive && i.balance > 0) critical.push('a transfer bonus is active on this balance');
  if (i.statusAtRisk) critical.push('elite status is at risk');
  if (i.certificateExpiringSoon) critical.push('a certificate expires within 60 days');
  if (critical.length) return { priority: 'CRITICAL', reasons: critical };
  if (i.daysToExpiry != null && i.daysToExpiry <= 90 && i.balance > 0) high.push(`points expire in ${i.daysToExpiry} days`);
  if (!i.lastObservedAt) high.push('never refreshed');
  else if ((i.now.getTime() - i.lastObservedAt.getTime()) / HOUR > REFRESH_INTERVAL_HOURS.NORMAL * 4) high.push('data is more than a month old');
  if (high.length) return { priority: 'HIGH', reasons: high };
  if (i.balance <= 0) return { priority: 'LOW', reasons: ['empty balance'] };
  return { priority: 'NORMAL', reasons: ['no deadline in sight'] };
}

export const nextRefreshAt = (priority: Priority, lastSuccessAt: Date | null, now: Date): Date => new Date((lastSuccessAt ?? now).getTime() + REFRESH_INTERVAL_HOURS[priority] * HOUR);

export const isDue = (next: Date | null, now: Date): boolean => !next || next.getTime() <= now.getTime();

/** How current the data is relative to how often it should be refreshed: fresh within one interval, aging within two, then stale. */
export function freshness(lastObservedAt: Date | null, priority: Priority, now: Date): Freshness {
  if (!lastObservedAt) return 'NEVER';
  const age = (now.getTime() - lastObservedAt.getTime()) / HOUR;
  const interval = REFRESH_INTERVAL_HOURS[priority];
  return age <= interval ? 'FRESH' : age <= interval * 2 ? 'AGING' : 'STALE';
}

export interface SourceAvailability {
  /** the member has a connected mailbox */
  mailbox: boolean;
  /** the program has email rules */
  programHasEmailRules: boolean;
  /** the member created an extension token */
  extension: boolean;
}

export interface RefreshAction {
  kind: 'SYNC_MAILBOX' | 'CONNECT_MAILBOX' | 'CAPTURE_PAGE' | 'FORWARD_STATEMENT' | 'UPDATE_MANUALLY';
  text: string;
  /** done by Pointwise without the member */
  automated: boolean;
}

/** What it takes to refresh an account right now, given the sources the member has set up. */
export function refreshPlan(program: string, fresh: Freshness, sources: SourceAvailability): RefreshAction[] {
  const out: RefreshAction[] = [];
  if (sources.mailbox && sources.programHasEmailRules) out.push({ kind: 'SYNC_MAILBOX', text: `Sync your mailbox for new ${program} emails.`, automated: true });
  else if (!sources.mailbox) out.push({ kind: 'CONNECT_MAILBOX', text: `Connect a mailbox so ${program} emails update this account automatically.`, automated: false });
  if (fresh === 'STALE' || fresh === 'NEVER' || fresh === 'AGING') {
    if (sources.extension) out.push({ kind: 'CAPTURE_PAGE', text: `Open your ${program} account page and click "Capture this page" in the extension.`, automated: false });
    out.push({ kind: 'FORWARD_STATEMENT', text: `Download your latest ${program} statement and import it, or forward the statement email.`, automated: false });
    out.push({ kind: 'UPDATE_MANUALLY', text: `Or enter the balance and expiry date from the ${program} website.`, automated: false });
  }
  return out;
}

export interface SyncSummary {
  total: number;
  ok: number;
  partial: number;
  failed: number;
  /** ok / total, null with no runs */
  successRate: number | null;
}

export function summarizeRuns(runs: Array<{ status: 'OK' | 'PARTIAL' | 'FAILED' }>): SyncSummary {
  const ok = runs.filter((r) => r.status === 'OK').length;
  const partial = runs.filter((r) => r.status === 'PARTIAL').length;
  const failed = runs.filter((r) => r.status === 'FAILED').length;
  return { total: runs.length, ok, partial, failed, successRate: runs.length ? Math.round(((ok + partial * 0.5) / runs.length) * 100) / 100 : null };
}

export { refreshConfidence };
