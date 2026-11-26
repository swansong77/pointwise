/**
 * Merchants a grocery-category rate does not cover. Issuers code superstores (Walmart, Target) and warehouse clubs
 * (Costco, Sam's Club) separately from supermarkets, so a "4X at U.S. supermarkets" rate does not apply there. The rule's own
 * text states the exclusion for most cards; American Express's "U.S. supermarkets" wording excludes them as a program rule.
 * Pure: returns merchant slugs; the seed turns them into ids.
 */
export const SUPERSTORE_SLUGS = ['walmart', 'target'] as const;
export const CLUB_SLUGS = ['costco'] as const;

export interface ExclusionInput {
  cardSlug: string;
  issuerName?: string | null;
  categorySlug: string;
  description: string;
}

export function excludedMerchantSlugs(r: ExclusionInput): string[] {
  if (r.categorySlug !== 'groceries') return [];
  const d = r.description;
  const out = new Set<string>();
  // the rule says so: "(not Walmart or Target)", "(excl. Target and Walmart)", "not superstores like Walmart and Target", "not discount stores, supercenters or wholesale clubs"
  if (/\b(not|excl\.?|excluding|except)\b[^)]*\b(walmart|target|superstores?|supercenters?|discount stores?)\b/i.test(d)) SUPERSTORE_SLUGS.forEach((s) => out.add(s));
  if (/\b(not|excl\.?|excluding|except)\b[^)]*\b(wholesale|clubs?|warehouse)\b/i.test(d)) CLUB_SLUGS.forEach((s) => out.add(s));
  // American Express: "U.S. supermarkets" never includes superstores or warehouse clubs
  const amex = /^amex-/.test(r.cardSlug) || /american express/i.test(r.issuerName ?? '');
  if (amex && /U\.S\. supermarkets/i.test(d)) [...SUPERSTORE_SLUGS, ...CLUB_SLUGS].forEach((s) => out.add(s));
  return [...out];
}
