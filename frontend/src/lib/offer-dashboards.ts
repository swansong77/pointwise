import type { UnifiedOffer } from './offer-inventory';

export type ExpiringKind = 'OFFER' | 'CREDIT' | 'CERTIFICATE';

export const KIND_LABEL: Record<ExpiringKind, string> = { OFFER: 'Offer', CREDIT: 'Credit', CERTIFICATE: 'Certificate' };

export interface ExpiringRow {
  kind: ExpiringKind;
  id: string;
  label: string;
  cardholder: string | null;
  card: string | null;
  walletCardId: string | null;
  merchant: string | null;
  endsAt: string;
  daysLeft: number;
  valueCents: number;
  action: string;
}

export interface ExpirationBucket {
  key: string;
  label: string;
  fromDays: number;
  toDays: number;
  items: ExpiringRow[];
  totalCents: number;
}

export interface ExpirationSummary {
  buckets: ExpirationBucket[];
  count: number;
  totalCents: number;
  urgentCents: number;
  byKind: Record<ExpiringKind, { count: number; cents: number }>;
  nextDeadline: ExpiringRow | null;
}

export interface SavingsLine {
  key: string;
  label: string;
  actualCents: number;
  expectedCents: number;
  count: number;
}

export interface SavingsSummary {
  totals: { actualCents: number; expectedCents: number; missedCents: number; creditsThisYearCents: number; savedCents: number };
  byCard: SavingsLine[];
  byMember: SavingsLine[];
  byMerchant: SavingsLine[];
  byMonth: Array<{ month: string; actualCents: number }>;
  plans: { done: number; expectedCents: number; actualCents: number; metCount: number; hitRate: number | null };
}

export interface OfferHolder {
  member: string | null;
  profileId: string | null;
  card: string | null;
  walletCardId: string | null;
  expectedCents: number;
  state: string;
  endsAt: string | null;
}

export interface MemberOffers {
  profileId: string;
  member: string;
  isPrimary: boolean;
  cards: number;
  liveOffers: number;
  expectedCents: number;
  expiringSoon: number;
  receivedCents: number;
  top: Array<{ merchant: string; title: string; expectedCents: number; endsAt: string | null }>;
}

export interface HouseholdOffers {
  members: MemberOffers[];
  overlaps: Array<{ merchant: string; valueCents: number; percent: number | null; minSpendCents: number | null; holders: OfferHolder[]; advice: string }>;
  routing: Array<{ merchant: string; merchantId: string | null; merchantSlug: string | null; holders: OfferHolder[]; best: OfferHolder; membersWithout: string[]; advice: string }>;
  totals: { liveOffers: number; expectedCents: number };
}

export interface MerchantDashboard {
  merchant: { id: string; slug: string; name: string; parentCompany: string | null; category: { slug: string; name: string } };
  offers: { active: UnifiedOffer[]; past: UnifiedOffer[] };
  expectedCents: number;
  receivedCents: number;
  multipliers: Array<{ walletCardId: string; card: string; member: string | null; multiplier: number; centsPerDollar: number; reason: string; pinned: boolean }>;
  portalRates: Array<{ portal: string; ratePercent: number | null; pointsPerDollar: number | null; source: string; expiresAt: string | null }>;
  certificates: Array<{ id: string; name: string; member: string; valueCents: number; expiresAt: string | null }>;
  transferRoutes: Array<{ currency: string; program: string; ratio: string; bonusPercent: number; bonusEndsAt: string | null }>;
  history: { count: number; active: number; averageValueCents: number; perYear: number; currentRank: number | null; best: { valueCents: number; issuer: string | null } | null };
  spend: { last12MonthsCents: number; purchases: number };
  bestWayToPay: {
    referenceAmountCents: number;
    basedOn: string;
    legs: Array<{ card: string; member: string | null; amountCents: number }>;
    expectedCents: number;
    confidence: number;
    actions: string[];
    warnings: string[];
    member: { member: string | null; cardName: string; expectedCents: number } | null;
    memberReason: string;
  } | null;
  daysToNextExpiry: number | null;
}

/** "Nov 2026" from "2026-11" */
export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
}
