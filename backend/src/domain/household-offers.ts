/**
 * How the household's offers line up across members (pure): each member's live offers and value, offers that sit on several cards,
 * and for each merchant who holds the best offer and who has none. Reads inventory rows; invents nothing.
 */
import { daysLeft, InventoryRow, LIVE_STATES } from './offer-lifecycle';

export const HOUSEHOLD_OFFERS_VERSION = 'household-offers/1';

export interface MemberRef {
  id: string;
  nickname: string;
  isPrimary: boolean;
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
  top: Array<{ merchant: string; title: string; expectedCents: number; endsAt: Date | null }>;
}

export interface OfferHolder {
  member: string | null;
  profileId: string | null;
  card: string | null;
  walletCardId: string | null;
  expectedCents: number;
  state: string;
  endsAt: Date | null;
}

export interface OfferOverlap {
  merchant: string;
  valueCents: number;
  percent: number | null;
  minSpendCents: number | null;
  holders: OfferHolder[];
  advice: string;
}

export interface MerchantRouting {
  merchant: string;
  merchantId: string | null;
  merchantSlug: string | null;
  holders: OfferHolder[];
  best: OfferHolder;
  membersWithout: string[];
  advice: string;
}

export interface HouseholdOffers {
  members: MemberOffers[];
  overlaps: OfferOverlap[];
  routing: MerchantRouting[];
  totals: { liveOffers: number; expectedCents: number };
}

const usd = (c: number) => `$${(c / 100).toFixed(2).replace('.00', '')}`;
const live = (r: InventoryRow) => LIVE_STATES.includes(r.state) && !!r.walletCardId;

const holderOf = (r: InventoryRow): OfferHolder => ({ member: r.cardholder, profileId: r.profileId, card: r.card, walletCardId: r.walletCardId, expectedCents: r.expectedSavingsCents, state: r.state, endsAt: r.endsAt });

export function householdOffers(rows: InventoryRow[], members: MemberRef[], now: Date): HouseholdOffers {
  const liveRows = rows.filter(live);
  const out: MemberOffers[] = members.map((m) => {
    const mine = liveRows.filter((r) => r.profileId === m.id);
    const cardIds = new Set(rows.filter((r) => r.profileId === m.id && r.walletCardId).map((r) => r.walletCardId));
    return {
      profileId: m.id,
      member: m.nickname,
      isPrimary: m.isPrimary,
      cards: cardIds.size,
      liveOffers: mine.length,
      expectedCents: mine.reduce((s, r) => s + r.expectedSavingsCents, 0),
      expiringSoon: mine.filter((r) => {
        const d = daysLeft(r.endsAt, now);
        return d != null && d >= 0 && d <= 30;
      }).length,
      receivedCents: rows.filter((r) => r.profileId === m.id).reduce((s, r) => s + r.actualSavingsCents, 0),
      top: [...mine]
        .sort((a, b) => b.expectedSavingsCents - a.expectedSavingsCents || a.id.localeCompare(b.id))
        .slice(0, 3)
        .map((r) => ({ merchant: r.merchant?.name ?? r.merchantText, title: r.title, expectedCents: r.expectedSavingsCents, endsAt: r.endsAt })),
    };
  });

  // the same offer (merchant and terms) on more than one card
  const sig = (r: InventoryRow) => `${r.merchant?.id ?? r.merchantText.toLowerCase()}|${r.valueCents}|${r.percent ?? ''}|${r.minSpendCents ?? ''}`;
  const groups = new Map<string, InventoryRow[]>();
  for (const r of liveRows) groups.set(sig(r), [...(groups.get(sig(r)) ?? []), r]);
  const overlaps: OfferOverlap[] = [...groups.values()]
    .filter((g) => new Set(g.map((r) => r.walletCardId)).size > 1)
    .map((g) => {
      const first = g[0];
      const who = [...new Set(g.map((r) => r.cardholder ?? 'You'))];
      const merchant = first.merchant?.name ?? first.merchantText;
      return {
        merchant,
        valueCents: first.valueCents,
        percent: first.percent,
        minSpendCents: first.minSpendCents,
        holders: g.map(holderOf).sort((a, b) => b.expectedCents - a.expectedCents),
        advice: `The same ${merchant} offer is on ${g.length} cards (${who.join(', ')}). Each card can use it once: ${first.minSpendCents ? `put ${usd(first.minSpendCents)} on each, ` : ''}or send a larger purchase to the card that earns the most.`,
      };
    })
    .sort((a, b) => b.holders.length - a.holders.length || a.merchant.localeCompare(b.merchant));

  // per merchant: who holds the best offer and who has none
  const byMerchant = new Map<string, InventoryRow[]>();
  for (const r of liveRows) byMerchant.set(r.merchant?.id ?? r.merchantText.toLowerCase(), [...(byMerchant.get(r.merchant?.id ?? r.merchantText.toLowerCase()) ?? []), r]);
  const routing: MerchantRouting[] = [...byMerchant.values()].map((g) => {
    const holders = g.map(holderOf).sort((a, b) => b.expectedCents - a.expectedCents || String(a.walletCardId).localeCompare(String(b.walletCardId)));
    const best = holders[0];
    const holderIds = new Set(holders.map((h) => h.profileId));
    const without = members.filter((m) => !holderIds.has(m.id)).map((m) => m.nickname);
    const merchant = g[0].merchant?.name ?? g[0].merchantText;
    return {
      merchant,
      merchantId: g[0].merchant?.id ?? null,
      merchantSlug: g[0].merchant?.slug ?? null,
      holders,
      best,
      membersWithout: without,
      advice: `${best.member ?? 'You'} should pay at ${merchant}: ${best.card ?? 'their card'} holds the best offer (${usd(best.expectedCents)} expected).${without.length ? ` ${without.join(' and ')} ${without.length > 1 ? 'have' : 'has'} no offer there.` : ''}`,
    };
  });
  routing.sort((a, b) => b.best.expectedCents - a.best.expectedCents || a.merchant.localeCompare(b.merchant));

  return { members: out, overlaps, routing, totals: { liveOffers: liveRows.length, expectedCents: liveRows.reduce((s, r) => s + r.expectedSavingsCents, 0) } };
}
