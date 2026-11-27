/** Response types for the portfolio, benefits, 5/24, household and import endpoints. */

export type Relationship = 'SELF' | 'SPOUSE' | 'PARTNER' | 'CHILD' | 'PARENT' | 'OTHER';
export type BenefitStatus = 'UNUSED' | 'PARTIAL' | 'COMPLETED' | 'EXPIRED' | 'EXPIRING_SOON';
export type BenefitPeriod = 'MONTHLY' | 'QUARTERLY' | 'SEMIANNUAL' | 'ANNUAL' | 'MULTI_YEAR';

export interface Member {
  id: string;
  nickname: string;
  relationship: Relationship;
  isPrimary: boolean;
  email: string | null;
  birthYear: number | null;
  creditBand?: CreditBand | null;
  goals?: string[];
  hasBusiness?: boolean;
  cardCount?: number;
  visibility?: 'OWN' | 'HOUSEHOLD';
  /** this member's mailboxes and alert address, as health only (never the addresses) */
  channels?: { mailboxes: number; needsAttention: number; lastSyncAt: string | null; alertAddress: boolean | null };
  /** The member's own sign-in, as the owner sees it */
  login?: { status: 'NONE' | 'INVITED' | 'ACTIVE'; canHaveLogin: boolean; email: string | null; since: string | null; inviteExpiresAt: string | null };
}

export interface Household {
  id: string;
  name: string;
  members: Member[];
}

export interface ValueTotals {
  annualFeeCents: number;
  faceBenefitCents: number;
  realizedBenefitCents: number;
  missedBenefitCents: number;
  rewardsCents: number;
  spendCents: number;
  netValueCents: number;
  effectiveValueCents: number;
  returnOnSpend: number | null;
}

export interface PortfolioCard extends ValueTotals {
  walletCardId: string;
  name: string;
  profileId: string | null;
  status: 'APPLIED' | 'APPROVED' | 'DENIED' | 'CLOSED';
  earnRate: number | null;
  breakEvenSpendCents: number | null;
  card: { id: string; name: string; issuer: string; color: string; type: 'PERSONAL' | 'BUSINESS'; network: string };
  nickname: string | null;
  lastFour: string | null;
  cardholder: 'PRIMARY' | 'AUTHORIZED_USER';
  openedAt: string | null;
  openDatePrecision: 'DAY' | 'MONTH';
  closedAt: string | null;
  creditLimitCents: number | null;
  source: 'MANUAL' | 'SPREADSHEET' | 'BANK' | 'CREDIT_REPORT';
  benefitCount: number;
}

export interface Portfolio {
  asOf: string;
  groups: { active: PortfolioCard[]; authorizedUser: PortfolioCard[]; closed: PortfolioCard[]; pending: PortfolioCard[] };
  byHolder: Array<ValueTotals & { profileId: string | null; cards: number; profile: { id: string; nickname?: string; relationship?: Relationship } | null }>;
  totals: ValueTotals;
  counts: { total: number; active: number; authorizedUser: number; closed: number; pending: number };
}

export interface Five24Card {
  cardId: string;
  name: string;
  issuer: string;
  counts: boolean;
  reason: string;
  openedAt: string | null;
  dropsOffAt: string | null;
  note?: string | null;
}

export interface Five24Status {
  count: number;
  limit: number;
  label: string;
  underLimit: boolean;
  slotsAvailable: number;
  nextDropAt: string | null;
  nextSlotAt: string | null;
  contributing: Five24Card[];
  excluded: Five24Card[];
  unknown: Five24Card[];
}

export interface Five24TimelinePoint {
  date: string;
  count: number;
  label: string;
  cardId: string | null;
  event: 'NOW' | 'DROP';
}

export interface Five24Response {
  asOf: string;
  members: Array<{ profile: Pick<Member, 'id' | 'nickname' | 'relationship' | 'isPrimary'>; status: Five24Status; timeline: Five24TimelinePoint[] }>;
}

export interface BenefitView {
  id: string;
  name: string;
  kind: 'CREDIT' | 'CERTIFICATE' | 'MEMBERSHIP' | 'ACCESS';
  category: { slug: string; name: string } | null;
  period: BenefitPeriod;
  periodMonths: number;
  basis: 'CALENDAR' | 'CARDMEMBER_YEAR';
  amountPerPeriodCents: number;
  annualValueCents: number;
  howIssued: string | null;
  actionNeeded: string | null;
  notes: string | null;
  enabled: boolean;
  walletCard: { id: string; name: string; issuer: string; color: string; profileId: string | null; cardholder: string; status: string };
  currentPeriod: {
    start: string;
    end: string;
    lastDay: string;
    allocatedCents: number;
    usedCents: number;
    remainingCents: number;
    percentUsed: number;
    status: BenefitStatus;
    daysLeft: number;
  };
  renewsAt: string;
  year: { annualValueCents: number; usedThisYearCents: number; remainingThisYearCents: number; missedCents: number };
  usages: Array<{
    id: string;
    amountCents: number;
    usedOn: string;
    periodStart: string;
    note: string | null;
    source?: 'MANUAL' | 'AUTO_PURCHASE' | 'AUTO_CREDIT';
    status?: 'CONFIRMED' | 'EXPECTED' | 'DISMISSED';
    transaction?: { id: string; description: string | null } | null;
  }>;
  autoTrack?: boolean;
  autoRules?: { keywords: string[]; categories: string[]; creditKeywords: string[]; suggested: boolean };
}

export interface BenefitSummary {
  totals: { annualValueCents: number; usedThisYearCents: number; remainingThisYearCents: number; missedThisYearCents: number; currentRemainingCents: number };
  counts: Record<BenefitStatus, number>;
  available: BenefitView[];
  expiring: BenefitView[];
  completed: BenefitView[];
  missed: BenefitView[];
}

export interface HouseholdDashboard {
  household: { id: string; name: string };
  members: Array<{ profile: Member; cards: PortfolioCard[]; totals: ValueTotals; five24: Five24Status | null }>;
  totals: ValueTotals;
}

export interface ImportRow {
  id: string;
  kind: 'CARD' | 'BENEFIT';
  rowNumber: number;
  result: 'NEW' | 'UPDATE' | 'DUPLICATE' | 'SKIPPED' | 'ERROR';
  message: string | null;
  data: {
    card?: {
      owner: string;
      cardName: string;
      lastDigits: string | null;
      issuer: string | null;
      closed: boolean;
      isAuthorizedUser: boolean;
      openedAt: string | null;
      annualFeeCents: number | null;
    };
    benefit?: { name: string; cardName: string; annualValueCents: number; period: BenefitPeriod; usedCents: number };
  };
}

export interface ImportJob {
  id: string;
  source: 'SPREADSHEET' | 'CSV' | 'BANK' | 'CREDIT_REPORT';
  status: 'PREVIEW' | 'COMMITTED' | 'FAILED' | 'DISCARDED';
  fileName: string | null;
  createdAt: string;
  committedAt: string | null;
  summary: {
    owners?: string[];
    sheetsRead?: string[];
    cards?: Record<string, number>;
    benefits?: Record<string, number>;
    closedCards?: number;
    authorizedUserCards?: number;
    result?: { cardsCreated: number; cardsUpdated: number; benefitsCreated: number; usageRows: number; membersCreated: number };
  };
  errors?: Array<{ sheet: string; row: number; message: string; severity: 'ERROR' | 'WARNING' }>;
  rows?: ImportRow[];
}

export type CreditBand = 'EXCELLENT' | 'VERY_GOOD' | 'GOOD' | 'FAIR' | 'POOR';
