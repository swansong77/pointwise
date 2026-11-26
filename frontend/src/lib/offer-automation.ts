import type { Tone } from './offer-market';

/** Types, labels and pure helpers for the Offer Automation pages. Money is integer cents. */

export type ItemStatus = 'AVAILABLE' | 'ENROLLED' | 'REDEEMED' | 'EXPIRED' | 'REMOVED';
export type Decision = 'NEW' | 'RECOMMENDED' | 'PENDING_REVIEW' | 'IGNORED' | 'APPROVED' | 'ENROLLED' | 'AUTO_ENROLLED' | 'FAILED';
export type SyncHealth = 'HEALTHY' | 'DEGRADED' | 'NEEDS_MFA' | 'NEEDS_LOGIN' | 'ERROR' | 'LOCKED' | 'DISABLED';
export type RunStatus = 'QUEUED' | 'RUNNING' | 'NEEDS_MFA' | 'SUCCESS' | 'PARTIAL' | 'FAILED';
export type ConnectorKind = 'MOCK' | 'EXTENSION' | 'EMAIL' | 'MANUAL' | 'ISSUER_LOGIN';
export type Mode = 'RECOMMEND' | 'BULK_APPROVAL' | 'AUTO';
export type InboxTab = 'all' | 'new' | 'review' | 'queued' | 'enrolled' | 'auto' | 'expiring' | 'redeemed';

export interface InboxItem {
  id: string;
  accountId: string;
  holder: string;
  issuer: string;
  walletCardId: string | null;
  card: string | null;
  merchant: string;
  title: string;
  offerType: string;
  valueCents: number;
  minSpendCents: number | null;
  endsAt: string | null;
  daysLeft: number | null;
  status: ItemStatus;
  decision: Decision;
  reason: string | null;
  score: number | null;
  scoreDetail: { scores?: Record<string, number>; reasons?: string[]; decision?: string } | null;
  autoEnrolled: boolean;
  sameOfferOnCards: number;
}

export interface OfferAccountView {
  id: string;
  issuer: { id: string; name: string; offersUrl: string | null };
  holderLabel: string;
  connectorKind: ConnectorKind;
  hasCredential: boolean;
  credentialRef: string | null;
  mfaMethod: string;
  syncHealth: SyncHealth;
  lastLoginAt: string | null;
  lastSyncAt: string | null;
  lastError: string | null;
  locked: boolean;
  automationOptIn: boolean;
  cadence: string;
  syncHour: number;
  timezone: string;
  nextRunAt: string | null;
  canSync: boolean;
  cannotSyncBecause: string | null;
  walletCardIds: string[];
  connector: { verified: boolean; unverifiedFlow: boolean; termsNote: string | null; serverSwitchOn: boolean };
}

export interface SyncRunView {
  id: string;
  batchId: string | null;
  accountId: string | null;
  holder: string | null;
  issuer: string | null;
  trigger: string;
  status: RunStatus;
  attempt: number;
  found: number;
  added: number;
  updated: number;
  removed: number;
  expired: number;
  enrolled: number;
  errors: number;
  warnings: number;
  progress: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface SyncDashboard {
  accounts?: OfferAccountView[];
  runs: SyncRunView[];
  totals: { found: number; added: number; errors: number; warnings: number; processed: number };
  done: boolean;
}

export interface RuleRow {
  id: string;
  label: string;
  kind: 'ALWAYS' | 'NEVER';
  matcher: string;
  matcherValue: string;
  priority: number;
  enabled: boolean;
}

export interface Savings {
  realizedCents: number;
  enrolledPotentialCents: number;
  notYetAddedCents: number;
  missedCents: number;
  enrolledCount: number;
  autoEnrolledCount: number;
}

export interface EventRow {
  id: string;
  type: string;
  actor: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export const TAB_LABEL: Record<InboxTab, string> = {
  all: 'Offer Inbox',
  new: 'New Offers',
  review: 'Pending Review',
  queued: 'Waiting for Browser',
  enrolled: 'Enrolled Offers',
  auto: 'Auto-Enrolled Offers',
  expiring: 'Expiring Offers',
  redeemed: 'Redeemed Offers',
};

export const DECISION_LABEL: Record<Decision, { label: string; tone: Tone }> = {
  NEW: { label: 'New', tone: 'slate' },
  RECOMMENDED: { label: 'Recommended', tone: 'green' },
  PENDING_REVIEW: { label: 'Review', tone: 'amber' },
  IGNORED: { label: 'Ignored', tone: 'slate' },
  APPROVED: { label: 'Approved', tone: 'green' },
  ENROLLED: { label: 'Enrolled', tone: 'green' },
  AUTO_ENROLLED: { label: 'Auto-Enrolled', tone: 'green' },
  FAILED: { label: 'Failed', tone: 'red' },
};

export const HEALTH_LABEL: Record<SyncHealth, { label: string; tone: Tone }> = {
  HEALTHY: { label: 'Healthy', tone: 'green' },
  DEGRADED: { label: 'Degraded', tone: 'amber' },
  NEEDS_MFA: { label: 'Needs Verification Code', tone: 'amber' },
  NEEDS_LOGIN: { label: 'Needs New Login', tone: 'red' },
  ERROR: { label: 'Error', tone: 'red' },
  LOCKED: { label: 'Locked', tone: 'red' },
  DISABLED: { label: 'Not Syncing', tone: 'slate' },
};

export const RUN_LABEL: Record<RunStatus, { label: string; tone: Tone }> = {
  QUEUED: { label: 'Queued', tone: 'slate' },
  RUNNING: { label: 'Running', tone: 'amber' },
  NEEDS_MFA: { label: 'Needs Code', tone: 'amber' },
  SUCCESS: { label: 'Done', tone: 'green' },
  PARTIAL: { label: 'Done with Problems', tone: 'amber' },
  FAILED: { label: 'Failed', tone: 'red' },
};

export const KIND_LABEL: Record<ConnectorKind, string> = {
  MOCK: 'Mock Issuer (Demo)',
  EXTENSION: 'Browser Extension',
  EMAIL: 'Offer Emails',
  MANUAL: 'Manual Paste',
  ISSUER_LOGIN: 'Server-Side Login (Opt-In)',
};

export const FACTOR_LABEL: Record<string, string> = {
  value: 'Offer value',
  expiration: 'Expiration',
  merchantPreference: 'Merchant preference',
  travel: 'Travel relevance',
  household: 'Household relevance',
  likelihood: 'Likelihood of use',
};

export const EVENT_LABEL: Record<string, string> = {
  DISCOVERED: 'Discovered',
  UPDATED: 'Updated',
  REMOVED: 'Removed',
  EXPIRED: 'Expired',
  REDEEMED: 'Redeemed',
  ACTIVATED: 'Enrolled',
  AUTO_ENROLLED: 'Auto-Enrolled',
  ENROLL_ATTEMPT: 'Enrollment Attempt',
  DECISION: 'Decision',
  SYNC: 'Sync',
  RULE_CHANGED: 'Rule or Policy Changed',
  IMPORTED: 'Imported',
};

export const MODE_LABEL: Record<Mode, { label: string; help: string }> = {
  RECOMMEND: { label: 'Recommend Only', help: 'PointWise suggests offers and never adds anything.' },
  BULK_APPROVAL: { label: 'Bulk Approval', help: 'You approve the recommended offers in one click.' },
  AUTO: { label: 'Automatic Enrollment', help: 'PointWise adds offers that match your rules and filter.' },
};

export const scoreTone = (score: number | null): Tone => (score == null ? 'slate' : score >= 85 ? 'green' : score >= 60 ? 'green' : score >= 35 ? 'amber' : 'slate');

/** "Should Prioritize" and friends, from the stored decision text. */
export function decisionPhrase(score: number | null): string {
  if (score == null) return 'Not Scored';
  if (score >= 85) return 'Should Prioritize';
  if (score >= 60) return 'Should Add';
  if (score >= 35) return 'Should Review';
  return 'Should Ignore';
}

/** The sync is finished when every run is in a final state. */
export const syncFinished = (d: Pick<SyncDashboard, 'runs' | 'done'> | undefined): boolean => !d || d.done;

/** One line for the progress panel. */
export function progressLine(t: SyncDashboard['totals'], total: number): string {
  return `${t.processed} of ${total} account(s) processed · ${t.found} offer(s) found · ${t.added} added · ${t.errors} error(s) · ${t.warnings} warning(s)`;
}

/** Offers that can be acted on from the inbox. */
export const actionable = (i: Pick<InboxItem, 'status' | 'decision'>): boolean => i.status === 'AVAILABLE' && i.decision !== 'IGNORED';

/** Percent into dollars text for a rule's minimum value, which is stored in cents. */
export const centsText = (cents: string): string => (/^\d+$/.test(cents) ? `$${(Number(cents) / 100).toFixed(2)}` : cents);

/** Dollars typed by the member into cents for a MIN_VALUE rule; null when it is not a number. */
export function dollarsToCents(text: string): number | null {
  const t = text.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}

export function describeRule(r: Pick<RuleRow, 'kind' | 'matcher' | 'matcherValue'>): string {
  const verb = r.kind === 'ALWAYS' ? 'Always add' : 'Never add';
  switch (r.matcher) {
    case 'MERCHANT':
      return `${verb} offers from ${r.matcherValue}`;
    case 'CATEGORY':
      return `${verb} ${r.matcherValue} offers`;
    case 'MIN_VALUE':
      return `${verb} offers worth ${centsText(r.matcherValue)} or more`;
    case 'OFFER_TYPE':
      return `${verb} ${r.matcherValue.toLowerCase().replace(/_/g, ' ')} offers`;
    case 'KEYWORD':
      return `${verb} offers mentioning “${r.matcherValue}”`;
    default:
      return `${verb} offers from merchants you already spend at`;
  }
}

/** Quick rules from the spec's examples. */
export const RULE_EXAMPLES: Array<{ label: string; kind: 'ALWAYS' | 'NEVER'; matcher: string; matcherValue: string }> = [
  { label: 'Always Add Hilton Offers', kind: 'ALWAYS', matcher: 'MERCHANT', matcherValue: 'Hilton' },
  { label: 'Always Add Marriott Offers', kind: 'ALWAYS', matcher: 'MERCHANT', matcherValue: 'Marriott' },
  { label: 'Always Add Hyatt Offers', kind: 'ALWAYS', matcher: 'MERCHANT', matcherValue: 'Hyatt' },
  { label: 'Always Add Costco Offers', kind: 'ALWAYS', matcher: 'MERCHANT', matcherValue: 'Costco' },
  { label: 'Always Add Amazon Offers', kind: 'ALWAYS', matcher: 'MERCHANT', matcherValue: 'Amazon' },
  { label: 'Always Add Travel Offers', kind: 'ALWAYS', matcher: 'CATEGORY', matcherValue: 'travel' },
  { label: 'Always Add Dining Offers', kind: 'ALWAYS', matcher: 'CATEGORY', matcherValue: 'dining' },
  { label: 'Always Add Offers Over $25', kind: 'ALWAYS', matcher: 'MIN_VALUE', matcherValue: '2500' },
  { label: 'Never Add Gambling Offers', kind: 'NEVER', matcher: 'CATEGORY', matcherValue: 'gambling' },
  { label: 'Never Add Crypto Offers', kind: 'NEVER', matcher: 'CATEGORY', matcherValue: 'crypto' },
  { label: 'Never Add Subscription Offers', kind: 'NEVER', matcher: 'CATEGORY', matcherValue: 'subscription' },
];
