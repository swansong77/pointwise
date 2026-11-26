import { createHash } from 'crypto';

/**
 * Snapshot diff for issuer offer inventories. A snapshot is the list of offers one issuer account shows for one
 * card at one time. Comparing two snapshots yields what is new, changed, removed, expired and enrolled, so every
 * change can be audited and notified. Pure code: no I/O.
 */
export const DIFF_VERSION = 'offer-diff/1';
/** an inventory that shrinks by more than this share is treated as a probable read failure, not a mass removal */
export const SHRINK_GUARD = 0.4;
export const SHRINK_GUARD_MIN_PREVIOUS = 5;

export type ItemStatus = 'AVAILABLE' | 'ENROLLED' | 'REDEEMED' | 'EXPIRED' | 'REMOVED';
export type OfferTypeName = 'STATEMENT_CREDIT' | 'CASHBACK_PERCENT' | 'POINTS_BONUS' | 'SPEND_GET' | 'PORTAL_RATE' | 'COUPON';

/** One offer as read from a source. `cardKey` is the wallet card id (or "") the offer is on; enrollments are never merged across cards. */
export interface InvItem {
  externalId: string;
  cardKey: string;
  merchantText: string;
  title: string;
  category?: string | null;
  offerType: OfferTypeName;
  valueCents: number;
  percent: number | null;
  points: number | null;
  minSpendCents: number | null;
  endsAt: Date | null;
  enrolled: boolean;
}

export interface StoredItem extends InvItem {
  id: string;
  status: ItemStatus;
  contentHash: string;
}

export const itemKey = (i: { cardKey: string; externalId: string }): string => `${i.cardKey}|${i.externalId}`;

/** Hash of the fields whose change matters to the member (not the enrolled flag, which is a status). */
export function contentHash(i: InvItem): string {
  const parts = [i.merchantText.trim().toLowerCase(), i.title.trim().toLowerCase(), i.offerType, i.valueCents, i.percent ?? '', i.points ?? '', i.minSpendCents ?? '', i.endsAt ? i.endsAt.toISOString().slice(0, 10) : ''];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
}

/** Order-independent hash of a whole inventory; an identical hash means nothing changed. */
export function inventoryHash(items: InvItem[]): string {
  const rows = items.map((i) => `${itemKey(i)}:${contentHash(i)}:${i.enrolled ? 1 : 0}`).sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex').slice(0, 32);
}

export interface ChangedField {
  field: 'title' | 'valueCents' | 'percent' | 'points' | 'minSpendCents' | 'endsAt' | 'merchantText' | 'offerType';
  from: unknown;
  to: unknown;
}

export interface DiffResult {
  added: InvItem[];
  updated: Array<{ stored: StoredItem; next: InvItem; changes: ChangedField[] }>;
  unchanged: StoredItem[];
  /** gone from the inventory before their end date and not enrolled */
  removed: StoredItem[];
  /** past their end date */
  expired: StoredItem[];
  /** enrolled offers that disappeared before their end date: normally an offer that was used up */
  redeemed: StoredItem[];
  /** now shown as enrolled by the issuer although we had them as available */
  newlyEnrolled: StoredItem[];
  /** offers that had been removed and are back */
  reappeared: StoredItem[];
  /** the inventory shrank so much it is probably a read failure; removals were not applied */
  suspicious: boolean;
  warnings: string[];
}

const dateStr = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

function changesBetween(a: InvItem, b: InvItem): ChangedField[] {
  const out: ChangedField[] = [];
  const pairs: Array<[ChangedField['field'], unknown, unknown]> = [
    ['title', a.title.trim(), b.title.trim()],
    ['merchantText', a.merchantText.trim(), b.merchantText.trim()],
    ['offerType', a.offerType, b.offerType],
    ['valueCents', a.valueCents, b.valueCents],
    ['percent', a.percent, b.percent],
    ['points', a.points, b.points],
    ['minSpendCents', a.minSpendCents, b.minSpendCents],
    ['endsAt', dateStr(a.endsAt), dateStr(b.endsAt)],
  ];
  for (const [field, from, to] of pairs) if (from !== to) out.push({ field, from, to });
  return out;
}

const ACTIVE: ItemStatus[] = ['AVAILABLE', 'ENROLLED'];

/**
 * Compares the stored state of one account with a new inventory. Offers already EXPIRED, REMOVED or REDEEMED that are
 * not in the inventory stay as they are. Duplicate external ids in the inventory keep the first.
 */
export function diffInventory(stored: StoredItem[], incoming: InvItem[], now: Date): DiffResult {
  const seen = new Map<string, InvItem>();
  for (const i of incoming) if (!seen.has(itemKey(i))) seen.set(itemKey(i), i);
  const prev = new Map(stored.map((s) => [itemKey(s), s]));
  const res: DiffResult = { added: [], updated: [], unchanged: [], removed: [], expired: [], redeemed: [], newlyEnrolled: [], reappeared: [], suspicious: false, warnings: [] };

  for (const [key, next] of seen) {
    const old = prev.get(key);
    if (!old) {
      if (next.endsAt && next.endsAt.getTime() <= now.getTime()) res.warnings.push(`${next.merchantText}: already ended, ignored`);
      else res.added.push(next);
      continue;
    }
    if (ACTIVE.includes(old.status) && next.endsAt && next.endsAt.getTime() <= now.getTime()) {
      // still listed but past its end date
      res.expired.push(old);
      continue;
    }
    const changes = changesBetween(old, next);
    if (old.status === 'REMOVED' || old.status === 'EXPIRED') {
      // an offer we had written off is shown again (a renewed or extended offer)
      if (!(next.endsAt && next.endsAt.getTime() <= now.getTime())) res.reappeared.push(old);
      continue;
    }
    if (old.status === 'AVAILABLE' && next.enrolled) res.newlyEnrolled.push(old);
    if (changes.length) res.updated.push({ stored: old, next, changes });
    else res.unchanged.push(old);
  }

  const activePrev = stored.filter((s) => ACTIVE.includes(s.status));
  const missing = activePrev.filter((s) => !seen.has(itemKey(s)));
  const shrank = activePrev.length >= SHRINK_GUARD_MIN_PREVIOUS && seen.size < activePrev.length * (1 - SHRINK_GUARD);
  for (const s of missing) {
    if (s.endsAt && s.endsAt.getTime() <= now.getTime()) res.expired.push(s);
    else if (shrank) continue;
    else if (s.status === 'ENROLLED') res.redeemed.push(s);
    else res.removed.push(s);
  }
  if (shrank) {
    res.suspicious = true;
    res.warnings.push(`the inventory shrank from ${activePrev.length} to ${seen.size} offers; removals were not applied`);
  }
  return res;
}
