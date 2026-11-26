import { mayReceive, StepPrivacy } from './privacy';

/**
 * Task-based model selection (pure) on top of the per-agent chain: filter by privacy, capability and cost
 * tier, then order cheapest first. Free-only deployments use maxCost 'FREE' (local models, no price row).
 */
export type CostTier = 'FREE' | 'LOW' | 'HIGH';
const ORDER: Record<CostTier, number> = { FREE: 0, LOW: 1, HIGH: 2 };

export interface ModelLike {
  id: string;
  capabilities: string[];
  inputPrice: unknown;
  outputPrice: unknown;
  provider: { kind: string };
}

/** USD per million tokens: none or zero → FREE, ≤ $1 → LOW, else HIGH. */
export function costTier(m: Pick<ModelLike, 'inputPrice' | 'outputPrice'>): CostTier {
  const i = m.inputPrice == null ? 0 : Number(m.inputPrice);
  const o = m.outputPrice == null ? 0 : Number(m.outputPrice);
  const worst = Math.max(i, o);
  if (!(worst > 0)) return 'FREE';
  return worst <= 1 ? 'LOW' : 'HIGH';
}

export interface TaskNeeds {
  privacy: StepPrivacy;
  capability?: string;
  maxCost?: CostTier;
}

export function selectModels<M extends ModelLike>(models: M[], need: TaskNeeds): M[] {
  const max = ORDER[need.maxCost ?? 'FREE'];
  return models
    .filter((m) => mayReceive(need.privacy, m.provider.kind))
    .filter((m) => !need.capability || m.capabilities.includes(need.capability))
    .filter((m) => ORDER[costTier(m)] <= max)
    .sort((a, b) => ORDER[costTier(a)] - ORDER[costTier(b)] || a.id.localeCompare(b.id));
}
