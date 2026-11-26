'use client';

import { useState } from 'react';
import { StatTiles, Tabs } from '@/components/charts';
import { CardSwatch } from '@/components/card-bits';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, ProgressBar, Select, Spinner } from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import { parseAmount, periodLabel, STATUS_LABEL, statusTone } from '@/lib/portfolio';
import type { BenefitPeriod, BenefitSummary, BenefitView } from '@/lib/portfolio-types';
import type { WalletCard } from '@/lib/types';
import { useApiMutation, useAuthedQuery, useWallet } from '@/lib/queries';
import { parseList, usageBadge } from '@/lib/spend';

type Bucket = 'available' | 'expiring' | 'completed' | 'missed';
const KEYS = [['benefits'], ['portfolio'], ['spending']] as const;

export default function BenefitsPage() {
  const [bucket, setBucket] = useState<Bucket>('available');
  const q = useAuthedQuery<BenefitSummary>(['benefits', 'summary'], '/benefits/summary');
  if (q.isLoading) return <Spinner label="Loading benefits" />;
  if (q.error) return <ErrorText error={q.error} />;
  const s = q.data;
  if (!s) return null;
  const list = s[bucket];

  return (
    <div className="space-y-6">
      <PageHeader title="Benefits" subtitle="Credits, certificates and perks on your cards — what's left, what's expiring, and what you've used." />
      <StatTiles
        testId="benefit-totals"
        items={[
          ['Annual value', money(s.totals.annualValueCents), 'face value of all credits'],
          ['Used this year', money(s.totals.usedThisYearCents)],
          ['Still available', money(s.totals.remainingThisYearCents), `${money(s.totals.currentRemainingCents)} in current periods`],
          ['Missed', money(s.totals.missedThisYearCents), 'unused credits that already reset'],
        ]}
      />
      <Panel
        title="Your benefits"
        data-testid="benefit-list"
        action={
          <Tabs<Bucket>
            label="Benefit group"
            value={bucket}
            onChange={setBucket}
            options={[
              ['available', `Available (${s.available.length})`],
              ['expiring', `Expiring (${s.expiring.length})`],
              ['completed', `Completed (${s.completed.length})`],
              ['missed', `Missed (${s.missed.length})`],
            ]}
          />
        }
      >
        {list.length === 0 ? (
          <EmptyState title={bucket === 'expiring' ? 'Nothing expiring in the next 30 days' : 'Nothing here'} />
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map((b) => (
              <BenefitRow key={b.id} b={b} showMissed={bucket === 'missed'} />
            ))}
          </ul>
        )}
      </Panel>
      <AddBenefit />
    </div>
  );
}

function BenefitRow({ b, showMissed }: { b: BenefitView; showMissed: boolean }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const cents = parseAmount(amount);
  const log = useApiMutation<void>(() => ({ path: `/benefits/${b.id}/usage`, method: 'POST', body: { amountCents: cents, note: note || undefined } }), KEYS);
  const p = b.currentPeriod;
  const hasValue = b.amountPerPeriodCents > 0;
  return (
    <li className="py-4" data-testid="benefit-row">
      <div className="flex flex-wrap items-start gap-3">
        <CardSwatch color={b.walletCard.color} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-slate-900">{b.name}</p>
            <Badge tone={statusTone(p.status)}>{STATUS_LABEL[p.status]}</Badge>
            {b.category && <span className="text-xs text-slate-500">{b.category.name}</span>}
          </div>
          <p className="text-xs text-slate-500">
            {b.walletCard.name} · {periodLabel(b.period, b.periodMonths, b.basis)}
            {hasValue && ` · ${money(b.amountPerPeriodCents)} per period`}
            {b.actionNeeded && ` · ${b.actionNeeded}`}
          </p>
          {hasValue && (
            <div className="mt-2 max-w-md">
              <ProgressBar value={p.percentUsed} tone={p.status === 'EXPIRING_SOON' ? 'amber' : 'brand'} label={`${b.name} used`} />
              <p className="mt-1 text-xs text-slate-500">
                {money(p.usedCents)} of {money(p.allocatedCents)} used · {money(p.remainingCents)} left · use by {shortDate(p.lastDay)} ({p.daysLeft} day
                {p.daysLeft === 1 ? '' : 's'})
              </p>
            </div>
          )}
          {showMissed && <p className="mt-1 text-sm text-red-700">{money(b.year.missedCents)} missed this year</p>}
          {hasValue && b.kind === 'CREDIT' && <AutoTracking b={b} />}
        </div>
        {hasValue && p.remainingCents > 0 && (
          <Button variant="secondary" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            Log use
          </Button>
        )}
      </div>
      {open && (
        <form
          className="mt-3 flex flex-wrap items-end gap-3 pl-11"
          onSubmit={(e) => {
            e.preventDefault();
            if (cents) log.mutate(undefined, { onSuccess: () => (setOpen(false), setAmount(''), setNote('')) });
          }}
        >
          <Field label="Amount used ($)" htmlFor={`amt-${b.id}`} error={amount && !cents ? 'Enter an amount like 12.50' : undefined}>
            <Input id={`amt-${b.id}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="w-32" />
          </Field>
          <Field label="Note (optional)" htmlFor={`note-${b.id}`}>
            <Input id={`note-${b.id}`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} className="w-56" />
          </Field>
          <Button type="submit" disabled={!cents} loading={log.isPending}>
            Save
          </Button>
          <ErrorText error={log.error} />
        </form>
      )}
    </li>
  );
}

/** Automatic tracking from transactions: rules, recent matches (with "not this benefit") and an editor. */
function AutoTracking({ b }: { b: BenefitView }) {
  const r = b.autoRules;
  const [editing, setEditing] = useState(false);
  const [keywords, setKeywords] = useState(r?.keywords.join(', ') ?? '');
  const [categories, setCategories] = useState(r?.categories.join(', ') ?? '');
  const [credits, setCredits] = useState(r?.creditKeywords.join(', ') ?? '');
  const save = useApiMutation<Record<string, unknown>>((body) => ({ path: `/benefits/${b.id}/auto-tracking`, method: 'PUT', body }), KEYS);
  const dismiss = useApiMutation<string>((usageId) => ({ path: `/benefits/usages/${usageId}/dismiss`, method: 'POST' }), KEYS);
  const auto = b.usages.filter((u) => u.source && u.source !== 'MANUAL').slice(0, 3);
  const rulesText = r ? [...r.keywords, ...r.categories.map((c) => `${c} purchases`)].join(', ') || 'statement credits only' : '';
  return (
    <div className="mt-2 space-y-1 text-xs text-slate-600" data-testid="auto-tracking">
      <p>
        {b.autoTrack === false ? (
          <>Auto-tracking off</>
        ) : (
          <>
            Auto-tracked from transactions: <span className="font-medium text-slate-800">{rulesText}</span>
            {r?.suggested && ' (suggested)'}
          </>
        )}{' '}
        <button type="button" className="text-brand-700 underline" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
          {editing ? 'Close' : 'Edit rules'}
        </button>
      </p>
      {auto.length > 0 && (
        <ul className="space-y-0.5" aria-label={`Automatic matches for ${b.name}`}>
          {auto.map((u) => {
            const badge = usageBadge(u);
            return (
              <li key={u.id} className="flex flex-wrap items-center gap-2">
                {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                <span>
                  {money(u.amountCents)} · {shortDate(u.usedOn)} · {u.transaction?.description ?? u.note}
                </span>
                <button
                  type="button"
                  className="text-slate-500 underline"
                  onClick={() => dismiss.mutate(u.id)}
                  aria-label={`Not ${b.name}: ${u.transaction?.description ?? u.note ?? ''}`}
                >
                  Not this benefit
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {editing && (
        <form
          className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(
              { autoTrack: true, rules: { keywords: parseList(keywords), categories: parseList(categories), creditKeywords: parseList(credits) } },
              { onSuccess: () => setEditing(false) },
            );
          }}
        >
          <Field label="Merchant words" htmlFor={`kw-${b.id}`} hint="e.g. uber, lyft">
            <Input id={`kw-${b.id}`} value={keywords} onChange={(e) => setKeywords(e.target.value)} />
          </Field>
          <Field label="Categories" htmlFor={`cat-${b.id}`} hint="used when no merchant word is set, e.g. dining">
            <Input id={`cat-${b.id}`} value={categories} onChange={(e) => setCategories(e.target.value)} />
          </Field>
          <Field label="Statement credit words" htmlFor={`cr-${b.id}`} hint="words in the issuer's credit line">
            <Input id={`cr-${b.id}`} value={credits} onChange={(e) => setCredits(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2 sm:col-span-3">
            <Button type="submit" loading={save.isPending}>
              Save rules
            </Button>
            <Button type="button" variant="secondary" onClick={() => save.mutate({ autoTrack: true, rules: null }, { onSuccess: () => setEditing(false) })}>
              Use suggested rules
            </Button>
            <Button type="button" variant="ghost" onClick={() => save.mutate({ autoTrack: b.autoTrack === false }, { onSuccess: () => setEditing(false) })}>
              {b.autoTrack === false ? 'Turn auto-tracking on' : 'Turn auto-tracking off'}
            </Button>
          </div>
        </form>
      )}
      <ErrorText error={save.error ?? dismiss.error} />
    </div>
  );
}

function AddBenefit() {
  const wallet = useWallet();
  const [walletCardId, setWalletCardId] = useState('');
  const [name, setName] = useState('');
  const [period, setPeriod] = useState<BenefitPeriod>('ANNUAL');
  const [amount, setAmount] = useState('');
  const cents = parseAmount(amount);
  const add = useApiMutation<void>(
    () => ({ path: '/benefits', method: 'POST', body: { walletCardId, name, period, amountPerPeriodCents: cents, ...(period === 'MULTI_YEAR' && { periodMonths: 48 }) } }),
    KEYS,
  );
  const cards = (wallet.data ?? []).filter((w: WalletCard) => w.status !== 'CLOSED');
  return (
    <Panel title="Track another benefit" data-testid="add-benefit">
      <form
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, { onSuccess: () => (setName(''), setAmount('')) });
        }}
      >
        <Field label="Card" htmlFor="ab-card">
          <Select id="ab-card" value={walletCardId} onChange={(e) => setWalletCardId(e.target.value)} required>
            <option value="">Choose…</option>
            {cards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.nickname || w.card.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Benefit" htmlFor="ab-name">
          <Input id="ab-name" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dining credit" required />
        </Field>
        <Field label="Resets" htmlFor="ab-period">
          <Select id="ab-period" value={period} onChange={(e) => setPeriod(e.target.value as BenefitPeriod)}>
            <option value="MONTHLY">Monthly</option>
            <option value="QUARTERLY">Quarterly</option>
            <option value="SEMIANNUAL">Twice a year</option>
            <option value="ANNUAL">Yearly</option>
            <option value="MULTI_YEAR">Every 4 years</option>
          </Select>
        </Field>
        <Field label="Amount per period ($)" htmlFor="ab-amount" error={amount && !cents ? 'Enter an amount' : undefined}>
          <Input id="ab-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Button type="submit" disabled={!walletCardId || !name || !cents} loading={add.isPending}>
          Add benefit
        </Button>
      </form>
      <ErrorText error={add.error} />
    </Panel>
  );
}
