/** Offer tracking rules (mirrors DBOfferInventory semantics from the analyzed app). */

export type OfferKind = 'CASH' | 'POINTS' | 'PERCENT';
export type UserOfferStatus = 'ACTIVE' | 'REDEEMED' | 'EXPIRED';

export interface OfferLike {
  kind: OfferKind;
  valueCents: number;
  startsAt: Date | null;
  endsAt: Date | null;
  isRepeatable: boolean;
  maxTimes: number | null;
}

export interface UserOfferLike {
  status: UserOfferStatus;
  amountUsedCents: number;
  timesUsed: number;
  snoozedUntil: Date | null;
  redeemedAt: Date | null;
}

export class OfferRuleError extends Error {}

export function isExpired(offer: Pick<OfferLike, 'endsAt'>, now: Date): boolean {
  return offer.endsAt != null && offer.endsAt.getTime() < now.getTime();
}

export function isStarted(offer: Pick<OfferLike, 'startsAt'>, now: Date): boolean {
  return offer.startsAt == null || offer.startsAt.getTime() <= now.getTime();
}

export function isSnoozed(uo: Pick<UserOfferLike, 'snoozedUntil'>, now: Date): boolean {
  return uo.snoozedUntil != null && uo.snoozedUntil.getTime() > now.getTime();
}

export function effectiveStatus(offer: OfferLike, uo: UserOfferLike, now: Date): UserOfferStatus {
  if (uo.status === 'REDEEMED') return 'REDEEMED';
  if (isExpired(offer, now)) return 'EXPIRED';
  return 'ACTIVE';
}

export function remainingCents(offer: OfferLike, uo: UserOfferLike): number {
  if (offer.kind === 'POINTS') return 0;
  return Math.max(0, offer.valueCents - uo.amountUsedCents);
}

/** Days until the offer ends (ceil), or null when open-ended. */
export function daysLeft(offer: Pick<OfferLike, 'endsAt'>, now: Date): number | null {
  if (!offer.endsAt) return null;
  return Math.ceil((offer.endsAt.getTime() - now.getTime()) / 86_400_000);
}

export function isExpiringSoon(offer: OfferLike, uo: UserOfferLike, now: Date, withinDays: number): boolean {
  if (effectiveStatus(offer, uo, now) !== 'ACTIVE') return false;
  if (isSnoozed(uo, now)) return false;
  const d = daysLeft(offer, now);
  return d != null && d >= 0 && d <= withinDays;
}

export interface UsageUpdate {
  amountUsedCents?: number;
  timesUsed?: number;
  redeemed?: boolean;
}

/**
 * Apply a usage update and return the new state. Enforces:
 *  - amounts are non-negative integers and never exceed the offer value (CASH/PERCENT)
 *  - timesUsed never exceeds maxTimes for repeatable offers; non-repeatable max 1
 *  - cannot redeem an offer that has not started; cannot change an expired offer
 *  - fully used cash offers auto-redeem
 */
export function applyUsage(offer: OfferLike, uo: UserOfferLike, update: UsageUpdate, now: Date): UserOfferLike {
  if (isExpired(offer, now) && uo.status !== 'REDEEMED') {
    throw new OfferRuleError('Offer has expired');
  }
  const next: UserOfferLike = { ...uo };

  if (update.amountUsedCents !== undefined) {
    const a = update.amountUsedCents;
    if (!Number.isInteger(a) || a < 0) throw new OfferRuleError('amountUsedCents must be a non-negative integer');
    if (offer.kind !== 'POINTS' && offer.valueCents > 0 && a > offer.valueCents) {
      throw new OfferRuleError('amountUsedCents cannot exceed the offer value');
    }
    next.amountUsedCents = a;
  }

  if (update.timesUsed !== undefined) {
    const t = update.timesUsed;
    if (!Number.isInteger(t) || t < 0) throw new OfferRuleError('timesUsed must be a non-negative integer');
    const max = offer.isRepeatable ? offer.maxTimes ?? Number.MAX_SAFE_INTEGER : 1;
    if (t > max) throw new OfferRuleError(`timesUsed cannot exceed ${max}`);
    next.timesUsed = t;
  }

  if (update.redeemed !== undefined) {
    if (update.redeemed) {
      if (!isStarted(offer, now)) throw new OfferRuleError('Offer has not started yet');
      next.status = 'REDEEMED';
      next.redeemedAt = next.redeemedAt ?? now;
      if (!offer.isRepeatable && next.timesUsed === 0) next.timesUsed = 1;
    } else {
      next.status = 'ACTIVE';
      next.redeemedAt = null;
    }
  }

  // Auto-redeem fully used cash offers.
  if (
    next.status === 'ACTIVE' &&
    offer.kind !== 'POINTS' &&
    offer.valueCents > 0 &&
    next.amountUsedCents >= offer.valueCents
  ) {
    next.status = 'REDEEMED';
    next.redeemedAt = now;
  }
  // Repeatable offers that reach maxTimes are complete.
  if (next.status === 'ACTIVE' && offer.isRepeatable && offer.maxTimes != null && next.timesUsed >= offer.maxTimes) {
    next.status = 'REDEEMED';
    next.redeemedAt = now;
  }
  return next;
}

export function snooze(uo: UserOfferLike, until: Date, now: Date): UserOfferLike {
  if (until.getTime() <= now.getTime()) throw new OfferRuleError('snooze date must be in the future');
  const maxMs = 366 * 86_400_000;
  if (until.getTime() - now.getTime() > maxMs) throw new OfferRuleError('cannot snooze for more than a year');
  return { ...uo, snoozedUntil: until };
}

export type OfferSort = 'endDate' | 'value' | 'addedDate' | 'alphabetical';

export interface SortableOffer {
  title: string;
  endsAt: Date | null;
  valueCents: number;
  addedAt: Date;
  isFavorite: boolean;
}

/** Favorites first, then the chosen key. Open-ended offers sort last by end date. */
export function sortOffers<T extends SortableOffer>(items: T[], sort: OfferSort = 'endDate'): T[] {
  const copy = [...items];
  copy.sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    switch (sort) {
      case 'value':
        return b.valueCents - a.valueCents || a.title.localeCompare(b.title);
      case 'addedDate':
        return b.addedAt.getTime() - a.addedAt.getTime();
      case 'alphabetical':
        return a.title.localeCompare(b.title);
      case 'endDate':
      default: {
        const ae = a.endsAt ? a.endsAt.getTime() : Number.POSITIVE_INFINITY;
        const be = b.endsAt ? b.endsAt.getTime() : Number.POSITIVE_INFINITY;
        return ae - be || a.title.localeCompare(b.title);
      }
    }
  });
  return copy;
}

/** Offer alert keyword matching (case-insensitive, whole-word-ish). */
export function matchesAlert(
  offer: { title: string; description?: string | null; valueCents: number; issuerId?: string | null },
  alert: { keywords: string[]; minValueCents?: number | null; issuerIds: string[] },
): boolean {
  if (alert.minValueCents != null && offer.valueCents < alert.minValueCents) return false;
  if (alert.issuerIds.length > 0 && (!offer.issuerId || !alert.issuerIds.includes(offer.issuerId))) return false;
  if (alert.keywords.length === 0) return true;
  const hay = `${offer.title} ${offer.description ?? ''}`.toLowerCase();
  return alert.keywords.some((k) => {
    const kw = k.trim().toLowerCase();
    return kw.length > 0 && hay.includes(kw);
  });
}
