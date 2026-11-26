import { InvItem } from './offer-snapshot-diff';

/**
 * Member-defined enrollment rules ("always add Hilton offers", "never add gambling offers", "offers over $25").
 * A NEVER rule always wins over an ALWAYS rule, whatever the priority.
 */
export const RULES_VERSION = 'enroll-rules/1';

export type RuleKindName = 'ALWAYS' | 'NEVER';
export type RuleMatcherName = 'MERCHANT' | 'CATEGORY' | 'MIN_VALUE' | 'OFFER_TYPE' | 'KEYWORD' | 'SPEND_HISTORY';

export interface Rule {
  id: string;
  label: string;
  kind: RuleKindName;
  matcher: RuleMatcherName;
  /** merchant or keyword text; category name; minimum value in cents; offer type; ignored for SPEND_HISTORY */
  matcherValue: string;
  accountId?: string | null;
  walletCardId?: string | null;
  priority: number;
  enabled: boolean;
}

export const CATEGORY_WORDS: Record<string, string[]> = {
  gambling: ['casino', 'sportsbook', 'draftkings', 'fanduel', 'betmgm', 'lottery', 'poker', 'gambling', 'betting', 'caesars sportsbook'],
  crypto: ['crypto', 'coinbase', 'binance', 'bitcoin', 'kraken', 'gemini exchange', 'blockchain', 'ethereum'],
  subscription: ['subscription', 'monthly plan', 'streaming', 'netflix', 'spotify', 'hulu', 'disney+', 'sirius', 'membership', 'peacock', 'hbo max', 'paramount+'],
  travel: ['hotel', 'resort', 'airline', 'airways', 'flight', 'hilton', 'marriott', 'hyatt', 'ihg', 'wyndham', 'delta', 'united', 'american airlines', 'southwest', 'jetblue', 'alaska air', 'expedia', 'booking.com', 'airbnb', 'vrbo', 'hertz', 'avis', 'cruise', 'travel', 'car rental'],
  dining: ['restaurant', 'dining', 'cafe', 'coffee', 'pizza', 'grill', 'kitchen', 'steakhouse', 'starbucks', 'doordash', 'grubhub', 'uber eats', 'chipotle', 'mcdonald', 'bistro', 'bakery'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+.& ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** The categories an offer belongs to: the source's own category, then keyword matches in the merchant and title. */
export function categoriesOf(i: Pick<InvItem, 'merchantText' | 'title' | 'category'>): string[] {
  const text = ` ${norm(`${i.merchantText} ${i.title} ${i.category ?? ''}`)} `;
  const out = new Set<string>();
  if (i.category) out.add(norm(i.category));
  for (const [cat, words] of Object.entries(CATEGORY_WORDS)) if (words.some((w) => text.includes(` ${norm(w)}`) || text.includes(norm(w) + ' '))) out.add(cat);
  return [...out];
}

/** Value in cents, estimated for percent and points offers (assumed spend: the minimum spend, else $100; a point is 1 cent). */
export function effectiveValueCents(i: Pick<InvItem, 'valueCents' | 'percent' | 'points' | 'minSpendCents'>): number {
  if (i.valueCents > 0) return i.valueCents;
  if (i.percent) return Math.round((i.percent / 100) * (i.minSpendCents ?? 10_000));
  if (i.points) return i.points;
  return 0;
}

export interface RuleContext {
  /** normalised names of merchants the household has spent at */
  spendMerchants: Set<string>;
  accountId?: string;
}

export interface RuleVerdict {
  verdict: 'ALWAYS' | 'NEVER' | null;
  rule: Rule | null;
  explanation: string;
}

function matches(r: Rule, i: InvItem, ctx: RuleContext): boolean {
  const v = norm(r.matcherValue);
  switch (r.matcher) {
    case 'MERCHANT':
      return !!v && (norm(i.merchantText).includes(v) || v.includes(norm(i.merchantText)) && norm(i.merchantText).length >= 3);
    case 'KEYWORD':
      return !!v && norm(`${i.merchantText} ${i.title}`).includes(v);
    case 'CATEGORY':
      return categoriesOf(i).includes(v);
    case 'MIN_VALUE':
      return effectiveValueCents(i) >= Number(r.matcherValue);
    case 'OFFER_TYPE':
      return i.offerType === r.matcherValue.toUpperCase();
    case 'SPEND_HISTORY':
      return ctx.spendMerchants.has(norm(i.merchantText));
  }
}

const inScope = (r: Rule, i: InvItem, ctx: RuleContext) => (!r.accountId || r.accountId === ctx.accountId) && (!r.walletCardId || r.walletCardId === i.cardKey);

/** Evaluates all enabled rules for an offer. NEVER beats ALWAYS; within a kind the lowest priority number wins. */
export function evaluateRules(item: InvItem, rules: Rule[], ctx: RuleContext): RuleVerdict {
  const hits = rules.filter((r) => r.enabled && inScope(r, item, ctx) && matches(r, item, ctx)).sort((a, b) => a.priority - b.priority);
  const never = hits.find((r) => r.kind === 'NEVER');
  if (never) return { verdict: 'NEVER', rule: never, explanation: `Blocked by your rule "${never.label}"${hits.some((r) => r.kind === 'ALWAYS') ? ' (a never-rule wins over an always-rule)' : ''}.` };
  const always = hits.find((r) => r.kind === 'ALWAYS');
  if (always) return { verdict: 'ALWAYS', rule: always, explanation: `Matches your rule "${always.label}".` };
  return { verdict: null, rule: null, explanation: 'No rule matched.' };
}

export const normalizeMerchant = norm;
