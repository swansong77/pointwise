export type Plan = 'FREE' | 'PRO';
export type SubscriptionStatus = 'ACTIVE' | 'TRIALING' | 'CANCELED' | 'PAST_DUE';

export interface PlanLimits {
  maxCards: number;
  maxTrackedOffers: number;
  offerAlerts: boolean;
  profiles: boolean;
  calculatorCompare: boolean;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: { maxCards: 5, maxTrackedOffers: 20, offerAlerts: false, profiles: false, calculatorCompare: false },
  PRO: {
    maxCards: Number.MAX_SAFE_INTEGER,
    maxTrackedOffers: Number.MAX_SAFE_INTEGER,
    offerAlerts: true,
    profiles: true,
    calculatorCompare: true,
  },
};

export interface SubscriptionLike {
  plan: Plan;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
}

/** PRO only counts while active/trialing (or canceled but still inside the paid period). */
export function effectivePlan(sub: SubscriptionLike | null | undefined, now: Date = new Date()): Plan {
  if (!sub || sub.plan !== 'PRO') return 'FREE';
  if (sub.status === 'ACTIVE' || sub.status === 'TRIALING') {
    return !sub.currentPeriodEnd || sub.currentPeriodEnd.getTime() > now.getTime() ? 'PRO' : 'FREE';
  }
  if (sub.status === 'CANCELED' && sub.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime()) {
    return 'PRO';
  }
  return 'FREE';
}

export function limitsFor(sub: SubscriptionLike | null | undefined, now?: Date): PlanLimits {
  return PLAN_LIMITS[effectivePlan(sub, now)];
}

export const PRICES = {
  month: { cents: 799, label: 'Monthly' },
  year: { cents: 5999, label: 'Annual', trialDays: 7 },
  lifetime: { cents: 14999, label: 'Lifetime' },
} as const;
export type BillingInterval = keyof typeof PRICES;

export function periodEndFor(interval: BillingInterval, from: Date): Date | null {
  const d = new Date(from.getTime());
  if (interval === 'month') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1);
  else return null;
  return d;
}
