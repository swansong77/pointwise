/* eslint-disable no-console */
/**
 * Seed data for the portfolio & benefits features (FICTIONAL catalog — invented products/issuers).
 *   - benefit categories and catalog benefit templates for the demo cards
 *   - issuer 5/24 metadata
 *   - a "family" demo account with a 3-person household, AU cards, a closed card, a business card,
 *     tracked benefits with usage and a year of transactions
 */
import {
  BenefitKind,
  BenefitPeriod,
  BonusType,
  PeriodBasis,
  PrismaClient,
} from "@prisma/client";
import { periodContaining } from "../domain/benefits";

const DAY = 86_400_000;

export const BENEFIT_CATEGORIES: Array<[slug: string, name: string]> = [
  ["airline", "Airline credits"],
  ["hotel", "Hotel credits"],
  ["dining", "Dining credits"],
  ["rideshare", "Rideshare credits"],
  ["trusted-traveler", "TSA PreCheck / Global Entry"],
  ["clear", "CLEAR"],
  ["lounge", "Lounge access"],
  ["free-night", "Free night certificates"],
  ["entertainment", "Streaming & entertainment"],
  ["membership", "Memberships"],
  ["shopping", "Shopping credits"],
  ["other", "Other"],
];

interface TemplateSeed {
  card: string;
  name: string;
  cat: string;
  kind?: BenefitKind;
  period: BenefitPeriod;
  months?: number;
  basis?: PeriodBasis;
  amount: number; // dollars per period
  how?: string;
  action?: string;
}

export const BENEFIT_TEMPLATES: TemplateSeed[] = [
  {
    card: "northwind-voyager-reserve",
    name: "Annual travel credit",
    cat: "airline",
    period: "ANNUAL",
    basis: "CARDMEMBER_YEAR",
    amount: 300,
    how: "Statement credit on any travel purchase",
  },
  {
    card: "northwind-voyager-reserve",
    name: "Global Entry / TSA PreCheck credit",
    cat: "trusted-traveler",
    period: "MULTI_YEAR",
    months: 48,
    basis: "CARDMEMBER_YEAR",
    amount: 120,
    how: "Statement credit for the application fee",
  },
  {
    card: "northwind-voyager-reserve",
    name: "Dining credit",
    cat: "dining",
    period: "MONTHLY",
    amount: 10,
    how: "$10 per month at partner restaurants",
    action: "Enroll",
  },
  {
    card: "northwind-voyager-reserve",
    name: "Airport lounge access",
    cat: "lounge",
    kind: "ACCESS",
    period: "ANNUAL",
    amount: 0,
    how: "Lounge membership for the cardholder",
  },
  {
    card: "contoso-gold",
    name: "Dining credit",
    cat: "dining",
    period: "MONTHLY",
    amount: 10,
    how: "$10 per month at partner restaurants",
    action: "Enroll",
  },
  {
    card: "contoso-gold",
    name: "Rideshare credit",
    cat: "rideshare",
    period: "MONTHLY",
    amount: 10,
    how: "$10 per month in rideshare cash",
  },
  {
    card: "contoso-skyhigh",
    name: "Airline incidental credit",
    cat: "airline",
    period: "ANNUAL",
    amount: 100,
    how: "Bag fees and seat upgrades with SkyHigh Airlines",
  },
  {
    card: "contoso-skyhigh",
    name: "Companion certificate",
    cat: "free-night",
    kind: "CERTIFICATE",
    period: "ANNUAL",
    basis: "CARDMEMBER_YEAR",
    amount: 0,
    how: "Issued each card anniversary",
  },
  {
    card: "litware-blue-cash",
    name: "Streaming credit",
    cat: "entertainment",
    period: "MONTHLY",
    amount: 7,
    how: "$7 per month on eligible streaming",
  },
  {
    card: "northwind-voyager",
    name: "Hotel credit",
    cat: "hotel",
    period: "ANNUAL",
    basis: "CARDMEMBER_YEAR",
    amount: 50,
    how: "Hotels booked through the Northwind travel portal",
  },
  {
    card: "contoso-skyhigh",
    name: "Clear membership credit",
    cat: "clear",
    period: "ANNUAL",
    amount: 50,
    how: "Statement credit for a CLEAR membership",
  },
];

/** Issuers whose business cards report to personal bureaus (fictional analogue of the real-world rule). */
export const ISSUER_524: Record<
  string,
  { businessReportsToPersonal: boolean; aliases: string[] }
> = {
  "Northwind Bank": {
    businessReportsToPersonal: false,
    aliases: ["Northwind", "NW Bank"],
  },
  "Contoso Financial": {
    businessReportsToPersonal: false,
    aliases: ["Contoso"],
  },
  "Fabrikam Card Services": {
    businessReportsToPersonal: false,
    aliases: ["Fabrikam"],
  },
  "Tailspin Credit Union": {
    businessReportsToPersonal: false,
    aliases: ["Tailspin", "TCU"],
  },
  "Litware Bank": { businessReportsToPersonal: true, aliases: ["Litware"] },
};

export async function seedPortfolioCatalog(
  prisma: PrismaClient,
  cardIds: Record<string, string>,
) {
  const catIds: Record<string, string> = {};
  for (const [i, [slug, name]] of BENEFIT_CATEGORIES.entries()) {
    const c = await prisma.benefitCategory.upsert({
      where: { slug },
      update: { name, sortOrder: i },
      create: { slug, name, sortOrder: i },
    });
    catIds[slug] = c.id;
  }
  for (const [name, meta] of Object.entries(ISSUER_524)) {
    await prisma.issuer.updateMany({ where: { name }, data: meta });
  }
  for (const t of BENEFIT_TEMPLATES) {
    const cardId = cardIds[t.card];
    if (!cardId) continue;
    const data = {
      categoryId: catIds[t.cat],
      kind: t.kind ?? "CREDIT",
      period: t.period,
      periodMonths:
        t.months ??
        { MONTHLY: 1, QUARTERLY: 3, SEMIANNUAL: 6, ANNUAL: 12, MULTI_YEAR: 48, ONE_TIME: 12, CUSTOM: 12 }[
          t.period
        ],
      basis: t.basis ?? "CALENDAR",
      amountPerPeriodCents: t.amount * 100,
      howIssued: t.how ?? null,
      actionNeeded: t.action ?? null,
    } as const;
    await prisma.benefit.upsert({
      where: { cardId_name: { cardId, name: t.name } },
      update: data,
      create: { cardId, name: t.name, ...data },
    });
  }
  return catIds;
}

async function copyTemplates(
  prisma: PrismaClient,
  walletCardId: string,
  cardId: string,
) {
  const templates = await prisma.benefit.findMany({
    where: { cardId, isActive: true },
  });
  await prisma.userBenefit.createMany({
    data: templates.map((t) => ({
      walletCardId,
      benefitId: t.id,
      name: t.name,
      kind: t.kind,
      period: t.period,
      periodMonths: t.periodMonths,
      basis: t.basis,
      amountPerPeriodCents: t.amountPerPeriodCents,
      categoryId: t.categoryId,
      howIssued: t.howIssued,
      actionNeeded: t.actionNeeded,
    })),
    skipDuplicates: true,
  });
}

/** Existing demo account: household SELF member + tracked benefits on its cards (no new cards). */
export async function seedDemoBenefits(prisma: PrismaClient, userId: string) {
  const hh = await prisma.household.upsert({
    where: { ownerId: userId },
    update: {},
    create: { ownerId: userId, name: "Optimizer household" },
  });
  await prisma.profile.updateMany({
    where: { userId },
    data: { householdId: hh.id },
  });
  await prisma.profile.updateMany({
    where: { userId, isPrimary: true },
    data: { relationship: "SELF" },
  });
  const cards = await prisma.walletCard.findMany({
    where: { wallet: { userId } },
  });
  for (const wc of cards) await copyTemplates(prisma, wc.id, wc.cardId);
}

/** A complete household portfolio for exploring the portfolio, benefits, 5/24 and household pages. */
export async function seedFamily(
  prisma: PrismaClient,
  ctx: { cardIds: Record<string, string>; categoryIds: Record<string, string> },
  user: { id: string },
  now = new Date(),
) {
  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { userId: user.id },
  });
  if ((await prisma.walletCard.count({ where: { walletId: wallet.id } })) > 0)
    return;
  const ago = (d: number) => new Date(now.getTime() - d * DAY);

  const hh = await prisma.household.upsert({
    where: { ownerId: user.id },
    update: {},
    create: { ownerId: user.id, name: "The Rivera household" },
  });
  await prisma.profile.updateMany({
    where: { userId: user.id, isPrimary: true },
    data: {
      householdId: hh.id,
      relationship: "SELF",
      nickname: "Jordan",
      sortOrder: -1,
    },
  });
  const self = await prisma.profile.findFirstOrThrow({
    where: { userId: user.id, isPrimary: true },
  });
  const spouse = await prisma.profile.create({
    data: {
      userId: user.id,
      householdId: hh.id,
      nickname: "Riley",
      relationship: "SPOUSE",
      sortOrder: 1,
    },
  });
  const child = await prisma.profile.create({
    data: {
      userId: user.id,
      householdId: hh.id,
      nickname: "Sam",
      relationship: "CHILD",
      birthYear: now.getUTCFullYear() - 16,
      sortOrder: 2,
    },
  });

  let order = 0;
  const add = async (
    slug: string,
    profileId: string,
    openedDaysAgo: number,
    extra: Record<string, unknown> = {},
  ) => {
    const wc = await prisma.walletCard.create({
      data: {
        walletId: wallet.id,
        cardId: ctx.cardIds[slug],
        profileId,
        status: "APPROVED",
        approvedAt: ago(openedDaysAgo),
        sortOrder: order++,
        ...extra,
      },
    });
    if (extra.cardholder !== "AUTHORIZED_USER")
      await copyTemplates(prisma, wc.id, wc.cardId);
    return wc;
  };
  const reserve = await add("northwind-voyager-reserve", self.id, 300, {
    lastFour: "7001",
    creditLimitCents: 25_000_00,
  });
  const gold = await add("contoso-gold", self.id, 400, {
    lastFour: "31005",
    creditLimitCents: 15_000_00,
  });
  const dbl = await add("fabrikam-double", self.id, 100, { lastFour: "7002" });
  const sky = await add("contoso-skyhigh", self.id, 600, { lastFour: "31009" });
  await add("litware-business-ink", self.id, 200, {
    lastFour: "7003",
    nickname: "Business card",
  });
  await add("fabrikam-flex", self.id, 900, {
    status: "CLOSED",
    closedAt: ago(60),
    lastFour: "7004",
  });
  const voyager = await add("northwind-voyager", spouse.id, 150, {
    lastFour: "8001",
  });
  const blue = await add("litware-blue-cash", spouse.id, 30, {
    lastFour: "8002",
    bonusSpendCents: 250_00,
  });
  await add("northwind-voyager-reserve", spouse.id, 280, {
    cardholder: "AUTHORIZED_USER",
    lastFour: "8003",
    nickname: "Reserve (AU)",
  });
  await add("contoso-gold", child.id, 60, {
    cardholder: "AUTHORIZED_USER",
    lastFour: "31077",
    nickname: "Gold (AU)",
  });

  // usage on a few benefits — periods computed exactly like the API (domain/benefits.periodContaining)
  const use = async (
    wc: { id: string; approvedAt: Date | null },
    name: string,
    amountCents: number,
    usedOn: Date,
    note?: string,
  ) => {
    const b = await prisma.userBenefit.findUniqueOrThrow({
      where: { walletCardId_name: { walletCardId: wc.id, name } },
    });
    const w = periodContaining(b, wc.approvedAt, usedOn);
    await prisma.benefitUsage.create({
      data: {
        userBenefitId: b.id,
        periodStart: w.start,
        amountCents,
        usedOn,
        note,
      },
    });
  };
  await use(reserve, "Annual travel credit", 180_00, ago(40), "Train tickets");
  for (let m = 1; m <= 6; m++)
    await use(
      gold,
      "Dining credit",
      10_00,
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 15)),
    );
  await use(gold, "Rideshare credit", 4_00, now, "Ride to the airport");
  await use(blue, "Streaming credit", 7_00, now);
  void sky;

  // a year of spend for rewards analytics
  const cat = ctx.categoryIds;
  const spend: Array<[string, string, number]> = [
    [reserve.id, "travel", 420_00],
    [reserve.id, "dining", 85_00],
    [gold.id, "groceries", 160_00],
    [gold.id, "dining", 70_00],
    [dbl.id, "everything-else", 300_00],
    [voyager.id, "travel", 120_00],
    [blue.id, "streaming", 25_00],
  ];
  const rows = [];
  for (let m = 0; m < 12; m++) {
    for (const [walletCardId, c, amt] of spend) {
      rows.push({
        userId: user.id,
        walletCardId,
        categoryId: cat[c],
        amountCents: amt,
        occurredAt: ago(m * 30 + 3),
        description: `Monthly ${c}`,
      });
    }
  }
  await prisma.transaction.createMany({ data: rows });
  console.log("family portfolio seeded");
}

/**
 * Phase C seed: bonus type/valuation on catalog cards and an opening WELCOME version per card.
 * Contoso Gold gets a fictional history (40K → 50K → current) to demonstrate timelines.
 */
export async function seedOfferHistory(prisma: PrismaClient, now = new Date()) {
  const cards = await prisma.creditCard.findMany({
    where: { ownerId: null },
    include: { currency: true },
  });
  const ago = (d: number) => new Date(now.getTime() - d * DAY);
  for (const c of cards) {
    const type: BonusType | null =
      c.bonusPoints == null
        ? null
        : c.currency.isCash
          ? "CASH"
          : c.currency.code.includes("MILES")
            ? "MILES"
            : "POINTS";
    const value = (amount: number | null) =>
      amount == null || type == null
        ? null
        : type === "CASH"
          ? amount
          : Math.round(amount * Number(c.currency.centsPerPoint));
    if (c.bonusType == null && type)
      await prisma.creditCard.update({
        where: { id: c.id },
        data: { bonusType: type, bonusValuationCents: value(c.bonusPoints) },
      });
    if ((await prisma.cardOffer.count({ where: { cardId: c.id } })) > 0)
      continue;
    const base = {
      cardId: c.id,
      kind: "WELCOME" as const,
      bonusType: type,
      minSpendCents: c.bonusSpendCents,
      spendMonths: c.bonusMonths,
      annualFeeCents: c.annualFeeCents,
      source: "seed",
    };
    if (c.slug === "contoso-gold" && c.bonusPoints) {
      await prisma.cardOffer.create({
        data: {
          ...base,
          bonusAmount: 40000,
          valuationCents: value(40000),
          validFrom: ago(420),
          validTo: ago(210),
          changeNote: "historical (fictional)",
        },
      });
      await prisma.cardOffer.create({
        data: {
          ...base,
          bonusAmount: 50000,
          valuationCents: value(50000),
          validFrom: ago(210),
          validTo: ago(60),
          changeNote: "historical (fictional)",
        },
      });
      await prisma.cardOffer.create({
        data: {
          ...base,
          bonusAmount: c.bonusPoints,
          valuationCents: value(c.bonusPoints),
          validFrom: ago(60),
          changeNote: "current",
        },
      });
    } else {
      await prisma.cardOffer.create({
        data: {
          ...base,
          bonusAmount: c.bonusPoints,
          valuationCents: value(c.bonusPoints),
          validFrom: c.createdAt,
        },
      });
    }
  }
}
