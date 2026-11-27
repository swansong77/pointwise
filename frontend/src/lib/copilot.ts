import type { CallAction } from '@/lib/search';

export type Horizon = 'TODAY' | 'WEEK' | 'MONTH' | 'LATER';
export const HORIZONS: Horizon[] = ['TODAY', 'WEEK', 'MONTH', 'LATER'];
export const HORIZON_LABEL: Record<Horizon, string> = { TODAY: 'Today', WEEK: 'This week', MONTH: 'This month', LATER: 'Later' };

export interface PlanFactor {
  label: string;
  effect: 'UP' | 'DOWN' | 'NEUTRAL';
  detail: string;
}

export interface PlanItem {
  id: string;
  lens: string;
  horizon: Horizon;
  title: string;
  recommendation: string;
  reason: string;
  evidence: string[];
  expectedValueCents: number | null;
  assumptions: string[];
  risks: string[];
  confidence: number;
  factors: PlanFactor[];
  href: string;
  calls: CallAction[];
}

export interface WhatIfDelta {
  dimension: 'FINANCIAL' | 'POINTS' | 'BENEFITS' | 'FIVE24' | 'HOUSEHOLD';
  label: string;
  before: string;
  after: string;
  change: string;
  direction: 'BETTER' | 'WORSE' | 'SAME' | 'UNKNOWN';
}

export interface WhatIfOutcome {
  scenario: 'APPLY' | 'WAIT' | 'TRANSFER' | 'CANCEL' | 'CHANGE';
  title: string;
  summary: string;
  verdict: 'FAVORABLE' | 'UNFAVORABLE' | 'MIXED' | 'NEUTRAL';
  recommendation: string;
  deltas: WhatIfDelta[];
  netCents: number | null;
  assumptions: string[];
  risks: string[];
  alternatives: string[];
  evidence: string[];
  confidence: number;
}

export const WHATIF_EXAMPLES = [
  'What if I wait 3 months?',
  'What if my spouse applies instead?',
  'What if I cancel Venture X?',
  'What if I transfer 60,000 points to Hyatt?',
  'What if I upgrade Freedom Flex to Sapphire Preferred?',
];

export interface CopilotPlan {
  mode: string;
  kind: 'AGENDA' | 'ANSWER' | 'WHATIF' | 'ROADMAP';
  question: string;
  headline: string;
  summary: string;
  items: PlanItem[];
  lenses: Array<{ lens: string; label: string; engines: string[]; ok: boolean; found: number; note: string }>;
  assumptions: string[];
  risks: string[];
  confidence: number;
  evidence: string[];
  counts: Record<Horizon, number>;
  valueAtStakeCents: number;
  memory?: { hidden: Array<{ id: string; title: string; action: string; until: string }>; boosted: number };
  whatIf?: WhatIfOutcome;
  roadmap?: import('@/lib/chief').RoadmapData;
}

export interface CopilotResponse {
  runId: string;
  mode: string;
  plan: CopilotPlan;
  narration: { text: string; model: string; provider: string; local: boolean; disclosureId: string } | null;
  narrationSkipped: string | null;
  sessionId: string | null;
  tookMs: number;
}

export interface CopilotSettings {
  aiModeEnabled: boolean;
  mode: string;
  temperature: number | null;
  reasoningDepth: string | null;
  responseStyle: string;
  cloudShare: { consented: boolean; consentedAt: string | null; providers: string[] };
  briefings?: { daily: boolean; weekly: boolean; monthly: boolean; alerts: boolean };
  chief?: { enabled: boolean; quietMode: boolean };
  providers: Array<{ name: string; kind: string; local: boolean; enabled: boolean }>;
  modes: Array<{ key: string; label: string; blurb: string }>;
  styles: string[];
}

export interface Disclosure {
  id: string;
  provider: string;
  model: string;
  local: boolean;
  purpose: string;
  createdAt: string;
  payload: unknown;
}

export const confidenceWord = (c: number) => (c >= 80 ? 'High' : c >= 55 ? 'Medium' : 'Low');

export type GoalKind = 'STATUS' | 'FIVE24' | 'TRIP' | 'CASHBACK' | 'FEES' | 'MILES' | 'CUSTOM';
export const GOAL_KINDS: Array<{ kind: GoalKind; label: string }> = [
  { kind: 'STATUS', label: 'Earn elite status' },
  { kind: 'FIVE24', label: 'Stay under 5/24' },
  { kind: 'TRIP', label: 'Save points for a trip' },
  { kind: 'CASHBACK', label: 'Earn cash back' },
  { kind: 'FEES', label: 'Keep annual fees down' },
  { kind: 'MILES', label: 'Build a points balance' },
  { kind: 'CUSTOM', label: 'Something else' },
];

export interface Goal {
  id: string;
  kind: GoalKind;
  title: string;
  status: 'ACTIVE' | 'DONE' | 'DROPPED';
  dueAt: string | null;
  manualProgress: number | null;
  progress: {
    pct: number | null;
    current: string;
    target: string;
    state: 'ACHIEVED' | 'ON_TRACK' | 'AT_RISK' | 'BEHIND' | 'UNKNOWN';
    detail: string;
    next: string[];
    confidence: number;
  };
}

export interface Preferences {
  airlines: string[];
  hotels: string[];
  destinations: string[];
  merchants: string[];
  priorities: string[];
}
export const PRIORITIES = [
  ['CASHBACK', 'Cash back'],
  ['TRAVEL', 'Travel'],
  ['HOTEL', 'Hotels'],
  ['AIRLINE', 'Airlines'],
  ['LOW_FEE', 'Low fees'],
] as const;

export interface MemoryRow {
  id: string;
  kind: 'PREFERENCE' | 'DECISION' | 'RECOMMENDATION';
  key: string;
  value: { action?: string; until?: string; title?: string; shown?: number } & Record<string, unknown>;
  updatedAt: string;
}

export type BriefKind = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export const BRIEF_LABEL: Record<BriefKind, string> = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly' };

export interface BriefLine {
  text: string;
  detail?: string;
  href?: string;
  valueCents?: number | null;
  tone: 'urgent' | 'warn' | 'good' | 'info';
  itemId?: string;
}
export interface BriefSection {
  key: string;
  title: string;
  lines: BriefLine[];
  empty: string;
}
export interface Briefing {
  greeting?: string;
  kind: BriefKind;
  periodKey: string;
  generatedAt: string;
  headline: string;
  summary: string;
  sections: BriefSection[];
  stats: Record<string, number | string>;
  confidence: number;
  assumptions: string[];
}
export interface StoredBriefing {
  id: string;
  kind: BriefKind;
  periodKey: string;
  createdAt: string;
  content: Briefing;
  narration: { text: string; model: string; provider: string; local: boolean } | null;
}
export interface Alert {
  key: string;
  title: string;
  body: string;
  link: string;
  dedupeKey: string;
}

export interface DashItem {
  id: string;
  lens: string;
  horizon: Horizon;
  title: string;
  recommendation: string;
  reason: string;
  confidence: number;
  expectedValueCents: number | null;
  href: string;
  calls: import('@/lib/search').CallAction[];
}
export interface Dashboard {
  generatedAt: string;
  headline: string;
  summary: string;
  confidence: number;
  counts: Record<Horizon, number>;
  valueAtStakeCents: number;
  today: DashItem[];
  expiring: DashItem[];
  actions: DashItem[];
  travel: DashItem[];
  savings: { offersCents: number; creditsCents: number; totalCents: number };
  household: {
    members: Array<{ member: string; count: number; underLimit: boolean; nextSlotAt: string | null }>;
    applyPick: { member: string; card: string; firstYearCents: number; usesSlot: boolean } | null;
  };
  portfolio: { healthScore: number | null; healthLabel: string | null; feesCents: number; valueCents: number; cards: number; toReview: number };
  goals: Goal[];
  recommendations: DashItem[];
  briefing: { id: string; kind: BriefKind; periodKey: string; headline: string; narration: StoredBriefing['narration'] } | null;
  hidden: number;
}
