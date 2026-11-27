/**
 * One lifecycle for every offer a household holds (pure, deterministic). The database keeps three overlapping status
 * sets (UserOffer.status, UserOffer.activationStatus, OfferSnapshotItem.status/decision); this derives the eight states
 * people think in, so no enum migration is needed. Also the merged inventory row, its filters and its sort.
 */
import { confidenceCap, OfferSourceKind, VerificationKind } from './offer-import';
import { expandNicknames as expand, norm } from './nicknames';

export const OFFER_LIFECYCLE_VERSION = 'offer-lifecycle/1';

export type LifecycleState = 'AVAILABLE' | 'ADDED' | 'ACTIVATED' | 'PARTIALLY_USED' | 'REDEEMED' | 'EXPIRED' | 'REMOVED' | 'REJECTED';

export const LIFECYCLE_STATES: LifecycleState[] = ['AVAILABLE', 'ADDED', 'ACTIVATED', 'PARTIALLY_USED', 'REDEEMED', 'EXPIRED', 'REMOVED', 'REJECTED'];
export const LIFECYCLE_LABEL: Record<LifecycleState, string> = {
  AVAILABLE: 'Available',
  ADDED: 'Added',
  ACTIVATED: 'Activated',
  PARTIALLY_USED: 'Partially used',
  REDEEMED: 'Fully redeemed',
  EXPIRED: 'Expired',
  REMOVED: 'Removed',
  REJECTED: 'Rejected',
};
/** states in which the offer can still earn something */
export const LIVE_STATES: LifecycleState[] = ['AVAILABLE', 'ADDED', 'ACTIVATED', 'PARTIALLY_USED'];

export interface LifecycleInput {
  offer: { endsAt: Date | null; enrollmentRequired: boolean };
  /** the member's own row (the offer is on a card) */
  userOffer?: { status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED'; amountUsedCents: number; timesUsed: number; activationStatus: 'NOT_REQUIRED' | 'PENDING' | 'ACTIVATED' | 'FAILED' } | null;
  /** the offer as found by an offer-sync or import, when there is no user row yet */
  snapshot?: { status: 'AVAILABLE' | 'ENROLLED' | 'REDEEMED' | 'EXPIRED' | 'REMOVED'; decision: string } | null;
}

export function lifecycleState(i: LifecycleInput, now: Date): LifecycleState {
  const ended = !!i.offer.endsAt && i.offer.endsAt.getTime() < now.getTime();
  const uo = i.userOffer;
  if (uo) {
    if (uo.status === 'REDEEMED') return 'REDEEMED';
    if (uo.status === 'EXPIRED' || ended) return 'EXPIRED';
    if (uo.activationStatus === 'FAILED') return 'REJECTED';
    if (uo.amountUsedCents > 0 || uo.timesUsed > 0) return 'PARTIALLY_USED';
    if (uo.activationStatus === 'ACTIVATED' || uo.activationStatus === 'NOT_REQUIRED' || !i.offer.enrollmentRequired) return 'ACTIVATED';
    return 'ADDED';
  }
  const s = i.snapshot;
  if (!s) return ended ? 'EXPIRED' : 'AVAILABLE';
  if (s.status === 'REMOVED') return 'REMOVED';
  if (s.status === 'REDEEMED') return 'REDEEMED';
  if (s.status === 'EXPIRED' || ended) return 'EXPIRED';
  if (s.status === 'ENROLLED' || s.decision === 'ENROLLED' || s.decision === 'AUTO_ENROLLED') return 'ADDED';
  if (s.decision === 'IGNORED' || s.decision === 'FAILED') return 'REJECTED';
  return 'AVAILABLE';
}

export interface ExpectedInput {
  state: LifecycleState;
  valueCents: number;
  source: OfferSourceKind;
  verification: VerificationKind;
}

/**
 * What an offer is expected to return: its value (the cash amount, or the maximum discount of a percent offer) scaled by how far
 * its source can be trusted (the same confidence cap the planner uses). Nothing for an offer that can no longer earn.
 */
export function expectedSavingsCents(i: ExpectedInput): number {
  if (!LIVE_STATES.includes(i.state)) return 0;
  return Math.round((Math.max(0, i.valueCents) * confidenceCap(i.source, i.verification)) / 100);
}

export interface InventoryRow {
  /** UserOffer id, or the snapshot item id when the offer is not on a card yet */
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
  endsAt: Date | null;
  daysLeft: number | null;
  state: LifecycleState;
  enrollmentRequired: boolean;
  activationStatus: string | null;
  addedAt: Date | null;
  activatedAt: Date | null;
  redeemedAt: Date | null;
  /** credit actually received */
  actualSavingsCents: number;
  expectedSavingsCents: number;
  source: string;
  reliability: number;
  verification: string;
  /** the last time something confirmed the offer exists */
  lastVerified: Date | null;
}

export interface InventoryQuery {
  /** free text: merchant, title, card, issuer, cardholder */
  q?: string;
  walletCardId?: string;
  profileId?: string;
  issuer?: string;
  categoryId?: string;
  states?: LifecycleState[];
  /** only offers that end within this many days (and have not ended) */
  expiresWithinDays?: number;
  minValueCents?: number;
  source?: string;
  sort?: 'ENDING' | 'VALUE' | 'EXPECTED' | 'ADDED' | 'MERCHANT';
  page?: number;
  pageSize?: number;
}

export function daysLeft(endsAt: Date | null, now: Date): number | null {
  if (!endsAt) return null;
  return Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000);
}

export function matchesQuery(r: InventoryRow, q: InventoryQuery, now: Date): boolean {
  if (q.walletCardId && r.walletCardId !== q.walletCardId) return false;
  if (q.profileId && r.profileId !== q.profileId) return false;
  if (q.categoryId && r.categoryId !== q.categoryId) return false;
  if (q.issuer && norm(r.issuer ?? '') !== expand(q.issuer)) return false;
  if (q.source && r.source !== q.source) return false;
  if (q.states?.length && !q.states.includes(r.state)) return false;
  if (q.minValueCents != null && Math.max(r.valueCents, r.expectedSavingsCents) < q.minValueCents) return false;
  if (q.expiresWithinDays != null) {
    const d = daysLeft(r.endsAt, now);
    if (d == null || d < 0 || d > q.expiresWithinDays) return false;
  }
  if (q.q?.trim()) {
    const hay = norm([r.merchant?.name, r.merchantText, r.title, r.card, r.issuer, r.cardholder, r.categoryName].filter(Boolean).join(' '));
    // every word must appear ("amex hilton" finds Hilton offers on Amex cards)
    if (!expand(q.q).split(' ').every((w) => hay.includes(w))) return false;
  }
  return true;
}

export function sortRows(rows: InventoryRow[], sort: InventoryQuery['sort'] = 'ENDING'): InventoryRow[] {
  const end = (r: InventoryRow) => (r.endsAt ? r.endsAt.getTime() : Number.MAX_SAFE_INTEGER);
  const cmp: Record<NonNullable<InventoryQuery['sort']>, (a: InventoryRow, b: InventoryRow) => number> = {
    ENDING: (a, b) => end(a) - end(b),
    VALUE: (a, b) => b.valueCents - a.valueCents,
    EXPECTED: (a, b) => b.expectedSavingsCents - a.expectedSavingsCents,
    ADDED: (a, b) => (b.addedAt?.getTime() ?? 0) - (a.addedAt?.getTime() ?? 0),
    MERCHANT: (a, b) => (a.merchant?.name ?? a.merchantText).localeCompare(b.merchant?.name ?? b.merchantText),
  };
  // a stable tie-break keeps pages deterministic
  return [...rows].sort((a, b) => cmp[sort](a, b) || a.id.localeCompare(b.id));
}

export interface InventorySummary {
  total: number;
  live: number;
  expiringSoon: number;
  expectedCents: number;
  actualCents: number;
  byState: Record<LifecycleState, number>;
}

export function summarize(rows: InventoryRow[], now: Date, soonDays = 30): InventorySummary {
  const byState = Object.fromEntries(LIFECYCLE_STATES.map((s) => [s, 0])) as Record<LifecycleState, number>;
  let live = 0;
  let expiringSoon = 0;
  let expectedCents = 0;
  let actualCents = 0;
  for (const r of rows) {
    byState[r.state]++;
    actualCents += r.actualSavingsCents;
    if (!LIVE_STATES.includes(r.state)) continue;
    live++;
    expectedCents += r.expectedSavingsCents;
    const d = daysLeft(r.endsAt, now);
    if (d != null && d >= 0 && d <= soonDays) expiringSoon++;
  }
  return { total: rows.length, live, expiringSoon, expectedCents, actualCents, byState };
}
