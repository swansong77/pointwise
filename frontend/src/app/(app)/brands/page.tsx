'use client';

import { useMemo, useState } from 'react';
import { BrandLogo } from '@/components/brand-logo';
import { Badge, EmptyState, Field, Input, PageHeader, Panel } from '@/components/ui';
import { Brand, BRANDS, brandsOfKind, KIND_LABEL, KIND_ORDER, LOGO_CREDITS, normalize } from '@/lib/brands';

function Tile({ b }: { b: Brand }) {
  return (
    <li className="flex items-center gap-3 rounded-xl border border-slate-100 p-3" data-testid="brand-tile" data-brand={b.key}>
      <BrandLogo brand={b} size="xl" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-slate-900">{b.name}</p>
        <p className="text-xs text-slate-600">
          {b.file ? (LOGO_CREDITS.some((c) => c.key === b.key) ? 'Logo · credited below' : 'Logo · open collection') : 'Monogram · no icon available'}
        </p>
        {b.codes.length > 0 && <p className="truncate text-xs text-slate-500">{b.codes.join(', ')}</p>}
      </div>
    </li>
  );
}

export default function BrandsPage() {
  const [q, setQ] = useState('');
  const n = normalize(q);
  const match = (b: Brand) => !n || [b.name, b.key, ...b.aliases, ...b.codes].some((t) => normalize(t).includes(n));
  const icons = BRANDS.filter((b) => b.file).length;
  const groups = useMemo(() => KIND_ORDER.map((k) => ({ kind: k, items: brandsOfKind(k).filter(match) })).filter((g) => g.items.length), [n]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-6" data-testid="brands">
      <PageHeader title="Brand logos" subtitle="The logos and icons the app shows for cards, banks, airlines, hotels, programs, merchants and memberships." />
      <Panel>
        <p className="text-sm text-slate-700" data-testid="brand-summary">
          {BRANDS.length} brands: <strong>{icons}</strong> with an icon, <strong>{BRANDS.length - icons}</strong> shown as a monogram badge.
        </p>
        <p className="mt-1 text-xs text-slate-600">
          Icons are from the Simple Icons collection (CC0) and are served by this app; nothing is loaded from other sites. Logos are the trademarks of their owners and are shown
          only to identify a card, bank, program or merchant. Where no icon was available, a monogram stands in rather than an imitation of a logo.
        </p>
        <div className="mt-3 max-w-sm">
          <Field label="Find a brand" htmlFor="brand-search">
            <Input id="brand-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Marriott, MR, chase…" />
          </Field>
        </div>
      </Panel>
      {groups.length === 0 && <EmptyState title="No brand matches">Try a shorter name or a program code.</EmptyState>}
      {groups.map((g) => (
        <Panel
          key={g.kind}
          title={
            <span>
              {KIND_LABEL[g.kind]} <Badge tone="slate">{g.items.length}</Badge>
            </span>
          }
          data-testid={`brand-group-${g.kind}`}
        >
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map((b) => (
              <Tile key={b.key} b={b} />
            ))}
          </ul>
        </Panel>
      ))}
      {LOGO_CREDITS.length > 0 && (
        <Panel title="Credits" data-testid="brand-credits">
          <p className="mb-2 text-xs text-slate-600">
            These logos are licensed Creative Commons Attribution-ShareAlike (CC BY-SA). The marks remain their owners&apos; trademarks.
          </p>
          <ul className="space-y-1 text-sm">
            {LOGO_CREDITS.map((c) => (
              <li key={c.key}>
                {c.name} logo by {c.author} ·{' '}
                <a className="text-brand-700 underline" href={c.licenceUrl} target="_blank" rel="noopener noreferrer">
                  {c.licence}
                </a>{' '}
                ·{' '}
                <a className="text-brand-700 underline" href={c.page} target="_blank" rel="noopener noreferrer">
                  source
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
