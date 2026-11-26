import type { ReactNode } from 'react';
import type { RankedCard } from '@/lib/types';
import { centsPerDollar, multiplier } from '@/lib/format';

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

export function CardSwatch({ color, size = 'md' }: { color: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={size === 'sm' ? 'inline-block h-4 w-6 rounded' : 'inline-block h-6 w-9 rounded-md shadow-inner'}
      style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)` }}
    />
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
