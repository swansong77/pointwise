/**
 * Offer stacking (pure): which value sources can be combined on one purchase, and what that is worth. Rules are
 * data (STACK_RULES) and every one is flagged unverified (community-reported, not an issuer statement), so they
 * surface as warnings with a risk-weighted value, never as facts (ADR-012).
 */

export type StackKind = 'CARD_EARN' | 'ISSUER_OFFER' | 'PORTAL' | 'COUPON' | 'GIFT_CARD' | 'STORE_SALE';
export type Compat = 'STACKS' | 'RISK' | 'CONFLICT';

export interface StackRule {
  a: StackKind;
  b: StackKind;
  compat: Compat;
  note: string;
  /** true only after the rule has been confirmed from an issuer / portal statement */
  verified: boolean;
}

export const STACK_RULES_VERSION = 'stack-rules/1';
export const RISK_WEIGHT = 0.5;

export const STACK_RULES: StackRule[] = [
  { a: 'ISSUER_OFFER', b: 'PORTAL', compat: 'STACKS', note: 'A card-linked offer and a portal cash-back are tracked separately, so they are commonly combined.', verified: false },
  { a: 'ISSUER_OFFER', b: 'CARD_EARN', compat: 'STACKS', note: 'Offer credits post as statement credits; the card still earns its normal rewards.', verified: false },
  { a: 'PORTAL', b: 'CARD_EARN', compat: 'STACKS', note: 'Portal cash-back is paid by the portal; the card earns on the charge.', verified: false },
  { a: 'ISSUER_OFFER', b: 'COUPON', compat: 'STACKS', note: 'Coupons reduce the price; the card offer applies to what you pay.', verified: false },
  { a: 'ISSUER_OFFER', b: 'STORE_SALE', compat: 'STACKS', note: 'A sale price lowers the total; offers usually apply to the amount charged.', verified: false },
  { a: 'PORTAL', b: 'COUPON', compat: 'RISK', note: 'Entering a coupon code from another site can void portal tracking.', verified: false },
  { a: 'PORTAL', b: 'GIFT_CARD', compat: 'RISK', note: 'Portals often exclude gift-card purchases.', verified: false },
  { a: 'GIFT_CARD', b: 'ISSUER_OFFER', compat: 'CONFLICT', note: 'Gift-card purchases are commonly excluded from card-linked offers.', verified: false },
  { a: 'GIFT_CARD', b: 'CARD_EARN', compat: 'RISK', note: 'Gift cards may not earn bonus-category rewards.', verified: false },
];

export interface StackComponent {
  kind: StackKind;
  label: string;
  cents: number;
  /** 0–100, from the source's reliability */
  confidence: number;
  evidence: string;
}

export interface StackResult {
  /** components counted, in the order to apply them */
  included: StackComponent[];
  /** components dropped because of a conflict */
  excluded: Array<{ component: StackComponent; because: string }>;
  /** every component's value if all rules hold */
  maxCents: number;
  /** value with risky pairs weighted at RISK_WEIGHT */
  expectedCents: number;
  warnings: Array<{ pair: [StackKind, StackKind]; compat: Compat; note: string; verified: boolean }>;
  /** true only if every rule that applied is verified */
  allRulesVerified: boolean;
  confidence: number;
  version: string;
}

const ORDER: StackKind[] = ['STORE_SALE', 'COUPON', 'PORTAL', 'CARD_EARN', 'ISSUER_OFFER', 'GIFT_CARD'];

function ruleFor(x: StackKind, y: StackKind, rules: StackRule[]): StackRule | undefined {
  return rules.find((r) => (r.a === x && r.b === y) || (r.a === y && r.b === x));
}

export function buildStack(components: StackComponent[], rules: StackRule[] = STACK_RULES): StackResult {
  const live = components.filter((c) => c.cents > 0 && c.confidence > 0);
  const excluded: StackResult['excluded'] = [];
  let kept = [...live];
  // resolve conflicts by dropping the smaller of the pair
  for (const r of rules.filter((x) => x.compat === 'CONFLICT')) {
    const a = kept.find((c) => c.kind === r.a);
    const b = kept.find((c) => c.kind === r.b);
    if (a && b) {
      const [keep, drop] = a.cents >= b.cents ? [a, b] : [b, a];
      kept = kept.filter((c) => c !== drop);
      excluded.push({ component: drop, because: `${r.note} (kept ${keep.label})` });
    }
  }
  const warnings: StackResult['warnings'] = [];
  const applied: StackRule[] = [];
  const riskyKinds = new Set<StackKind>();
  for (let i = 0; i < kept.length; i++)
    for (let j = i + 1; j < kept.length; j++) {
      const r = ruleFor(kept[i].kind, kept[j].kind, rules);
      if (!r) continue;
      applied.push(r);
      if (r.compat !== 'STACKS') {
        warnings.push({ pair: [r.a, r.b], compat: r.compat, note: r.note, verified: r.verified });
        if (r.compat === 'RISK') {
          // the smaller side of a risky pair is the one that may not pay out
          const [x, y] = [kept[i], kept[j]];
          riskyKinds.add((x.cents <= y.cents ? x : y).kind);
        }
      }
    }
  const included = [...kept].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const maxCents = included.reduce((s, c) => s + c.cents, 0);
  const expectedCents = Math.round(included.reduce((s, c) => s + c.cents * (riskyKinds.has(c.kind) ? RISK_WEIGHT : 1), 0));
  return {
    included,
    excluded,
    maxCents,
    expectedCents,
    warnings,
    allRulesVerified: applied.every((r) => r.verified),
    confidence: included.length ? Math.min(...included.map((c) => c.confidence)) : 0,
    version: STACK_RULES_VERSION,
  };
}
