/* eslint-disable no-console */
/**
 * Applies issuer listings (verified-listings.ts) to the catalog — no network, no AI:
 * - curated SEED cards on a listing: name, type, network and annual fee from the issuer, product page
 *   registered as a source (the free refresh engine re-checks it daily), lastVerifiedAt = listing date,
 *   verifiedScope ISSUER_LISTING; rewards replaced only when the listing states them;
 * - cards the listing adds: created as SEED cards with what the listing states;
 * - curated cards a complete listing no longer shows: marked closed to new applicants and hidden from
 *   the catalog (kept for wallets that hold them).
 * Cards an admin edited or research created (catalogSource ADMIN / RESEARCH) are never changed.
 */
import { PrismaClient } from "@prisma/client";
import { validateSourceUrl } from "../catalog-refresh/fetcher";
import {
  LISTING_CURRENCIES,
  listingSlug,
  VERIFIED_LISTINGS,
} from "./verified-listings";

export interface ListingResult {
  confirmed: number;
  added: number;
  discontinued: number;
  sources: number;
  skippedEdited: number;
}

export async function applyVerifiedListings(
  prisma: PrismaClient,
): Promise<ListingResult> {
  const out: ListingResult = {
    confirmed: 0,
    added: 0,
    discontinued: 0,
    sources: 0,
    skippedEdited: 0,
  };
  for (const c of LISTING_CURRENCIES) {
    await prisma.rewardCurrency.upsert({
      where: { code: c.code },
      update: {},
      create: { code: c.code, name: c.name, centsPerPoint: c.centsPerPoint },
    });
  }
  const categories = Object.fromEntries(
    (await prisma.category.findMany({ select: { id: true, slug: true } })).map(
      (c) => [c.slug, c.id],
    ),
  );
  const currencies = Object.fromEntries(
    (
      await prisma.rewardCurrency.findMany({ select: { id: true, code: true } })
    ).map((c) => [c.code, c.id]),
  );

  const addSource = async (cardId: string, url: string | null) => {
    if (!url) return;
    try {
      validateSourceUrl(url);
    } catch {
      return; // not an allow-listed issuer page in this deployment
    }
    const exists = await prisma.cardDataSource.findFirst({
      where: { cardId, url },
    });
    if (!exists) {
      await prisma.cardDataSource.create({ data: { cardId, url } });
      out.sources++;
    }
  };
  const replaceRewards = async (
    cardId: string,
    rewards: NonNullable<
      (typeof VERIFIED_LISTINGS)[number]["cards"][number]["rewards"]
    >,
  ) => {
    await prisma.reward.deleteMany({ where: { cardId } });
    const rows = rewards
      .filter(([cat]) => categories[cat])
      .map(([cat, rate, description, cap, period]) => ({
        cardId,
        categoryId: categories[cat],
        multiplier: rate,
        description,
        capCents: cap ? cap * 100 : null,
        capPeriod: cap ? (period ?? "YEAR") : null,
      }));
    if (rows.length) await prisma.reward.createMany({ data: rows });
  };

  for (const listing of VERIFIED_LISTINGS) {
    const issuer = await prisma.issuer.findUnique({
      where: { name: listing.issuer },
    });
    if (!issuer) continue; // registry import runs first
    const at = new Date(`${listing.fetchedOn}T00:00:00Z`);
    const seen = new Set<string>();
    for (const l of listing.cards) {
      const slug = listingSlug(listing.issuer, l);
      seen.add(slug);
      const existing = await prisma.creditCard.findUnique({ where: { slug } });
      if (existing && existing.catalogSource !== "SEED") {
        out.skippedEdited++;
        await addSource(existing.id, l.url);
        continue;
      }
      const facts = {
        name: l.name,
        type: l.type,
        annualFeeCents: Math.round(l.feeDollars * 100),
        ...(l.network && { network: l.network }),
        ...(l.foreignTxFee !== undefined && { foreignTxFee: l.foreignTxFee }),
        lastVerifiedAt: at,
        verifiedScope: "ISSUER_LISTING",
        dataAsOf: at,
        productStatus: "OPEN" as const,
        isActive: true,
        ...(l.url && { applyUrl: l.url }),
      };
      if (existing) {
        await prisma.creditCard.update({
          where: { id: existing.id },
          data: facts,
        });
        if (l.rewards?.length) await replaceRewards(existing.id, l.rewards);
        await addSource(existing.id, l.url);
        out.confirmed++;
        continue;
      }
      const card = await prisma.creditCard.create({
        data: {
          slug,
          ...facts,
          network: l.network ?? "OTHER",
          issuerId: issuer.id,
          currencyId: currencies[l.currency ?? "CASH"] ?? currencies.CASH,
          foreignTxFee:
            l.foreignTxFee ??
            !(l.features ?? []).some((f) =>
              /no foreign transaction fee/i.test(f),
            ),
          catalogSource: "SEED",
          popularity: 5,
          color: "#475569",
        },
      });
      if (l.rewards?.length) await replaceRewards(card.id, l.rewards);
      const features = [...(l.features ?? []), `Issuer listing: ${l.earning}`];
      await prisma.cardFeature.createMany({
        data: features.map((text, i) => ({
          cardId: card.id,
          text: text.slice(0, 200),
          sortOrder: i,
        })),
      });
      await addSource(card.id, l.url);
      out.added++;
    }
    for (const [slug, url] of listing.pagesOnly ?? []) {
      seen.add(slug);
      const card = await prisma.creditCard.findUnique({ where: { slug } });
      if (card) await addSource(card.id, url);
    }
    for (const slug of listing.discontinued ?? []) {
      const r = await prisma.creditCard.updateMany({
        where: { slug, catalogSource: "SEED" },
        data: {
          productStatus: "CLOSED_TO_NEW",
          isActive: false,
          lastVerifiedAt: at,
          verifiedScope: "ISSUER_LISTING",
        },
      });
      out.discontinued += r.count;
    }
  }
  return out;
}
