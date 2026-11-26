'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel } from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';
import { confidenceLabel, PlanResponse, PlanView, PlannedPurchase } from '@/lib/offer-intel';

function PlanCard({ plan, rank }: { plan: PlanView; rank: number }) {
  return (
    <li className="rounded-lg border border-slate-200 p-3" data-testid="plan">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={rank === 0 ? 'green' : 'slate'}>{rank === 0 ? 'Best' : `#${rank + 1}`}</Badge>
        {plan.kind === 'SPLIT' && <Badge tone="brand">Split spend</Badge>}
        <span className="font-medium">
          {plan.legs.map((l) => `${l.cardName}${l.member ? ` (${l.member})` : ''}${plan.legs.length > 1 ? ` ${money(l.amountCents)}` : ''}`).join(' + ')}
        </span>
        <span className="ml-auto text-sm">
          <strong>{money(plan.expectedCents)}</strong> expected <span className="text-slate-600">(up to {money(plan.maxCents)})</span>
        </span>
        <Badge tone="slate">
          Confidence {confidenceLabel(plan.confidence)} ({plan.confidence}%)
        </Badge>
      </div>
      {plan.actions.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm" data-testid="plan-actions">
          {plan.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
        {plan.justification.map((j) => (
          <li key={j}>{j}</li>
        ))}
      </ul>
      {plan.warnings.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-900" data-testid="plan-warnings">
          {plan.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <details className="mt-2 text-xs text-slate-600">
        <summary className="cursor-pointer">Evidence ({plan.evidence.length})</summary>
        <ul className="mt-1 list-disc pl-5" data-testid="plan-evidence">
          {plan.evidence.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
        <p className="mt-1">Stacking rules {plan.stack.version}{plan.stack.allRulesVerified ? '' : ' are community-reported and not confirmed by the issuers'}.</p>
      </details>
    </li>
  );
}

export default function PlanPurchasePage() {
  const [merchant, setMerchant] = useState('');
  const [dollars, setDollars] = useState('');
  const [when, setWhen] = useState('');
  const [res, setRes] = useState<PlanResponse | null>(null);
  const planned = useAuthedQuery<PlannedPurchase[]>(['offer-intel', 'planned'], '/offers/intel/planned');
  const plan = useApiMutation<{ save: boolean }, PlanResponse>(
    (v) => ({
      path: '/offers/intel/plan',
      method: 'POST',
      body: { merchantText: merchant.trim(), amountCents: Math.round(Number(dollars) * 100), save: v.save, ...(when ? { plannedFor: new Date(when).toISOString() } : {}) },
    }),
    [['offer-intel']],
  );
  const remove = useApiMutation<string>((id) => ({ path: `/offers/intel/planned/${id}`, method: 'DELETE' }), [['offer-intel', 'planned']]);
  const valid = merchant.trim().length >= 2 && Number(dollars) > 0;
  return (
    <div className="space-y-6" data-testid="plan-purchase">
      <PageHeader
        title="Plan a purchase"
        subtitle="About to spend? See which card in your household returns the most, what to activate first, and why."
        action={
          <Link href="/offers/intel" className="text-sm text-brand-700 hover:underline">
            Offer intelligence →
          </Link>
        }
      />
      <Panel>
        <form
          className="grid gap-3 sm:grid-cols-[1fr_10rem_12rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            plan.mutate({ save: false }, { onSuccess: (r) => setRes(r) });
          }}
        >
          <Field label="Merchant" htmlFor="pp-merchant">
            <Input id="pp-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Marriott" required />
          </Field>
          <Field label="Amount ($)" htmlFor="pp-amount">
            <Input id="pp-amount" type="number" min="0.01" step="0.01" value={dollars} onChange={(e) => setDollars(e.target.value)} placeholder="1200" required />
          </Field>
          <Field label="When (optional)" htmlFor="pp-when">
            <Input id="pp-when" type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Button type="submit" disabled={!valid} loading={plan.isPending} data-testid="plan-go">
            Find the best way to pay
          </Button>
        </form>
        <ErrorText error={plan.error} />
      </Panel>

      {res && (
        <Panel title={`${res.merchant.name} · ${money(res.amountCents)}`} action={res.plans.length > 0 && <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => plan.mutate({ save: true }, { onSuccess: (r) => setRes(r) })} data-testid="plan-save">Save as planned purchase</Button>}>
          {res.merchantConfidence < 0.8 && <p className="mb-2 rounded bg-amber-50 p-2 text-sm text-amber-900">We matched “{merchant}” to {res.merchant.name} with low confidence — check it is the right merchant.</p>}
          {res.plans.length === 0 ? (
            <EmptyState title="No plan available">Add a card to your wallet, then try again.</EmptyState>
          ) : (
            <ol className="space-y-3" data-testid="plans">
              {res.plans.map((p, i) => (
                <PlanCard key={`${p.kind}-${p.legs.map((l) => l.walletCardId).join('-')}`} plan={p} rank={i} />
              ))}
            </ol>
          )}
          <p className="mt-3 text-xs text-slate-600">General information, not financial advice. Every figure above comes from your cards’ earn rules and the offers you track, and is recorded in your audit trail.</p>
        </Panel>
      )}

      <Panel title="Planned purchases">
        {(planned.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-600">None saved.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm" data-testid="planned-list">
            {planned.data!.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <span className="font-medium">{p.merchantText}</span>
                <span>{money(p.amountCents)}</span>
                {p.plannedFor && <span className="text-slate-600">on {shortDate(p.plannedFor)}</span>}
                <Button variant="ghost" className="ml-auto px-2 py-1 text-xs" onClick={() => remove.mutate(p.id)}>
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
