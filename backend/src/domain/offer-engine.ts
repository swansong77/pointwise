/**
 * Offer eligibility and missed-offer detection (pure, deterministic). Every finding carries its evidence
 * (offer id, transaction ids, amounts), a confidence capped by the offer's source reliability, and a plain
 * reason. No model is involved (ADR-012).
 */
import { confidenceCap, OfferSourceKind, VerificationKind } from './offer-import';

export const OFFER_ENGINE_VERSION = 'offer-engine/1';

export type EligibilityState = 'ELIGIBLE' | 'ACTIVATED' | 'PARTIAL' | 'PENDING_CREDIT' | 'COMPLETED' | 'EXPIRED';
export type MissedCause = 'NOT_ADDED' | 'NOT_ACTIVATED' | 'WRONG_CARD' | 'BELOW_MIN_SPEND' | 'EXPIRED_BEFORE_PURCHASE';

export interface OfferTerms {
  id: string;
  merchantId: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  minSpendCents: number | null;
  valueCents: number;
  percent: number | null;
  maxRewardCents?: number | null;
  points?: number | null;
  enrollmentRequired: boolean;
  source: OfferSourceKind;
  verification: VerificationKind;
}

export interface UserOfferState {
  status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED';
  activationStatus: 'NOT_REQUIRED' | 'PENDING' | 'ACTIVATED' | 'FAILED';
}

/** Where a user-offer stands. matchedSpendCents = spend at the merchant on that card inside the offer window. */
export function eligibilityState(offer: OfferTerms, uo: UserOfferState | null, matchedSpendCents: number, now: Date): EligibilityState {
  if (uo?.status === 'REDEEMED') return 'COMPLETED';
  if (offer.endsAt && offer.endsAt < now) return 'EXPIRED';
  if (uo?.status === 'EXPIRED') return 'EXPIRED';
  const active = !!uo && (!offer.enrollmentRequired || uo.activationStatus === 'ACTIVATED' || uo.activationStatus === 'NOT_REQUIRED');
  if (!active) return 'ELIGIBLE';
  const min = offer.minSpendCents ?? 0;
  if (matchedSpendCents > 0 && min > 0 && matchedSpendCents >= min) return 'PENDING_CREDIT';
  if (matchedSpendCents > 0 && matchedSpendCents < min) return 'PARTIAL';
  return 'ACTIVATED';
}

/** Value (cents) an offer returns on this much spend; points are reported separately. */
export function offerValueCents(o: Pick<OfferTerms, 'valueCents' | 'percent' | 'maxRewardCents' | 'minSpendCents'>, spendCents: number): number {
  if (o.minSpendCents != null && spendCents < o.minSpendCents) return 0;
  if (o.percent != null) {
    const v = Math.round((spendCents * o.percent) / 100);
    return o.maxRewardCents != null ? Math.min(v, o.maxRewardCents) : o.valueCents > 0 ? Math.min(v, o.valueCents) : v;
  }
  return o.valueCents;
}

export interface Txn {
  id: string;
  merchantId: string | null;
  walletCardId: string;
  date: Date;
  /** positive = purchase */
  amountCents: number;
}

export interface OfferHolding {
  offer: OfferTerms;
  /** wallet cards the offer can be on (the card product matches) */
  eligibleWalletCardIds: string[];
  /** the user's rows for this offer, by wallet card */
  userOffers: Array<{ walletCardId: string } & UserOfferState>;
}

export interface MissedOffer {
  offerId: string;
  merchantId: string | null;
  cause: MissedCause;
  lostCents: number;
  spendCents: number;
  walletCardId: string | null;
  transactionIds: string[];
  /** 0–100, never above the source's confidence cap */
  confidence: number;
  action: string;
  evidence: string[];
}

const BASE_CONFIDENCE: Record<MissedCause, number> = { BELOW_MIN_SPEND: 90, NOT_ACTIVATED: 85, NOT_ADDED: 80, WRONG_CARD: 75, EXPIRED_BEFORE_PURCHASE: 60 };
const GRACE_DAYS = 30;

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);
const sum = (t: Txn[]) => t.reduce((s, x) => s + x.amountCents, 0);

/**
 * Looks for purchases at an offer's merchant that the offer could have covered but did not, and says why.
 * One finding per offer (the card with the most spend decides the cause). No finding without transactions.
 */
export function detectMissed(holdings: OfferHolding[], txns: Txn[], now: Date): MissedOffer[] {
  const out: MissedOffer[] = [];
  for (const h of holdings) {
    const o = h.offer;
    if (!o.merchantId) continue;
    const cap = confidenceCap(o.source, o.verification);
    if (cap === 0) continue; // disputed offers are not used as evidence
    const atMerchant = txns.filter((t) => t.merchantId === o.merchantId && t.amountCents > 0);
    if (!atMerchant.length) continue;
    const start = o.startsAt ?? new Date(0);
    const inWindow = atMerchant.filter((t) => t.date >= start && (!o.endsAt || t.date <= o.endsAt));
    if (!inWindow.length) {
      const end = o.endsAt;
      const late = end ? atMerchant.filter((t) => t.date > end && t.date.getTime() - end.getTime() <= GRACE_DAYS * 86_400_000) : [];
      if (!end || !late.length) continue;
      const spend = sum(late);
      out.push(finding(o, 'EXPIRED_BEFORE_PURCHASE', spend, null, late, cap, [`offer ended ${day(end)}`, `${late.length} purchase(s) within ${GRACE_DAYS} days after, ${usd(spend)}`], 'Check the offers page earlier or set an expiry reminder; the same merchant may run it again.'));
      continue;
    }
    const eligible = new Set(h.eligibleWalletCardIds);
    const onEligible = inWindow.filter((t) => eligible.has(t.walletCardId));
    if (!onEligible.length) {
      if (!eligible.size) continue; // the user has no card this offer works on
      const spend = sum(inWindow);
      out.push(finding(o, 'WRONG_CARD', spend, null, inWindow, cap, [`${inWindow.length} purchase(s) at the merchant, ${usd(spend)}, on cards without this offer`], 'Use the card that holds this offer for this merchant.'));
      continue;
    }
    const byCard = new Map<string, Txn[]>();
    for (const t of onEligible) byCard.set(t.walletCardId, [...(byCard.get(t.walletCardId) ?? []), t]);
    const [cardId, cardTx] = [...byCard.entries()].sort((a, b) => sum(b[1]) - sum(a[1]))[0];
    const spend = sum(cardTx);
    const uo = h.userOffers.find((u) => u.walletCardId === cardId);
    if (!uo) {
      out.push(finding(o, 'NOT_ADDED', spend, cardId, cardTx, cap, ['offer available on this card, not added', `${cardTx.length} purchase(s), ${usd(spend)}`], 'Add the offer to the card before the next purchase.'));
    } else if (o.enrollmentRequired && uo.activationStatus !== 'ACTIVATED' && uo.activationStatus !== 'NOT_REQUIRED') {
      out.push(finding(o, 'NOT_ACTIVATED', spend, cardId, cardTx, cap, ['offer added but not activated', `${cardTx.length} purchase(s), ${usd(spend)}`], 'Activate the offer on the issuer’s offers page, then mark it activated here.'));
    } else if (o.minSpendCents != null && spend < o.minSpendCents && (!o.endsAt || o.endsAt >= now)) {
      // not a loss yet: the offer is live and the minimum is not met, so it is reported while it can still be earned
      out.push({
        ...finding(o, 'BELOW_MIN_SPEND', spend, cardId, cardTx, cap, [`spent ${usd(spend)} of ${usd(o.minSpendCents)} required`], `Spend ${usd(o.minSpendCents - spend)} more on this card before ${o.endsAt ? day(o.endsAt) : 'it ends'}.`),
        lostCents: o.valueCents,
      });
    }
  }
  return out.sort((a, b) => b.lostCents - a.lostCents);
}

function finding(o: OfferTerms, cause: MissedCause, spend: number, walletCardId: string | null, tx: Txn[], cap: number, evidence: string[], action: string): MissedOffer {
  return {
    offerId: o.id,
    merchantId: o.merchantId,
    cause,
    lostCents: offerValueCents(o, spend),
    spendCents: spend,
    walletCardId,
    transactionIds: tx.map((t) => t.id).slice(0, 20),
    confidence: Math.min(cap, BASE_CONFIDENCE[cause]),
    action,
    evidence,
  };
}
