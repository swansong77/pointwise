/** Framework-free domain types shared by the pure engines. Money is always integer cents. */

export type CardStatus = 'APPLIED' | 'APPROVED' | 'DENIED' | 'CLOSED';
export type CardType = 'PERSONAL' | 'BUSINESS';

export interface DomainRewardRule {
  id: string;
  categoryId: string | null;
  merchantId: string | null;
  multiplier: number;
  description: string;
  isRotating: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  /** spend cap in cents per period, after which the rate drops to the card's base rate */
  capCents?: number | null;
  capPeriod?: 'QUARTER' | 'YEAR' | string | null;
  /** the rate needs something a category match cannot know (a travel portal, a linked account, an "up to" rate): shown on the card, never used to rank */
  conditional?: boolean;
  /** when an issuer page last confirmed this rate; null = unverified */
  verifiedAt?: Date | null;
}

export interface DomainCurrency {
  id: string;
  code: string;
  centsPerPoint: number;
  isCash: boolean;
}

export interface DomainCard {
  id: string;
  name: string;
  color: string;
  type: CardType;
  annualFeeCents: number;
  bonusSpendCents: number | null;
  bonusMonths: number | null;
  bonusPoints: number | null;
  currency: DomainCurrency;
  rewards: DomainRewardRule[];
  issuerName?: string;
  /** issuer reports business cards on personal credit reports (5/24) */
  businessReportsToPersonal?: boolean;
}

export interface DomainWalletCard {
  id: string;
  nickname: string | null;
  status: CardStatus;
  approvedAt: Date | null;
  closedAt: Date | null;
  annualFeeOverrideCents: number | null;
  bonusEarned: boolean;
  bonusSpendCents: number;
  selectedCategoryIds: string[];
  card: DomainCard;
  cardholder?: 'PRIMARY' | 'AUTHORIZED_USER';
  profileId?: string | null;
  openDatePrecision?: 'DAY' | 'MONTH';
  excludeFrom524?: boolean;
  excludeReason?: string | null;
}

export interface PurchaseTarget {
  /** category being purchased in (for merchants: the merchant's category) */
  categoryId: string | null;
  /** parent category, if the category is a subcategory */
  parentCategoryId?: string | null;
  merchantId?: string | null;
  /** the "everywhere else" category id */
  fallbackCategoryId: string | null;
}
