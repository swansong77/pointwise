/* eslint-disable no-console */
/**
 * Imports the curated real-card list (real-catalog.data.ts). Idempotent:
 * - issuers, currencies and merchants are created if missing (existing rows keep admin edits);
 * - a card is created if missing; an existing card is refreshed only while it is still an
 *   unverified SEED entry — cards that an admin edited, research created, or a source verified are
 *   never overwritten;
 * - nothing is deleted. `--retire-demo` hides the fictional demo cards from the catalog (isActive=false).
 *
 *   npm run catalog:import                 # import / refresh the real-card list
 *   npm run catalog:import -- --retire-demo
 */
import { PrismaClient } from "@prisma/client";
import { CATEGORIES, CATEGORY_PARENTS } from "./categories";
import { applyVerifiedListings, ListingResult } from "./verified-listings.apply";
import { applyRateVerifications, RateVerificationResult } from "./rate-verification.apply";
import { applyRotating, RotatingResult } from "./rotating.apply";
import { applyRewardExclusions } from "./reward-exclusions.apply";
import { ROTATING_CALENDAR } from "./rotating-calendar";
import {
  DATA_AS_OF,
  ISSUER_REGISTRY,
  REAL_CARDS,
  REAL_CURRENCIES,
  REAL_MERCHANTS,
} from "./real-catalog.data";

export interface ImportResult {
  issuers: number;
  currencies: number;
  merchants: number;
  created: number;
  refreshed: number;
  skipped: number;
  retiredDemo: number;
  listings: ListingResult | null;
  rates: RateVerificationResult | null;
  rotating: RotatingResult | null;
  exclusions: { grocery: number; updated: number } | null;
}

export async function importRealCatalog(
  prisma: PrismaClient,
  opts: { retireDemo?: boolean } = {},
): Promise<ImportResult> {
  const out: ImportResult = {
    issuers: 0,
    currencies: 0,
    merchants: 0,
    created: 0,
    refreshed: 0,
    skipped: 0,
    retiredDemo: 0,
    listings: null,
    rates: null,
    rotating: null,
    exclusions: null,
  };
  const asOf = new Date(`${DATA_AS_OF}T00:00:00Z`);

  const categoryIds: Record<string, string> = {};
  for (const [i, [slug, name, icon, fallback]] of CATEGORIES.entries()) {
    const c = await prisma.category.upsert({
      where: { slug },
      update: {},
      create: { slug, name, icon, sortOrder: i, isFallback: !!fallback },
    });
    categoryIds[slug] = c.id;
  }
  // sub-categories (travel family): fill in the parent where it is missing, leave admin changes alone
  for (const [child, parent] of Object.entries(CATEGORY_PARENTS)) await prisma.category.updateMany({ where: { slug: child, parentId: null }, data: { parentId: categoryIds[parent] } });

  const issuerIds: Record<string, string> = {};
  for (const i of ISSUER_REGISTRY) {
    const existing = await prisma.issuer.findUnique({
      where: { name: i.name },
    });
    const row = existing
      ? // keep admin edits; fill in what the registry knows and the row is missing
        await prisma.issuer.update({
          where: { id: existing.id },
          data: {
            ...(!existing.website && { website: i.website }),
            ...(existing.kind === "BANK" &&
              i.kind &&
              i.kind !== "BANK" && { kind: i.kind }),
            ...(!existing.aliases.length && { aliases: i.aliases }),
          },
        })
      : await prisma.issuer.create({
          data: {
            name: i.name,
            website: i.website,
            aliases: i.aliases,
            kind: i.kind ?? "BANK",
            enforcesFive24: !!i.enforcesFive24,
            businessReportsToPersonal: !!i.businessReportsToPersonal,
            countryCode: "US",
          },
        });
    if (!existing) out.issuers++;
    issuerIds[i.name] = row.id;
  }

  const currencyIds: Record<string, string> = {};
  const cash = await prisma.rewardCurrency.upsert({
    where: { code: "CASH" },
    update: {},
    create: { code: "CASH", name: "Cash back", centsPerPoint: 1, isCash: true },
  });
  currencyIds.CASH = cash.id;
  for (const c of REAL_CURRENCIES) {
    const existing = await prisma.rewardCurrency.findUnique({
      where: { code: c.code },
    });
    const row =
      existing ??
      (await prisma.rewardCurrency.create({
        data: {
          code: c.code,
          name: c.name,
          centsPerPoint: c.centsPerPoint,
          householdPooling: !!c.householdPooling,
        },
      }));
    if (!existing) out.currencies++;
    currencyIds[c.code] = row.id;
  }

  const merchantIds: Record<string, string> = {};
  for (const m of REAL_MERCHANTS) {
    const existing = await prisma.merchant.findUnique({
      where: { slug: m.slug },
    });
    const row =
      existing ??
      (await prisma.merchant.create({
        data: {
          slug: m.slug,
          name: m.name,
          categoryId: categoryIds[m.category],
          hosts: m.hosts,
          isPopular: true,
        },
      }));
    if (!existing) out.merchants++;
    merchantIds[m.slug] = row.id;
  }

  for (const c of REAL_CARDS) {
    const existing = await prisma.creditCard.findUnique({
      where: { slug: c.slug },
      select: { id: true, catalogSource: true, lastVerifiedAt: true },
    });
    if (
      existing &&
      (existing.catalogSource !== "SEED" || existing.lastVerifiedAt)
    ) {
      out.skipped++;
      continue;
    }
    const data = {
      name: c.name,
      issuerId: issuerIds[c.issuer],
      network: c.network,
      type: c.type ?? "PERSONAL",
      annualFeeCents: Math.round(c.feeDollars * 100),
      foreignTxFee: c.foreignTxFee,
      currencyId: currencyIds[c.currency],
      color: c.color,
      productFamily: c.productFamily ?? null,
      recommendedCredit: c.recommendedCredit ?? null,
      popularity: c.popularity,
      catalogSource: "SEED" as const,
      dataAsOf: asOf,
      isActive: true,
    };
    const card = existing
      ? await prisma.creditCard.update({ where: { id: existing.id }, data })
      : await prisma.creditCard.create({ data: { slug: c.slug, ...data } });
    if (existing) out.refreshed++;
    else out.created++;
    await prisma.$transaction([
      prisma.reward.deleteMany({ where: { cardId: card.id } }),
      prisma.cardFeature.deleteMany({ where: { cardId: card.id } }),
      prisma.reward.createMany({
        data: [
          ...c.rewards.map(([cat, rate, description, cap, period]) => ({
            cardId: card.id,
            categoryId: categoryIds[cat],
            multiplier: rate,
            description,
            capCents: cap ? cap * 100 : null,
            capPeriod: cap ? (period ?? "YEAR") : null,
          })),
          ...(c.merchantRewards ?? []).map(([merchant, rate, description]) => ({
            cardId: card.id,
            merchantId: merchantIds[merchant],
            multiplier: rate,
            description,
          })),
        ],
      }),
      prisma.cardFeature.createMany({
        data: c.features.map((text, i) => ({
          cardId: card.id,
          text,
          sortOrder: i,
        })),
      }),
    ]);
  }

  // issuer listings read from the issuers' own websites correct and extend the curated list
  out.listings = await applyVerifiedListings(prisma);
  // rates confirmed against issuer product pages (and conditional/portal-only flags) go on top of the curated list and the listings
  out.rates = await applyRateVerifications(prisma);
  out.rotating = await applyRotating(prisma, ROTATING_CALENDAR);
  out.exclusions = await applyRewardExclusions(prisma);
  if (opts.retireDemo)
    out.retiredDemo = (
      await prisma.creditCard.updateMany({
        where: { catalogSource: "DEMO", isActive: true },
        data: { isActive: false },
      })
    ).count;
  return out;
}

if (require.main === module) {
  const prisma = new PrismaClient();
  importRealCatalog(prisma, {
    retireDemo: process.argv.includes("--retire-demo"),
  })
    .then((r) => console.log("real catalog import", JSON.stringify(r)))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
