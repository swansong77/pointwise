/** AI Mode (Copilot) modes, response styles and what each asks of the planner and of a model (pure). */
export const MODES = ['QUICK', 'PLANNING', 'RESEARCH', 'TRAVEL', 'CARD_STRATEGY', 'AUDIT'] as const;
export type Mode = (typeof MODES)[number];
export const STYLES = ['CONCISE', 'BALANCED', 'DETAILED'] as const;
export type Style = (typeof STYLES)[number];
export const DEPTHS = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type Depth = (typeof DEPTHS)[number];

export type Lens = 'CARD_STRATEGY' | 'OFFER' | 'LOYALTY' | 'TRAVEL' | 'BENEFIT' | 'PORTFOLIO' | 'AUDIT';

export const LENS_LABEL: Record<Lens, string> = {
  CARD_STRATEGY: 'Card Strategy',
  OFFER: 'Merchant Offers',
  LOYALTY: 'Loyalty',
  TRAVEL: 'Travel',
  BENEFIT: 'Benefits',
  PORTFOLIO: 'Family Portfolio',
  AUDIT: 'Audit',
};

export interface ModeSpec {
  label: string;
  blurb: string;
  /** which specialists work on an agenda in this mode */
  lenses: Lens[];
  /** items shown in an agenda */
  limit: number;
  effort: 'low' | 'medium' | 'high';
  maxTokens: number;
}

const ALL: Lens[] = ['OFFER', 'LOYALTY', 'TRAVEL', 'BENEFIT', 'CARD_STRATEGY', 'PORTFOLIO', 'AUDIT'];

export const MODE_SPEC: Record<Mode, ModeSpec> = {
  QUICK: { label: 'Quick', blurb: 'The few things that matter most right now.', lenses: ALL, limit: 5, effort: 'low', maxTokens: 400 },
  PLANNING: { label: 'Planning', blurb: 'A fuller plan across offers, credits, points and cards.', lenses: ALL, limit: 12, effort: 'medium', maxTokens: 700 },
  RESEARCH: { label: 'Research', blurb: 'Everything found, with the reasoning and the evidence.', lenses: ALL, limit: 20, effort: 'high', maxTokens: 900 },
  TRAVEL: { label: 'Travel', blurb: 'Points, certificates, transfer bonuses and credits for trips.', lenses: ['TRAVEL', 'LOYALTY', 'OFFER', 'BENEFIT'], limit: 10, effort: 'medium', maxTokens: 700 },
  CARD_STRATEGY: { label: 'Card strategy', blurb: 'Annual fees, 5/24, the next card and the household.', lenses: ['CARD_STRATEGY', 'PORTFOLIO', 'BENEFIT'], limit: 10, effort: 'medium', maxTokens: 700 },
  AUDIT: { label: 'Audit', blurb: 'Stale data, missed offers and credits that went unused.', lenses: ['AUDIT', 'BENEFIT', 'OFFER', 'LOYALTY'], limit: 12, effort: 'medium', maxTokens: 700 },
};

export const isMode = (x: unknown): x is Mode => typeof x === 'string' && (MODES as readonly string[]).includes(x);
export const isStyle = (x: unknown): x is Style => typeof x === 'string' && (STYLES as readonly string[]).includes(x);
export const isDepth = (x: unknown): x is Depth => typeof x === 'string' && (DEPTHS as readonly string[]).includes(x);

export function effortFor(mode: Mode, depth: Depth | null | undefined): 'low' | 'medium' | 'high' {
  return depth ? (depth.toLowerCase() as 'low' | 'medium' | 'high') : MODE_SPEC[mode].effort;
}

export const clampTemperature = (t: unknown): number | null => (typeof t === 'number' && Number.isFinite(t) ? Math.min(1, Math.max(0, Math.round(t * 100) / 100)) : null);

export const STYLE_INSTRUCTION: Record<Style, string> = {
  CONCISE: 'Write at most three short sentences.',
  BALANCED: 'Write one short paragraph of at most 90 words.',
  DETAILED: 'Write up to 180 words: a short opening, then one short line per item.',
};
