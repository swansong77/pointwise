/** Pure helpers for the portfolio / benefits / 5-24 pages (unit tested). */
import type { BenefitPeriod, BenefitStatus, Five24TimelinePoint, Relationship } from './portfolio-types';

export const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  SELF: 'You',
  SPOUSE: 'Spouse',
  PARTNER: 'Partner',
  CHILD: 'Child',
  PARENT: 'Parent',
  OTHER: 'Other',
};

export const STATUS_LABEL: Record<BenefitStatus, string> = {
  UNUSED: 'Unused',
  PARTIAL: 'Partial',
  COMPLETED: 'Completed',
  EXPIRED: 'Expired',
  EXPIRING_SOON: 'Expiring soon',
};

export function statusTone(s: BenefitStatus): 'slate' | 'green' | 'amber' | 'red' | 'brand' {
  switch (s) {
    case 'COMPLETED':
      return 'green';
    case 'EXPIRING_SOON':
      return 'amber';
    case 'EXPIRED':
      return 'red';
    case 'PARTIAL':
      return 'brand';
    default:
      return 'slate';
  }
}

export function periodLabel(period: BenefitPeriod, months = 12, basis: 'CALENDAR' | 'CARDMEMBER_YEAR' = 'CALENDAR'): string {
  const base =
    period === 'MONTHLY'
      ? 'Monthly'
      : period === 'QUARTERLY'
        ? 'Quarterly'
        : period === 'SEMIANNUAL'
          ? 'Twice a year'
          : period === 'ANNUAL'
            ? 'Yearly'
            : `Every ${Number((months / 12).toFixed(1))} years`;
  return basis === 'CARDMEMBER_YEAR' && period !== 'MULTI_YEAR' ? `${base} (card anniversary)` : base;
}

export const FIVE24_REASON: Record<string, string> = {
  PERSONAL: 'Personal card',
  AUTHORIZED_USER: 'Authorized user (appears on your report)',
  BUSINESS_REPORTS_TO_PERSONAL: 'Business card reported to personal bureaus',
  BUSINESS_NOT_REPORTED: 'Business card (not on personal report)',
  MANUAL_EXCLUSION: 'Excluded by you',
  OUTSIDE_WINDOW: 'Opened more than 24 months ago',
  NO_OPEN_DATE: 'Open date unknown',
  NOT_OPENED: 'Application not approved',
  FUTURE_DATE: 'Open date in the future',
};

/** 0–1 position of `count` on a gauge that tops out at `max` (default 6 = "6/24+"). */
export function gaugeFraction(count: number, max = 6): number {
  return Math.max(0, Math.min(1, count / max));
}

/** SVG arc path for a half-circle gauge from 180° (left) to 0° (right), filled to `fraction`. */
export function arcPath(fraction: number, r = 80, cx = 100, cy = 100): string {
  const f = Math.max(0, Math.min(1, fraction));
  const angle = Math.PI * (1 - f);
  const x = cx + r * Math.cos(angle);
  const y = cy - r * Math.sin(angle);
  return `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${Number(x.toFixed(2))} ${Number(y.toFixed(2))}`;
}

/** Step-chart points (x in 0..width over time, y by count) for a 5/24 timeline. */
export function timelineSteps(points: Five24TimelinePoint[], width = 600, height = 160, maxCount = 6): Array<{ x: number; y: number; label: string; date: string }> {
  if (points.length === 0) return [];
  const t0 = new Date(points[0].date).getTime();
  const t1 = new Date(points[points.length - 1].date).getTime();
  const span = Math.max(1, t1 - t0);
  const top = Math.max(maxCount, ...points.map((p) => p.count));
  return points.map((p) => ({
    x: Math.round(((new Date(p.date).getTime() - t0) / span) * width),
    y: Math.round(height - (p.count / top) * height),
    label: p.label,
    date: p.date,
  }));
}

/** SVG path for a step line through the points. */
export function stepPath(steps: Array<{ x: number; y: number }>, width = 600): string {
  if (steps.length === 0) return '';
  let d = `M 0 ${steps[0].y}`;
  for (let i = 1; i < steps.length; i++) d += ` H ${steps[i].x} V ${steps[i].y}`;
  return `${d} H ${width}`;
}

export function percent(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${(n * 100).toFixed(n * 100 >= 10 ? 0 : 1)}%`;
}

export function monthYear(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Dollars input → cents (accepts "12", "12.5", "$1,234.56"); null when invalid or ≤ 0. */
export function parseAmount(input: string): number | null {
  const s = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  return cents > 0 ? cents : null;
}

export const ACCEPTED_UPLOADS = '.xlsx,.csv';
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function uploadProblem(file: { name: string; size: number } | null): string | null {
  if (!file) return 'Choose a file first';
  if (!/\.(xlsx|csv)$/i.test(file.name)) return 'Only .xlsx workbooks and .csv files are supported';
  if (file.size > MAX_UPLOAD_BYTES) return 'File is larger than 5 MB';
  return null;
}
