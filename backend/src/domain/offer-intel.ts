/**
 * Offer intelligence (pure): where today's welcome offer sits in the card's own history, how hard the
 * application is for this applicant, and what to do about the expiry. Inputs are public catalog data plus
 * the applicant's own counts; nothing here calls a model. See docs/architecture-decisions.md (ADR-003, ADR-008).
 *
 * All thresholds live in OFFER_CONFIG so they are visible, versioned and tested rather than scattered.
 */
import { median, OfferPoint } from './card-extract';

export const OFFER_ENGINE_VERSION = 'offer-intel/1';

export const OFFER_CONFIG = {
  /** at or above this share of the best-ever value counts as "near the historic high" */
  nearHighRatio: 0.9,
  /** at or above this multiple of the 24-month median counts as elevated */
  elevatedFactor: 1.2,
  /** below this multiple of the 24-month median counts as below typical */
  belowTypicalFactor: 0.9,
  /** days before expiry that make an elevated offer urgent */
  urgentDays: 14,
  /** days before expiry that are worth mentioning */
  soonDays: 45,
  /** history window for "typical" */
  medianMonths: 24,
} as const;

export type OfferVerdict = 'BEST_EVER' | 'NEAR_HIGH' | 'ELEVATED' | 'TYPICAL' | 'BELOW_TYPICAL' | 'UNKNOWN';

export interface OfferStats {
  currentValueCents: number | null;
  bestEverCents: number | null;
  /** when the best-ever version started */
  bestEverSince: Date | null;
  median24mCents: number | null;
  /** all versions ever recorded */
  versions: number;
  /** share (0–1) of the card's recorded time during which the offer was worth less than today's */
  percentile: number | null;
  /** days the current version has been open */
  daysAtCurrent: number | null;
  verdict: OfferVerdict;
}

const DAY = 86_400_000;

/** Verdict of a current value against its history. `history` includes the current open version. */
export function offerStats(history: OfferPoint[], now: Date): OfferStats {
  const valued = history.filter((h) => h.valuationCents != null);
  const current = history.find((h) => h.validTo == null) ?? null;
  const cur = current?.valuationCents ?? null;
  const base: OfferStats = {
    currentValueCents: cur,
    bestEverCents: null,
    bestEverSince: null,
    median24mCents: null,
    versions: history.length,
    percentile: null,
    daysAtCurrent: current ? Math.max(0, Math.floor((now.getTime() - current.validFrom.getTime()) / DAY)) : null,
    verdict: 'UNKNOWN',
  };
  if (!valued.length) return base;
  const best = valued.reduce((b, h) => ((h.valuationCents as number) > (b.valuationCents as number) ? h : b));
  base.bestEverCents = best.valuationCents;
  base.bestEverSince = best.validFrom;
  const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - OFFER_CONFIG.medianMonths, now.getUTCDate()));
  base.median24mCents = median(
    valued.filter((h) => (h.validTo ?? now) >= since).map((h) => h.valuationCents as number),
  );
  if (cur == null) return base;

  // time-weighted percentile: how long was the offer worth less than it is today
  let total = 0;
  let below = 0;
  for (const h of valued) {
    const end = (h.validTo ?? now).getTime();
    const days = Math.max(1, (end - h.validFrom.getTime()) / DAY);
    total += days;
    if ((h.valuationCents as number) < cur) below += days;
    else if (h.valuationCents === cur) below += days / 2;
  }
  base.percentile = total ? Math.round((below / total) * 100) / 100 : null;
  base.verdict = verdictFor(cur, base.bestEverCents, base.median24mCents, valued.length);
  return base;
}

export function verdictFor(current: number, bestEver: number | null, med: number | null, versions: number): OfferVerdict {
  if (bestEver == null) return 'UNKNOWN';
  // with a single recorded version there is nothing to compare against
  if (versions < 2) return 'TYPICAL';
  if (current >= bestEver) return 'BEST_EVER';
  if (current >= bestEver * OFFER_CONFIG.nearHighRatio) return 'NEAR_HIGH';
  if (med != null && med > 0) {
    if (current >= med * OFFER_CONFIG.elevatedFactor) return 'ELEVATED';
    if (current < med * OFFER_CONFIG.belowTypicalFactor) return 'BELOW_TYPICAL';
  }
  return 'TYPICAL';
}

// ───────────── application difficulty ─────────────

export type Difficulty = 'EASY' | 'MODERATE' | 'HARD' | 'BLOCKED';

export interface IssuerRule {
  issuer: string;
  /** short rule name */
  rule: string;
  /** how many new accounts (any issuer) within `months` make this rule bite */
  maxNew: number;
  months: number;
  /** only the issuer's own cards count toward the limit */
  ownOnly: boolean;
  /** true once confirmed from an issuer page; false = community-reported (shown as such) */
  verified: boolean;
  source: string;
}

/**
 * Starting table. Every rule here is community-reported until confirmed from the issuer's own wording
 * (docs/offer-sources-research.md); the UI labels unverified rules and never states them as fact.
 */
export const ISSUER_RULES: IssuerRule[] = [
  { issuer: 'chase', rule: '5/24', maxNew: 5, months: 24, ownOnly: false, verified: false, source: 'community-reported' },
  { issuer: 'barclays', rule: '6/24', maxNew: 6, months: 24, ownOnly: false, verified: false, source: 'community-reported' },
  { issuer: 'citi', rule: '1/8 and 2/65', maxNew: 1, months: 0.27, ownOnly: true, verified: false, source: 'community-reported' },
  { issuer: 'american express', rule: '1 in 5 days, 2 in 90 days', maxNew: 2, months: 3, ownOnly: true, verified: false, source: 'community-reported' },
  { issuer: 'capital one', rule: '1 per 6 months', maxNew: 1, months: 6, ownOnly: true, verified: false, source: 'community-reported' },
  { issuer: 'bank of america', rule: '2/3/4', maxNew: 2, months: 2, ownOnly: false, verified: false, source: 'community-reported' },
];

export interface ApplicantActivity {
  /** new accounts opened in the last N months, any issuer (personal + counting business) */
  newAccountsAny: (months: number) => number;
  /** same, restricted to the issuer being evaluated */
  newAccountsAt: (issuer: string, months: number) => number;
  /** the applicant already holds (or recently had) this product, so a bonus may not be paid */
  holdsProduct?: boolean;
}

export interface DifficultyResult {
  level: Difficulty;
  reasons: string[];
  /** rules that were evaluated and their verification state */
  rules: Array<{ rule: string; verified: boolean }>;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * How hard this application is for this applicant. Rules that are not issuer-verified can raise the level
 * to HARD at most — only a verified rule may say BLOCKED — so an unconfirmed community rule never tells
 * someone they cannot apply.
 */
export function applicationDifficulty(issuer: string, a: ApplicantActivity, rules: IssuerRule[] = ISSUER_RULES): DifficultyResult {
  const key = norm(issuer);
  const matched = rules.filter((r) => key.includes(r.issuer) || r.issuer.includes(key));
  const reasons: string[] = [];
  let level: Difficulty = 'EASY';
  const raise = (to: Difficulty) => {
    const order: Difficulty[] = ['EASY', 'MODERATE', 'HARD', 'BLOCKED'];
    if (order.indexOf(to) > order.indexOf(level)) level = to;
  };
  for (const r of matched) {
    const n = r.ownOnly ? a.newAccountsAt(issuer, Math.max(1, Math.ceil(r.months))) : a.newAccountsAny(r.months);
    const tag = r.verified ? '' : ' (community-reported rule)';
    if (n >= r.maxNew) {
      reasons.push(`${r.rule}: ${n} new account${n === 1 ? '' : 's'} in the window${tag}`);
      raise(r.verified ? 'BLOCKED' : 'HARD');
    } else if (n === r.maxNew - 1 && r.maxNew > 1) {
      reasons.push(`${r.rule}: one slot left${tag}`);
      raise('MODERATE');
    }
  }
  if (a.holdsProduct) {
    reasons.push('You hold or recently held this product; the welcome bonus may not be paid again');
    raise('HARD');
  }
  if (!reasons.length) reasons.push(matched.length ? 'No limit reached' : 'No known velocity rule for this issuer');
  return { level, reasons, rules: matched.map((r) => ({ rule: r.rule, verified: r.verified })) };
}

// ───────────── expiry intelligence ─────────────

export type AdviceTone = 'urgent' | 'positive' | 'neutral' | 'caution';
export interface Advice {
  code: string;
  text: string;
  tone: AdviceTone;
  /** lower sorts first */
  priority: number;
}

export interface AdviceInput {
  verdict: OfferVerdict;
  /** null = no stated expiry */
  daysToExpiry: number | null;
  bestEverCents: number | null;
  currentValueCents: number | null;
  /** the applicant is blocked from this card (e.g. 5/24) */
  applicantBlocked?: boolean;
  /** another household member who is not blocked, if any */
  alternateMember?: string | null;
}

const money = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;

/** Plain-language guidance, most important first. Deterministic: same inputs, same text. */
export function offerAdvice(i: AdviceInput): Advice[] {
  const out: Advice[] = [];
  const high = i.verdict === 'BEST_EVER' || i.verdict === 'NEAR_HIGH' || i.verdict === 'ELEVATED';
  if (i.daysToExpiry != null && i.daysToExpiry < 0) {
    out.push({ code: 'EXPIRED', text: 'This offer has expired.', tone: 'caution', priority: 0 });
    return out;
  }
  if (i.applicantBlocked) {
    out.push(
      i.alternateMember
        ? { code: 'MOVE_TO_MEMBER', text: `Move the application to ${i.alternateMember}.`, tone: 'neutral', priority: 1 }
        : { code: 'BLOCKED', text: 'You are not eligible for this card right now.', tone: 'caution', priority: 1 },
    );
  }
  if (i.daysToExpiry != null && high && i.daysToExpiry <= OFFER_CONFIG.urgentDays) {
    out.push({
      code: 'APPLY_BEFORE_EXPIRY',
      text: `Apply within ${i.daysToExpiry} day${i.daysToExpiry === 1 ? '' : 's'} before this elevated offer expires.`,
      tone: 'urgent',
      priority: 2,
    });
  } else if (i.daysToExpiry != null && i.daysToExpiry <= OFFER_CONFIG.soonDays) {
    out.push({ code: 'EXPIRES_SOON', text: `This offer expires in ${i.daysToExpiry} days.`, tone: 'neutral', priority: 4 });
  }
  switch (i.verdict) {
    case 'BEST_EVER':
      out.push({ code: 'BEST_EVER', text: 'This is the best offer on record for this card.', tone: 'positive', priority: 3 });
      break;
    case 'NEAR_HIGH':
      out.push({ code: 'NEAR_HIGH', text: 'Current offer is near its historic high.', tone: 'positive', priority: 3 });
      break;
    case 'ELEVATED':
      out.push({ code: 'PRIORITIZE', text: 'Offer likely worth prioritizing.', tone: 'positive', priority: 3 });
      break;
    case 'BELOW_TYPICAL':
      out.push({
        code: 'WAIT',
        text:
          i.bestEverCents != null
            ? `Wait for a better offer; this card has been worth up to ${money(i.bestEverCents)}.`
            : 'Wait for a better offer.',
        tone: 'caution',
        priority: 3,
      });
      break;
    default:
      break;
  }
  return out.sort((a, b) => a.priority - b.priority);
}

/** Whole days from now until `expires` (negative once past), or null when there is no expiry. */
export function daysUntil(expires: Date | null | undefined, now: Date): number | null {
  if (!expires) return null;
  const a = Date.UTC(expires.getUTCFullYear(), expires.getUTCMonth(), expires.getUTCDate());
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((a - b) / DAY);
}

// ───────────── auto-publish policy ─────────────

export interface ProposedChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
  /** domain the value was read from */
  sourceHost: string | null;
  /** the issuer's own domains for this card */
  issuerHosts: string[];
  /** extraction confidence 0–1 */
  confidence: number;
  cardKnown: boolean;
}

export const AUTO_PUBLISH = {
  minConfidence: 0.8,
  /** largest relative change that may publish without a human */
  maxChangeRatio: 0.6,
  /** plausible bounds per numeric field */
  bounds: {
    bonusAmount: [0, 500_000],
    bonusSpendCents: [0, 20_000_00],
    bonusMonths: [0, 12],
    annualFeeCents: [0, 1_500_00],
    authorizedUserFeeCents: [0, 1_000_00],
  } as Record<string, [number, number]>,
} as const;

export type PublishDecision = { action: 'PUBLISH' | 'REVIEW'; reasons: string[] };

const hostMatches = (host: string, allowed: string[]) =>
  allowed.some((a) => host === a || host.endsWith(`.${a}`));

/**
 * Publish automatically only when the value came from the issuer's own domain for a known card, with
 * high extraction confidence, within plausible bounds and a bounded change. Anything else is reviewed.
 */
export function autoPublishDecision(c: ProposedChange): PublishDecision {
  const why: string[] = [];
  if (!c.cardKnown) why.push('card is not in the catalog');
  if (!c.sourceHost || !hostMatches(c.sourceHost.toLowerCase(), c.issuerHosts.map((h) => h.toLowerCase())))
    why.push('not read from the issuer\'s own domain');
  if (c.confidence < AUTO_PUBLISH.minConfidence) why.push(`extraction confidence ${c.confidence.toFixed(2)} is below ${AUTO_PUBLISH.minConfidence}`);
  const bounds = AUTO_PUBLISH.bounds[c.field];
  if (typeof c.newValue === 'number') {
    if (!bounds) why.push(`no plausibility bounds for ${c.field}`);
    else if (c.newValue < bounds[0] || c.newValue > bounds[1]) why.push(`${c.field} ${c.newValue} is outside the plausible range`);
    if (typeof c.oldValue === 'number' && c.oldValue > 0) {
      const ratio = Math.abs(c.newValue - c.oldValue) / c.oldValue;
      if (ratio > AUTO_PUBLISH.maxChangeRatio) why.push(`change of ${Math.round(ratio * 100)}% is larger than ${Math.round(AUTO_PUBLISH.maxChangeRatio * 100)}%`);
    }
  } else if (c.field !== 'bonusType' && c.field !== 'offerExpiresAt' && c.field !== 'foreignTxFee') {
    why.push(`${c.field} is not auto-publishable`);
  }
  return why.length ? { action: 'REVIEW', reasons: why } : { action: 'PUBLISH', reasons: ['verified from the issuer\'s own page'] };
}
