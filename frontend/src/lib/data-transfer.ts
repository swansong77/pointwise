import type { Tone } from './offer-market';

/** Types and pure helpers for data export and import, backups and the migration checklist. */

export interface ImportReport {
  mode: 'merge' | 'replace';
  dryRun: boolean;
  created: Record<string, number>;
  updated: Record<string, number>;
  duplicates: Record<string, number>;
  unmapped: Record<string, number>;
  notRestored: Array<{ model: string; rows: number; why: string }>;
  warnings: string[];
  totals: { created: number; duplicates: number; unmapped: number };
}

export interface BackupFile {
  name: string;
  bytes: number;
  modifiedAt: string;
}

export interface BackupList {
  files: BackupFile[];
  folder: string;
  keep: number;
  nightly: { configured: boolean; schedule: string };
  migration: string;
  maintenance: { on: boolean; reason: string | null; since: string | null };
}

export interface VerifyReport {
  ok: boolean;
  createdAt: string | null;
  appVersion: string | null;
  migration: string | null;
  rows: number | null;
  models: number | null;
  hasEnv: boolean;
  includesEphemeral: boolean | null;
  warnings: string[];
  problems: string[];
  incompatible: string | null;
}

export interface Check {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

export interface EnvRow {
  name: string;
  kind: 'carry' | 'review';
  state: 'set' | 'not set';
  value?: string;
  note: string;
}

/** Friendly names for the parts of a member's data (the model names are internal). */
export const SECTION_LABEL: Record<string, string> = {
  Household: 'Household',
  Profile: 'Household members',
  Wallet: 'Wallet',
  WalletCard: 'Cards',
  CreditCard: 'Your own cards',
  CardFeature: 'Your own card details',
  Reward: 'Your own card rewards',
  UserValuation: 'Point values',
  CategoryPin: 'Pinned categories',
  Offer: 'Offers you entered',
  UserOffer: 'Offers on cards',
  OfferAlert: 'Offer alerts',
  Transaction: 'Transactions',
  StatementImport: 'Statement imports',
  StatementValidation: 'Statement checks',
  UserBenefit: 'Benefits',
  BenefitUsage: 'Benefit use',
  BenefitNotification: 'Benefit reminders',
  BenefitDetection: 'Detected benefit credits',
  CardImportJob: 'Spreadsheet imports',
  ImportRow: 'Spreadsheet import rows',
  CreditReportAccount: 'Credit report accounts',
  FiveTwentyFourSnapshot: '5/24 history',
  SpendProfileEntry: 'Spending profile',
  RetentionOfferReport: 'Retention offers',
  PlannedPurchase: 'Planned purchases',
  Recommendation: 'Recommendations',
  RecommendationFactor: 'Recommendation reasons',
  OfferEvent: 'Offer history',
  NotificationPreference: 'Notification settings',
  AiSettings: 'AI settings',
  EnrollmentPolicy: 'Offer enrollment mode',
  EnrollmentRule: 'Offer enrollment rules',
  LoyaltyBalance: 'Loyalty balances',
  LoyaltyAccount: 'Loyalty accounts',
  LoyaltyEvent: 'Loyalty history',
  LoyaltyCertificate: 'Certificates',
  EliteStatus: 'Elite status',
  Membership: 'Memberships',
  AwardTrip: 'Award trips',
  LoyaltyObservation: 'Loyalty updates',
  LoyaltySyncRun: 'Loyalty sync history',
  OfferAccount: 'Offer accounts',
  OfferAccountCard: 'Offer account cards',
  OfferSnapshot: 'Offer snapshots',
  OfferSnapshotItem: 'Discovered offers',
  EnrollmentAttempt: 'Enrollment attempts',
  OfferSyncRun: 'Offer sync history',
  BankConnection: 'Bank links',
  Mailbox: 'Mailboxes',
  Subscription: 'Plan',
  User: 'Account',
  AiConversation: 'Assistant conversations',
  AiMessage: 'Assistant messages',
};

export const sectionLabel = (model: string): string => SECTION_LABEL[model] ?? model.replace(/([a-z])([A-Z])/g, '$1 $2');

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** The rows of the import preview, one per part of the data, in the order of most rows first. */
export function reportRows(r: ImportReport): Array<{ model: string; label: string; created: number; updated: number; duplicates: number; unmapped: number }> {
  const models = new Set([...Object.keys(r.created), ...Object.keys(r.updated), ...Object.keys(r.duplicates), ...Object.keys(r.unmapped)]);
  return [...models]
    .map((model) => ({ model, label: sectionLabel(model), created: r.created[model] ?? 0, updated: r.updated[model] ?? 0, duplicates: r.duplicates[model] ?? 0, unmapped: r.unmapped[model] ?? 0 }))
    .filter((x) => x.created + x.updated + x.duplicates + x.unmapped > 0)
    .sort((a, b) => b.created + b.duplicates - (a.created + a.duplicates) || a.label.localeCompare(b.label));
}

/** One sentence about what a preview or an import did. */
export function reportSummary(r: ImportReport): string {
  const { created, duplicates, unmapped } = r.totals;
  const verb = r.dryRun ? 'would add' : 'added';
  const parts = [`${verb} ${created} item(s)`];
  if (duplicates) parts.push(`${duplicates} already ${r.dryRun ? 'exist' : 'existed'} and ${r.dryRun ? 'would be' : 'were'} skipped`);
  if (unmapped) parts.push(`${unmapped} could not be matched to this server's catalog`);
  return `${r.dryRun ? 'Preview: ' : ''}${parts.join(', ')}.`;
}

export const checkTone = (s: Check['status']): Tone => (s === 'ok' ? 'green' : s === 'warn' ? 'amber' : 'red');

export const hasFailure = (checks: Check[]): boolean => checks.some((c) => c.status === 'fail');

/** The passphrase rules, as the server applies them. */
export function passphraseProblem(p: string): string | null {
  if (p.length < 12) return 'Use at least 12 characters.';
  if (/^(.)\1+$/.test(p)) return 'Do not use one repeated character.';
  return null;
}

/** The steps of moving to another server, in order. */
export const MIGRATION_STEPS: Array<{ id: string; title: string; where: 'new server' | 'old server' | 'both'; detail: string }> = [
  { id: 'prep', title: 'Prepare the new server', where: 'new server', detail: 'Install the same PointWise version as this one. Set TOKEN_ENC_KEY (it can be a new key), your database and Redis addresses, and SEED_DEMO_USERS=false. Start it once so it applies the database migrations, then run the preflight check.' },
  { id: 'rehearse', title: 'Rehearse', where: 'both', detail: 'Make a backup now, restore it on the new server, and run the verification. Fix anything it reports. This changes nothing here.' },
  { id: 'freeze', title: 'Turn on maintenance mode', where: 'old server', detail: 'Members see a short notice and cannot change data while you move it. Administrators can still sign in.' },
  { id: 'bundle', title: 'Make the final backup', where: 'old server', detail: 'Include the environment secrets if you want everyone to stay signed in and keep their push subscriptions. Download the file.' },
  { id: 'restore', title: 'Restore on the new server', where: 'new server', detail: 'Copy the file over and restore it with its passphrase. Everything is replaced in one step and rolled back if anything does not match.' },
  { id: 'verify', title: 'Verify', where: 'new server', detail: 'Run the verification: every reference points at a row, one secret of each kind decrypts, an administrator exists. Sign in and look around.' },
  { id: 'switch', title: 'Switch over', where: 'both', detail: 'Point your address (DNS) at the new server. Update the redirect addresses for Google and Microsoft sign-in, the bank-link webhook, and the inbound email provider. Members should re-sync their mailboxes and update the extension address.' },
  { id: 'rollback', title: 'Keep the old server for a while', where: 'old server', detail: 'Leave it in maintenance mode, untouched, until you are sure. To roll back, point the address back and turn maintenance mode off.' },
];
