export type Visibility = 'OWN' | 'HOUSEHOLD';

export interface MemberMe {
  email: string;
  nickname: string;
  relationship: string;
  since: string | null;
  household: string;
  visibility: Visibility;
  /** the owner lets this member add and edit their own cards, points and credit usage */
  canEdit: boolean;
}

export interface MemberCard {
  walletCardId: string;
  name: string;
  status: string;
  cardholder: 'PRIMARY' | 'AUTHORIZED_USER';
  annualFeeCents: number;
  lastFour: string | null;
  card: { id: string; name: string; issuer: string; color: string };
}

export interface MemberBenefit {
  id: string;
  name: string;
  period: string;
  amountPerPeriodCents: number;
  walletCard: { id: string; name: string; issuer: string };
  currentPeriod: { end: string; allocatedCents: number; usedCents: number; remainingCents: number; percentUsed: number; status: string; daysLeft: number };
}

export interface MemberLoyalty {
  id: string;
  name: string;
  nickname: string | null;
  accountLast4: string | null;
  balance: number;
  pendingBalance: number;
  statusLevel: string | null;
  statusDeadline: string | null;
  expiresAt: string | null;
}

export interface MemberTransaction {
  id: string;
  amountCents: number;
  description: string | null;
  occurredAt: string;
  kind: string;
  card: string;
  lastFour: string | null;
}

export interface MemberOverview {
  asOf: string;
  cards: {
    groups: { active: MemberCard[]; authorizedUser: MemberCard[]; closed: MemberCard[]; pending: MemberCard[] };
    totals: { annualFeeCents: number; faceBenefitCents: number; realizedBenefitCents: number; effectiveValueCents: number };
    counts: { total: number; active: number; authorizedUser: number; closed: number; pending: number };
  };
  benefits: MemberBenefit[];
  loyalty: MemberLoyalty[];
  transactions: MemberTransaction[];
}

/** The only pages a member sign-in can open. Everything else is denied by the server too. */
export const MEMBER_PATHS = ['/my'];
export const isMemberPath = (pathname: string) => MEMBER_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));
