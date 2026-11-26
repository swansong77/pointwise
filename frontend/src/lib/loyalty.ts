import type { Tone } from './offer-market';

export type RiskLevel = 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'EXPIRED';

export interface Prediction {
  expiresAt: string | null;
  daysLeft: number | null;
  atRiskPoints: number;
  riskScore: number;
  level: RiskLevel;
  confidence: number;
  reason: string;
  source: string;
  threshold: number | null;
  tranches: Array<{ date: string; points: number }>;
}

export interface AccountView {
  id: string;
  profileId: string;
  member: string;
  programCode: string | null;
  programName: string;
  kind: string;
  isBankCurrency: boolean;
  unit: string;
  centsPerPoint: number;
  nickname: string | null;
  accountLast4: string | null;
  balance: number;
  pendingBalance: number;
  lifetimePoints: number;
  statusLevel: string | null;
  expiresAt: string | null;
  lastActivityAt: string | null;
  valueCents: number;
  policy: { type: string; months: number | null; resetConditions: string[]; verified: boolean; source: string | null };
  prediction: Prediction;
}

export interface PreserveAdvice {
  key: string;
  label: string;
  estCostCents: number;
  effort: 'LOW' | 'MEDIUM' | 'HIGH';
  fitsDeadline: boolean;
  confirmedByPolicy: boolean;
  note: string;
}

export interface ExpirationItem {
  accountId: string;
  member: string;
  program: string;
  unit: string;
  balance: number;
  valueCents: number;
  prediction: Prediction;
  message: string | null;
  preservation: PreserveAdvice[];
}

export interface HistoryResponse {
  account: AccountView;
  months: Array<{ month: string; balance: number; change: number }>;
  growth: { startBalance: number; endBalance: number; change: number; pct: number | null; bestMonth: string | null; worstMonth: string | null };
  totals: { current: number; pending: number; earned: number; bonus: number; purchased: number; redeemed: number; expired: number; transferredOut: number; transferredIn: number; netChange: number };
}

export interface CertificateView {
  id: string;
  category: 'FREE_NIGHT' | 'COMPANION' | 'UPGRADE';
  name: string;
  program: string | null;
  member: string;
  status: string;
  quantity: number;
  expiresAt: string | null;
  pointCap: number | null;
  eligible: string[];
  blackout: string | null;
  restrictions: string | null;
  potentialValueCents: number;
  view: { state: 'AVAILABLE' | 'EXPIRING' | 'EXPIRED' | 'USED' | 'CANCELLED'; daysLeft: number | null };
}

export interface CertOpportunity {
  certId: string;
  name: string;
  member: string;
  daysLeft: number | null;
  valueCents: number;
  hotel: string | null;
  urgency: 'HIGH' | 'MEDIUM' | 'LOW';
  message: string;
}

export interface StatusRow {
  id: string;
  program: string;
  level: string;
  member: string;
  expiresAt: string | null;
  metric: string | null;
  progress: number;
  required: number;
  maintained: boolean;
  valueCents: number;
  current: boolean;
  benefits: string[];
  view: { pct: number | null; daysLeft: number | null; remaining: number; renewalLikelihood: number; risk: RiskLevel; headline: string; actions: string[] };
}

export interface MembershipRow {
  id: string;
  kind: string;
  name: string;
  member: string;
  expiresAt: string | null;
  memberLast4: string | null;
  renewalCostCents: number;
  autoRenew: boolean;
  annualValueCents: number;
  creditSuggestion: string | null;
  view: { daysLeft: number | null; state: 'ACTIVE' | 'EXPIRING' | 'EXPIRED' | 'NO_DATE'; renewalEligible: boolean; headline: string };
}

export interface Valuation {
  currentCents: number;
  potentialCents: number;
  atRiskCents: number;
  expiredCents: number;
  recoveredCents: number;
  annualNetCents: number;
  totalPoints: number;
  byCategory: { points: number; certificates: number; status: number; memberships: number; credits: number };
  members: Array<{ memberId: string; member: string; currentCents: number; atRiskCents: number; annualNetCents: number; points: number }>;
}

export interface ForecastItem {
  type: string;
  label: string;
  member: string;
  date: string;
  valueCents: number;
  detail?: string;
}

export interface Forecast {
  overdue: ForecastItem[];
  buckets: Array<{ key: string; label: string; items: ForecastItem[]; totalCents: number }>;
}

export interface TransferRoute {
  currency: string;
  currencyName: string;
  program: string;
  programName: string;
  ratio: string;
  transferDays: number;
  activeBonusPercent: number | null;
  bonusEndsAt: string | null;
  effectiveCentsPerPoint: number;
  stats: { count: number; averagePercent: number; maxPercent: number };
  advice: { verdict: 'TRANSFER_NOW' | 'WAIT' | 'NO_BONUS_EXPECTED' | 'NO_DATA'; text: string; confidence: number };
}

export interface HouseholdView {
  combined: { currentCents: number; potentialCents: number; atRiskCents: number; annualNetCents: number; totalPoints: number };
  members: Valuation['members'];
  expiring: Array<{ member: string; program: string; atRiskPoints: number; daysLeft: number | null; level: RiskLevel }>;
  transfers: Array<{ member: string; currency: string; points: number; program: string; bonusPercent: number; centsPerPoint: number; upliftVsCash: number }>;
}

export interface AwardOptionView {
  programCode: string;
  programName: string;
  pointsNeeded: number;
  shortfall: number;
  costCents: number;
  usesTransfer: boolean;
  activeBonusPercent: number | null;
  score: number;
  reasons: string[];
  warnings: string[];
}

export interface TripResult {
  destination: string;
  cabin: string;
  pointsNeeded: number;
  pointsEstimated: boolean;
  estimateNote: string | null;
  options: AwardOptionView[];
  certificates: Array<{ certId: string; name: string; member: string; usable: boolean; note: string }>;
  expiringAssets: Array<{ member: string; program: string; atRiskPoints: number; daysLeft: number | null }>;
  tripId: string | null;
}

export interface Member {
  id: string;
  nickname: string;
}

export interface Dashboard {
  valuation: Valuation;
  atRiskPoints: number;
  expiringAccounts: ExpirationItem[];
  certificates: CertOpportunity[];
  statuses: StatusRow[];
  memberships: MembershipRow[];
  nextThirtyDays: { label: string; items: ForecastItem[]; totalCents: number };
  overdue: ForecastItem[];
}

export interface Registry {
  programs: Array<{ code: string; name: string; kind: string; centsPerPoint: number; policy: { type: string; months: number | null; verified: boolean } }>;
  currencies: Array<{ code: string; name: string; centsPerPoint: number; policy: { type: string; months: number | null; verified: boolean } }>;
}

export const RISK_TONE: Record<RiskLevel, Tone> = { NONE: 'green', LOW: 'slate', MEDIUM: 'amber', HIGH: 'red', EXPIRED: 'red' };
export const RISK_LABEL: Record<RiskLevel, string> = { NONE: 'No risk', LOW: 'Low risk', MEDIUM: 'Medium risk', HIGH: 'High risk', EXPIRED: 'Expired' };

export const KIND_LABEL: Record<string, string> = { AIRLINE: 'Airline', HOTEL: 'Hotel', SHOPPING: 'Shopping', DINING: 'Dining', CRUISE: 'Cruise', RENTAL_CAR: 'Rental car', CASINO: 'Casino', RETAIL: 'Retail', OTHER: 'Other' };
export const CERT_LABEL: Record<string, string> = { FREE_NIGHT: 'Free night', COMPANION: 'Companion', UPGRADE: 'Upgrade' };
export const MEMBERSHIP_KINDS = ['CLEAR', 'TSA_PRECHECK', 'GLOBAL_ENTRY', 'PRIORITY_PASS', 'DRAGONPASS', 'AIRLINE_CLUB', 'HOTEL', 'OTHER'] as const;
export const MEMBERSHIP_LABEL: Record<string, string> = { CLEAR: 'CLEAR', TSA_PRECHECK: 'TSA PreCheck', GLOBAL_ENTRY: 'Global Entry', PRIORITY_PASS: 'Priority Pass', DRAGONPASS: 'DragonPass', AIRLINE_CLUB: 'Airline club', HOTEL: 'Hotel membership', OTHER: 'Other' };
export const EVENT_KINDS = [
  { id: 'EARN', label: 'Earned' },
  { id: 'BONUS', label: 'Bonus' },
  { id: 'PURCHASE', label: 'Purchased' },
  { id: 'REDEEM', label: 'Redeemed' },
  { id: 'EXPIRE', label: 'Expired' },
  { id: 'TRANSFER_OUT', label: 'Transferred out' },
  { id: 'TRANSFER_IN', label: 'Transferred in' },
] as const;
export const POLICY_LABEL: Record<string, string> = { NEVER: 'Does not expire', ACTIVITY: 'Expires without activity', FIXED: 'Expires after earning', WHILE_CARD_OPEN: 'Kept while the card is open', UNKNOWN: 'Policy not known' };
export const VERDICT_LABEL: Record<string, { label: string; tone: Tone }> = {
  TRANSFER_NOW: { label: 'Transfer now', tone: 'green' },
  WAIT: { label: 'Wait for a better bonus', tone: 'amber' },
  NO_BONUS_EXPECTED: { label: 'No bonus expected', tone: 'slate' },
  NO_DATA: { label: 'No history yet', tone: 'slate' },
};
export const FORECAST_TYPE_LABEL: Record<string, string> = { POINTS: 'Points', FREE_NIGHT: 'Free night', COMPANION: 'Companion', UPGRADE: 'Upgrade', STATUS: 'Elite status', MEMBERSHIP: 'Membership', CREDIT: 'Travel credit' };

/** "120,000 miles" */
export const pointsLabel = (n: number, unit = 'points') => `${n.toLocaleString('en-US')} ${unit}`;

/** "6 days", "3 months", "in the past" for a number of days. */
export function daysLabel(days: number | null): string {
  if (days == null) return 'no date';
  if (days < 0) return `${-days} day(s) ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 60) return `${days} days`;
  if (days < 730) return `${Math.round(days / 30.4375)} months`;
  return `${(days / 365.25).toFixed(1)} years`;
}

/** Height (0–100) of each month's bar, relative to the largest balance. */
export function barHeights(months: Array<{ balance: number }>): number[] {
  const max = Math.max(1, ...months.map((m) => m.balance));
  return months.map((m) => Math.round((m.balance / max) * 100));
}

export const effortLabel = (e: PreserveAdvice['effort']) => ({ LOW: 'Easy', MEDIUM: 'Some effort', HIGH: 'Significant effort' })[e];
