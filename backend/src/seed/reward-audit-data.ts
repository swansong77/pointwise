import type { AuditCard, AuditReward } from '../domain/reward-audit';
import { REAL_CARDS, REAL_CURRENCIES } from './real-catalog.data';
import { REGISTRY_CURRENCIES } from './loyalty-registry';
import { LISTING_CURRENCIES, VERIFIED_LISTINGS, listingSlug } from './verified-listings';
import { RATES_VERIFIED_ON, RATE_CORRECTIONS, RATE_VERIFICATIONS } from './rate-verification';

const tuple = (t: [string, number, string, number?, ('QUARTER' | 'YEAR')?], verifiedOn?: string | null): AuditReward => ({ cat: t[0], mult: t[1], desc: t[2], cap: t[3] ?? null, capPeriod: t[3] ? (t[4] ?? 'YEAR') : null, verifiedOn: verifiedOn ?? null });

/** The cards as the seed leaves them: curated list, then issuer listings over it, then the issuer-page checks over both. */
export function auditCards(): { cards: AuditCard[]; currencies: string[] } {
  const bySlug = new Map<string, AuditCard>();
  for (const c of REAL_CARDS) {
    bySlug.set(c.slug, {
      slug: c.slug,
      name: c.name,
      issuer: c.issuer,
      currency: c.currency,
      feeDollars: c.feeDollars,
      source: 'CURATED',
      rewards: [...c.rewards.map((t) => tuple(t)), ...(c.merchantRewards ?? []).map((m) => ({ merchant: m[0], mult: m[1], desc: m[2] }))],
    });
  }
  for (const l of VERIFIED_LISTINGS) {
    for (const lc of l.cards) {
      const slug = listingSlug(l.issuer, lc);
      const existing = bySlug.get(slug);
      if (existing) {
        existing.feeDollars = lc.feeDollars;
        if (lc.rewards?.length) {
          // the listing's rates replace the curated ones; the curated base rate stays when the listing states none
          const base = lc.rewards.some((t) => t[0] === 'everything-else') ? null : existing.rewards.find((r) => r.cat === 'everything-else' && !r.merchant);
          existing.rewards = [...(base ? [base] : []), ...lc.rewards.map((t) => tuple(t, l.fetchedOn))];
        }
      } else {
        bySlug.set(slug, { slug, name: lc.name, issuer: l.issuer, currency: lc.currency ?? 'CASH', feeDollars: lc.feeDollars, source: 'LISTING', rewards: (lc.rewards ?? []).map((t) => tuple(t, l.fetchedOn)) });
      }
    }
  }
  for (const v of RATE_VERIFICATIONS) {
    const c = bySlug.get(v.slug);
    if (!c) continue;
    if (v.feeDollars !== undefined) c.feeDollars = v.feeDollars;
    for (const r of v.rates) {
      const next: AuditReward = { cat: r.cat ?? null, merchant: r.merchant ?? null, mult: r.mult, desc: r.desc, cap: r.cap ?? null, capPeriod: r.cap ? (r.capPeriod ?? 'YEAR') : null, conditional: !!r.conditional, rotating: !!r.rotating, verifiedOn: RATES_VERIFIED_ON };
      const i = c.rewards.findIndex((x) => (x.cat ?? null) === next.cat && (x.merchant ?? null) === next.merchant && !!x.conditional === !!next.conditional && !!x.rotating === !!next.rotating);
      if (i >= 0) c.rewards[i] = next;
      else c.rewards.push(next);
    }
  }
  for (const k of RATE_CORRECTIONS) for (const r of bySlug.get(k.slug)?.rewards ?? []) if (r.cat === k.cat && !r.merchant && !r.verifiedOn) r.conditional = true;
  const currencies = [...new Set([...REAL_CURRENCIES, ...REGISTRY_CURRENCIES, ...LISTING_CURRENCIES].map((x) => x.code)), 'CASH'];
  return { cards: [...bySlug.values()], currencies };
}
