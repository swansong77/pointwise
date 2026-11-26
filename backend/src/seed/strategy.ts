import { PrismaClient } from "@prisma/client";

/**
 * Phase D seed: issuer application rules, fictional loyalty programs and transfer partners,
 * plus balances and a spend profile for the demo family. Idempotent.
 */

/** issuers that usually deny applicants at 5/24 (fictional catalog) */
export const ENFORCES_524 = ["Northwind Bank"];

export const PRODUCT_FAMILIES: Record<string, string> = {
  "northwind-voyager": "Voyager",
  "northwind-voyager-reserve": "Voyager",
  "contoso-gold": "Contoso Charge",
  "contoso-everyday": "Contoso Everyday",
};

/** credit typically needed for approval (fictional catalog) */
export const RECOMMENDED_CREDIT: Record<
  string,
  "EXCELLENT" | "VERY_GOOD" | "GOOD" | "FAIR"
> = {
  "northwind-voyager-reserve": "EXCELLENT",
  "contoso-gold": "VERY_GOOD",
  "northwind-voyager": "GOOD",
  "contoso-skyhigh": "GOOD",
  "litware-blue-cash": "GOOD",
  "fabrikam-double": "GOOD",
  "fabrikam-flex": "FAIR",
  "tailspin-everyday-plus": "FAIR",
};

/** currency → pooling within a household, transfer increment */
export const CURRENCY_TRAVEL: Record<
  string,
  { householdPooling: boolean; transferIncrement: number }
> = {
  NW_MILES: { householdPooling: true, transferIncrement: 1000 },
  CONTOSO_PTS: { householdPooling: false, transferIncrement: 1000 },
  FABRIKAM_PTS: { householdPooling: false, transferIncrement: 1000 },
  TAILSPIN_STARS: { householdPooling: false, transferIncrement: 500 },
};

export const PROGRAMS: Array<{
  code: string;
  name: string;
  kind: "AIRLINE" | "HOTEL";
  cpp: number;
  pooling?: boolean;
}> = [
  {
    code: "SKYHIGH",
    name: "SkyHigh Airlines Miles",
    kind: "AIRLINE",
    cpp: 1.4,
  },
  { code: "AEROLINK", name: "AeroLink Rewards", kind: "AIRLINE", cpp: 1.3 },
  { code: "BLUEWING", name: "BlueWing Club", kind: "AIRLINE", cpp: 1.2 },
  {
    code: "STAYWELL",
    name: "StayWell Points",
    kind: "HOTEL",
    cpp: 0.7,
    pooling: true,
  },
  { code: "HARBOR", name: "Harbor Hotels Club", kind: "HOTEL", cpp: 0.8 },
];

const DAY = 86_400_000;

/** [currency, program, ratioFrom, ratioTo, transferDays, bonus % (and days until it ends)] */
export const PARTNERS: Array<
  [string, string, number, number, number, number?, number?]
> = [
  ["NW_MILES", "SKYHIGH", 1, 1, 0],
  ["NW_MILES", "BLUEWING", 1, 1, 1],
  ["NW_MILES", "STAYWELL", 1, 1, 0],
  ["CONTOSO_PTS", "SKYHIGH", 1, 1, 2],
  ["CONTOSO_PTS", "AEROLINK", 1, 1, 0, 30, 45],
  ["CONTOSO_PTS", "HARBOR", 1, 2, 1],
  ["FABRIKAM_PTS", "AEROLINK", 1, 1, 0],
  ["TAILSPIN_STARS", "HARBOR", 2, 1, 3],
];

export async function seedStrategyCatalog(
  prisma: PrismaClient,
  now = new Date(),
) {
  await prisma.issuer.updateMany({
    where: { name: { in: ENFORCES_524 } },
    data: { enforcesFive24: true },
  });
  for (const [slug, productFamily] of Object.entries(PRODUCT_FAMILIES))
    await prisma.creditCard.updateMany({
      where: { slug },
      data: { productFamily },
    });
  for (const [slug, recommendedCredit] of Object.entries(RECOMMENDED_CREDIT))
    await prisma.creditCard.updateMany({
      where: { slug, recommendedCredit: null },
      data: { recommendedCredit },
    });
  for (const [code, data] of Object.entries(CURRENCY_TRAVEL))
    await prisma.rewardCurrency.updateMany({ where: { code }, data });
  const programIds: Record<string, string> = {};
  for (const p of PROGRAMS) {
    const data = {
      name: p.name,
      kind: p.kind,
      centsPerPoint: p.cpp,
      householdPooling: !!p.pooling,
    };
    programIds[p.code] = (
      await prisma.loyaltyProgram.upsert({
        where: { code: p.code },
        update: data,
        create: { code: p.code, ...data },
      })
    ).id;
  }
  for (const [
    cur,
    prog,
    ratioFrom,
    ratioTo,
    transferDays,
    bonusPercent = 0,
    bonusDays,
  ] of PARTNERS) {
    const currency = await prisma.rewardCurrency.findUnique({
      where: { code: cur },
    });
    if (!currency) continue;
    const data = {
      ratioFrom,
      ratioTo,
      transferDays,
      bonusPercent,
      bonusEndsAt: bonusDays ? new Date(now.getTime() + bonusDays * DAY) : null,
    };
    await prisma.transferPartner.upsert({
      where: {
        currencyId_programId: {
          currencyId: currency.id,
          programId: programIds[prog],
        },
      },
      update: {},
      create: { currencyId: currency.id, programId: programIds[prog], ...data },
    });
  }
}

/** Balances per member and a spend profile for the demo family (only when none exist yet). */
export async function seedFamilyStrategy(prisma: PrismaClient, userId: string) {
  const members = await prisma.profile.findMany({ where: { userId } });
  const by = (n: string) => members.find((m) => m.nickname === n);
  const jordan = by("Jordan");
  const riley = by("Riley");
  if (!jordan || !riley) return;
  // self-reported bands (only set once, so a user's own change is kept)
  await prisma.profile.updateMany({
    where: { id: jordan.id, creditBand: null },
    data: { creditBand: "EXCELLENT" },
  });
  await prisma.profile.updateMany({
    where: { id: riley.id, creditBand: null },
    data: { creditBand: "GOOD" },
  });
  if ((await prisma.loyaltyBalance.count({ where: { userId } })) === 0) {
    const cur = async (code: string) =>
      (await prisma.rewardCurrency.findUniqueOrThrow({ where: { code } })).id;
    const prog = async (code: string) =>
      (await prisma.loyaltyProgram.findUniqueOrThrow({ where: { code } })).id;
    const rows = [
      {
        profileId: jordan.id,
        currencyId: await cur("NW_MILES"),
        points: 64_000,
      },
      {
        profileId: jordan.id,
        currencyId: await cur("CONTOSO_PTS"),
        points: 85_000,
      },
      {
        profileId: jordan.id,
        programId: await prog("SKYHIGH"),
        points: 12_500,
      },
      {
        profileId: riley.id,
        currencyId: await cur("NW_MILES"),
        points: 41_000,
      },
      {
        profileId: riley.id,
        programId: await prog("STAYWELL"),
        points: 18_000,
      },
    ];
    for (const r of rows)
      await prisma.loyaltyBalance.create({ data: { userId, ...r } });
  }
  if ((await prisma.spendProfileEntry.count({ where: { userId } })) === 0) {
    const spend: Record<string, number> = {
      groceries: 900_00,
      dining: 650_00,
      gas: 250_00,
      travel: 400_00,
      airlines: 150_00,
      "online-shopping": 350_00,
      "everything-else": 1500_00,
    };
    for (const [slug, monthlyCents] of Object.entries(spend)) {
      const c = await prisma.category.findUnique({ where: { slug } });
      if (c)
        await prisma.spendProfileEntry.create({
          data: { userId, categoryId: c.id, monthlyCents },
        });
    }
  }
}

/** Programs and currencies that exist only in the fictional demo catalog. */
export const FICTIONAL_PROGRAM_CODES = PROGRAMS.map((p) => p.code);
export const FICTIONAL_CURRENCY_CODES = Object.keys(CURRENCY_TRAVEL);

/**
 * Removes the invented airline/hotel programs, the transfer routes into them and every route or
 * balance that hangs off an invented currency. Real programs and real bank routes are untouched;
 * the fictional demo cards keep their currencies (they are retired, not deleted). Idempotent.
 */
export async function purgeFictionalTravelData(prisma: PrismaClient) {
  const currencies = await prisma.rewardCurrency.findMany({ where: { code: { in: FICTIONAL_CURRENCY_CODES } }, select: { id: true } });
  const currencyIds = currencies.map((c) => c.id);
  const programs = await prisma.loyaltyProgram.findMany({ where: { code: { in: FICTIONAL_PROGRAM_CODES } }, select: { id: true } });
  const programIds = programs.map((p) => p.id);
  const routes = await prisma.transferPartner.deleteMany({ where: { OR: [{ currencyId: { in: currencyIds } }, { programId: { in: programIds } }] } });
  const bonuses = await prisma.transferBonusRecord.deleteMany({ where: { OR: [{ currencyId: { in: currencyIds } }, { programId: { in: programIds } }] } });
  const balances = await prisma.loyaltyBalance.deleteMany({ where: { OR: [{ currencyId: { in: currencyIds } }, { programId: { in: programIds } }] } });
  const accounts = await prisma.loyaltyAccount.deleteMany({ where: { programId: { in: programIds } } });
  const certs = await prisma.loyaltyCertificate.deleteMany({ where: { programId: { in: programIds } } });
  const elite = await prisma.eliteStatus.deleteMany({ where: { programId: { in: programIds } } });
  const progs = await prisma.loyaltyProgram.deleteMany({ where: { id: { in: programIds } } });
  return { routes: routes.count, bonuses: bonuses.count, balances: balances.count, accounts: accounts.count, certificates: certs.count, elite: elite.count, programs: progs.count };
}
