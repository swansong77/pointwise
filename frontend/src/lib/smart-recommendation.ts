import { money } from './format';
import type { Advice } from './offer-market';

export const GOAL_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'TRAVEL', label: 'Travel' },
  { id: 'CASHBACK', label: 'Cash back' },
  { id: 'HOTEL', label: 'Hotels' },
  { id: 'AIRLINE', label: 'Airlines' },
  { id: 'LOW_FEE', label: 'Low or no fee' },
];

export interface Factor {
  key: string;
  label: string;
  deltaCents: number;
  note: string;
}

export interface SmartCard {
  cardId: string;
  slug: string;
  name: string;
  issuer: string;
  eligible: boolean;
  adjustedScoreCents: number;
  firstYearValueCents: number;
  longTermValueCents: number;
  probability: number;
  confidence: number;
  confidenceReasons: string[];
  factors: Factor[];
  risks: string[];
  advice: Advice[];
  recommendationId?: string;
}

export interface SmartResponse {
  engine: string;
  member: { profileId: string; nickname: string };
  recommended: SmartCard | null;
  alternatives: SmartCard[];
  others: SmartCard[];
  inputs: { goals: string[]; appsLast6m: number; hasBusiness: boolean; creditBandKnown: boolean; benefitUtilizationPct: number | null };
  disclaimer: string;
}

/** "About 85% (estimate)" — probability is never shown as a promise. */
export function probabilityLabel(p: number): string {
  if (p <= 0) return 'Not eligible right now';
  return `About ${Math.round(p * 100)}% (estimate)`;
}

export function factorLabel(f: Pick<Factor, 'label' | 'deltaCents'>): string {
  return `${f.deltaCents >= 0 ? '+' : '−'}${money(Math.abs(f.deltaCents))} ${f.label}`;
}

export function toggleGoal(goals: string[], id: string): string[] {
  return goals.includes(id) ? goals.filter((g) => g !== id) : [...goals, id];
}
