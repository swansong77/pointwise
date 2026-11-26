import type { Tone } from './offer-market';
import type { BenefitView } from './portfolio-types';

export type LifecycleState = 'AVAILABLE' | 'ADDED' | 'ACTIVATED' | 'PARTIALLY_USED' | 'REDEEMED' | 'EXPIRED' | 'REMOVED' | 'REJECTED';

export const LIFECYCLE: Record<LifecycleState, { label: string; tone: Tone; live: boolean }> = {
  AVAILABLE: { label: 'Available', tone: 'brand', live: true },
  ADDED: { label: 'Added', tone: 'amber', live: true },
  ACTIVATED: { label: 'Activated', tone: 'green', live: true },
  PARTIALLY_USED: { label: 'Partially used', tone: 'green', live: true },
  REDEEMED: { label: 'Fully redeemed', tone: 'slate', live: false },
  EXPIRED: { label: 'Expired', tone: 'slate', live: false },
  REMOVED: { label: 'Removed', tone: 'slate', live: false },
  REJECTED: { label: 'Rejected', tone: 'red', live: false },
};
export const LIFECYCLE_ORDER = Object.keys(LIFECYCLE) as LifecycleState[];

export interface UnifiedOffer {
  id: string;
  origin: 'USER_OFFER' | 'SYNC';
  offerId: string | null;
  title: string;
  merchant: { id: string; name: string; slug: string } | null;
  merchantText: string;
  categoryId: string | null;
  categoryName: string | null;
  walletCardId: string | null;
  card: string | null;
  issuer: string | null;
  profileId: string | null;
  cardholder: string | null;
  offerType: string;
  valueCents: number;
  percent: number | null;
  points: number | null;
  minSpendCents: number | null;
  endsAt: string | null;
  daysLeft: number | null;
  state: LifecycleState;
  enrollmentRequired: boolean;
  activationStatus: string | null;
  addedAt: string | null;
  activatedAt: string | null;
  redeemedAt: string | null;
  actualSavingsCents: number;
  expectedSavingsCents: number;
  source: string;
  reliability: number;
  verification: string;
  lastVerified: string | null;
}

export interface InventorySummary {
  total: number;
  live: number;
  expiringSoon: number;
  expectedCents: number;
  actualCents: number;
  byState: Record<LifecycleState, number>;
}

export interface UnifiedInventory {
  summary: InventorySummary;
  total: number;
  page: number;
  pageSize: number;
  items: UnifiedOffer[];
}

export interface InventoryFilters {
  q: string;
  walletCardId: string;
  profileId: string;
  states: LifecycleState[];
  expiresWithinDays: number | null;
  minValueCents: number | null;
  sort: 'ENDING' | 'VALUE' | 'EXPECTED' | 'ADDED' | 'MERCHANT';
  page: number;
}

export const EMPTY_FILTERS: InventoryFilters = { q: '', walletCardId: '', profileId: '', states: [], expiresWithinDays: null, minValueCents: null, sort: 'ENDING', page: 1 };

const LIVE: LifecycleState[] = ['AVAILABLE', 'ADDED', 'ACTIVATED', 'PARTIALLY_USED'];

/** Ready-made searches ("show all offers expiring in 30 days", "worth more than $50"). */
export const QUICK_FILTERS: Array<{ key: string; label: string; apply: Partial<InventoryFilters> }> = [
  { key: 'all', label: 'All offers', apply: {} },
  { key: 'live', label: 'Still earning', apply: { states: LIVE } },
  { key: 'expiring30', label: 'Expiring in 30 days', apply: { expiresWithinDays: 30, states: LIVE } },
  { key: 'over50', label: 'Worth over $50', apply: { minValueCents: 5000, sort: 'VALUE' } },
  { key: 'needs', label: 'Needs activation', apply: { states: ['ADDED'] } },
  { key: 'amex', label: 'Amex', apply: { q: 'amex' } },
  { key: 'chase', label: 'Chase', apply: { q: 'chase' } },
  { key: 'hilton', label: 'Hilton', apply: { q: 'hilton' } },
];

export function inventoryPath(f: InventoryFilters, pageSize = 50): string {
  const p = new URLSearchParams();
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.walletCardId) p.set('walletCardId', f.walletCardId);
  if (f.profileId) p.set('profileId', f.profileId);
  if (f.states.length) p.set('states', f.states.join(','));
  if (f.expiresWithinDays != null) p.set('expiresWithinDays', String(f.expiresWithinDays));
  if (f.minValueCents != null) p.set('minValueCents', String(f.minValueCents));
  p.set('sort', f.sort);
  p.set('page', String(f.page));
  p.set('pageSize', String(pageSize));
  return `/offers/intel/inventory/unified?${p.toString()}`;
}

/** "$100 back on $500", "10% back up to $20", "5,000 points" */
export function offerValueText(o: Pick<UnifiedOffer, 'valueCents' | 'percent' | 'points' | 'minSpendCents'>, money: (c: number) => string): string {
  const spend = o.minSpendCents ? ` on ${money(o.minSpendCents)}` : '';
  if (o.percent != null) return `${o.percent}% back${o.valueCents ? ` up to ${money(o.valueCents)}` : ''}`;
  if (o.points) return `${o.points.toLocaleString('en-US')} points${spend}`;
  return `${money(o.valueCents)} back${spend}`;
}

export interface CardDetail {
  card: {
    walletCardId: string;
    name: string;
    catalogName: string;
    issuer: string;
    network: string;
    color: string;
    lastFour: string | null;
    status: string;
    cardholder: string | null;
    profileId: string | null;
    isAuthorizedUser: boolean;
    approvedAt: string | null;
    annualFeeCents: number;
    currency: { name: string; centsPerPoint: number };
    bonus: { spendCents: number; earned: boolean; requiredCents: number | null; months: number | null; points: number | null };
  };
  rewards: Array<{
    id: string;
    categoryId: string | null;
    merchantId: string | null;
    multiplier: number;
    description: string;
    isRotating: boolean;
    conditional: boolean;
    capCents: number | null;
    capPeriod: string | null;
  }>;
  selectedCategoryIds: string[];
  benefits: BenefitView[];
  certificates: Array<{ id: string; name: string; category: string; subtype: string | null; expiresAt: string | null; quantity: number; potentialValueCents: number | null }>;
  offers: {
    active: UnifiedOffer[];
    pending: UnifiedOffer[];
    expired: UnifiedOffer[];
    redeemed: UnifiedOffer[];
    removed: UnifiedOffer[];
    missed: {
      totalLostCents: number;
      items: Array<{ offerId: string; cause: string; lostCents: number; action: string; offer: { title: string; merchant: string | null; endsAt: string | null } }>;
    };
  };
  upcomingExpirations: UnifiedOffer[];
  savings: { offersCents: number; creditsThisYearCents: number; totalCents: number; expectedOffersCents: number; annualFeeCents: number };
  summary: InventorySummary;
}
