import { money } from './format';

export type Level = 'account' | 'product' | 'cardholder' | 'household';
export const LEVELS: Array<{ id: Level; label: string }> = [
  { id: 'account', label: 'Card account' },
  { id: 'cardholder', label: 'Cardholder' },
  { id: 'product', label: 'Card product' },
  { id: 'household', label: 'Household' },
];

export interface RollGroup {
  key: string;
  label: string;
  accounts: number;
  benefits: number;
  allocatedCents: number;
  usedCents: number;
  remainingCents: number;
  utilizationPct: number;
}
export interface BenefitRecord {
  benefitId: string;
  cardAccountId: string;
  cardholder: string | null;
  card: string;
  lastFour: string | null;
  benefitName: string;
  frequency: string;
  resetSchedule: string;
  periodStart: string;
  periodEnd: string;
  allocatedCents: number;
  usedCents: number;
  remainingCents: number;
  utilizationPct: number;
  expirationDate: string | null;
  detectionMethod: string;
  verificationStatus: 'VERIFIED' | 'UNVERIFIED' | 'REJECTED' | 'NONE';
  statementEvidence: number;
  status: string;
}
export interface RollupResponse {
  level: Level;
  groups: RollGroup[];
  records: BenefitRecord[];
}

export interface AuditDetection {
  id: string;
  method: string;
  confidence: number;
  tier: 'ASSIGN' | 'REVIEW';
  rule: string;
  status: 'DETECTED' | 'ACCEPTED' | 'REJECTED';
  duplicateRisk: boolean;
  aiReasoning: string | null;
  transaction: { description: string | null; occurredAt: string; amountCents: number; kind: string } | null;
  statement: { id: string; format: string; channel: string; periodEnd: string | null; createdAt: string } | null;
}
export interface AuditItem extends BenefitRecord {
  detected: number;
  matched: number;
  missed: number;
  manualOverrides: number;
  detections: AuditDetection[];
}
export interface AuditResponse {
  items: AuditItem[];
  missedTransactions: Array<{ id: string; walletCardId: string; description: string | null; occurredAt: string; amountCents: number }>;
  summary: { benefits: number; detected: number; matched: number; overrides: number; needsReview: number; missedTransactions: number };
}

export interface ReconcileRow {
  benefitId: string;
  cardAccountId: string;
  cardholder: string | null;
  card: string;
  lastFour: string | null;
  benefitName: string;
  frequency: string;
  expectedCents: number;
  detectedCents: number;
  pendingCents: number;
  missingCents: number;
  expiredCents: number;
  unusedCents: number;
  potentialMissed: boolean;
  suggestion: string;
}
export interface ReconciliationResponse {
  totals: { expectedCents: number; detectedCents: number; pendingCents: number; missingCents: number; expiredCents: number; unusedCents: number };
  rows: ReconcileRow[];
  unused: ReconcileRow[];
  expired: ReconcileRow[];
  potentialMissed: ReconcileRow[];
  actions: Array<{ benefitId: string; card: string; lastFour: string | null; cardholder: string | null; benefit: string; suggestion: string }>;
}

export interface Validation {
  status: 'PASS' | 'WARNING' | 'FAILED';
  confidence: number;
  statementCount: number;
  importedCount: number;
  differenceCount: number;
  statementCents: number;
  importedCents: number;
  missingCents: number;
  notes: string[];
}

export const VALIDATION_TONE: Record<Validation['status'], 'green' | 'amber' | 'red'> = { PASS: 'green', WARNING: 'amber', FAILED: 'red' };

export const METHOD_LABEL: Record<string, string> = {
  EXACT: 'Exact match',
  ALIAS: 'Alias match',
  REGEX: 'Pattern match',
  FUZZY: 'Fuzzy match',
  AI: 'AI suggestion',
  MANUAL: 'Entered by you',
};

/** "Amex Gold ··1001 (Me)" */
export function accountLabel(r: { card: string; lastFour: string | null; cardholder: string | null }): string {
  return `${r.card}${r.lastFour ? ` ··${r.lastFour}` : ''}${r.cardholder ? ` (${r.cardholder})` : ''}`;
}

/** One-line statement validation summary shown after an import. */
export function validationSummary(v: Validation): string {
  if (v.status === 'PASS') return `All ${v.statementCount} transactions on the statement were imported.`;
  const parts = [`${v.importedCount} of ${v.statementCount} transactions imported`];
  if (v.missingCents > 0) parts.push(`${money(v.missingCents)} not captured`);
  return parts.join(' · ');
}
