/** Credit report import — Experian, Equifax, TransUnion or Credit Karma (preview → confirm). */
export type Bureau = 'TRANSUNION' | 'EQUIFAX' | 'EXPERIAN' | 'OTHER';
export interface ReportAccount {
  creditorName: string;
  issuer: string | null;
  accountType: string | null;
  openedOn: string;
  precision: 'DAY' | 'MONTH';
  status: 'OPEN' | 'CLOSED';
  closedOn: string | null;
  lastDigits: string | null;
  creditLimitCents: number | null;
  isAuthorizedUser: boolean;
  bureaus?: Bureau[];
  dateConflict?: Partial<Record<Bureau, string>> | null;
  alreadyImported: boolean;
  match: { walletCardId: string; name: string; by: string; currentOpenDate: string | null; dateCheck: 'MISSING' | 'SAME' | 'DIFFERENT' } | null;
  suggested: 'LINK' | 'ADD' | 'SKIP';
  note: string | null;
}

export interface ReportPreview {
  bureau: Bureau | 'MULTIPLE';
  bureaus: Bureau[];
  reports: Array<{ name: string; bureau: Bureau; provider: 'CREDIT_KARMA' | 'BUREAU'; accounts: number; skipped: number }>;
  source: string;
  profileId: string;
  accounts: ReportAccount[];
  skipped: Array<{ creditorName: string; reason: string }>;
}

/** Only the fields the import endpoint accepts, plus the user's choice for the row. */
export function reportRowFor(a: ReportAccount, choice: { action: 'LINK' | 'ADD' | 'SKIP'; walletCardId?: string; overwrite?: boolean } | undefined) {
  const action = choice?.action ?? 'SKIP';
  return {
    creditorName: a.creditorName,
    issuer: a.issuer,
    accountType: a.accountType,
    openedOn: a.openedOn,
    precision: a.precision,
    status: a.status,
    closedOn: a.closedOn,
    lastDigits: a.lastDigits,
    creditLimitCents: a.creditLimitCents,
    isAuthorizedUser: a.isAuthorizedUser,
    ...(a.bureaus?.length && { bureaus: a.bureaus }),
    action,
    ...(action === 'LINK' && choice?.walletCardId && { walletCardId: choice.walletCardId }),
    ...(action === 'LINK' && choice?.overwrite && { overwrite: true }),
  };
}

export const BUREAU_LABEL: Record<Bureau, string> = { TRANSUNION: 'TransUnion', EQUIFAX: 'Equifax', EXPERIAN: 'Experian', OTHER: 'Other' };

/** "TransUnion 2025-04-02 · Experian 2025-05-02" */
export function conflictText(c: Partial<Record<Bureau, string>> | null | undefined): string | null {
  if (!c) return null;
  return Object.entries(c)
    .map(([b, d]) => `${BUREAU_LABEL[b as Bureau]} ${d}`)
    .join(' · ');
}
