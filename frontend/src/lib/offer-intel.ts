import type { Tone } from './offer-market';

export type OfferSource = 'ISSUER_OFFICIAL' | 'ACCOUNT_DATA' | 'EMAIL' | 'PUBLIC_PAGE' | 'AI_INFERRED' | 'USER_ENTERED' | 'ADMIN' | 'PORTAL';
export type Verification = 'UNVERIFIED' | 'VERIFIED' | 'DISPUTED';
export type ActivationStatus = 'NOT_REQUIRED' | 'PENDING' | 'ACTIVATED' | 'FAILED';
export type MissedCause = 'NOT_ADDED' | 'NOT_ACTIVATED' | 'WRONG_CARD' | 'BELOW_MIN_SPEND' | 'EXPIRED_BEFORE_PURCHASE';

export const SOURCE_LABEL: Record<OfferSource, string> = {
  ISSUER_OFFICIAL: 'Issuer (official)',
  ACCOUNT_DATA: 'Account data',
  EMAIL: 'Email',
  PUBLIC_PAGE: 'Public page',
  AI_INFERRED: 'AI-inferred',
  USER_ENTERED: 'Entered by you',
  ADMIN: 'Curated',
  PORTAL: 'Portal',
};

export const CAUSE_LABEL: Record<MissedCause, { label: string; tone: Tone }> = {
  NOT_ADDED: { label: 'Not added', tone: 'red' },
  NOT_ACTIVATED: { label: 'Not activated', tone: 'red' },
  WRONG_CARD: { label: 'Wrong card', tone: 'amber' },
  BELOW_MIN_SPEND: { label: 'Below minimum spend', tone: 'amber' },
  EXPIRED_BEFORE_PURCHASE: { label: 'Expired before purchase', tone: 'slate' },
};

export const ACTIVATION_LABEL: Record<ActivationStatus, { label: string; tone: Tone }> = {
  NOT_REQUIRED: { label: 'No activation needed', tone: 'slate' },
  PENDING: { label: 'Needs activation', tone: 'amber' },
  ACTIVATED: { label: 'Activated', tone: 'green' },
  FAILED: { label: 'Activation failed', tone: 'red' },
};

export interface InventoryRow {
  id: string;
  offerId: string;
  title: string;
  merchant: { id: string; name: string; slug: string; parentCompany: string | null } | null;
  card: string;
  walletCardId: string;
  offerType: string;
  valueCents: number;
  percent: string | number | null;
  points: number | null;
  minSpendCents: number | null;
  endsAt: string | null;
  source: OfferSource;
  reliability: number;
  verification: Verification;
  confidenceCap: number;
  enrollmentRequired: boolean;
  activationStatus: ActivationStatus;
  activatedAt: string | null;
  activationVerifiedBy: 'MANUAL' | 'STATEMENT' | 'EMAIL' | null;
  status: string;
  offersUrl: string | null;
}

export interface Factor {
  factor: string;
  weight: number;
  value: number;
  points: number;
  reason: string;
}

export interface Opportunity {
  offerId: string;
  title: string;
  merchant: string | null;
  endsAt: string | null;
  daysLeft: number | null;
  added: boolean;
  activated: boolean;
  offersUrl: string | null;
  source: OfferSource;
  verification: Verification;
  score: number;
  expectedValueCents: number;
  confidence: number;
  factors: Factor[];
  version: string;
}

export interface MissedItem {
  offerId: string;
  cause: MissedCause;
  lostCents: number;
  spendCents: number;
  confidence: number;
  action: string;
  evidence: string[];
  transactionIds: string[];
  offer: { id: string; title: string; merchant: string | null; endsAt: string | null; source: OfferSource | null };
}

export interface QueueItem {
  userOfferId: string;
  title: string;
  merchant: string | null;
  card: string;
  walletCardId: string;
  valueCents: number;
  endsAt: string | null;
  daysLeft: number | null;
  activationStatus: ActivationStatus;
  offersUrl: string | null;
  issuer: string | null;
}

export interface OfferEventRow {
  id: string;
  type: string;
  actor: 'USER' | 'SYSTEM' | 'AGENT';
  detail: Record<string, unknown>;
  createdAt: string;
  offerId: string | null;
}

export interface ImportResult {
  created: Array<{ userOfferId: string; offerId: string; merchant: string | null; merchantConfidence: number | null }>;
  skipped: Array<{ merchant: string; reason: string }>;
  rejected: Array<{ line: number; text: string; reason: string }>;
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

export interface PlanView {
  kind: 'SINGLE' | 'SPLIT';
  legs: PlanLeg[];
  portal: { portal: string; cents: number } | null;
  expectedCents: number;
  maxCents: number;
  confidence: number;
  justification: string[];
  evidence: string[];
  warnings: string[];
  actions: string[];
  stack: { allRulesVerified: boolean; version: string };
}

export interface PlanResponse {
  merchant: { id: string | null; name: string };
  merchantConfidence: number;
  amountCents: number;
  plans: PlanView[];
  plannedPurchaseId: string | null;
}

export interface PlannedPurchase {
  id: string;
  merchantText: string;
  amountCents: number;
  plannedFor: string | null;
}

/** Colour for a 0–100 score. */
export function scoreTone(score: number): Tone {
  return score >= 70 ? 'green' : score >= 40 ? 'amber' : 'slate';
}

/** "high" / "medium" / "low" for a 0–100 confidence. */
export function confidenceLabel(c: number): string {
  return c >= 80 ? 'High' : c >= 50 ? 'Medium' : 'Low';
}

export const EVENT_LABEL: Record<string, string> = {
  IMPORTED: 'Imported',
  UPDATED: 'Updated',
  ACTIVATED: 'Marked activated',
  ACTIVATION_FAILED: 'Activation failed',
  ACTIVATION_VERIFIED: 'Activation confirmed by a statement credit',
  EXPIRED: 'Expired',
  REDEEMED: 'Redeemed',
  RECOMMENDED: 'Recommended',
  MISSED_DETECTED: 'Missed offer found',
  PLANNED: 'Planned',
};

export const FACTOR_LABEL: Record<string, string> = {
  urgency: 'Urgency',
  expectedSavings: 'Expected savings',
  spendFrequency: 'How often you shop here',
  merchantUsage: 'Spend at this merchant',
  categoryPreference: 'Category you favour',
  simplicity: 'Simplicity',
  redemptionProbability: 'Likelihood you redeem it',
  historicalUtilization: 'Your past redemptions',
  householdRelevance: 'Household relevance',
};
