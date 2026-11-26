'use client';

import { BrandLogo } from '@/components/brand-logo';
import clsx from 'clsx';
import { useState, type FormEvent } from 'react';
import { Badge, Button, EmptyState, ErrorText, Field, Input, Panel, PageHeader, Select, Spinner } from '@/components/ui';
import { CardSwatch } from '@/components/card-bits';
import { qk, useApiMutation, useEligibleOffers, useMyOffers, useWallet } from '@/lib/queries';
import { daysLeftLabel, dollarsToCents, money } from '@/lib/format';
import type { UserOffer } from '@/lib/types';

const TABS = ['ACTIVE', 'REDEEMED', 'EXPIRED'] as const;
const invalidate = [['offers'], qk.dashboard] as const;

function OfferRow({ uo }: { uo: UserOffer }) {
  const [amount, setAmount] = useState('');
  const update = useApiMutation<Record<string, unknown>>((body) => ({ path: `/offers/mine/${uo.id}`, method: 'PATCH', body }), invalidate);
  const remove = useApiMutation<void>(() => ({ path: `/offers/mine/${uo.id}`, method: 'DELETE' }), invalidate);
  const cents = dollarsToCents(amount);
  const active = uo.effectiveStatus === 'ACTIVE';

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="offer-row">
      <div className="flex flex-wrap items-start gap-3">
        <CardSwatch color={uo.walletCard.card.color} />
        {uo.offer.merchant && <BrandLogo brand={{ name: uo.offer.merchant.name }} size="md" decorative />}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">
            {uo.isFavorite && <span aria-label="favorite">★ </span>}
            {uo.offer.title}
          </p>
          <p className="text-xs text-slate-500">
            {uo.walletCard.nickname || uo.walletCard.card.name}
            {uo.offer.merchant && ` · ${uo.offer.merchant.name}`}
            {uo.offer.minSpendCents ? ` · min spend ${money(uo.offer.minSpendCents)}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold" data-testid="offer-value" data-cents={uo.offer.valueCents}>
            {uo.offer.kind === 'POINTS' ? 'Bonus pts' : money(uo.offer.valueCents)}
          </p>
          <Badge tone={uo.effectiveStatus === 'REDEEMED' ? 'green' : uo.effectiveStatus === 'EXPIRED' ? 'red' : (uo.daysLeft ?? 99) <= 7 ? 'amber' : 'slate'}>
            {uo.effectiveStatus === 'ACTIVE' ? daysLeftLabel(uo.daysLeft) : uo.effectiveStatus.toLowerCase()}
          </Badge>
        </div>
      </div>
      {uo.offer.kind !== 'POINTS' && uo.amountUsedCents > 0 && (
        <p className="mt-2 text-xs text-slate-500">
          Used {money(uo.amountUsedCents)} · remaining {money(uo.remainingCents)}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        {active && (
          <>
            <Button variant="secondary" loading={update.isPending} onClick={() => update.mutate({ redeemed: true })} data-testid="redeem">
              Mark redeemed
            </Button>
            {uo.offer.kind !== 'POINTS' && (
              <form
                className="flex items-end gap-2"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  if (cents != null) update.mutate({ amountUsedCents: cents }, { onSuccess: () => setAmount('') });
                }}
              >
                <label className="sr-only" htmlFor={`amt-${uo.id}`}>
                  Amount used in dollars
                </label>
                <Input id={`amt-${uo.id}`} className="w-28" placeholder="$ used" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <Button type="submit" variant="ghost" disabled={cents == null}>
                  Save amount
                </Button>
              </form>
            )}
            <Button variant="ghost" onClick={() => update.mutate({ snoozedUntil: new Date(Date.now() + 7 * 86_400_000).toISOString() })}>
              Snooze 7d
            </Button>
          </>
        )}
        {uo.effectiveStatus === 'REDEEMED' && (
          <Button variant="ghost" onClick={() => update.mutate({ redeemed: false })}>
            Undo redeem
          </Button>
        )}
        <Button variant="ghost" onClick={() => update.mutate({ isFavorite: !uo.isFavorite })} aria-pressed={uo.isFavorite}>
          {uo.isFavorite ? 'Unfavorite' : 'Favorite'}
        </Button>
        <Button variant="ghost" className="text-red-600" onClick={() => remove.mutate(undefined)}>
          Remove
        </Button>
      </div>
      <ErrorText error={update.error || remove.error} />
    </li>
  );
}

function CustomOfferForm({ onDone }: { onDone: () => void }) {
  const wallet = useWallet();
  const [form, setForm] = useState({ walletCardId: '', title: '', value: '', endsAt: '' });
  const create = useApiMutation<void>(
    () => ({
      path: '/offers/custom',
      method: 'POST',
      body: { walletCardId: form.walletCardId, title: form.title, kind: 'CASH', valueCents: dollarsToCents(form.value) ?? 0, endsAt: form.endsAt || undefined },
    }),
    invalidate,
  );
  const valid = form.walletCardId && form.title.trim().length >= 2 && dollarsToCents(form.value) != null;
  return (
    <Panel title="Add a custom offer" action={<Button variant="ghost" onClick={onDone}>Close</Button>} data-testid="custom-offer-form">
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined, { onSuccess: onDone });
        }}
      >
        <Field label="Card" htmlFor="co-card">
          <Select id="co-card" value={form.walletCardId} onChange={(e) => setForm({ ...form, walletCardId: e.target.value })}>
            <option value="">Select a card…</option>
            {wallet.data?.map((w) => (
              <option key={w.id} value={w.id}>
                {w.nickname || w.card.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" htmlFor="co-title">
          <Input id="co-title" value={form.title} maxLength={140} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. $10 back at Local Bakery" />
        </Field>
        <Field label="Value ($)" htmlFor="co-value">
          <Input id="co-value" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        </Field>
        <Field label="Expires (optional)" htmlFor="co-ends">
          <Input id="co-ends" type="date" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <ErrorText error={create.error} />
          <Button type="submit" disabled={!valid} loading={create.isPending}>
            Save offer
          </Button>
        </div>
      </form>
    </Panel>
  );
}

function EligibleOffers() {
  const eligible = useEligibleOffers();
  const add = useApiMutation<{ offerId: string; walletCardId: string }>((body) => ({ path: '/offers/mine', method: 'POST', body }), [...invalidate, qk.eligible]);
  if (!eligible.data?.length) return null;
  return (
    <Panel title={`Available to add (${eligible.data.length})`} data-testid="eligible-offers">
      <ul className="divide-y divide-slate-100">
        {eligible.data.map((e) => (
          <li key={`${e.offer.id}-${e.walletCardId}`} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{e.offer.title}</p>
              <p className="text-xs text-slate-500">
                for {e.cardName}
                {e.offer.endsAt && ` · ends ${new Date(e.offer.endsAt).toLocaleDateString()}`}
              </p>
            </div>
            <Button variant="secondary" loading={add.isPending && add.variables?.offerId === e.offer.id} onClick={() => add.mutate({ offerId: e.offer.id, walletCardId: e.walletCardId })} aria-label={`Add offer ${e.offer.title}`}>
              Add to card
            </Button>
          </li>
        ))}
      </ul>
      <ErrorText error={add.error} />
    </Panel>
  );
}

export default function OffersPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]>('ACTIVE');
  const [sort, setSort] = useState('endDate');
  const [custom, setCustom] = useState(false);
  const offers = useMyOffers(tab, sort);

  return (
    <div className="space-y-6">
      <PageHeader title="Offers" subtitle="Track card-linked offers and credits before they expire." action={!custom && <Button onClick={() => setCustom(true)}>+ Custom offer</Button>} />
      {custom && <CustomOfferForm onDone={() => setCustom(false)} />}
      <EligibleOffers />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label="Offer status" className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
          {TABS.map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={clsx('rounded-md px-3 py-1.5 text-sm', tab === t ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}
            >
              {t.charAt(0) + t.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Sort
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-40">
            <option value="endDate">Ending soonest</option>
            <option value="value">Highest value</option>
            <option value="addedDate">Recently added</option>
            <option value="alphabetical">A–Z</option>
          </Select>
        </label>
      </div>
      {offers.isLoading && <Spinner />}
      <ErrorText error={offers.error} />
      {offers.data?.length === 0 && <EmptyState title={`No ${tab.toLowerCase()} offers`} />}
      <ul className="space-y-3" data-testid="offer-list">
        {offers.data?.map((uo) => <OfferRow key={uo.id} uo={uo} />)}
      </ul>
    </div>
  );
}
