export type StepPrivacy = 'PUBLIC' | 'USER';

export interface RunStep {
  ordinal: number;
  id: string;
  agent: string;
  engine: string;
  privacy: StepPrivacy;
  status: 'OK' | 'SKIPPED' | 'FAILED';
  durationMs: number;
  error: string | null;
}

export interface RunResult {
  runId: string;
  workflow: string;
  status: 'COMPLETED' | 'FAILED';
  privacy: StepPrivacy;
  answer: string;
  narration: { text: string; model: string; promptVersion: number } | null;
  narrationSkipped?: string;
  steps: RunStep[];
}

export const STEP_LABEL: Record<string, string> = {
  offers: 'Offer agent — current offers and history',
  five24: '5/24 agent — application limits',
  portfolio: 'Portfolio review agent — fees and benefit use',
  strategy: 'Card strategy agent — best card per member',
  recommendation: 'Recommendation engine — scored and explained',
};

export const stepLabel = (id: string) => STEP_LABEL[id] ?? id;

export const PRIVACY_NOTE: Record<StepPrivacy, string> = {
  PUBLIC: 'Public catalog data',
  USER: 'Your data — computed on this server, never sent to an AI provider',
};
