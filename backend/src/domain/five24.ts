import { addMonths } from './dates';
import { CardStatus, CardType } from './types';

/**
 * Chase 5/24 engine (pure). See docs/chase-524-engine.md.
 *
 * Rule modelled: a person is "N/24" where N = number of credit-card accounts opened in the last
 * 24 months that appear on their PERSONAL credit report:
 *   - personal cards (any issuer) count, including closed ones;
 *   - authorized-user cards count (they report on the AU's file) unless manually excluded;
 *   - business cards count only for issuers that report business cards to personal bureaus;
 *   - applications that were not approved (APPLIED/DENIED) never count.
 * An account stops counting 24 months after it was opened. When only the month is known
 * (credit reports show month granularity) it is assumed to count until the first day of the
 * 25th month after the opening month — the conservative choice.
 */

export type OpenDatePrecision = 'DAY' | 'MONTH';
export type Five24Holder = 'PRIMARY' | 'AUTHORIZED_USER';

export interface Five24Card {
  id: string;
  name: string;
  issuer: string;
  type: CardType;
  cardholder: Five24Holder;
  status: CardStatus;
  openedAt: Date | null;
  precision?: OpenDatePrecision;
  businessReportsToPersonal?: boolean;
  excludeFrom524?: boolean;
  excludeReason?: string | null;
}

export type Five24Reason =
  | 'PERSONAL'
  | 'AUTHORIZED_USER'
  | 'BUSINESS_REPORTS_TO_PERSONAL'
  | 'BUSINESS_NOT_REPORTED'
  | 'MANUAL_EXCLUSION'
  | 'OUTSIDE_WINDOW'
  | 'NO_OPEN_DATE'
  | 'NOT_OPENED'
  | 'FUTURE_DATE';

export interface Five24CardResult {
  cardId: string;
  name: string;
  issuer: string;
  counts: boolean;
  reason: Five24Reason;
  openedAt: Date | null;
  /** first instant the card no longer counts (null when it never counted for a date reason) */
  dropsOffAt: Date | null;
  note?: string | null;
}

export interface Five24Status {
  count: number;
  limit: number;
  /** "0/24" … "5/24", then "6/24+" */
  label: string;
  underLimit: boolean;
  slotsAvailable: number;
  /** when the count next decreases (null if nothing counts) */
  nextDropAt: Date | null;
  /** when the person is next under the limit (null if already under) */
  nextSlotAt: Date | null;
  contributing: Five24CardResult[];
  excluded: Five24CardResult[];
  /** cards that cannot be assessed (no open date) — the count may be understated */
  unknown: Five24CardResult[];
}

export interface Five24TimelinePoint {
  date: Date;
  count: number;
  label: string;
  cardId: string | null;
  event: 'NOW' | 'DROP';
}

export function five24Label(count: number): string {
  return count >= 6 ? '6/24+' : `${count}/24`;
}

/** The first instant at which a card opened at `openedAt` stops counting. */
export function dropOffDate(openedAt: Date, precision: OpenDatePrecision = 'DAY'): Date {
  if (precision === 'MONTH') {
    return new Date(Date.UTC(openedAt.getUTCFullYear(), openedAt.getUTCMonth() + 25, 1));
  }
  return addMonths(openedAt, 24);
}

export function evaluateCard(card: Five24Card, now: Date): Five24CardResult {
  const base = { cardId: card.id, name: card.name, issuer: card.issuer, openedAt: card.openedAt };
  const no = (reason: Five24Reason, dropsOffAt: Date | null = null, note?: string | null): Five24CardResult => ({
    ...base,
    counts: false,
    reason,
    dropsOffAt,
    ...(note !== undefined && { note }),
  });

  if (card.status === 'APPLIED' || card.status === 'DENIED') return no('NOT_OPENED');
  if (!card.openedAt) return no('NO_OPEN_DATE');
  if (card.openedAt.getTime() > now.getTime()) return no('FUTURE_DATE');

  const dropsOffAt = dropOffDate(card.openedAt, card.precision ?? 'DAY');
  let reason: Five24Reason;
  if (card.type === 'BUSINESS') {
    if (!card.businessReportsToPersonal) return no('BUSINESS_NOT_REPORTED');
    reason = 'BUSINESS_REPORTS_TO_PERSONAL';
  } else {
    reason = card.cardholder === 'AUTHORIZED_USER' ? 'AUTHORIZED_USER' : 'PERSONAL';
  }
  if (now.getTime() >= dropsOffAt.getTime()) return no('OUTSIDE_WINDOW', dropsOffAt);
  if (card.excludeFrom524) return no('MANUAL_EXCLUSION', dropsOffAt, card.excludeReason ?? null);
  return { ...base, counts: true, reason, dropsOffAt };
}

export function five24Status(cards: Five24Card[], now: Date = new Date(), limit = 5): Five24Status {
  const results = cards.map((c) => evaluateCard(c, now));
  const contributing = results
    .filter((r) => r.counts)
    .sort((a, b) => (a.dropsOffAt as Date).getTime() - (b.dropsOffAt as Date).getTime());
  const unknown = results.filter((r) => r.reason === 'NO_OPEN_DATE');
  const excluded = results.filter((r) => !r.counts && r.reason !== 'NO_OPEN_DATE');
  const count = contributing.length;
  const drops = contributing.map((r) => r.dropsOffAt as Date);
  // To get under the limit, (count - limit + 1) cards must drop off.
  const needed = count - limit + 1;
  return {
    count,
    limit,
    label: five24Label(count),
    underLimit: count < limit,
    slotsAvailable: Math.max(0, limit - count),
    nextDropAt: drops[0] ?? null,
    nextSlotAt: needed > 0 ? drops[needed - 1] : null,
    contributing,
    excluded,
    unknown,
  };
}

/**
 * Projection: the count today, then one point per drop-off within `horizonMonths` (assuming no new
 * accounts are opened). Drops on the same day are merged into one point.
 */
export function five24Timeline(cards: Five24Card[], now: Date = new Date(), horizonMonths = 24): Five24TimelinePoint[] {
  const status = five24Status(cards, now);
  const horizon = addMonths(now, horizonMonths).getTime();
  const points: Five24TimelinePoint[] = [{ date: now, count: status.count, label: status.label, cardId: null, event: 'NOW' }];
  let count = status.count;
  for (const c of status.contributing) {
    const at = c.dropsOffAt as Date;
    if (at.getTime() > horizon) break;
    count -= 1;
    const last = points[points.length - 1];
    if (last.event === 'DROP' && last.date.getTime() === at.getTime()) {
      last.count = count;
      last.label = five24Label(count);
      continue;
    }
    points.push({ date: at, count, label: five24Label(count), cardId: c.cardId, event: 'DROP' });
  }
  return points;
}
