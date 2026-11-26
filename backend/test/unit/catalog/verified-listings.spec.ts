import { CATEGORIES } from "../../../src/seed/categories";
import {
  ISSUER_REGISTRY,
  REAL_CARDS,
} from "../../../src/seed/real-catalog.data";
import {
  LISTING_CURRENCIES,
  listingSlug,
  VERIFIED_LISTINGS,
} from "../../../src/seed/verified-listings";
import { REAL_CURRENCIES } from "../../../src/seed/real-catalog.data";
import { validateSourceUrl } from "../../../src/catalog-refresh/fetcher";

const cats = new Set(CATEGORIES.map(([slug]) => slug));
const slugs = new Set(REAL_CARDS.map((c) => c.slug));
const issuers = new Set(ISSUER_REGISTRY.map((i) => i.name));
const currencies = new Set([
  ...REAL_CURRENCIES.map((c) => c.code),
  ...LISTING_CURRENCIES.map((c) => c.code),
]);
const all = VERIFIED_LISTINGS.flatMap((l) =>
  l.cards.map((c) => ({ ...c, issuer: l.issuer })),
);

describe("verified issuer listings (data)", () => {
  it("reference registry issuers, curated slugs, known categories and currencies", () => {
    const problems: string[] = [];
    for (const l of VERIFIED_LISTINGS) {
      if (!issuers.has(l.issuer)) problems.push(`issuer ${l.issuer}`);
      for (const s of [
        ...(l.discontinued ?? []),
        ...(l.pagesOnly ?? []).map(([s]) => s),
      ])
        if (!slugs.has(s)) problems.push(`slug ${s}`);
    }
    for (const c of all) {
      if (c.slug && !slugs.has(c.slug)) problems.push(`slug ${c.slug}`);
      if (c.currency && !currencies.has(c.currency))
        problems.push(`currency ${c.currency}`);
      for (const [cat] of c.rewards ?? [])
        if (!cats.has(cat)) problems.push(`category ${cat} (${c.name})`);
    }
    expect(problems).toEqual([]);
  });

  it("only retire cards from listings read completely, and never a card the same listing confirms", () => {
    for (const l of VERIFIED_LISTINGS) {
      if (l.discontinued?.length) expect(l.complete).toBe(true);
      const confirmed = new Set(l.cards.map((c) => c.slug).filter(Boolean));
      for (const s of l.discontinued ?? [])
        expect(confirmed.has(s)).toBe(false);
    }
  });

  it("every product page is on the issuer allow-list the refresh engine accepts", () => {
    const ok = (u: string) => {
      try {
        validateSourceUrl(u, {});
        return true;
      } catch {
        return false;
      }
    };
    const urls = [
      ...all.map((c) => c.url),
      ...VERIFIED_LISTINGS.flatMap((l) =>
        (l.pagesOnly ?? []).map(([, u]) => u),
      ),
    ];
    const bad = urls.filter((u): u is string => !!u && !ok(u));
    expect(bad).toEqual([]);
  });

  it("records a stated fee for every card, and each curated card at most once", () => {
    for (const c of all)
      expect(Number.isFinite(c.feeDollars) && c.feeDollars >= 0).toBe(true);
    const seen = all.map((c) => c.slug).filter(Boolean);
    expect(new Set(seen).size).toBe(seen.length);
    const names = all.map((c) => `${c.issuer}|${c.name}`);
    expect(new Set(names).size).toBe(names.length);
    const generated = all.map((c) => listingSlug(c.issuer, c));
    expect(generated.filter((s, i) => generated.indexOf(s) !== i)).toEqual([]);
    expect(listingSlug("Capital One", { name: "BJ's One+ Mastercard" })).toBe(
      "capital-one-bj-s-one-plus-mastercard",
    );
  });
});
