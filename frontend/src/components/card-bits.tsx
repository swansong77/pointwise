'use client';

import type { ReactNode } from 'react';
import type { RankedCard } from '@/lib/types';
import { centsPerDollar, multiplier } from '@/lib/format';
import { resolveBrand } from '@/lib/brands';
import { BrandLogo } from '@/components/brand-logo';
import { useMemo } from 'react';
import { useWallet } from '@/lib/queries';

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
 * A card's face: its colour, the issuing bank's logo and its name. One mark only (the bank's, not the payment network's);
 * the logo is the issuer's own mark, shown only to identify the card, and the colour comes from the catalog, not a copy of any card art.
 */
export function CardArt({ name, color, issuer, size = 'md' }: { name: string; color: string; issuer?: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'lg' ? 'h-24 w-40' : size === 'sm' ? 'h-7 w-11' : 'h-11 w-[4.5rem]';
  const logo = size === 'lg' ? 'md' : 'xs';
  return (
    <span
      data-testid="card-art"
      role="img"
      aria-label={`${name} card${issuer ? `, ${issuer}` : ''}`}
      className={`relative inline-block shrink-0 overflow-hidden rounded-lg shadow-sm ${dims}`}
      style={{ background: `linear-gradient(135deg, ${color}, ${color}b3)` }}
    >
      {size === 'sm' ? (
        issuer && <BrandLogo brand={{ name: issuer }} kinds={['ISSUER']} size="xs" decorative className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
      ) : (
        issuer && <BrandLogo brand={{ name: issuer }} kinds={['ISSUER']} size={logo} decorative className="absolute left-1 top-1" />
      )}
    </span>
  );
}

export interface WalletCardInfo {
  name: string;
  color: string;
  issuer: string;
}

/** The household's cards by wallet-card id and by catalog-card id, so any list of cards can show the issuer's logo. */
export function useWalletCardInfo(): Map<string, WalletCardInfo> {
  const w = useWallet();
  return useMemo(() => {
    const m = new Map<string, WalletCardInfo>();
    for (const wc of w.data ?? []) {
      const info = { name: wc.card.name, color: wc.card.color, issuer: wc.card.issuer.name };
      m.set(wc.id, info);
      if (!m.has(`card:${wc.card.id}`)) m.set(`card:${wc.card.id}`, info);
    }
    return m;
  }, [w.data]);
}

/** A card face for a card the household holds: the issuer comes from the wallet by id. */
export function WalletCardArt({ walletCardId, cardId, name, color, size = 'md' }: { walletCardId?: string | null; cardId?: string | null; name?: string; color?: string; size?: 'sm' | 'md' | 'lg' }) {
  const map = useWalletCardInfo();
  const info = (walletCardId ? map.get(walletCardId) : undefined) ?? (cardId ? map.get(`card:${cardId}`) : undefined);
  return <CardArt name={name ?? info?.name ?? 'Card'} color={color ?? info?.color ?? '#64748b'} issuer={info?.issuer} size={size} />;
}

export function RankedCardRow({ r, rank, action }: { r: RankedCard; rank: number; action?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2" data-testid="ranked-card">
      <span className="w-5 text-right text-xs font-semibold text-slate-400">{rank}</span>
      <WalletCardArt walletCardId={r.walletCardId} cardId={r.cardId} name={r.name} color={r.color} />
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
