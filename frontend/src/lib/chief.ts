import type { CallAction } from '@/lib/search';

export type Band = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export const BAND_LABEL: Record<Band, string> = { CRITICAL: 'Critical', HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low', INFO: 'Informational' };
export const BAND_TONE: Record<Band, 'red' | 'amber' | 'brand' | 'slate' | 'green'> = { CRITICAL: 'red', HIGH: 'amber', MEDIUM: 'brand', LOW: 'slate', INFO: 'slate' };
export type CenterKey = 'TODAY' | 'WEEK' | 'MONTH' | 'QUARTER' | 'ANNUAL';

export interface ExecItem {
  id: string;
  lens: string;
  title: string;
  recommendation: string;
  reason: string;
  evidence: string[];
  assumptions: string[];
  expectedValueCents: number | null;
  confidence: number;
  href: string;
  calls: CallAction[];
  score: number;
  band: Band;
  timeMinutes: number;
  risk: { level: 'LOW' | 'MEDIUM' | 'HIGH'; note: string };
  impact: { cls: string; atRiskCents: number; preservedCents: number; createdCents: number; lostCents: number; futureCents: number };
  deadline: string | null;
  daysLeft: number | null;
  alternatives: string[];
  sources: string[];
  agents: Array<{ key: string; label: string }>;
  center: CenterKey;
}

export interface Recovery {
  headline: string;
  lostCents: number;
  lines: Array<{ kind: string; label: string; cents: number }>;
  atRiskCents: number;
  recoverable: Array<{ id: string; title: string; recommendation: string; cents: number; href: string; deadline: string | null; band: Band; score: number }>;
  recoveredCents: number;
}

export interface ChiefOverview {
  generatedAt: string;
  greeting: string;
  summary: { highPriority: number; valueAtRiskCents: number; pointsAtRisk: number; certificatesExpiring: number; newHighValueOffers: number; totalActions: number };
  confidence: number;
  top: ExecItem[];
  center: Array<{ key: CenterKey; label: string; count: number; valueAtRiskCents: number }>;
  recovery: Recovery;
  hidden: number;
}

export interface CenterList {
  key: CenterKey;
  label: string;
  count: number;
  valueAtRiskCents: number;
  items: ExecItem[];
}

export const RISK_WORD = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' } as const;
export const IMPACT_WORD: Record<string, string> = {
  PRESERVED: 'Value preserved if you act',
  CREATED: 'Value created if you act',
  FUTURE: 'Expected future value',
  LOST: 'Value already lost',
  NONE: 'No dollar impact',
};

export type Grade = 'STRONG' | 'GOOD' | 'FAIR' | 'WEAK';
export const GRADE_LABEL: Record<Grade, string> = { STRONG: 'Strong', GOOD: 'Good', FAIR: 'Fair', WEAK: 'Needs work' };
export const GRADE_TONE: Record<Grade, 'green' | 'brand' | 'amber' | 'red'> = { STRONG: 'green', GOOD: 'brand', FAIR: 'amber', WEAK: 'red' };

export interface ScoreCard {
  key: 'HOUSEHOLD' | 'LOYALTY' | 'PORTFOLIO' | 'OFFERS' | 'TRAVEL';
  label: string;
  score: number;
  grade: Grade;
  reasons: string[];
  href: string;
}

export interface CommandCenterData {
  generatedAt: string;
  values: {
    totalHouseholdCents: number;
    pointsCents: number;
    benefitsCents: number;
    certificatesCents: number;
    travelCreditsCents: number;
    offersAvailableCents: number;
    expiringAssetsCents: number;
    recentSavingsCents: number;
    savingsThisYearCents: number;
    opportunitiesCount: number;
    opportunitiesCents: number;
    projectedSavingsCents: number;
  };
  scores: ScoreCard[];
  outlook: {
    realizedYtdCents: number;
    projectedAdditionalCents: number;
    feesRemainingCents: number;
    netCents: number;
    lowCents: number;
    highCents: number;
    confidence: number;
    assumptions: string[];
  };
  risks: ExecItem[];
  opportunities: ExecItem[];
  today: ExecItem[];
  top: ExecItem[];
  confidence: number;
}

export type FeeVerdictKind = 'KEEP' | 'RETENTION_CALL' | 'PRODUCT_CHANGE' | 'DOWNGRADE' | 'REPLACE' | 'CANCEL' | 'REVIEW';
export const FEE_VERDICT_LABEL: Record<FeeVerdictKind, string> = {
  KEEP: 'Keep',
  RETENTION_CALL: 'Retention call',
  PRODUCT_CHANGE: 'Product change',
  DOWNGRADE: 'Downgrade',
  REPLACE: 'Replace',
  CANCEL: 'Cancel',
  REVIEW: 'Review',
};
export const FEE_VERDICT_TONE: Record<FeeVerdictKind, 'green' | 'amber' | 'red' | 'brand' | 'slate'> = {
  KEEP: 'green',
  RETENTION_CALL: 'amber',
  PRODUCT_CHANGE: 'brand',
  DOWNGRADE: 'brand',
  REPLACE: 'amber',
  CANCEL: 'red',
  REVIEW: 'slate',
};

export interface FeeVerdict {
  card: string;
  member: string | null;
  verdict: FeeVerdictKind;
  netCents: number;
  justification: string;
  alternatives: string[];
  impactCents: number;
  daysToRenewal: number | null;
  confidence: number;
  evidence: string[];
}
export interface FeeReview {
  generatedAt: string;
  verdicts: FeeVerdict[];
  totals: { cards: number; feesCents: number; valueCents: number; impactCents: number; counts: Record<FeeVerdictKind, number> };
}

export interface StoredBoard {
  id: string;
  periodKey: string;
  createdAt: string;
  content: import('@/lib/copilot').Briefing;
}

export interface GovAdvice {
  kind: 'WAIT' | 'APPLY' | 'MOVE' | 'BUSINESS' | 'BONUS' | 'LAST_SLOT';
  text: string;
  detail: string;
  member: string;
  valueCents: number | null;
  date: string | null;
}
export interface Governance {
  headline: string;
  members: Array<{
    member: string;
    label: string;
    state: 'OPEN' | 'ONE_LEFT' | 'AT_LIMIT';
    slots: number;
    nextSlotAt: string | null;
    recentApprovals: Array<{ card: string; approvedAt: string }>;
    upcomingDrops: string[];
  }>;
  advice: GovAdvice[];
}

export type RoadArea = 'OFFERS' | 'POINTS' | 'CARDS' | 'APPLICATIONS' | 'GOALS' | 'LIFE';
export interface RoadmapData {
  span: 90 | 365;
  headline: string;
  phases: Array<{
    label: string;
    from: string;
    to: string;
    events: Array<{ date: string; title: string; area: RoadArea; valueCents: number; atRisk: boolean; href: string }>;
    valueCents: number;
    atRiskCents: number;
  }>;
  focus: Array<{ area: RoadArea; label: string; advice: string; events: number; valueCents: number }>;
  totalValueCents: number;
  atRiskCents: number;
  eventCount: number;
}

export type LifeKind = 'FAMILY_VACATION' | 'COLLEGE_VISIT' | 'MISSION_TRIP' | 'INTERNATIONAL' | 'BUSINESS_TRAVEL' | 'MAJOR_PURCHASE' | 'MOVING' | 'HOME_PROJECT' | 'OTHER';
export const LIFE_KINDS: Array<{ kind: LifeKind; label: string; travel: boolean }> = [
  { kind: 'FAMILY_VACATION', label: 'Family vacation', travel: true },
  { kind: 'COLLEGE_VISIT', label: 'College visit', travel: true },
  { kind: 'MISSION_TRIP', label: 'Mission trip', travel: true },
  { kind: 'INTERNATIONAL', label: 'International travel', travel: true },
  { kind: 'BUSINESS_TRAVEL', label: 'Business travel', travel: true },
  { kind: 'MAJOR_PURCHASE', label: 'Major purchase', travel: false },
  { kind: 'MOVING', label: 'Moving', travel: false },
  { kind: 'HOME_PROJECT', label: 'Home project', travel: false },
  { kind: 'OTHER', label: 'Something else', travel: false },
];
export interface LifeEstimate {
  assumed: string[];
  bestCards: Array<{ use: string; card: string; member: string | null; expectedCents: number; netCostCents: number; why: string }>;
  offers: string[];
  pointsUse: { program: string; pointsNeeded: number; covered: number; shortfall: number; summary: string } | null;
  travelCredits: { cents: number; items: Array<{ benefit: string; card: string; cents: number }> };
  certificates: Array<{ name: string; cents: number; expiresOn: string; usable: boolean }>;
  transferBonuses: string[];
  expectedValueCents: number;
  assumptions: string[];
  risks: string[];
  confidence: number;
}
export interface LifeEvent {
  id: string;
  kind: LifeKind;
  title: string;
  destination: string | null;
  startsOn: string | null;
  endsOn: string | null;
  travelers: number;
  budgetCents: number | null;
  status: 'PLANNING' | 'BOOKED' | 'DONE' | 'CANCELLED';
  estimate: LifeEstimate | null;
  estimatedAt: string | null;
}

export interface HouseholdChiefData {
  headline: string;
  members: Array<{
    member: string;
    relationship: string;
    isPrimary: boolean;
    five24: string | null;
    cardsHeld: number;
    actions: Array<{ id: string; title: string; recommendation: string; band: Band; score: number; valueCents: number | null; href: string }>;
  }>;
  shared: Array<{ id: string; title: string; recommendation: string; band: Band; score: number; valueCents: number | null; href: string }>;
  authorizedUsers: Array<{ member: string; card: string; holder: string; text: string }>;
  bestCardByCategory: Array<{ category: string; card: string; holder: string | null; centsPerDollar: number; annualSpendCents: number; text: string }>;
}
