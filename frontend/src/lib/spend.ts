import { money } from './format';
import type { Validation } from './benefit-audit';

export type TxKind = 'PURCHASE' | 'CREDIT' | 'REFUND' | 'PAYMENT' | 'FEE';
export type UsageStatus = 'CONFIRMED' | 'EXPECTED' | 'DISMISSED';
export type UsageSource = 'MANUAL' | 'AUTO_PURCHASE' | 'AUTO_CREDIT';

export interface SpendTx {
  id: string;
  occurredAt: string;
  description: string | null;
  amountCents: number;
  kind: TxKind;
  source: 'MANUAL' | 'CSV' | 'PDF' | 'BANK';
  category: { slug: string; name: string } | null;
  bankCategory: string | null;
  merchant: string | null;
  walletCard: { id: string; name: string; color: string; lastFour: string | null };
  benefits: Array<{ usageId: string; benefitId: string; name: string; amountCents: number; status: UsageStatus; source: UsageSource }>;
}

export interface StatementPreview {
  card: string;
  format: 'pdf' | 'csv';
  period: { start: string | null; end: string | null } | null;
  columns: { date: string; description: string; amount: string; category: string | null };
  purchasesAre: 'positive' | 'negative';
  errors: Array<{ line: number; message: string }>;
  validation?: Validation;
  totals: { rows: number; new: number; duplicates: number; purchasesCents: number };
  rows: Array<{
    occurredAt: string;
    description: string;
    amountCents: number;
    kind: TxKind;
    category: string | null;
    merchant: string | null;
    duplicate: boolean;
    benefit: { id: string; name: string; by: string; term: string; confidence?: number } | null;
  }>;
}

export interface BenefitUpdate {
  benefitId: string;
  benefit: string;
  card: string;
  amountCents: number;
  status: 'EXPECTED' | 'CONFIRMED';
  transaction: string;
}

export interface SpendSummary {
  totalCents: number;
  byCategory: Array<{ category: { slug: string; name: string } | null; amountCents: number; count: number }>;
  byCard: Array<{ walletCardId: string; name: string; amountCents: number; count: number }>;
  autoTracked: { expectedCents: number; confirmedCents: number; matches: number };
}

export const KIND_LABEL: Record<TxKind, string> = { PURCHASE: 'Purchase', CREDIT: 'Statement credit', REFUND: 'Refund', PAYMENT: 'Payment', FEE: 'Fee' };

/** Money as it affects the card balance: purchases and fees +, credits / refunds / payments −. */
export function txAmount(kind: TxKind, cents: number): string {
  return kind === 'PURCHASE' || kind === 'FEE' ? money(cents) : `−${money(cents)}`;
}

export function kindTone(kind: TxKind): 'slate' | 'green' | 'amber' | 'red' {
  return kind === 'CREDIT' || kind === 'REFUND' ? 'green' : kind === 'FEE' ? 'red' : kind === 'PAYMENT' ? 'slate' : 'slate';
}

/** Badge for a benefit usage: how it was recorded and whether the credit has posted. */
export function usageBadge(u: { source?: UsageSource; status?: UsageStatus }): { label: string; tone: 'green' | 'amber' | 'slate' } | null {
  if (!u.source || u.source === 'MANUAL') return null;
  if (u.status === 'EXPECTED') return { label: 'auto · credit expected', tone: 'amber' };
  return { label: 'auto · credit posted', tone: 'green' };
}

export const MATCH_LABEL: Record<string, string> = { EXACT: 'exact', ALIAS: 'alias', REGEX: 'pattern', FUZZY: 'fuzzy', AI: 'AI', keyword: 'merchant', category: 'category', credit: 'statement credit' };

/** "uber, Lyft ,, uber" → ["uber", "lyft"] */
export function parseList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

export interface CaptureStatus {
  inbox: {
    configured: boolean;
    address: string | null;
    enabled: boolean;
    received: number;
    lastReceivedAt: string | null;
    gmailFilter: string;
    confirmation: { code: string | null; url: string | null; receivedAt: string } | null;
  };
  cards: Array<{
    walletCardId: string;
    name: string;
    issuer: string;
    color: string;
    lastFour: string | null;
    automatic: boolean;
    via: 'BANK' | 'EMAIL' | 'MANUAL';
    bank: { connectionId: string; institution: string | null; needsReauth: boolean; lastSyncedAt: string | null } | null;
    lastAlertAt: string | null;
    lastTransactionAt: string | null;
    statements: { statements: number; through: string | null; lastImportAt: string | null } | null;
    statementDue: boolean;
    hint: string | null;
  }>;
  automated: number;
  needsCard: Array<{
    id: string;
    kind: string;
    receivedAt: string;
    amountCents: number | null;
    merchant: string | null;
    lastDigits: string | null;
    occurredAt: string | null;
    credit: boolean;
    note: string | null;
  }>;
  recent: Array<{
    id: string;
    receivedAt: string;
    fromDomain: string;
    subject: string;
    kind: string;
    status: string;
    verified: boolean;
    amountCents: number | null;
    merchant: string | null;
    note: string | null;
  }>;
}

export const VIA_LABEL: Record<'BANK' | 'EMAIL' | 'MANUAL', string> = { BANK: 'Bank connection', EMAIL: 'Alert emails', MANUAL: 'Not automated' };

export function viaTone(via: 'BANK' | 'EMAIL' | 'MANUAL', needsReauth = false): 'green' | 'amber' | 'red' | 'slate' {
  if (needsReauth) return 'red';
  return via === 'MANUAL' ? 'amber' : 'green';
}

export const INBOUND_STATUS_LABEL: Record<string, string> = { PROCESSED: 'added', NEEDS_CARD: 'which card?', DUPLICATE: 'already recorded', REJECTED: 'rejected' };

export type BulkStatus = 'IMPORTED' | 'ALREADY_IMPORTED' | 'NEEDS_CARD' | 'ERROR';
export interface BulkFileResult {
  file: string;
  status: BulkStatus;
  walletCardId?: string;
  card?: string | null;
  matchedBy?: 'digits' | 'choice';
  lastDigits?: string | null;
  period?: { start: string | null; end: string | null } | null;
  imported?: number;
  merged?: number;
  duplicates?: number;
  benefitUpdates?: number;
  validation?: Validation;
  note?: string;
}
export interface BulkResult {
  files: BulkFileResult[];
  totals: { imported: number; alreadyImported: number; needsCard: number; errors: number; transactions: number };
}

export const BULK_STATUS: Record<BulkStatus, { label: string; tone: 'green' | 'slate' | 'amber' | 'red' }> = {
  IMPORTED: { label: 'Imported', tone: 'green' },
  ALREADY_IMPORTED: { label: 'Already imported', tone: 'slate' },
  NEEDS_CARD: { label: 'Choose card', tone: 'amber' },
  ERROR: { label: 'Not imported', tone: 'red' },
};

/** Up to the bulk limit, statement-like files only (PDF / CSV), no duplicates by name. */
export function pickStatementFiles<T extends { name: string }>(files: T[], max = 24): { files: T[]; skipped: string[] } {
  const seen = new Set<string>();
  const ok: T[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    if (!/\.(pdf|csv)$/i.test(f.name) || seen.has(f.name) || ok.length >= max) skipped.push(f.name);
    else (seen.add(f.name), ok.push(f));
  }
  return { files: ok, skipped };
}

/** Largest request body sent at once; the web proxy rejects anything over 10 MB, so stay well under it. */
export const BULK_BATCH_BYTES = 6 * 1024 * 1024;

/** Splits files into upload batches by total size (and count); a single oversized file goes alone. */
export function batchBySize<T extends { size: number }>(files: T[], maxBytes = BULK_BATCH_BYTES, maxCount = 24): T[][] {
  const out: T[][] = [];
  let cur: T[] = [];
  let bytes = 0;
  for (const f of files) {
    if (cur.length && (bytes + f.size > maxBytes || cur.length >= maxCount)) {
      out.push(cur);
      cur = [];
      bytes = 0;
    }
    cur.push(f);
    bytes += f.size;
  }
  if (cur.length) out.push(cur);
  return out;
}

/** Combines the results of several upload batches into one result with recounted totals. */
export function mergeBulk(parts: BulkResult[]): BulkResult {
  const files = parts.flatMap((p) => p.files);
  const count = (s: BulkStatus) => files.filter((f) => f.status === s).length;
  return {
    files,
    totals: {
      imported: count('IMPORTED'),
      alreadyImported: count('ALREADY_IMPORTED'),
      needsCard: count('NEEDS_CARD'),
      errors: count('ERROR'),
      transactions: files.reduce((a, f) => a + (f.imported ?? 0), 0),
    },
  };
}
