import type { RecOutput } from '../domain/recommendation-intel';

/** The orchestrator's view of the smart-recommendation result. */
export interface SmartResult {
  engine: string;
  member: { profileId: string; nickname: string };
  recommended: (RecOutput & { recommendationId?: string }) | null;
  alternatives: Array<RecOutput & { recommendationId?: string }>;
}
