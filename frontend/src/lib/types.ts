export type CardStatus = 'APPLIED' | 'APPROVED' | 'DENIED' | 'CLOSED';
export type OfferKind = 'CASH' | 'POINTS' | 'PERCENT';

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface Currency {
  id: string;
  code: string;
  name: string;
  centsPerPoint: string;
  isCash: boolean;
}

export interface CatalogCard {
  id: string;
  slug: string;
  name: string;
  network: string;
  type: 'PERSONAL' | 'BUSINESS';
  annualFeeCents: number;
  color: string;
  bonusDescription: string | null;
  issuer: { id: string; name: string };
  currency: Currency;
  catalogSource?: 'DEMO' | 'SEED' | 'ADMIN' | 'RESEARCH';
  dataAsOf?: string | null;
  lastVerifiedAt?: string | null;
  verifiedScope?: string | null;
}

export interface Reward {
  id: string;
  multiplier: string;
  description: string;
  isRotating: boolean;
  conditional?: boolean;
  capCents?: number | null;
  capPeriod?: 'QUARTER' | 'YEAR' | null;
  verifiedAt?: string | null;
  categoryId: string | null;
  merchantId: string | null;
  category?: { name: string; slug?: string } | null;
  merchant?: { name: string } | null;
}

export interface WalletCard {
  id: string;
  nickname: string | null;
  notes: string | null;
  status: CardStatus;
  cardholder: 'PRIMARY' | 'AUTHORIZED_USER';
  /** the household member who holds the card; null means the account owner (primary member) */
  profileId?: string | null;
  profile?: { id: string; nickname: string; relationship: string; isPrimary: boolean } | null;
  lastFour: string | null;
  approvedAt: string | null;
  closedAt: string | null;
  bonusSpendCents: number;
  bonusEarned: boolean;
  selectedCategoryIds: string[];
  card: CatalogCard & { rewards: Reward[]; bonusSpendCents: number | null; bonusMonths: number | null };
  _count?: { userOffers: number };
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  icon: string;
  isFallback: boolean;
  parentId: string | null;
}

export interface Merchant {
  id: string;
  slug: string;
  name: string;
  hosts: string[];
  category: { id: string; name: string; icon: string };
}

export interface RankedCard {
  walletCardId: string;
  cardId: string;
  name: string;
  color: string;
  multiplier: number;
  centsPerPoint: number;
  centsPerDollar: number;
  matchLevel: string;
  reason: string;
  pinned: boolean;
  /** the multiplier used to rank: lower than `multiplier` when a cap and your known spend pull it down */
  effectiveMultiplier?: number;
  cap?: { capCents: number; capPeriod: 'QUARTER' | 'YEAR' } | null;
  blended?: boolean;
  /** an issuer page has confirmed the rate used */
  verified?: boolean;
}

export interface Offer {
  id: string;
  title: string;
  description: string | null;
  kind: OfferKind;
  valueCents: number;
  minSpendCents: number | null;
  startsAt: string | null;
  endsAt: string | null;
  isRepeatable: boolean;
  maxTimes: number | null;
  isCustom: boolean;
  merchant?: { id: string; name: string; slug?: string } | null;
  issuer?: { id: string; name: string } | null;
}

export interface UserOffer {
  id: string;
  status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED';
  effectiveStatus: 'ACTIVE' | 'REDEEMED' | 'EXPIRED';
  amountUsedCents: number;
  timesUsed: number;
  isFavorite: boolean;
  snoozedUntil: string | null;
  snoozed: boolean;
  remainingCents: number;
  daysLeft: number | null;
  offer: Offer;
  walletCard: { id: string; nickname: string | null; card: { id: string; name: string; color: string } };
}

export interface Dashboard {
  plan: 'FREE' | 'PRO';
  unreadNotifications: number;
  stats: { cards: number; activeOffers: number; availableOfferValueCents: number; redeemedValueCents: number };
  bestByCategory: Array<{ category: { id: string; slug: string; name: string; icon: string; parentSlug?: string | null }; best: RankedCard | null }>;
  expiringOffers: Array<{ id: string; offer: Offer; walletCard: { nickname: string | null; card: { name: string; color: string } } }>;
  renewals: Array<{ walletCardId: string; name: string; renewsAt: string; daysUntil: number; annualFeeCents: number }>;
  bonuses: Array<{ walletCardId: string; name: string; requiredSpendCents: number; spentCents: number; percent: number; deadline: string; daysLeft: number; atRisk: boolean }>;
  fiveTwentyFour: { count: number; nextDropAt: string | null; underLimit: boolean };
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface Subscription {
  plan: 'FREE' | 'PRO';
  status: string;
  interval: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  effectivePlan: 'FREE' | 'PRO';
  limits: { maxCards: number; maxTrackedOffers: number; offerAlerts: boolean; profiles: boolean; calculatorCompare: boolean };
  prices: Record<'month' | 'year' | 'lifetime', { cents: number; label: string; trialDays?: number }>;
}

export interface NearbyItem {
  locationId: string;
  name: string;
  address: string | null;
  distanceM: number;
  merchant: { id: string; slug: string; name: string; category: string; icon: string };
  bestCard: RankedCard | null;
  offers: Array<{ id: string; title: string; valueCents: number; endsAt: string | null }>;
}
