/** Types and pure helpers for the next-card scorer, travel and ops pages. Money is integer cents. */

export type SpendSource = 'PROFILE' | 'TRANSACTIONS' | 'DEFAULT';

export interface CardScore {
  cardId: string;
  slug: string;
  name: string;
  issuer: string;
  profileId: string;
  member: string;
  eligible: boolean;
  blockers: string[];
  warnings: string[];
  firstYearValueCents: number;
  longTermValueCents: number;
  score: number;
  components: {
    bonusCents: number;
    earnCents: number;
    benefitsCents: number;
    firstYearFeeCents: number;
    annualFeeCents: number;
  };
  feeReturn: number | null;
  spendFeasible: boolean | null;
  approvalOdds: 'LIKELY' | 'POSSIBLE' | 'UNLIKELY' | 'UNKNOWN';
  five24: {
    countsToward: boolean;
    before: number;
    after: number;
    blockedByRule: boolean;
    usesLastSlot: boolean;
    underLimitAgainAt: string | null;
    slotCostCents: number;
  };
  confidence: number;
  confidenceNotes: string[];
  reasons: string[];
  topCategories: Array<{
    category: string;
    newCentsPerDollar: number;
    currentCentsPerDollar: number;
    annualGainCents: number;
  }>;
}

export interface NextCardResponse {
  member: {
    profileId: string;
    nickname: string;
    five24: { count: number; limit: number; underLimit: boolean };
  };
  spend: { source: SpendSource; monthlyTotalCents: number };
  cards: CardScore[];
  disclaimer: string;
}

export interface HouseholdPlan {
  members: Array<{ profileId: string; member: string; top: CardScore[] }>;
  pick: CardScore | null;
  why: string;
  spend: { source: SpendSource; monthlyTotalCents: number };
}

export interface SpendProfile {
  source: SpendSource;
  lines: Array<{
    categoryId: string;
    parentCategoryId?: string | null;
    name: string;
    monthlyCents: number;
  }>;
  monthlyTotalCents: number;
}

export interface Balance {
  id: string;
  profileId: string;
  member: string;
  kind: 'CURRENCY' | 'PROGRAM';
  code: string;
  name: string;
  points: number;
  valueCents: number;
  updatedAt: string;
}

export interface TransferAdvice {
  balances: Array<{
    profileId: string;
    member: string;
    currency: string;
    currencyName: string;
    points: number;
    cashValueCents: number;
    bestValueCents: number;
    best: {
      program: string;
      programName: string;
      centsPerPoint: number;
      upliftVsCash: number;
      bonusPercent: number;
      bonusEndsAt: string | null;
      transferDays: number;
    } | null;
    advice: string;
  }>;
  totals: { cashValueCents: number; bestValueCents: number };
}

export interface PartnersResponse {
  programs: Array<{
    id: string;
    code: string;
    name: string;
    kind: 'AIRLINE' | 'HOTEL' | 'OTHER';
    centsPerPoint: number;
    householdPooling: boolean;
  }>;
  currencies: Array<{
    code: string;
    name: string;
    centsPerPoint: number;
    householdPooling: boolean;
    options: Array<{
      program: string;
      programName: string;
      kind: string;
      programPointsPerPoint: number;
      centsPerPoint: number;
      upliftVsCash: number;
      bonusPercent: number;
      bonusEndsAt: string | null;
      transferDays: number;
    }>;
  }>;
}

export interface AwardPlan {
  program: { code: string; name: string; kind: string; centsPerPoint: number };
  pointsNeeded: number;
  steps: Array<{
    kind: 'USE_BALANCE' | 'TRANSFER';
    member: string;
    profileId: string;
    from: string;
    pointsUsed: number;
    programPoints: number;
    costCents: number;
    transferDays: number;
  }>;
  covered: number;
  shortfall: number;
  totalCostCents: number;
  awardValueCents: number;
  costCentsPerProgramPoint: number | null;
  maxTransferDays: number;
  warnings: string[];
  summary: string;
}

export const SPEND_SOURCE_LABEL: Record<SpendSource, string> = {
  PROFILE: 'your spend profile',
  TRANSACTIONS: 'your last 12 months of transactions',
  DEFAULT: 'a typical household (add your spend for better results)',
};

/** "High" ≥ 0.8, "Medium" ≥ 0.6, else "Low" — with a badge tone. */
export function confidenceLabel(c: number): {
  label: string;
  tone: 'green' | 'amber' | 'red';
} {
  if (c >= 0.8)
    return {
      label: `High confidence (${Math.round(c * 100)} %)`,
      tone: 'green',
    };
  if (c >= 0.6)
    return {
      label: `Medium confidence (${Math.round(c * 100)} %)`,
      tone: 'amber',
    };
  return { label: `Low confidence (${Math.round(c * 100)} %)`, tone: 'red' };
}

/** Short 5/24 impact chip text. */
export function five24Chip(f: CardScore['five24']): string {
  if (!f.countsToward) return 'Not on 5/24';
  if (f.slotCostCents === 0) return `No slot used (${f.before}/24)`;
  return `5/24: ${f.before} → ${f.after}${f.usesLastSlot ? ' (last slot)' : ''}`;
}

/** Signed whole-dollar money: "-$325", "$1,016". */
export function signedMoney(cents: number): string {
  const abs = Math.abs(Math.round(cents / 100)).toLocaleString('en-US');
  return `${cents < 0 ? '-' : ''}$${abs}`;
}

export function points(n: number): string {
  return n.toLocaleString('en-US');
}

/** Parses "60,000" / "60k" / "1.5m" into points; null when invalid. */
export function parsePoints(input: string): number | null {
  const s = input.trim().toLowerCase().replace(/,/g, '');
  const m = /^(\d+(?:\.\d+)?)\s*([km])?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) * (m[2] === 'k' ? 1_000 : m[2] === 'm' ? 1_000_000 : 1);
  return Number.isFinite(n) && n >= 0 && Number.isInteger(Math.round(n)) ? Math.round(n) : null;
}

/** Ops status → badge tone. */
export function statusTone(s: string): 'green' | 'amber' | 'red' | 'slate' {
  return s === 'ok' || s === 'CLOSED' || s === 'ACTIVE'
    ? 'green'
    : s === 'degraded' || s === 'DISABLED'
      ? 'amber'
      : s === 'down' || s === 'OPEN' || s === 'ERROR'
        ? 'red'
        : 'slate';
}

/** "3 h 5 min" / "2 d 4 h" */
export function uptime(sec: number): string {
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3_600);
  const m = Math.floor((sec % 3_600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

export const CREDIT_BANDS: Array<[string, string]> = [
  ['', 'Not set'],
  ['EXCELLENT', 'Excellent (800+)'],
  ['VERY_GOOD', 'Very good (740–799)'],
  ['GOOD', 'Good (670–739)'],
  ['FAIR', 'Fair (580–669)'],
  ['POOR', 'Poor (under 580)'],
];

/** Approval-odds chip; null when unknown (no band or no catalog requirement). */
export function oddsChip(o: CardScore['approvalOdds']): { label: string; tone: 'green' | 'amber' | 'red' } | null {
  if (o === 'LIKELY') return { label: 'Approval likely', tone: 'green' };
  if (o === 'POSSIBLE') return { label: 'Approval uncertain', tone: 'amber' };
  if (o === 'UNLIKELY') return { label: 'Approval unlikely', tone: 'red' };
  return null;
}

export interface TermHit {
  cardId: string;
  slug: string;
  card: string;
  kind: 'description' | 'bonus' | 'feature' | 'earning' | 'benefit';
  text: string;
  snippet: string;
  rank: number;
}

/** Splits a «highlighted» snippet into plain / highlighted parts (rendered without HTML). */
export function highlightParts(snippet: string): Array<{ text: string; hit: boolean }> {
  return snippet
    .split(/(«[^»]*»)/)
    .filter((p) => p !== '')
    .map((p) => (p.startsWith('«') && p.endsWith('»') ? { text: p.slice(1, -1), hit: true } : { text: p, hit: false }));
}
