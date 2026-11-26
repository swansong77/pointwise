import { applyVerifiedListings } from "../../../src/seed/verified-listings.apply";
import {
  listingSlug,
  VERIFIED_LISTINGS,
} from "../../../src/seed/verified-listings";
import {
  ISSUER_REGISTRY,
  REAL_CARDS,
} from "../../../src/seed/real-catalog.data";

/** Minimal in-memory stand-in for the Prisma calls the importer makes. */
function fakeDb() {
  let n = 0;
  const id = () => `id${++n}`;
  const cards = new Map<string, any>(); // by slug
  const sources: any[] = [];
  const rewards: any[] = [];
  const features: any[] = [];
  const currencies = new Map<string, any>([
    ["CASH", { id: "cur-cash", code: "CASH" }],
  ]);
  const issuers = new Map(
    ISSUER_REGISTRY.map((i) => [i.name, { id: `iss-${i.name}`, name: i.name }]),
  );
  const byId = (cid: string) => [...cards.values()].find((c) => c.id === cid);
  const db: any = {
    rewardCurrency: {
      upsert: async ({ create }: any) =>
        currencies.get(create.code) ??
        (currencies.set(create.code, { id: id(), ...create }),
        currencies.get(create.code)),
      findMany: async () => [...currencies.values()],
    },
    category: {
      findMany: async () =>
        [
          "dining",
          "groceries",
          "gas",
          "travel",
          "everything-else",
          "hotels",
          "airlines",
        ].map((slug) => ({ id: `cat-${slug}`, slug })),
    },
    issuer: {
      findUnique: async ({ where }: any) => issuers.get(where.name) ?? null,
    },
    creditCard: {
      findUnique: async ({ where }: any) => cards.get(where.slug) ?? null,
      update: async ({ where, data }: any) =>
        Object.assign(byId(where.id), data),
      create: async ({ data }: any) => {
        const c = { id: id(), ...data };
        cards.set(data.slug, c);
        return c;
      },
      updateMany: async ({ where, data }: any) => {
        const c = cards.get(where.slug);
        if (!c || c.catalogSource !== where.catalogSource) return { count: 0 };
        Object.assign(c, data);
        return { count: 1 };
      },
    },
    cardDataSource: {
      findFirst: async ({ where }: any) =>
        sources.find((s) => s.cardId === where.cardId && s.url === where.url) ??
        null,
      create: async ({ data }: any) => sources.push(data),
    },
    reward: {
      deleteMany: async ({ where }: any) =>
        rewards.splice(
          0,
          rewards.length,
          ...rewards.filter((r) => r.cardId !== where.cardId),
        ),
      createMany: async ({ data }: any) => rewards.push(...data),
      findFirst: async ({ where }: any) => rewards.find((r) => r.cardId === where.cardId && r.categoryId === where.categoryId) ?? null,
      create: async ({ data }: any) => rewards.push(data),
    },
    cardFeature: {
      createMany: async ({ data }: any) => features.push(...data),
    },
  };
  const seedCard = (slug: string, extra: any = {}) =>
    cards.set(slug, {
      id: id(),
      slug,
      name: `old ${slug}`,
      annualFeeCents: 1,
      catalogSource: "SEED",
      isActive: true,
      productStatus: "OPEN",
      ...extra,
    });
  return { db, cards, sources, rewards, features, seedCard };
}

const curated = (slug: string) => REAL_CARDS.some((c) => c.slug === slug);

describe("applyVerifiedListings", () => {
  it("corrects curated SEED cards from the listing and records their product pages", async () => {
    const f = fakeDb();
    f.seedCard("chase-ihg-one-rewards-premier", { annualFeeCents: 9900 });
    await applyVerifiedListings(f.db);
    const ihg = f.cards.get("chase-ihg-one-rewards-premier");
    expect(ihg).toMatchObject({
      annualFeeCents: 15000,
      verifiedScope: "ISSUER_LISTING",
      productStatus: "OPEN",
    });
    expect(ihg.lastVerifiedAt.toISOString().slice(0, 10)).toBe("2026-11-22");
    expect(
      f.sources.some((s) => s.cardId === ihg.id && /chase\.com/.test(s.url)),
    ).toBe(true);
  });

  it("never changes a card an admin edited or research created", async () => {
    const f = fakeDb();
    f.seedCard("chase-ihg-one-rewards-premier", {
      annualFeeCents: 9900,
      catalogSource: "ADMIN",
    });
    const r = await applyVerifiedListings(f.db);
    expect(f.cards.get("chase-ihg-one-rewards-premier").annualFeeCents).toBe(
      9900,
    );
    expect(r.skippedEdited).toBe(1);
  });

  it("adds cards first seen on a listing, with stated rewards and the listing text as a feature", async () => {
    const f = fakeDb();
    await applyVerifiedListings(f.db);
    const sw = f.cards.get(
      listingSlug("Chase", {
        name: "Southwest Rapid Rewards Priority Credit Card",
      }),
    );
    expect(sw).toMatchObject({
      annualFeeCents: 22900,
      type: "PERSONAL",
      catalogSource: "SEED",
      network: "VISA",
    });
    expect(
      f.rewards
        .filter((r) => r.cardId === sw.id)
        .map((r) => [r.categoryId, r.multiplier]),
    ).toEqual(
      expect.arrayContaining([
        ["cat-gas", 2],
        ["cat-dining", 2],
      ]),
    );
    expect(
      f.features.some(
        (x) =>
          x.cardId === sw.id && /Issuer listing: 4X Southwest/.test(x.text),
      ),
    ).toBe(true);
  });

  it("retires curated cards a complete listing no longer shows, but only SEED ones", async () => {
    const f = fakeDb();
    f.seedCard("capital-one-walmart-rewards");
    f.seedCard("barclays-aadvantage-aviator-red", { catalogSource: "ADMIN" });
    await applyVerifiedListings(f.db);
    expect(f.cards.get("capital-one-walmart-rewards")).toMatchObject({
      isActive: false,
      productStatus: "CLOSED_TO_NEW",
    });
    expect(f.cards.get("barclays-aadvantage-aviator-red")).toMatchObject({
      isActive: true,
      productStatus: "OPEN",
    });
  });

  it("is idempotent: a second run adds no cards or sources", async () => {
    const f = fakeDb();
    const first = await applyVerifiedListings(f.db);
    const second = await applyVerifiedListings(f.db);
    expect(first.added).toBeGreaterThan(50);
    expect(second.added).toBe(0);
    expect(second.sources).toBe(0);
    const listed = VERIFIED_LISTINGS.reduce((k, l) => k + l.cards.length, 0);
    expect(second.confirmed).toBe(listed);
    expect(curated("chase-sapphire-preferred")).toBe(true);
  });
});
