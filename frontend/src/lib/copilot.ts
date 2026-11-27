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

export interface CopilotPlan {
  mode: string;
  kind: 'AGENDA' | 'ANSWER';
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
