import defs from '../../brands/brands.json';
import manifest from './brands.generated.json';

/**
 * Brand logos and icons. Icons are vendored (CC0, Simple Icons) into /public/brands and served by the app itself; a
 * brand without an icon gets a generated monogram badge. Logos stay the trademarks of their owners and are shown
 * only to identify the card, bank, program or merchant (docs/brand-assets.md).
 */
export type BrandKind = 'ISSUER' | 'NETWORK' | 'AIRLINE' | 'HOTEL' | 'BANK_REWARDS' | 'SHOPPING' | 'MERCHANT' | 'MEMBERSHIP' | 'SERVICE';

export interface Brand {
  key: string;
  name: string;
  kind: BrandKind;
  aliases: string[];
  codes: string[];
  /** file under /brands, or null when the brand uses a monogram */
  file: string | null;
  hex: string | null;
}

type Def = { key: string; name: string; kind: string; simple?: string; aliases?: string[]; codes?: string[] };
const files = manifest as unknown as Record<string, { file: string; hex: string | null }>;

export const BRANDS: Brand[] = (defs as Def[]).map((d) => ({
  key: d.key,
  name: d.name,
  kind: d.kind as BrandKind,
  aliases: d.aliases ?? [],
  codes: d.codes ?? [],
  file: files[d.key]?.file ?? null,
  hex: files[d.key]?.hex ?? null,
}));

export const KIND_LABEL: Record<BrandKind, string> = {
  ISSUER: 'Banks and card issuers',
  NETWORK: 'Card networks',
  AIRLINE: 'Airlines and airline programs',
  HOTEL: 'Hotels and travel',
  BANK_REWARDS: 'Bank rewards currencies',
  SHOPPING: 'Shopping portals',
  MERCHANT: 'Merchants',
  MEMBERSHIP: 'Memberships and clubs',
  SERVICE: 'Mail, bank-link and AI services',
};
export const KIND_ORDER: BrandKind[] = ['ISSUER', 'NETWORK', 'AIRLINE', 'HOTEL', 'BANK_REWARDS', 'SHOPPING', 'MERCHANT', 'MEMBERSHIP', 'SERVICE'];

/** lower case, letters and digits only ("U.S. Bank" → "usbank"; "Walmart+" keeps its plus). */
export const normalize = (s: string): string => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9+]/g, '');

const INDEX = new Map<string, Brand>();
for (const b of BRANDS) for (const t of [b.key, b.name, ...b.aliases, ...b.codes]) if (!INDEX.has(normalize(t))) INDEX.set(normalize(t), b);
const BY_LENGTH = [...INDEX.entries()].filter(([k]) => k.length >= 6).sort((a, b) => b[0].length - a[0].length);

export interface BrandQuery {
  /** program or currency code, e.g. MAR_BONVOY */
  code?: string | null;
  slug?: string | null;
  name?: string | null;
  issuer?: string | null;
  network?: string | null;
}

/**
 * Finds the brand for a name, code, slug or issuer. Exact matches only, unless `kinds` narrows the search to the
 * kinds that make sense (a program name such as "Marriott Bonvoy Boundless" may then contain a brand name).
 */
export function resolveBrand(input: string | BrandQuery | null | undefined, kinds?: BrandKind[]): Brand | null {
  if (!input) return null;
  const candidates = typeof input === 'string' ? [input] : [input.code, input.slug, input.issuer, input.network, input.name].filter((x): x is string => !!x);
  // a bank filter also takes the bank-owned rewards brands (Bilt is a card issuer and a rewards currency)
  const wanted = kinds && kinds.includes('ISSUER') && !kinds.includes('BANK_REWARDS') ? [...kinds, 'BANK_REWARDS' as BrandKind] : kinds;
  const ok = (b: Brand) => !wanted || wanted.includes(b.kind);
  for (const c of candidates) {
    const hit = INDEX.get(normalize(c));
    if (hit && ok(hit)) return hit;
  }
  if (kinds) {
    for (const c of candidates) {
      const n = normalize(c);
      if (n.length < 6) continue;
      const hit = BY_LENGTH.find(([k, b]) => n.includes(k) && ok(b));
      if (hit) return hit[1];
    }
  }
  return null;
}

const PALETTE = ['#1e3a8a', '#7c2d12', '#14532d', '#581c87', '#831843', '#134e4a', '#7f1d1d', '#312e81', '#3f3f46', '#0c4a6e'];

/** A stable dark colour for a name, so a monogram looks the same everywhere (white text always passes contrast). */
export function monogramColor(name: string): string {
  let h = 0;
  for (const ch of normalize(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const SKIP = new Set(['the', 'of', 'and', 'a', 'an', 'inc', 'co', 'bank']);

/** One or two capital letters for a name ("Wyndham Rewards" → "WR", "Citi" → "C"). */
export function initials(name: string): string {
  const words = name.replace(/[^A-Za-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean);
  const keep = words.filter((w) => !SKIP.has(w.toLowerCase()));
  const use = keep.length ? keep : words;
  if (!use.length) return '?';
  return use.length === 1 ? use[0].slice(0, use[0].length > 2 && /^[A-Z]{2,}$/.test(use[0]) ? 2 : 1).toUpperCase() : (use[0][0] + use[1][0]).toUpperCase();
}

export const brandsOfKind = (kind: BrandKind): Brand[] => BRANDS.filter((b) => b.kind === kind);
export const logoUrl = (b: Brand): string | null => (b.file ? `/brands/${b.file}` : null);
