/** Pure formatting helpers (unit tested). All money values are integer cents. */

export function money(cents: number | null | undefined, opts: { compact?: boolean } = {}): string {
  const v = (cents ?? 0) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: opts.compact || Number.isInteger(v) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(v);
}

/** "5¢/$" for centsPerDollar, trimming trailing zeros. */
export function centsPerDollar(v: number): string {
  return `${Number(v.toFixed(2))}¢/$`;
}

export function multiplier(x: number | string): string {
  const n = Number(x);
  return `${Number.isInteger(n) ? n : Number(n.toFixed(2))}x`;
}

export function shortDate(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

export function daysLeftLabel(days: number | null | undefined): string {
  if (days == null) return 'No expiry';
  if (days < 0) return 'Expired';
  if (days === 0) return 'Ends today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

export function distance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Parse a dollars string like "1,234.50" into integer cents. Returns null if invalid. */
export function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}

export function pct(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

export function initials(name: string | null | undefined, email?: string): string {
  const src = (name || email || '?').trim();
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase();
}
