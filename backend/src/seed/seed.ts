/* eslint-disable no-console */
/**
 * Idempotent seed. The demo catalog is FICTIONAL (issuers, cards, merchants are invented); the real-card
 * catalog (SEED_CATALOG=real|both, or `npm run catalog:import`) is the curated list in real-catalog.data.ts.
 * Nothing here is copied from any third-party card database.
 *
 *   node dist/seed/seed.js            # upsert catalog + demo users
 *   SEED_DEMO_USERS=false node ...    # catalog only
 *   SEED_CATALOG=real node ...        # real cards instead of the fictional demo catalog
 */
import { CardNetwork, CardType, OfferKind, PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import {
  seedDemoBenefits,
  seedFamily,
  seedOfferHistory,
  seedPortfolioCatalog,
} from "./portfolio";
import { applyRewardExclusions } from "./reward-exclusions.apply";
import { purgeFictionalTravelData, seedFamilyStrategy, seedStrategyCatalog } from "./strategy";
import { seedAi } from "./ai";
import { applyMerchantIdentities } from "./merchant-identities";
import { applyLoyaltyRegistry } from "./loyalty-registry";
import { CATEGORIES, CATEGORY_PARENTS } from "./categories";
import { importRealCatalog } from "./real-catalog";

const prisma = new PrismaClient();
const DAY = 86_400_000;
const now = new Date();
const inDays = (d: number) => new Date(now.getTime() + d * DAY);

const ISSUERS = [
  "Northwind Bank",
  "Contoso Financial",
  "Fabrikam Card Services",
  "Tailspin Credit Union",
  "Litware Bank",
];

const CURRENCIES: Array<
  [code: string, name: string, cpp: number, isCash: boolean]
> = [
  ["CASH", "Cash back", 1.0, true],
  ["NW_MILES", "Northwind Miles", 1.5, false],
  ["CONTOSO_PTS", "Contoso Points", 1.25, false],
  ["FABRIKAM_PTS", "Fabrikam Rewards", 1.0, false],
  ["TAILSPIN_STARS", "Tailspin Stars", 0.8, false],
];

interface CardSeed {
  slug: string;
  name: string;
  issuer: string;
  network: CardNetwork;
  type?: CardType;
  currency: string;
  fee: number; // dollars
  color: string;
  bonus?: { points: number; spend: number; months: number; text: string };
  features: string[];
  rewards: Array<{
    cat?: string;
    merchant?: string;
    x: number;
    text: string;
    rotating?: boolean;
  }>;
  popularity: number;
}

const CARDS: CardSeed[] = [
  {
    slug: "northwind-voyager",
    name: "Northwind Voyager",
    issuer: "Northwind Bank",
    network: "VISA",
    currency: "NW_MILES",
    fee: 95,
    color: "#1e3a8a",
    bonus: {
      points: 60000,
      spend: 4000,
      months: 3,
      text: "60,000 miles after $4,000 spend in 3 months",
    },
    features: [
      "No foreign transaction fees",
      "Trip delay insurance",
      "Transfer to airline partners",
    ],
    rewards: [
      { cat: "travel", x: 3, text: "3X miles on travel" },
      { cat: "dining", x: 3, text: "3X miles on dining" },
      { cat: "streaming", x: 2, text: "2X miles on streaming" },
      { cat: "everything-else", x: 1, text: "1X miles everywhere else" },
    ],
    popularity: 100,
  },
  {
    slug: "northwind-voyager-reserve",
    name: "Northwind Voyager Reserve",
    issuer: "Northwind Bank",
    network: "VISA",
    currency: "NW_MILES",
    fee: 550,
    color: "#0f172a",
    bonus: {
      points: 80000,
      spend: 6000,
      months: 3,
      text: "80,000 miles after $6,000 spend in 3 months",
    },
    features: [
      "$300 annual travel credit",
      "Airport lounge access",
      "Primary rental car coverage",
    ],
    rewards: [
      {
        cat: "hotels",
        x: 10,
        text: "10X on hotels booked via Northwind Travel",
      },
      {
        cat: "car-rental",
        x: 10,
        text: "10X on car rentals via Northwind Travel",
      },
      { cat: "airlines", x: 5, text: "5X on flights" },
      { cat: "dining", x: 3, text: "3X on dining" },
      { cat: "everything-else", x: 1, text: "1X everywhere else" },
    ],
    popularity: 80,
  },
  {
    slug: "contoso-gold",
    name: "Contoso Gold",
    issuer: "Contoso Financial",
    network: "AMEX",
    currency: "CONTOSO_PTS",
    fee: 250,
    color: "#b45309",
    bonus: {
      points: 60000,
      spend: 6000,
      months: 6,
      text: "60,000 points after $6,000 in 6 months",
    },
    features: ["$120 dining credit", "$120 rideshare credit"],
    rewards: [
      { cat: "dining", x: 4, text: "4X points at restaurants worldwide" },
      {
        cat: "groceries",
        x: 4,
        text: "4X at U.S. supermarkets (up to $25k/yr)",
      },
      { cat: "airlines", x: 3, text: "3X on flights booked directly" },
      { cat: "everything-else", x: 1, text: "1X everywhere else" },
    ],
    popularity: 95,
  },
  {
    slug: "contoso-everyday",
    name: "Contoso Everyday",
    issuer: "Contoso Financial",
    network: "AMEX",
    currency: "CONTOSO_PTS",
    fee: 0,
    color: "#64748b",
    features: [
      "No annual fee",
      "20% bonus when making 20+ purchases per month",
    ],
    rewards: [
      { cat: "groceries", x: 2, text: "2X at U.S. supermarkets" },
      { cat: "everything-else", x: 1, text: "1X everywhere else" },
    ],
    popularity: 40,
  },
  {
    slug: "fabrikam-flex",
    name: "Fabrikam Flex",
    issuer: "Fabrikam Card Services",
    network: "VISA",
    currency: "CASH",
    fee: 0,
    color: "#0369a1",
    bonus: {
      points: 20000,
      spend: 500,
      months: 3,
      text: "$200 after $500 in 3 months",
    },
    features: [
      "5% rotating categories each quarter (activation required)",
      "No annual fee",
    ],
    rewards: [
      {
        cat: "gas",
        x: 5,
        text: "5% on gas this quarter (activate)",
        rotating: true,
      },
      {
        cat: "groceries",
        x: 5,
        text: "5% on groceries this quarter (activate)",
        rotating: true,
      },
      {
        cat: "online-shopping",
        x: 5,
        text: "5% online this quarter (activate)",
        rotating: true,
      },
      { cat: "drugstores", x: 3, text: "3% at drugstores" },
      { cat: "dining", x: 3, text: "3% on dining" },
      { cat: "everything-else", x: 1, text: "1% everywhere else" },
    ],
    popularity: 90,
  },
  {
    slug: "fabrikam-double",
    name: "Fabrikam Double Cash",
    issuer: "Fabrikam Card Services",
    network: "MASTERCARD",
    currency: "CASH",
    fee: 0,
    color: "#047857",
    features: ["Unlimited 2% cash back", "No annual fee"],
    rewards: [{ cat: "everything-else", x: 2, text: "2% on every purchase" }],
    popularity: 85,
  },
  {
    slug: "tailspin-everyday-plus",
    name: "Tailspin Everyday Plus",
    issuer: "Tailspin Credit Union",
    network: "MASTERCARD",
    currency: "TAILSPIN_STARS",
    fee: 0,
    color: "#7c3aed",
    features: ["Credit union membership required"],
    rewards: [
      { cat: "gas", x: 4, text: "4X stars on gas" },
      { cat: "transit", x: 3, text: "3X on transit & rideshare" },
      { cat: "everything-else", x: 1, text: "1X everywhere else" },
    ],
    popularity: 30,
  },
  {
    slug: "litware-blue-cash",
    name: "Litware Blue Cash",
    issuer: "Litware Bank",
    network: "AMEX",
    currency: "CASH",
    fee: 95,
    color: "#2563eb",
    bonus: {
      points: 25000,
      spend: 3000,
      months: 6,
      text: "$250 after $3,000 in 6 months",
    },
    features: [
      "6% at U.S. supermarkets on up to $6,000/yr",
      "6% on select streaming",
    ],
    rewards: [
      { cat: "groceries", x: 6, text: "6% at U.S. supermarkets" },
      { cat: "streaming", x: 6, text: "6% on select U.S. streaming" },
      { cat: "gas", x: 3, text: "3% at U.S. gas stations" },
      { cat: "transit", x: 3, text: "3% on transit" },
      { cat: "everything-else", x: 1, text: "1% everywhere else" },
    ],
    popularity: 75,
  },
  {
    slug: "litware-business-ink",
    name: "Litware Business Ink",
    issuer: "Litware Bank",
    network: "VISA",
    type: "BUSINESS",
    currency: "CASH",
    fee: 0,
    color: "#334155",
    bonus: {
      points: 75000,
      spend: 6000,
      months: 3,
      text: "$750 after $6,000 in 3 months",
    },
    features: ["Employee cards at no cost"],
    rewards: [
      {
        cat: "phone-internet",
        x: 5,
        text: "5% on internet, cable and phone (up to $25k)",
      },
      { cat: "gas", x: 2, text: "2% at gas stations" },
      { cat: "dining", x: 2, text: "2% on dining" },
      { cat: "everything-else", x: 1, text: "1% everywhere else" },
    ],
    popularity: 50,
  },
  {
    slug: "northwind-shopper",
    name: "Northwind ShopNow Card",
    issuer: "Northwind Bank",
    network: "VISA",
    currency: "CASH",
    fee: 0,
    color: "#ea580c",
    features: ["5% at ShopNow.example", "No annual fee"],
    rewards: [
      { merchant: "shopnow", x: 5, text: "5% back at ShopNow" },
      { cat: "dining", x: 2, text: "2% on dining" },
      { cat: "gas", x: 2, text: "2% on gas" },
      { cat: "everything-else", x: 1, text: "1% everywhere else" },
    ],
    popularity: 70,
  },
  {
    slug: "contoso-skyhigh",
    name: "SkyHigh Airlines Contoso Card",
    issuer: "Contoso Financial",
    network: "AMEX",
    currency: "CONTOSO_PTS",
    fee: 150,
    color: "#0e7490",
    bonus: {
      points: 50000,
      spend: 3000,
      months: 3,
      text: "50,000 points after $3,000 in 3 months",
    },
    features: ["Free first checked bag on SkyHigh", "Priority boarding"],
    rewards: [
      {
        merchant: "skyhigh-airlines",
        x: 3,
        text: "3X on SkyHigh Airlines purchases",
      },
      { cat: "dining", x: 2, text: "2X on dining" },
      { cat: "everything-else", x: 1, text: "1X everywhere else" },
    ],
    popularity: 45,
  },
  {
    slug: "tailspin-debit-rewards",
    name: "Tailspin Debit Rewards",
    issuer: "Tailspin Credit Union",
    network: "VISA",
    currency: "CASH",
    fee: 0,
    color: "#9ca3af",
    features: ["Debit card"],
    rewards: [{ cat: "everything-else", x: 0.5, text: "0.5% everywhere" }],
    popularity: 5,
  },
];

const MERCHANTS: Array<{
  slug: string;
  name: string;
  cat: string;
  hosts: string[];
  popular?: boolean;
}> = [
  {
    slug: "freshcart",
    name: "FreshCart Market",
    cat: "groceries",
    hosts: ["freshcart.example"],
    popular: true,
  },
  {
    slug: "bean-street",
    name: "Bean Street Coffee",
    cat: "dining",
    hosts: ["beanstreet.example"],
    popular: true,
  },
  {
    slug: "quickfuel",
    name: "QuickFuel",
    cat: "gas",
    hosts: ["quickfuel.example"],
    popular: true,
  },
  {
    slug: "skyhigh-airlines",
    name: "SkyHigh Airlines",
    cat: "airlines",
    hosts: ["skyhigh.example"],
    popular: true,
  },
  {
    slug: "staywell",
    name: "StayWell Hotels",
    cat: "hotels",
    hosts: ["staywell.example"],
  },
  {
    slug: "megamart",
    name: "MegaMart Wholesale",
    cat: "wholesale-clubs",
    hosts: ["megamart.example"],
    popular: true,
  },
  {
    slug: "shopnow",
    name: "ShopNow",
    cat: "online-shopping",
    hosts: ["shopnow.example"],
    popular: true,
  },
  {
    slug: "cityride",
    name: "CityRide",
    cat: "transit",
    hosts: ["cityride.example"],
  },
  {
    slug: "homebuild",
    name: "HomeBuild Supply",
    cat: "home-improvement",
    hosts: ["homebuild.example"],
  },
  {
    slug: "medicare-pharmacy",
    name: "CornerCare Pharmacy",
    cat: "drugstores",
    hosts: ["cornercare.example"],
  },
  {
    slug: "cinemax",
    name: "Starlight Cinemas",
    cat: "entertainment",
    hosts: ["starlight.example"],
  },
  {
    slug: "streamflix",
    name: "StreamFlix",
    cat: "streaming",
    hosts: ["streamflix.example"],
  },
  {
    slug: "pasta-palace",
    name: "Pasta Palace",
    cat: "dining",
    hosts: ["pastapalace.example"],
  },
  {
    slug: "greenleaf-grocer",
    name: "GreenLeaf Grocer",
    cat: "groceries",
    hosts: ["greenleaf.example"],
  },
  {
    slug: "drivenow-rentals",
    name: "DriveNow Rentals",
    cat: "car-rental",
    hosts: ["drivenow.example"],
  },
];

// Demo locations around a fixed point (downtown San Francisco) for the Nearby feature.
const ORIGIN = { lat: 37.7749, lng: -122.4194 };
const LOCATIONS: Array<
  [merchant: string, name: string, dLat: number, dLng: number, address: string]
> = [
  ["freshcart", "FreshCart Market — Market St", 0.0012, 0.0008, "1 Market St"],
  [
    "bean-street",
    "Bean Street Coffee — Civic Center",
    -0.0006,
    0.0011,
    "200 Larkin St",
  ],
  ["quickfuel", "QuickFuel — Mission", -0.0081, 0.0021, "1500 Mission St"],
  ["megamart", "MegaMart Wholesale — SoMa", -0.0052, 0.0094, "450 10th St"],
  [
    "pasta-palace",
    "Pasta Palace — Hayes Valley",
    -0.0002,
    -0.0041,
    "300 Hayes St",
  ],
  [
    "medicare-pharmacy",
    "CornerCare Pharmacy — Polk",
    0.0043,
    -0.0002,
    "1100 Polk St",
  ],
  [
    "cinemax",
    "Starlight Cinemas — Van Ness",
    0.0068,
    -0.0012,
    "1000 Van Ness Ave",
  ],
  [
    "greenleaf-grocer",
    "GreenLeaf Grocer — Nob Hill",
    0.0151,
    0.0032,
    "1400 California St",
  ],
  [
    "homebuild",
    "HomeBuild Supply — Bayview",
    -0.0402,
    0.0301,
    "2000 Industrial Way",
  ],
  [
    "staywell",
    "StayWell Hotels — Union Square",
    0.0039,
    0.0115,
    "335 Powell St",
  ],
];

async function upsertCategories() {
  const categoryIds: Record<string, string> = {};
  for (const [i, [slug, name, icon, fallback]] of CATEGORIES.entries()) {
    const c = await prisma.category.upsert({
      where: { slug },
      update: { name, icon, sortOrder: i, isFallback: !!fallback },
      create: { slug, name, icon, sortOrder: i, isFallback: !!fallback },
    });
    categoryIds[slug] = c.id;
  }
  for (const [child, parent] of Object.entries(CATEGORY_PARENTS)) await prisma.category.update({ where: { slug: child }, data: { parentId: categoryIds[parent] } });
  return categoryIds;
}

async function upsertCatalog() {
  const categoryIds = await upsertCategories();

  const issuerIds: Record<string, string> = {};
  for (const name of ISSUERS) {
    const iss = await prisma.issuer.upsert({
      where: { name },
      update: {},
      create: { name, countryCode: "US" },
    });
    issuerIds[name] = iss.id;
  }

  const currencyIds: Record<string, string> = {};
  for (const [code, name, cpp, isCash] of CURRENCIES) {
    const cur = await prisma.rewardCurrency.upsert({
      where: { code },
      update: { name, centsPerPoint: cpp, isCash },
      create: { code, name, centsPerPoint: cpp, isCash },
    });
    currencyIds[code] = cur.id;
  }

  const merchantIds: Record<string, string> = {};
  for (const m of MERCHANTS) {
    const row = await prisma.merchant.upsert({
      where: { slug: m.slug },
      update: {
        name: m.name,
        categoryId: categoryIds[m.cat],
        hosts: m.hosts,
        isPopular: !!m.popular,
      },
      create: {
        slug: m.slug,
        name: m.name,
        categoryId: categoryIds[m.cat],
        hosts: m.hosts,
        isPopular: !!m.popular,
      },
    });
    merchantIds[m.slug] = row.id;
  }

  await prisma.location.deleteMany({});
  for (const [merchant, name, dLat, dLng, address] of LOCATIONS) {
    await prisma.location.create({
      data: {
        merchantId: merchantIds[merchant],
        name,
        address,
        latitude: ORIGIN.lat + dLat,
        longitude: ORIGIN.lng + dLng,
      },
    });
  }

  const cardIds: Record<string, string> = {};
  for (const c of CARDS) {
    const data = {
      name: c.name,
      issuerId: issuerIds[c.issuer],
      network: c.network,
      type: c.type ?? "PERSONAL",
      annualFeeCents: c.fee * 100,
      currencyId: currencyIds[c.currency],
      color: c.color,
      bonusDescription: c.bonus?.text ?? null,
      bonusPoints: c.bonus?.points ?? null,
      bonusSpendCents: c.bonus ? c.bonus.spend * 100 : null,
      bonusMonths: c.bonus?.months ?? null,
      popularity: c.popularity,
      catalogSource: "DEMO",
      isActive: true, // hidden again below when SEED_RETIRE_DEMO=true
      foreignTxFee: !c.features.some((f) =>
        f.toLowerCase().includes("no foreign"),
      ),
    } as const;
    const card = await prisma.creditCard.upsert({
      where: { slug: c.slug },
      update: data,
      create: { slug: c.slug, ...data },
    });
    cardIds[c.slug] = card.id;
    await prisma.reward.deleteMany({ where: { cardId: card.id } });
    await prisma.cardFeature.deleteMany({ where: { cardId: card.id } });
    await prisma.reward.createMany({
      data: c.rewards.map((r) => ({
        cardId: card.id,
        categoryId: r.cat ? categoryIds[r.cat] : null,
        merchantId: r.merchant ? merchantIds[r.merchant] : null,
        multiplier: r.x,
        description: r.text,
        isRotating: !!r.rotating,
      })),
    });
    await prisma.cardFeature.createMany({
      data: c.features.map((text, i) => ({
        cardId: card.id,
        text,
        sortOrder: i,
      })),
    });
  }

  // Catalog offers (relative dates so the demo always has live/expiring offers).
  const OFFERS: Array<{
    key: string;
    title: string;
    kind: OfferKind;
    value: number;
    minSpend?: number;
    merchant?: string;
    issuer?: string;
    card?: string;
    ends: number;
    repeat?: number;
    desc: string;
  }> = [
    {
      key: "o1",
      title: "FreshCart: Spend $50, get $10 back",
      kind: "CASH",
      value: 1000,
      minSpend: 5000,
      merchant: "freshcart",
      issuer: "Contoso Financial",
      ends: 5,
      desc: "One-time statement credit.",
    },
    {
      key: "o2",
      title: "Bean Street: 20% back up to $8",
      kind: "PERCENT",
      value: 800,
      merchant: "bean-street",
      issuer: "Northwind Bank",
      ends: 21,
      desc: "Earn 20% back on purchases, up to $8 total.",
    },
    {
      key: "o3",
      title: "QuickFuel: $5 back on $40+",
      kind: "CASH",
      value: 500,
      minSpend: 4000,
      merchant: "quickfuel",
      issuer: "Fabrikam Card Services",
      ends: 3,
      repeat: 2,
      desc: "Up to 2 times.",
    },
    {
      key: "o4",
      title: "StreamFlix: $5 monthly credit",
      kind: "CASH",
      value: 500,
      merchant: "streamflix",
      card: "contoso-gold",
      ends: 30,
      repeat: 12,
      desc: "Monthly streaming credit.",
    },
    {
      key: "o5",
      title: "StayWell: Spend $300, get $60 back",
      kind: "CASH",
      value: 6000,
      minSpend: 30000,
      merchant: "staywell",
      issuer: "Northwind Bank",
      ends: 60,
      desc: "Book directly with StayWell.",
    },
    {
      key: "o6",
      title: "ShopNow: 1,000 bonus points on $25+",
      kind: "POINTS",
      value: 1250,
      merchant: "shopnow",
      issuer: "Contoso Financial",
      ends: 14,
      desc: "Bonus points posted within 90 days.",
    },
    {
      key: "o7",
      title: "MegaMart: $25 back on $150+",
      kind: "CASH",
      value: 2500,
      minSpend: 15000,
      merchant: "megamart",
      issuer: "Litware Bank",
      ends: 45,
      desc: "Online or in-store.",
    },
    {
      key: "o8",
      title: "Pasta Palace: $15 back on $60+",
      kind: "CASH",
      value: 1500,
      minSpend: 6000,
      merchant: "pasta-palace",
      issuer: "Fabrikam Card Services",
      ends: 10,
      desc: "Dine-in or takeout.",
    },
  ];
  const offerIds: Record<string, string> = {};
  for (const o of OFFERS) {
    const existing = await prisma.offer.findFirst({
      where: { title: o.title, isCustom: false },
    });
    const data = {
      title: o.title,
      description: o.desc,
      kind: o.kind,
      valueCents: o.value,
      points: o.kind === "POINTS" ? 1000 : null,
      percent: o.kind === "PERCENT" ? 20 : null,
      minSpendCents: o.minSpend ?? null,
      startsAt: inDays(-7),
      endsAt: inDays(o.ends),
      isRepeatable: !!o.repeat,
      maxTimes: o.repeat ?? null,
      merchantId: o.merchant ? merchantIds[o.merchant] : null,
      issuerId: o.issuer
        ? issuerIds[o.issuer]
        : o.card
          ? issuerIds[CARDS.find((c) => c.slug === o.card)!.issuer]
          : null,
      cardId: o.card ? cardIds[o.card] : null,
      terms: "Demo offer. Enrollment required. Valid in the U.S.",
    };
    const row = existing
      ? await prisma.offer.update({ where: { id: existing.id }, data })
      : await prisma.offer.create({ data });
    offerIds[o.key] = row.id;
  }
  return { categoryIds, cardIds, offerIds, merchantIds };
}

async function upsertUser(
  email: string,
  password: string,
  name: string,
  role: "USER" | "ADMIN",
) {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  return prisma.user.upsert({
    where: { email },
    update: { role, name },
    create: {
      email,
      name,
      role,
      passwordHash,
      emailVerified: new Date(),
      wallet: { create: {} },
      subscription: { create: { plan: "FREE", status: "ACTIVE" } },
      notificationPrefs: { create: {} },
      profiles: {
        create: { nickname: name, isPrimary: true, relationship: "SELF" },
      },
    },
  });
}

async function seedDemoUsers(ctx: Awaited<ReturnType<typeof upsertCatalog>>) {
  await upsertUser(
    "admin@pointwise.local",
    "Admin12345!",
    "Ada Admin",
    "ADMIN",
  );
  const demo = await upsertUser(
    "demo@pointwise.local",
    "Demo12345!",
    "Omar Optimizer",
    "USER",
  );
  await prisma.subscription.update({
    where: { userId: demo.id },
    data: {
      plan: "PRO",
      status: "ACTIVE",
      interval: "lifetime",
      provider: "mock",
    },
  });

  const wallet = await prisma.wallet.findUniqueOrThrow({
    where: { userId: demo.id },
  });
  if ((await prisma.walletCard.count({ where: { walletId: wallet.id } })) > 0)
    return; // already seeded

  const add = (
    slug: string,
    approvedDaysAgo: number,
    extra: Record<string, unknown> = {},
  ) =>
    prisma.walletCard.create({
      data: {
        walletId: wallet.id,
        cardId: ctx.cardIds[slug],
        status: "APPROVED",
        approvedAt: inDays(-approvedDaysAgo),
        ...extra,
      },
    });
  const voyager = await add("northwind-voyager", 340, {
    nickname: "Travel card",
    lastFour: "4821",
  });
  const gold = await add("contoso-gold", 40, {
    bonusSpendCents: 2100_00,
    lastFour: "1007",
  });
  const flex = await add("fabrikam-flex", 700, {
    selectedCategoryIds: [ctx.categoryIds["gas"], ctx.categoryIds["groceries"]],
  });
  const dbl = await add("fabrikam-double", 1200);
  const blue = await add("litware-blue-cash", 20, { bonusSpendCents: 500_00 });

  const link = (
    walletCardId: string,
    key: string,
    extra: Record<string, unknown> = {},
  ) =>
    prisma.userOffer.create({
      data: { walletCardId, offerId: ctx.offerIds[key], ...extra },
    });
  await link(gold.id, "o1");
  await link(gold.id, "o4", { amountUsedCents: 500, timesUsed: 1 });
  await link(voyager.id, "o2", { isFavorite: true });
  await link(flex.id, "o3");
  await link(voyager.id, "o5");
  await link(blue.id, "o7");
  await link(flex.id, "o8", {
    status: "REDEEMED",
    redeemedAt: inDays(-1),
    amountUsedCents: 1500,
    timesUsed: 1,
  });
  void dbl;

  await prisma.notification.create({
    data: {
      userId: demo.id,
      type: "SYSTEM",
      title: "Welcome to PointWise",
      body: "Add your cards to see your best card everywhere.",
      link: "/wallet",
      dedupeKey: "welcome",
    },
  });
}

/**
 * SEED_CATALOG selects the catalog:
 *   demo (default) — fictional issuers/cards + demo family (tests, CI, Docker validation)
 *   real           — curated real-card list only (unverified until confirmed); admin + empty demo user
 *   both           — demo accounts plus the real-card list (SEED_RETIRE_DEMO=true hides the
 *                    fictional cards from the catalog; demo accounts keep them in their wallets)
 */
async function main() {
  const mode = (process.env.SEED_CATALOG ?? "demo").toLowerCase();
  if (!["demo", "real", "both"].includes(mode))
    throw new Error(`SEED_CATALOG must be demo, real or both (got ${mode})`);
  await seedAi(prisma);
  if (mode === "real") {
    await upsertCategories();
    console.log(
      "real catalog",
      JSON.stringify(await importRealCatalog(prisma)),
    );
    console.log("merchant identities", JSON.stringify(await applyMerchantIdentities(prisma)));
    console.log("loyalty registry", JSON.stringify(await applyLoyaltyRegistry(prisma)));
    // merchants exist only now in real mode, so the grocery-rate exclusions (Walmart, Target, clubs) are applied again here
    console.log("reward exclusions", JSON.stringify(await applyRewardExclusions(prisma)));
    if (process.env.SEED_DEMO_USERS !== "false") {
      await upsertUser(
        "admin@pointwise.local",
        "Admin12345!",
        "Ada Admin",
        "ADMIN",
      );
      await upsertUser(
        "demo@pointwise.local",
        "Demo12345!",
        "Omar Optimizer",
        "USER",
      );
    }
  } else {
    const ctx = await upsertCatalog();
    await seedPortfolioCatalog(prisma, ctx.cardIds);
    await seedOfferHistory(prisma);
    // invented airlines/hotels/transfer routes exist only in the pure demo catalog (tests); real stacks never get them
    if (mode === "demo") await seedStrategyCatalog(prisma);
    console.log("merchant identities", JSON.stringify(await applyMerchantIdentities(prisma)));
    if (process.env.SEED_DEMO_USERS !== "false") {
      await seedDemoUsers(ctx);
      const demo = await prisma.user.findUniqueOrThrow({
        where: { email: "demo@pointwise.local" },
      });
      await seedDemoBenefits(prisma, demo.id);
      const family = await upsertUser(
        "family@pointwise.local",
        "Family12345!",
        "Jordan Rivera",
        "USER",
      );
      await prisma.subscription.update({
        where: { userId: family.id },
        data: {
          plan: "PRO",
          status: "ACTIVE",
          interval: "lifetime",
          provider: "mock",
        },
      });
      await seedFamily(prisma, ctx, family);
      if (mode === "demo") await seedFamilyStrategy(prisma, family.id);
    }
    // both: real cards in the catalog; with SEED_RETIRE_DEMO=true the fictional ones leave the
    // public catalog but stay in the demo accounts' wallets
    if (mode === "both") {
      console.log(
        "real catalog",
        JSON.stringify(
          await importRealCatalog(prisma, {
            retireDemo: process.env.SEED_RETIRE_DEMO === "true",
          }),
        ),
      );
      // the real bank currencies exist now, so the registry's transfer routes can attach to them
      console.log("loyalty registry", JSON.stringify(await applyLoyaltyRegistry(prisma)));
    }
    if (mode !== "demo") console.log("fictional travel data removed", JSON.stringify(await purgeFictionalTravelData(prisma)));
  }
  const counts = {
    categories: await prisma.category.count(),
    issuers: await prisma.issuer.count(),
    cards: await prisma.creditCard.count(),
    merchants: await prisma.merchant.count(),
    locations: await prisma.location.count(),
    offers: await prisma.offer.count({ where: { isCustom: false } }),
    users: await prisma.user.count(),
    benefitTemplates: await prisma.benefit.count(),
    trackedBenefits: await prisma.userBenefit.count(),
    loyaltyPrograms: await prisma.loyaltyProgram.count(),
    transferPartners: await prisma.transferPartner.count(),
  };
  console.log("seed complete", JSON.stringify(counts));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
