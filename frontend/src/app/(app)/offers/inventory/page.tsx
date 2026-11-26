'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BrandLogo } from '@/components/brand-logo';
import { StatTiles } from '@/components/charts';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { daysLeftLabel, money, shortDate } from '@/lib/format';
import {
  EMPTY_FILTERS,
  InventoryFilters,
  inventoryPath,
  LIFECYCLE,
  LIFECYCLE_ORDER,
  LifecycleState,
  offerValueText,
  QUICK_FILTERS,
  UnifiedInventory,
  UnifiedOffer,
} from '@/lib/offer-inventory';
import type { Member } from '@/lib/portfolio-types';
import { useAuthedQuery, useWallet } from '@/lib/queries';

const PAGE_SIZE = 25;

function OfferRow({ o }: { o: UnifiedOffer }) {
  const st = LIFECYCLE[o.state];
  const merchant = o.merchant?.name ?? o.merchantText;
  return (
    <li className="grid gap-3 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.5fr)_minmax(0,1fr)_auto] sm:items-center" data-testid="inventory-row" data-state={o.state}>
      <div className="flex min-w-0 items-center gap-3">
        <BrandLogo brand={{ name: merchant }} size="md" decorative />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-slate-900">{merchant}</p>
          <p className="truncate text-xs text-slate-600">{offerValueText(o, money)}</p>
          <p className="truncate text-xs text-slate-500">{o.title}</p>
        </div>
      </div>
      <div className="min-w-0 text-xs text-slate-600">
        <p className="truncate">
          {o.cardholder ? <strong className="font-medium text-slate-800">{o.cardholder}</strong> : 'Not on a card yet'}
          {o.card && (
            <>
              {' · '}
              {o.walletCardId ? (
                <Link href={`/wallet/${o.walletCardId}`} className="text-brand-700 underline">
                  {o.card}
                </Link>
              ) : (
                o.card
              )}
            </>
          )}
        </p>
        <p className="truncate">{o.issuer ?? '—'}</p>
        <p className="truncate text-slate-500">
          {o.origin === 'SYNC' ? 'Found by account sync' : o.source.replace(/_/g, ' ').toLowerCase()} · checked {shortDate(o.lastVerified)}
        </p>
      </div>
      <div className="text-xs text-slate-600">
        <p className={o.daysLeft != null && o.daysLeft >= 0 && o.daysLeft <= 14 && st.live ? 'font-medium text-red-700' : ''}>
          {o.endsAt ? `${shortDate(o.endsAt)} · ${daysLeftLabel(o.daysLeft)}` : 'No expiry'}
        </p>
        <p>
          Expected <strong className="text-slate-800">{money(o.expectedSavingsCents)}</strong>
          {o.actualSavingsCents > 0 && (
            <>
              {' · '}Received <strong className="text-slate-800">{money(o.actualSavingsCents)}</strong>
            </>
          )}
        </p>
      </div>
      <div className="sm:text-right">
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
    </li>
  );
}

export default function OfferInventoryPage() {
  const [f, setF] = useState<InventoryFilters>(EMPTY_FILTERS);
  const [quick, setQuick] = useState('all');
  const path = inventoryPath(f, PAGE_SIZE);
  const inv = useAuthedQuery<UnifiedInventory>(['offers', 'inventory', path], path);
  const wallet = useWallet();
  const members = useAuthedQuery<Member[]>(['household', 'members'], '/household/members');
  const set = (patch: Partial<InventoryFilters>) => setF((cur) => ({ ...cur, page: 1, ...patch }));
  const toggleState = (s: LifecycleState) => set({ states: f.states.includes(s) ? f.states.filter((x) => x !== s) : [...f.states, s] });
  const d = inv.data;
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  return (
    <div className="space-y-6" data-testid="offer-inventory">
      <PageHeader title="Offer inventory" subtitle="Every offer across your household’s cards: who holds it, what it’s worth, when it ends and where it stands." />
      {d && (
        <StatTiles
          testId="inventory-totals"
          items={[
            ['Offers', String(d.summary.total), `${d.summary.live} still earning`],
            ['Expiring in 30 days', String(d.summary.expiringSoon)],
            ['Expected savings', money(d.summary.expectedCents), 'from offers still earning'],
            ['Received so far', money(d.summary.actualCents)],
          ]}
        />
      )}
      <Panel title="Find offers">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick filters">
          {QUICK_FILTERS.map((q) => (
            <Button
              key={q.key}
              variant={quick === q.key ? 'primary' : 'secondary'}
              className="text-xs"
              aria-pressed={quick === q.key}
              onClick={() => {
                setQuick(q.key);
                setF({ ...EMPTY_FILTERS, ...q.apply });
              }}
            >
              {q.label}
            </Button>
          ))}
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Search" htmlFor="inv-q" hint="Merchant, card, issuer or person. “amex hilton” works.">
            <Input id="inv-q" value={f.q} placeholder="Hilton, Amex, Sapphire…" onChange={(e) => set({ q: e.target.value })} />
          </Field>
          <Field label="Cardholder" htmlFor="inv-who">
            <Select id="inv-who" value={f.profileId} onChange={(e) => set({ profileId: e.target.value })}>
              <option value="">Everyone</option>
              {(members.data ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nickname}
                  {m.isPrimary ? ' (you)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Card" htmlFor="inv-card">
            <Select id="inv-card" value={f.walletCardId} onChange={(e) => set({ walletCardId: e.target.value })}>
              <option value="">All cards</option>
              {(wallet.data ?? []).map((w) => (
                <option key={w.id} value={w.id}>
                  {w.nickname || w.card.name}
                  {w.lastFour ? ` ••${w.lastFour}` : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sort by" htmlFor="inv-sort">
            <Select id="inv-sort" value={f.sort} onChange={(e) => set({ sort: e.target.value as InventoryFilters['sort'] })}>
              <option value="ENDING">Ending soonest</option>
              <option value="VALUE">Highest value</option>
              <option value="EXPECTED">Highest expected savings</option>
              <option value="ADDED">Recently added</option>
              <option value="MERCHANT">Merchant A–Z</option>
            </Select>
          </Field>
          <Field label="Ends within" htmlFor="inv-exp">
            <Select id="inv-exp" value={f.expiresWithinDays ?? ''} onChange={(e) => set({ expiresWithinDays: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">Any time</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </Select>
          </Field>
          <Field label="Worth at least" htmlFor="inv-val">
            <Select id="inv-val" value={f.minValueCents ?? ''} onChange={(e) => set({ minValueCents: e.target.value === '' ? null : Number(e.target.value) })}>
              <option value="">Any value</option>
              <option value="2500">$25</option>
              <option value="5000">$50</option>
              <option value="10000">$100</option>
              <option value="25000">$250</option>
            </Select>
          </Field>
        </div>
        <fieldset className="mt-4">
          <legend className="text-sm font-medium text-slate-700">Where it stands</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {LIFECYCLE_ORDER.map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" checked={f.states.includes(s)} onChange={() => toggleState(s)} />
                {LIFECYCLE[s].label}
                {d && <span className="text-xs text-slate-600">({d.summary.byState[s]})</span>}
              </label>
            ))}
          </div>
        </fieldset>
      </Panel>

      {inv.isLoading && <Spinner label="Loading offers" />}
      <ErrorText error={inv.error} />
      {d && d.total === 0 && <EmptyState title="No offers match">Try fewer filters, or add offers on the Offers page or by importing them.</EmptyState>}
      {d && d.total > 0 && (
        <Panel title={`${d.total} offer${d.total === 1 ? '' : 's'}`} data-testid="inventory-list">
          <ul className="divide-y divide-slate-100">
            {d.items.map((o) => (
              <OfferRow key={o.id} o={o} />
            ))}
          </ul>
          {pages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <Button variant="secondary" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>
                Previous
              </Button>
              <span>
                Page {f.page} of {pages}
              </span>
              <Button variant="secondary" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>
                Next
              </Button>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
