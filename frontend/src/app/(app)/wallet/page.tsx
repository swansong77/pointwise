'use client';

import { useState } from 'react';
import { Badge, Button, EmptyState, ErrorText, Field, Input, Panel, PageHeader, Select, Spinner } from '@/components/ui';
import { CardArt } from '@/components/card-bits';
import { Tabs } from '@/components/charts';
import { qk, useApiMutation, useCardSearch, useCategories, useCustomMatches, useWallet } from '@/lib/queries';
import { money, shortDate } from '@/lib/format';
import { rewardBadges } from '@/lib/rates';
import { validateLastFour } from '@/lib/validation';
import { verificationBadge } from '@/lib/catalog';
import type { CardStatus, WalletCard } from '@/lib/types';

const STATUS_TONE: Record<CardStatus, 'green' | 'amber' | 'red' | 'slate'> = { APPROVED: 'green', APPLIED: 'amber', DENIED: 'red', CLOSED: 'slate' };

function AddCard({ onDone }: { onDone: () => void }) {
  const [q, setQ] = useState('');
  const [approvedAt, setApprovedAt] = useState('');
  const [lastFour, setLastFour] = useState('');
  const [cardType, setCardType] = useState<'' | 'PERSONAL' | 'BUSINESS'>('');
  const search = useCardSearch(q, cardType || undefined);
  const add = useApiMutation<{ cardId: string }>(
    ({ cardId }) => ({ path: '/wallet/cards', method: 'POST', body: { cardId, approvedAt: approvedAt || undefined, lastFour: lastFour || undefined } }),
    [qk.wallet, qk.dashboard],
  );
  const lastFourError = validateLastFour(lastFour);

  return (
    <Panel
      title="Add a card"
      action={
        <Button variant="ghost" onClick={onDone}>
          Close
        </Button>
      }
      data-testid="add-card-panel"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Search cards" htmlFor="card-search">
          <Input id="card-search" placeholder="e.g. Sapphire, Chase, credit union" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        <Field label="Approval date (optional)" htmlFor="approved-at" hint="Used for bonus deadlines, renewals and 5/24.">
          <Input id="approved-at" type="date" value={approvedAt} onChange={(e) => setApprovedAt(e.target.value)} />
        </Field>
        <Field label="Last 4 digits (optional)" htmlFor="last-four" error={lastFourError ?? undefined}>
          <Input id="last-four" inputMode="numeric" maxLength={4} value={lastFour} onChange={(e) => setLastFour(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3">
        <Tabs<'' | 'PERSONAL' | 'BUSINESS'>
          label="Card type"
          value={cardType}
          onChange={setCardType}
          options={[
            ['', 'All cards'],
            ['PERSONAL', 'Personal'],
            ['BUSINESS', 'Business'],
          ]}
        />
      </div>
      <ErrorText error={add.error} />
      {search.isLoading ? (
        <Spinner />
      ) : (
        <ul className="mt-4 divide-y divide-slate-100" data-testid="card-search-results">
          {search.data?.items.map((c) => {
            const badge = verificationBadge(c);
            return (
              <li key={c.id} className="flex items-center gap-3 py-2">
                <CardArt name={c.name} color={c.color} issuer={c.issuer.name} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.name}</p>
                  {badge && (
                    <span title={badge.title} data-testid="verification-badge">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </span>
                  )}
                  <p className="text-xs text-slate-500">
                    {c.type === 'BUSINESS' ? 'Business · ' : ''}
                    {c.issuer.name} · {c.network} · {c.annualFeeCents ? `${money(c.annualFeeCents)}/yr` : 'No annual fee'}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  disabled={!!lastFourError}
                  loading={add.isPending && add.variables?.cardId === c.id}
                  onClick={() => add.mutate({ cardId: c.id }, { onSuccess: onDone })}
                  aria-label={`Add ${c.name}`}
                >
                  Add
                </Button>
              </li>
            );
          })}
          {search.data?.items.length === 0 && <li className="py-4 text-sm text-slate-500">No cards match “{q}”.</li>}
        </ul>
      )}
    </Panel>
  );
}

function WalletCardRow({ wc }: { wc: WalletCard }) {
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState(wc.nickname ?? '');
  const [status, setStatus] = useState<CardStatus>(wc.status);
  const categories = useCategories();
  const update = useApiMutation<Record<string, unknown>>((body) => ({ path: `/wallet/cards/${wc.id}`, method: 'PATCH', body }), [qk.wallet, qk.dashboard]);
  const remove = useApiMutation<void>(() => ({ path: `/wallet/cards/${wc.id}`, method: 'DELETE' }), [qk.wallet, qk.dashboard]);
  const rotating = wc.card.rewards.filter((r) => r.isRotating);

  return (
    <li className="rounded-2xl border border-slate-200 bg-white p-4" data-testid="wallet-card">
      <div className="flex flex-wrap items-center gap-3">
        <CardArt name={wc.card.name} color={wc.card.color} issuer={wc.card.issuer.name} />
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">
            {wc.nickname || wc.card.name} {wc.lastFour && <span className="text-xs text-slate-400">•••• {wc.lastFour}</span>}
          </p>
          <p className="text-xs text-slate-500">
            {wc.card.issuer.name} · {wc.card.currency.name} @ {wc.card.currency.centsPerPoint}¢ · approved {shortDate(wc.approvedAt)}
          </p>
        </div>
        <Badge tone={STATUS_TONE[wc.status]}>{wc.status.toLowerCase()}</Badge>
        <Button variant="ghost" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          {editing ? 'Done' : 'Edit'}
        </Button>
      </div>
      <ul className="mt-3 flex flex-wrap gap-2">
        {rewardBadges(wc.card.rewards).map((b) => {
          const r = wc.card.rewards.find((x) => x.id === b.id)!;
          return (
            <li key={b.id} data-testid="reward-badge" data-conditional={b.conditional || undefined}>
              <Badge tone={r.isRotating ? (wc.selectedCategoryIds.includes(r.categoryId ?? '') ? 'green' : 'slate') : b.conditional ? 'slate' : 'brand'}>
                {b.text}
                {b.conditional ? ' (portal or linked account)' : r.isRotating ? ' (activate)' : ''}
              </Badge>
            </li>
          );
        })}
      </ul>
      {editing && (
        <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 sm:grid-cols-3">
          <Field label="Nickname" htmlFor={`nick-${wc.id}`}>
            <Input id={`nick-${wc.id}`} value={nickname} maxLength={60} onChange={(e) => setNickname(e.target.value)} />
          </Field>
          <Field label="Status" htmlFor={`status-${wc.id}`}>
            <Select id={`status-${wc.id}`} value={status} onChange={(e) => setStatus(e.target.value as CardStatus)}>
              {(['APPROVED', 'APPLIED', 'DENIED', 'CLOSED'] as const).map((s) => (
                <option key={s} value={s}>
                  {s.toLowerCase()}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end gap-2">
            <Button loading={update.isPending} onClick={() => update.mutate({ nickname: nickname || null, status }, { onSuccess: () => setEditing(false) })}>
              Save
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => {
                if (window.confirm(`Remove ${wc.card.name} and its tracked offers?`)) remove.mutate(undefined);
              }}
            >
              Remove
            </Button>
          </div>
          {rotating.length > 0 && (
            <fieldset className="sm:col-span-3">
              <legend className="text-sm font-medium text-slate-700">Activated Rotating Categories</legend>
              <div className="mt-2 flex flex-wrap gap-3">
                {rotating.map((r) => {
                  const cat = categories.data?.find((c) => c.id === r.categoryId);
                  const checked = wc.selectedCategoryIds.includes(r.categoryId ?? '');
                  return (
                    <label key={r.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          update.mutate({
                            selectedCategoryIds: checked ? wc.selectedCategoryIds.filter((id) => id !== r.categoryId) : [...wc.selectedCategoryIds, r.categoryId],
                          })
                        }
                      />
                      {cat?.name ?? r.description}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <ErrorText error={update.error || remove.error} />
        </div>
      )}
    </li>
  );
}

function MatchCustomCards() {
  const m = useCustomMatches();
  const relink = useApiMutation<string[]>((ids) => ({ path: '/wallet/custom-matches', method: 'POST', body: { walletCardIds: ids } }), [qk.wallet, qk.customMatches, qk.dashboard]);
  if (!m.data || m.data.matches.length === 0) return null;
  const ids = m.data.matches.map((x) => x.walletCardId);
  return (
    <Panel title="Match imported cards to the catalog" data-testid="match-custom">
      <p className="text-sm text-slate-600">
        {ids.length} card{ids.length === 1 ? ' was' : 's were'} imported without earning rates. Matching them to the catalog shows their categories and uses them in Best Card by Category. Your last digits, dates and notes stay.
      </p>
      <ul className="mt-3 space-y-1 text-sm">
        {m.data.matches.map((x) => (
          <li key={x.walletCardId}>
            {x.customName}
            {x.lastFour ? ` ••••${x.lastFour}` : ''} → <strong>{x.catalogName}</strong>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-3">
        <Button onClick={() => relink.mutate(ids)} disabled={relink.isPending}>
          {relink.isPending ? 'Matching…' : `Match ${ids.length} card${ids.length === 1 ? '' : 's'}`}
        </Button>
        {m.data.unmatched > 0 && <span className="text-xs text-slate-500">{m.data.unmatched} more have no catalog match (older or discontinued cards).</span>}
      </div>
      <ErrorText error={relink.error} />
    </Panel>
  );
}

export default function WalletPage() {
  const wallet = useWallet();
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Wallet"
        subtitle="The cards you hold. We only store the last 4 digits, never full card numbers."
        action={!adding && <Button onClick={() => setAdding(true)}>+ Add card</Button>}
      />
      {adding && <AddCard onDone={() => setAdding(false)} />}
      <MatchCustomCards />
      {wallet.isLoading && <Spinner />}
      <ErrorText error={wallet.error} />
      {wallet.data && wallet.data.length === 0 && !adding && <EmptyState title="Your wallet is empty">Add a card to see your best card everywhere.</EmptyState>}
      <ul className="space-y-3" data-testid="wallet-list">
        {wallet.data?.map((wc) => (
          <WalletCardRow key={wc.id} wc={wc} />
        ))}
      </ul>
    </div>
  );
}
