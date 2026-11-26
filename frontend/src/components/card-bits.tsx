import type { ReactNode } from 'react';
import type { RankedCard } from '@/lib/types';
import { centsPerDollar, multiplier } from '@/lib/format';
import { resolveBrand } from '@/lib/brands';
import { BrandLogo } from '@/components/brand-logo';

const ICONS: Record<string, string> = {
  utensils: '🍽️',
  'shopping-cart': '🛒',
  fuel: '⛽',
  plane: '✈️',
  'plane-takeoff': '🛫',
  bed: '🛏️',
  car: '🚗',
  train: '🚆',
  monitor: '🖥️',
  pill: '💊',
  tv: '📺',
  film: '🎬',
  hammer: '🔨',
  warehouse: '🏬',
  phone: '📱',
  star: '⭐',
};

export function categoryEmoji(icon: string | null | undefined): string {
  return (icon && ICONS[icon]) || '🏷️';
}

export function CardSwatch({ color, size = 'md', issuer }: { color: string; size?: 'sm' | 'md'; issuer?: string | null }) {
  const swatch = (
    <span
      aria-hidden
      className={size === 'sm' ? 'inline-block h-4 w-6 rounded' : 'inline-block h-6 w-9 rounded-md shadow-inner'}
      style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
    />
  );
  const brand = issuer ? resolveBrand({ name: issuer }, ['ISSUER']) : null;
  if (!brand?.file) return swatch;
  return (
    <span className="relative inline-flex">
      {swatch}
      <BrandLogo brand={brand} size="xs" decorative className="absolute -bottom-1 -right-1" />
    </span>
  );
}

/**
 * A card's face: its colour, the issuer's logo, the network's logo and its name. Logos are the issuer's and
 * network's own marks, shown only to identify the card; the colour comes from the catalog, not a copy of any card art.
 */
export function CardArt({ name, color, issuer, network, size = 'md' }: { name: string; color: string; issuer?: string | null; network?: string | null; size?: 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'h-24 w-40' : 'h-11 w-[4.5rem]';
  return (
    <span
      data-testid="card-art"
      role="img"
      aria-label={`${name} card${issuer ? `, ${issuer}` : ''}${network ? `, ${network}` : ''}`}
      className={`relative inline-block shrink-0 overflow-hidden rounded-lg shadow-sm ${dims}`}
      style={{ background: `linear-gradient(135deg, ${color}, ${color}b3)` }}
    >
      {issuer && <BrandLogo brand={{ name: issuer }} kinds={['ISSUER']} size={size === 'lg' ? 'md' : 'xs'} decorative className="absolute left-1 top-1" />}
      {network && <BrandLogo brand={{ network }} kinds={['NETWORK', 'ISSUER']} size={size === 'lg' ? 'md' : 'xs'} decorative className="absolute bottom-1 right-1" />}
    </span>
  );
}

export function RankedCardRow({ r, rank, action }: { r: RankedCard; rank: number; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2" data-testid="ranked-card">
      <span className="w-5 text-right text-xs font-semibold text-slate-400">{rank}</span>
      <CardSwatch color={r.color} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-slate-900">
          {r.name} {r.pinned && <span className="ml-1 text-xs text-brand-600">📌 pinned</span>}
        </p>
        <p className="truncate text-xs text-slate-500">{r.reason}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold text-slate-900">{centsPerDollar(r.centsPerDollar)}</p>
        <p className="text-xs text-slate-500">
          {multiplier(r.multiplier)} × {r.centsPerPoint}¢
        </p>
      </div>
      {action}
    </li>
  );
}
