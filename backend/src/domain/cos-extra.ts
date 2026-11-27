/**
 * Items the daily agenda leaves out because they are not for today: membership renewals, elite status that needs requalifying, and fee
 * decisions a year out. They feed the Action Center's quarterly and annual lists (pure).
 */
import type { PlanItem } from './copilot-plan';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Obj) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const usd = (c: number) => '$' + Math.round(c / 100).toLocaleString('en-US');
const day = (x: unknown): string => {
  const d = typeof x === 'string' || x instanceof Date ? new Date(x) : null;
  return d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : '';
};
const word = (k: string) => k.toLowerCase().replace(/_/g, ' ');
const base = (): Pick<PlanItem, 'assumptions' | 'factors' | 'calls' | 'horizon'> => ({ assumptions: [], factors: [], calls: [], horizon: 'LATER' });

/** Global Entry, CLEAR, lounge memberships coming up for renewal in the next year */
export function membershipItems(rows: unknown, now: Date, withinDays = 366): PlanItem[] {
  void now;
  return arr(rows)
    .map(obj)
    .filter((m) => {
      const d = num(obj(m.view).daysLeft);
      return d != null && d <= withinDays && str(obj(m.view).state) !== 'NO_DATE';
    })
    .slice(0, 5)
    .map((m) => {
      const v = obj(m.view);
      const d = num(v.daysLeft) as number;
      const value = num(m.annualValueCents) ?? 0;
      const credit = str(m.creditSuggestion);
      return {
        ...base(),
        id: 'membership:' + str(m.id),
        lens: 'LOYALTY' as const,
        title: d < 0 ? `${word(str(m.kind))} membership has expired` : `${word(str(m.kind))} membership ${d <= 1 ? 'ends' : 'renews'} in ${d} days`,
        recommendation: v.renewalEligible === true ? `Renew now.${credit ? ' ' + credit : ''}` : `Renewal opens closer to ${day(m.expiresAt ?? m.renewalAt)}.`,
        reason: value > 0 ? `It is worth about ${usd(value)} a year to you.` : 'It lapses if it is not renewed.',
        evidence: [`Memberships: ${str(v.headline) || 'expiry recorded'}`],
        expectedValueCents: value || null,
        risks: d <= 14 ? ['Some renewals take weeks to process.'] : [],
        confidence: 80,
        href: '/loyalty',
        facts: { kind: 'MEMBERSHIP_RENEWAL', subject: word(str(m.kind)), member: str(m.member) || undefined, amountCents: value || undefined, daysLeft: d },
        priority: 5,
      };
    });
}

/** Elite status that is in progress but not yet kept, or at risk of lapsing */
export function statusItems(rows: unknown): PlanItem[] {
  return arr(rows)
    .map(obj)
    .filter((s) => s.current !== false && s.maintained !== true && ['HIGH', 'MEDIUM', 'EXPIRED'].includes(str(obj(s.view).risk)))
    .slice(0, 4)
    .map((s) => {
      const v = obj(s.view);
      const d = num(v.daysLeft);
      const value = num(s.valueCents) ?? 0;
      const actions = arr(v.actions).map(str);
      return {
        ...base(),
        id: 'status:' + str(s.id),
        lens: 'LOYALTY' as const,
        title: `${str(s.program)} ${str(s.level)} status: ${num(v.pct) != null ? `${num(v.pct)}% there` : 'in progress'}`,
        recommendation: actions[0] || str(v.headline) || 'Check what is still needed to qualify.',
        reason: value > 0 ? `The status is worth about ${usd(value)} a year.` : 'It lapses unless it is requalified.',
        evidence: [`Elite status: ${str(v.headline)}`],
        expectedValueCents: value || null,
        risks: ['Qualification rules can change.'],
        confidence: 65,
        href: '/loyalty',
        facts: { kind: 'STATUS_REQUAL', program: str(s.program) || undefined, member: str(s.member) || undefined, amountCents: value || undefined, daysLeft: d ?? undefined, verdict: str(v.risk).toLowerCase() },
        priority: 6,
      };
    });
}
