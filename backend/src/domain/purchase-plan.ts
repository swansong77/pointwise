/**
 * Purchase planner (pure): for "I am about to spend $X at merchant Y", rank the household's cards by net return
 * (card earn + applicable offer + portal, stacked per offer-stack rules), and test splitting the spend across two
 * cards. Every plan carries its justification, evidence and confidence; a claim without evidence is omitted
 * (ADR-012). No model is involved.
 */
import { buildStack, StackComponent, StackResult } from './offer-stack';
import { confidenceCap } from './offer-import';
import { eligibilityState, OfferTerms, offerValueCents } from './offer-engine';

export const PLAN_VERSION = 'purchase-plan/1';
/** earn rules come from the card catalog, not a user claim */
export const EARN_CONFIDENCE = 90;
/** a split must beat the best single card by at least this much to be suggested */
export const MIN_SPLIT_GAIN_CENTS = 100;

export interface PlanCard {
  walletCardId: string;
  cardName: string;
  /** household member who holds the card */
  member: string | null;
  isAuthorizedUser: boolean;
  /** rewards earned per dollar at this merchant, in cents (from the ranking engine) */
  centsPerDollar: number;
  earnReason: string;
}

export interface PlanOffer {
  terms: OfferTerms;
  title: string;
  /** wallet cards the offer can be on */
  eligibleWalletCardIds: string[];
  userOffers: Array<{ walletCardId: string; status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED'; activationStatus: 'NOT_REQUIRED' | 'PENDING' | 'ACTIVATED' | 'FAILED' }>;
  offersUrl?: string | null;
}

export interface PortalRateInput {
  portal: string;
  ratePercent: number;
  source: string;
  /** 0–100 */
  reliability: number;
}

export interface PlanInput {
  merchant: { id: string | null; name: string };
  amountCents: number;
  now: Date;
  cards: PlanCard[];
  offers: PlanOffer[];
  portalRates: PortalRateInput[];
  /** resolution confidence for the merchant (0–1); below 0.8 the plan says so */
  merchantConfidence?: number;
}

export interface PlanLeg {
  walletCardId: string;
  cardName: string;
  member: string | null;
  isAuthorizedUser: boolean;
  amountCents: number;
  earnCents: number;
  offerCents: number;
  offerTitle: string | null;
  needsActivation: boolean;
  offersUrl: string | null;
}

export interface Plan {
  kind: 'SINGLE' | 'SPLIT';
  legs: PlanLeg[];
  portal: { portal: string; cents: number } | null;
  stack: StackResult;
  /** risk-weighted net return, cents */
  expectedCents: number;
  maxCents: number;
  confidence: number;
  justification: string[];
  evidence: string[];
  warnings: string[];
  actions: string[];
}

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

interface Candidate {
  card: PlanCard;
  offer: PlanOffer | null;
  offerCents: number;
  needsActivation: boolean;
  offerConfidence: number;
  offerMinOk: boolean;
}

function bestOfferFor(card: PlanCard, amount: number, offers: PlanOffer[], now: Date): Candidate {
  let best: Candidate = { card, offer: null, offerCents: 0, needsActivation: false, offerConfidence: 0, offerMinOk: true };
  for (const o of offers) {
    if (!o.eligibleWalletCardIds.includes(card.walletCardId)) continue;
    const cap = confidenceCap(o.terms.source, o.terms.verification);
    if (cap === 0) continue;
    const uo = o.userOffers.find((u) => u.walletCardId === card.walletCardId) ?? null;
    const state = eligibilityState(o.terms, uo, 0, now);
    if (state === 'EXPIRED' || state === 'COMPLETED') continue;
    if (o.terms.startsAt && o.terms.startsAt > now) continue;
    const minOk = o.terms.minSpendCents == null || amount >= o.terms.minSpendCents;
    // below the minimum the offer pays nothing, but it is kept so the plan can say what is missing
    const cents = minOk ? offerValueCents(o.terms, amount) : o.terms.valueCents;
    if (best.offer && best.offerMinOk && !minOk) continue;
    if (best.offer && best.offerMinOk === minOk && cents <= best.offerCents) continue;
    best = { card, offer: o, offerCents: cents, needsActivation: state === 'ELIGIBLE' && o.terms.enrollmentRequired, offerConfidence: cap, offerMinOk: minOk };
  }
  return best;
}

function portalFor(rates: PortalRateInput[], amount: number): { rate: PortalRateInput; cents: number } | null {
  let best: { rate: PortalRateInput; cents: number } | null = null;
  for (const r of rates) {
    const cents = Math.round((amount * r.ratePercent) / 100);
    if (cents > (best?.cents ?? 0)) best = { rate: r, cents };
  }
  return best;
}

function makePlan(kind: Plan['kind'], legs: Array<{ c: Candidate; amount: number; earn: number; offerCents: number }>, input: PlanInput): Plan {
  const portal = portalFor(input.portalRates, input.amountCents);
  const comps: StackComponent[] = [];
  const evidence: string[] = [];
  const justification: string[] = [];
  const warnings: string[] = [];
  const actions: string[] = [];
  for (const l of legs) {
    const who = `${l.c.card.cardName}${l.c.card.member ? ` (${l.c.card.member})` : ''}`;
    comps.push({ kind: 'CARD_EARN', label: `${who} earn`, cents: l.earn, confidence: EARN_CONFIDENCE, evidence: l.c.card.earnReason });
    evidence.push(`card earn: ${who} — ${l.c.card.earnReason}`);
    justification.push(`${who} returns ${usd(l.earn)} on ${usd(l.amount)} (${l.c.card.centsPerDollar.toFixed(2)}¢ per $).`);
    if (l.c.card.isAuthorizedUser) warnings.push(`${who} is an authorized-user card; its offers and rewards belong to the primary account.`);
    if (l.offerCents > 0 && l.c.offer) {
      const t = l.c.offer.terms;
      comps.push({ kind: 'ISSUER_OFFER', label: l.c.offer.title, cents: l.offerCents, confidence: l.c.offerConfidence, evidence: `offer ${t.id} (${t.source}, ${t.verification})` });
      evidence.push(`offer ${t.id}: ${l.c.offer.title} — source ${t.source}, ${t.verification.toLowerCase()}, confidence cap ${l.c.offerConfidence}`);
      justification.push(`${l.c.offer.title} credits ${usd(l.offerCents)}${t.minSpendCents ? ` once ${usd(t.minSpendCents)} is spent` : ''}.`);
      if (l.c.needsActivation) actions.push(`Activate "${l.c.offer.title}" on ${l.c.card.cardName} before paying${l.c.offer.offersUrl ? ` (${l.c.offer.offersUrl})` : ''}.`);
    }
  }
  if (portal) {
    comps.push({ kind: 'PORTAL', label: `${portal.rate.portal} ${portal.rate.ratePercent}%`, cents: portal.cents, confidence: portal.rate.reliability, evidence: `portal rate: ${portal.rate.source}` });
    evidence.push(`portal ${portal.rate.portal}: ${portal.rate.ratePercent}% — ${portal.rate.source}`);
    justification.push(`${portal.rate.portal} adds ${usd(portal.cents)} (${portal.rate.ratePercent}%) if you click through first.`);
    actions.push(`Start from the ${portal.rate.portal} link, then pay with the card above.`);
  }
  const stack = buildStack(comps);
  for (const w of stack.warnings) warnings.push(`${w.pair.join(' + ')}: ${w.note}${w.verified ? '' : ' (community-reported, not confirmed)'}`);
  for (const x of stack.excluded) warnings.push(`Not counted: ${x.component.label} — ${x.because}`);
  if ((input.merchantConfidence ?? 1) < 0.8) warnings.push('The merchant name was matched with low confidence; confirm it is the right merchant.');
  return {
    kind,
    legs: legs.map((l) => ({
      walletCardId: l.c.card.walletCardId,
      cardName: l.c.card.cardName,
      member: l.c.card.member,
      isAuthorizedUser: l.c.card.isAuthorizedUser,
      amountCents: l.amount,
      earnCents: l.earn,
      offerCents: l.offerCents,
      offerTitle: l.offerCents > 0 ? l.c.offer?.title ?? null : null,
      needsActivation: l.offerCents > 0 && l.c.needsActivation,
      offersUrl: l.c.offer?.offersUrl ?? null,
    })),
    portal: portal ? { portal: portal.rate.portal, cents: portal.cents } : null,
    stack,
    expectedCents: stack.expectedCents,
    maxCents: stack.maxCents,
    confidence: stack.confidence,
    justification,
    evidence,
    warnings,
    actions,
  };
}

/** Ranked plans, best first. Empty when there is no card to evaluate. */
export function planPurchase(input: PlanInput): Plan[] {
  const { amountCents: amount, cards } = input;
  if (!cards.length || amount <= 0) return [];
  const earn = (c: PlanCard, a: number) => Math.round((a * c.centsPerDollar) / 100);
  const singles = cards.map((card) => {
    const c = bestOfferFor(card, amount, input.offers, input.now);
    // an offer whose minimum is not met by this purchase counts nothing on a single card
    const offerCents = c.offerMinOk ? c.offerCents : 0;
    const plan = makePlan('SINGLE', [{ c, amount, earn: earn(card, amount), offerCents }], input);
    if (c.offer && !c.offerMinOk && c.offer.terms.minSpendCents != null)
      plan.warnings.push(`"${c.offer.title}" needs ${usd(c.offer.terms.minSpendCents)}; this purchase is ${usd(amount)}, so it earns nothing from it.`);
    return plan;
  });
  singles.sort((a, b) => b.expectedCents - a.expectedCents || a.legs[0].cardName.localeCompare(b.legs[0].cardName));
  const plans: Plan[] = [...singles];

  // split: put the offer's minimum on the card holding it, the rest on the best earner
  const bestSingle = singles[0];
  let bestSplit: Plan | null = null;
  for (const y of cards) {
    const cy = bestOfferFor(y, amount, input.offers, input.now);
    const min = cy.offer?.terms.minSpendCents;
    if (!cy.offer || !min || min >= amount) continue;
    const offerCents = offerValueCents(cy.offer.terms, min);
    for (const x of cards) {
      if (x.walletCardId === y.walletCardId) continue;
      const cx = bestOfferFor(x, amount - min, input.offers, input.now);
      const split = makePlan(
        'SPLIT',
        [
          { c: cy, amount: min, earn: earn(y, min), offerCents },
          { c: { ...cx, offer: null, offerCents: 0, needsActivation: false }, amount: amount - min, earn: earn(x, amount - min), offerCents: 0 },
        ],
        input,
      );
      if (split.expectedCents >= bestSingle.expectedCents + MIN_SPLIT_GAIN_CENTS && (!bestSplit || split.expectedCents > bestSplit.expectedCents)) bestSplit = split;
    }
  }
  if (bestSplit) {
    bestSplit.warnings.push('Splitting assumes the offer minimum can be met in one separate transaction; check the offer terms.');
    bestSplit.justification.unshift(`Splitting beats the best single card by ${usd(bestSplit.expectedCents - bestSingle.expectedCents)}.`);
    plans.unshift(bestSplit);
  }
  return plans;
}
