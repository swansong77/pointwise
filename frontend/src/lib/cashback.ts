export type Health = 'UP' | 'DOWN' | 'UNKNOWN';
export type Freshness = 'FRESH' | 'RECENT' | 'AGING' | 'STALE';

export interface RankedSite {
  site: string;
  name: string;
  kind: 'CASHBACK' | 'POINTS';
  label: string;
  percent: number;
  upTo: boolean;
  expectedPercent: number;
  expectedCents: number;
  reliability: number;
  freshness: Freshness;
  health: Health;
  healthNote: string;
  usable: boolean;
  hasAccount: boolean;
  holders: string[];
  conditions: string | null;
  observedAt: string;
  method: string;
  url: string;
  warnings: string[];
}

export interface CashbackRec {
  haveAccounts: boolean;
  pick: RankedSite | null;
  consider: (RankedSite & { extraCents: number }) | null;
  ranked: RankedSite[];
  steps: string[];
  warnings: string[];
  /** the store's page on Cashback Monitor, where every site's current rate is compared */
  monitorUrl?: string;
  /** what the comparison site headlines as the best rate for this store, when it was read lately */
  benchmark?: { source: string; bestPercent: number; observedAt: string; url: string } | null;
}

export interface CashbackSiteView {
  code: string;
  name: string;
  kind: 'CASHBACK' | 'POINTS';
  homeUrl: string;
  notes: string | null;
  health: Health;
  healthNote: string;
  lastCheckedAt: string | null;
  autoRead: boolean;
  lastReadAt: string | null;
  rates: number;
  ratesSeenAt: string | null;
  accounts: Array<{ profileId: string; member: string }>;
}

export interface AdminSite {
  id: string;
  code: string;
  name: string;
  kind: 'CASHBACK' | 'POINTS';
  homeUrl: string;
  notes: string | null;
  isActive: boolean;
  autoRead: boolean;
  storeUrlTemplate: string | null;
  lastReadAt: string | null;
  lastReadNote: string | null;
  readFailures: number;
  reachable: boolean | null;
  httpStatus: number | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  failures: number;
}

export interface AdminRate {
  id: string;
  site: string;
  merchant: string;
  merchantSlug: string;
  ratePercent: number | null;
  pointsPerDollar: number | null;
  upTo: boolean;
  expiresAt: string | null;
  observedAt: string;
  method: string;
  source: string;
  conditions: string | null;
  expired: boolean;
}

export const HEALTH_LABEL: Record<Health, string> = { UP: 'Answering', DOWN: 'Not answering', UNKNOWN: 'Not checked lately' };
export const HEALTH_TONE: Record<Health, 'green' | 'red' | 'slate'> = { UP: 'green', DOWN: 'red', UNKNOWN: 'slate' };
export const FRESH_LABEL: Record<Freshness, string> = { FRESH: 'confirmed this week', RECENT: 'confirmed in the last two weeks', AGING: 'not confirmed for weeks', STALE: 'out of date' };
