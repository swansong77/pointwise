'use client';

import { WalletCardArt } from '@/components/card-bits';
import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, EmptyState, ErrorText, Field, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery, useWallet } from '@/lib/queries';
import {
  ACTIVATION_LABEL,
  CAUSE_LABEL,
  confidenceLabel,
  EVENT_LABEL,
  FACTOR_LABEL,
  ImportResult,
  InventoryRow,
  MissedItem,
  OfferEventRow,
  Opportunity,
  QueueItem,
  scoreTone,
  SOURCE_LABEL,
} from '@/lib/offer-intel';

type Tab = 'opportunities' | 'missed' | 'activate' | 'inventory' | 'audit';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'opportunities', label: 'Opportunities' },
  { id: 'missed', label: 'Missed offers' },
  { id: 'activate', label: 'Activation checklist' },
  { id: 'inventory', label: 'Inventory & import' },
  { id: 'audit', label: 'Audit trail' },
];

function Opportunities() {
  const q = useAuthedQuery<{ items: Opportunity[] }>(['offer-intel', 'opportunities'], '/offers/intel/opportunities');
  const [open, setOpen] = useState<string | null>(null);
  if (q.isLoading) return <Spinner />;
  const items = q.data?.items ?? [];
  if (!items.length) return <EmptyState title="No open offers">Import your offers on the Inventory tab to see them ranked.</EmptyState>;
  return (
    <ul className="divide-y divide-slate-100 text-sm" data-testid="opportunities">
      {items.map((o) => (
        <li key={o.offerId} className="py-3" data-testid="opportunity">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={scoreTone(o.score)}>Score {o.score}/100</Badge>
            <BrandLogo brand={{ name: o.merchant }} name={o.merchant ?? o.title} size="md" decorative />
            <span className="font-medium">{o.merchant ?? o.title}</span>
            <span className="text-slate-600">about {money(o.expectedValueCents)} expected</span>
            {o.daysLeft != null && <Badge tone={o.daysLeft <= 7 ? 'red' : 'slate'}>{o.daysLeft} day(s) left</Badge>}
            <Badge tone={o.activated ? 'green' : 'amber'}>{o.activated ? 'Activated' : 'Not activated'}</Badge>
            <Badge tone="slate">Confidence {confidenceLabel(o.confidence)} ({o.confidence}%)</Badge>
            <button type="button" className="ml-auto text-xs text-brand-700 hover:underline" onClick={() => setOpen(open === o.offerId ? null : o.offerId)} aria-expanded={open === o.offerId}>
              {open === o.offerId ? 'Hide why' : 'Why this score?'}
            </button>
          </div>
          {open === o.offerId && (
            <div className="mt-2 rounded-lg bg-slate-50 p-3" data-testid="score-factors">
              <p className="mb-2 text-xs text-slate-600">
                Source: {SOURCE_LABEL[o.source]} ({o.verification.toLowerCase()}). The score is the sum of these factors; confidence can never exceed what the source supports.
              </p>
              <table className="w-full text-xs">
                <tbody>
                  {o.factors.map((f) => (
                    <tr key={f.factor} className="border-t border-slate-200">
                      <td className="py-1 pr-2 font-medium">{FACTOR_LABEL[f.factor] ?? f.factor}</td>
                      <td className="py-1 pr-2 text-slate-600">{f.reason}</td>
                      <td className="py-1 text-right">
                        {f.points}/{f.weight}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

function Missed() {
  const q = useAuthedQuery<{ totalLostCents: number; items: MissedItem[] }>(['offer-intel', 'missed'], '/offers/intel/missed');
  if (q.isLoading) return <Spinner />;
  const items = q.data?.items ?? [];
  if (!items.length) return <EmptyState title="Nothing missed">No purchases at merchants with offers were found without the offer. This needs imported statements and offers.</EmptyState>;
  return (
    <div data-testid="missed">
      <p className="mb-3 text-sm text-slate-700">
        About <strong>{money(q.data!.totalLostCents)}</strong> of offer value was missed in the last 12 months (not counting offers you can still earn).
      </p>
      <ul className="divide-y divide-slate-100 text-sm">
        {items.map((m) => (
          <li key={`${m.offerId}-${m.cause}`} className="py-3" data-testid="missed-item">
            <div className="flex flex-wrap items-center gap-2">
              <BrandLogo brand={{ name: m.offer.merchant }} name={m.offer.merchant ?? m.offer.title} size="md" decorative />
              <span className="font-medium">{m.offer.merchant ?? m.offer.title}</span>
              <Badge tone={CAUSE_LABEL[m.cause].tone}>{CAUSE_LABEL[m.cause].label}</Badge>
              <span className="text-slate-600">{money(m.lostCents)} {m.cause === 'BELOW_MIN_SPEND' ? 'still available' : 'lost'}</span>
              <Badge tone="slate">Confidence {m.confidence}%</Badge>
            </div>
            <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
              {m.evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
              <li>Based on {m.transactionIds.length} transaction(s).</li>
            </ul>
            <p className="mt-1 text-sm">→ {m.action}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Activation() {
  const q = useAuthedQuery<QueueItem[]>(['offer-intel', 'queue'], '/offers/intel/activation-queue');
  const mark = useApiMutation<{ id: string; status: 'ACTIVATED' | 'FAILED' }>(
    (v) => ({ path: `/offers/intel/activation/${v.id}`, method: 'POST', body: { status: v.status } }),
    [['offer-intel']],
  );
  if (q.isLoading) return <Spinner />;
  const items = q.data ?? [];
  if (!items.length) return <EmptyState title="Nothing to activate">Every offer you track is activated or needs no activation.</EmptyState>;
  const byCard = new Map<string, QueueItem[]>();
  for (const i of items) byCard.set(i.card, [...(byCard.get(i.card) ?? []), i]);
  return (
    <div data-testid="activation">
      <p className="mb-3 text-sm text-slate-600">
        Pointwise never signs in to your bank. Open your card issuer's offers page yourself, add the offer, then mark it here. We confirm it later when the statement credit appears.
      </p>
      <ErrorText error={mark.error} />
      {[...byCard.entries()].map(([card, rows]) => (
        <div key={card} className="mb-4">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><WalletCardArt walletCardId={rows[0].walletCardId} name={card} size="sm" />{card}</h3>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
            {rows.map((r) => (
              <li key={r.userOfferId} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="activation-item">
                <BrandLogo brand={{ name: r.merchant }} name={r.merchant ?? r.title} size="md" decorative />
                <span className="font-medium">{r.merchant ?? r.title}</span>
                <span className="text-slate-600">{money(r.valueCents)}</span>
                {r.daysLeft != null && <Badge tone={r.daysLeft <= 7 ? 'red' : 'slate'}>{r.daysLeft} day(s) left</Badge>}
                <Badge tone={ACTIVATION_LABEL[r.activationStatus].tone}>{ACTIVATION_LABEL[r.activationStatus].label}</Badge>
                <span className="ml-auto flex items-center gap-2">
                  {r.offersUrl && (
                    <a href={r.offersUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-brand-700 hover:underline">
                      Open {r.issuer ?? 'issuer'} offers ↗
                    </a>
                  )}
                  <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => mark.mutate({ id: r.userOfferId, status: 'ACTIVATED' })} loading={mark.isPending} data-testid="mark-activated">
                    Mark activated
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Inventory() {
  const inv = useAuthedQuery<InventoryRow[]>(['offer-intel', 'inventory'], '/offers/intel/inventory');
  const wallet = useWallet();
  const [cardId, setCardId] = useState('');
  const [text, setText] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const imp = useApiMutation<{ walletCardId: string; text: string }, ImportResult>((b) => ({ path: '/offers/intel/import', method: 'POST', body: b }), [['offer-intel']]);
  const cards = wallet.data ?? [];
  const chosen = cardId || cards[0]?.id || '';
  return (
    <div className="space-y-5">
      <Panel title="Import offers" data-testid="offer-import">
        <p className="mb-3 text-sm text-slate-600">
          Paste one offer per line, for example <code>Hilton: Spend $500, get $100 back, expires 12/31/2026</code>. Offers you enter yourself are marked as the least reliable source until a statement credit confirms them.
        </p>
        <div className="grid gap-3 sm:grid-cols-[16rem_1fr]">
          <Field label="Card" htmlFor="oi-card">
            <Select id="oi-card" value={chosen} onChange={(e) => setCardId(e.target.value)}>
              {cards.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nickname || c.card.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Offers" htmlFor="oi-text">
            <textarea id="oi-text" className="h-28 w-full rounded-lg border border-slate-300 p-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} placeholder={'Hilton: Spend $500, get $100 back, expires 12/31/2026\nUber Eats - 10% back up to $20 - ends Jan 15, 2027'} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button
            onClick={() => imp.mutate({ walletCardId: chosen, text }, { onSuccess: (r) => setResult(r) })}
            disabled={!chosen || text.trim().length < 6}
            loading={imp.isPending}
            data-testid="import-offers"
          >
            Import offers
          </Button>
          <ErrorText error={imp.error} />
        </div>
        {result && (
          <div className="mt-3 text-sm" role="status" data-testid="import-result">
            <p>
              Added <strong>{result.created.length}</strong>, skipped {result.skipped.length}, could not read {result.rejected.length}.
            </p>
            {result.rejected.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
                {result.rejected.map((r) => (
                  <li key={r.line}>
                    Line {r.line}: “{r.text}” — {r.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Panel>
      {inv.isLoading && <Spinner />}
      {inv.data && inv.data.length === 0 && <EmptyState title="No offers yet">Import offers above to start tracking them.</EmptyState>}
      {inv.data && inv.data.length > 0 && (
        <div className="overflow-x-auto" data-testid="inventory">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-600">
              <tr>
                <th className="py-1 pr-3">Merchant</th>
                <th className="py-1 pr-3">Card</th>
                <th className="py-1 pr-3">Value</th>
                <th className="py-1 pr-3">Ends</th>
                <th className="py-1 pr-3">Source</th>
                <th className="py-1 pr-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {inv.data.map((r) => (
                <tr key={r.id} className="border-t border-slate-100" data-testid="inventory-row">
                  <td className="py-2 pr-3 font-medium">
                    <span className="flex items-center gap-2"><BrandLogo brand={{ name: r.merchant?.name }} name={r.merchant?.name ?? r.title} size="md" decorative />{r.merchant?.name ?? r.title}</span>
                    {r.merchant?.parentCompany && <span className="block text-xs font-normal text-slate-600">{r.merchant.parentCompany}</span>}
                  </td>
                  <td className="py-2 pr-3">{r.card}</td>
                  <td className="py-2 pr-3">{r.percent != null ? `${r.percent}%` : r.points ? `${r.points.toLocaleString()} pts` : money(r.valueCents)}{r.minSpendCents ? ` over ${money(r.minSpendCents)}` : ''}</td>
                  <td className="py-2 pr-3">{r.endsAt ? shortDate(r.endsAt) : '—'}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={r.reliability >= 75 ? 'green' : r.reliability >= 50 ? 'amber' : 'slate'}>
                      {SOURCE_LABEL[r.source]} · {r.reliability}
                    </Badge>
                    <span className="block text-xs text-slate-600">
                      {r.verification.toLowerCase()} · confidence up to {r.confidenceCap}%
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <Badge tone={ACTIVATION_LABEL[r.activationStatus].tone}>{ACTIVATION_LABEL[r.activationStatus].label}</Badge>
                    {r.activationVerifiedBy === 'STATEMENT' && <span className="block text-xs text-slate-600">confirmed by statement credit</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Audit() {
  const q = useAuthedQuery<OfferEventRow[]>(['offer-intel', 'events'], '/offers/intel/events');
  if (q.isLoading) return <Spinner />;
  const rows = q.data ?? [];
  if (!rows.length) return <EmptyState title="No events yet">Imports, activations, recommendations and missed offers are recorded here with their evidence.</EmptyState>;
  return (
    <ul className="divide-y divide-slate-100 text-sm" data-testid="audit-trail">
      {rows.map((e) => (
        <li key={e.id} className="py-2" data-testid="audit-event">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{EVENT_LABEL[e.type] ?? e.type}</span>
            <Badge tone="slate">{e.actor.toLowerCase()}</Badge>
            <span className="text-xs text-slate-600">{shortDate(e.createdAt)}</span>
          </div>
          <details className="text-xs text-slate-600">
            <summary className="cursor-pointer">Evidence</summary>
            <pre className="mt-1 overflow-x-auto rounded bg-slate-50 p-2">{JSON.stringify(e.detail, null, 2)}</pre>
          </details>
        </li>
      ))}
    </ul>
  );
}

export default function OfferIntelPage() {
  const [tab, setTab] = useState<Tab>('opportunities');
  return (
    <div className="space-y-6" data-testid="offer-intel">
      <PageHeader
        title="Offer intelligence"
        subtitle="Every offer on your cards, ranked by what it is worth to you, what you missed and why, and what to activate."
        action={
          <Link href="/offers/plan" className="text-sm text-brand-700 hover:underline">
            Plan a purchase →
          </Link>
        }
      />
      <div role="tablist" aria-label="Offer intelligence" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            data-testid={`tab-${t.id}`}
            className={`rounded-t-lg px-3 py-2 text-sm ${tab === t.id ? 'border-b-2 border-brand-600 font-semibold text-brand-800' : 'text-slate-700 hover:bg-slate-100'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <Panel>
        {tab === 'opportunities' && <Opportunities />}
        {tab === 'missed' && <Missed />}
        {tab === 'activate' && <Activation />}
        {tab === 'inventory' && <Inventory />}
        {tab === 'audit' && <Audit />}
      </Panel>
    </div>
  );
}
