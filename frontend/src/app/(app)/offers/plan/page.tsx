'use client';

import { WalletCardArt } from '@/components/card-bits';
import { BrandLogo } from '@/components/brand-logo';
import { StatTiles } from '@/components/charts';
import Link from 'next/link';
import { useState } from 'react';
import { CashbackCard } from '@/components/cashback-card';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, Select } from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import type { Member } from '@/lib/portfolio-types';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';
import { confidenceLabel, PlanResponse, PlanStrategy, PlanView, PlannedPurchase } from '@/lib/offer-intel';

const STRATEGY_TONE: Record<PlanStrategy['key'], 'green' | 'brand' | 'slate' | 'amber'> = { BEST: 'green', ALTERNATIVE: 'brand', CONSERVATIVE: 'slate', MAX_REWARDS: 'amber' };

function Breakdown({ plan, amountCents }: { plan: PlanView; amountCents: number }) {
  const b = plan.breakdown;
  if (!b) return null;
  const rows: Array<[string, string, string?]> = [
    ['Cash back', money(b.cashbackCents)],
    ['Points', b.estimatedPoints ? b.estimatedPoints.toLocaleString('en-US') : '—'],
    ['Offers', money(b.offersCents)],
    ['Credits & certificates', money(b.creditsCents + b.certificateCents)],
    ['Portal', money(b.portalCents)],
    ['Welcome bonus progress', money(b.bonusProgressCents)],
    ['Total returned', money(plan.totalValueReturnedCents ?? plan.expectedCents)],
    ['Net cost', money(plan.netCostCents ?? amountCents - plan.expectedCents), `of ${money(amountCents)}`],
  ];
  return (
    <div className="mt-3">
      <StatTiles testId="plan-breakdown" items={rows.filter(([, v]) => v !== '$0' && v !== '—').slice(0, 8)} />
      {b.transferUpliftCents > 0 && plan.transfer && (
        <p className="mt-2 text-xs text-slate-600" data-testid="plan-transfer">
          Transfer value, not counted above: moving the points to {plan.transfer.partner} could add about {money(b.transferUpliftCents)} ({plan.transfer.note}).
        </p>
      )}
    </div>
  );
}

function PlanCard({ plan, rank, amountCents, tags }: { plan: PlanView; rank: number; amountCents: number; tags: PlanStrategy[] }) {
  return (
    <li className="rounded-lg border border-slate-200 p-3" data-testid="plan">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={rank === 0 ? 'green' : 'slate'}>{rank === 0 ? 'Best' : `#${rank + 1}`}</Badge>
        {tags
          .filter((t) => t.key !== 'BEST')
          .map((t) => (
            <Badge key={t.key} tone={STRATEGY_TONE[t.key]}>
              {t.label.replace(' strategy', '')}
            </Badge>
          ))}
        {plan.kind === 'SPLIT' && <Badge tone="brand">Split spend</Badge>}
        <span className="inline-flex gap-1">
          {plan.legs.map((l) => (
            <WalletCardArt key={l.walletCardId} walletCardId={l.walletCardId} name={l.cardName} size="sm" />
          ))}
        </span>
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
      {rank === 0 && <Breakdown plan={plan} amountCents={amountCents} />}
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
        <p className="mt-1">
          Stacking rules {plan.stack.version}
          {plan.stack.allRulesVerified ? '' : ' are community-reported and not confirmed by the issuers'}.
        </p>
      </details>
    </li>
  );
}

function Strategies({ res }: { res: PlanResponse }) {
  const s = res.strategies ?? [];
  if (s.length === 0) return null;
  return (
    <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="strategies">
      {s.map((x) => {
        const p = res.plans[x.planIndex];
        return (
          <div key={x.key} className="rounded-lg border border-slate-200 p-3 text-sm" data-testid="strategy" data-key={x.key}>
            <Badge tone={STRATEGY_TONE[x.key]}>{x.label}</Badge>
            <p className="mt-2 font-medium">{p?.legs.map((l) => l.cardName).join(' + ')}</p>
            <p className="text-xs text-slate-600">{p?.member ? `${p.member} pays` : ''}</p>
            <p className="mt-1">
              <strong>{money(x.key === 'MAX_REWARDS' ? (p?.maxRewardsCents ?? x.expectedCents) : x.expectedCents)}</strong>
              {x.opportunityCostCents > 0 && <span className="text-xs text-slate-600"> · {money(x.opportunityCostCents)} less than best</span>}
            </p>
            <p className="mt-1 text-xs text-slate-600">{x.why}</p>
          </div>
        );
      })}
    </div>
  );
}

function Insights({ res }: { res: PlanResponse }) {
  const hh = res.household;
  const expiry = res.expiryImpact ?? [];
  const t = res.bestTimeToBuy;
  const showHousehold = hh && hh.best && hh.options.length > 1;
  if (!showHousehold && expiry.length === 0 && !t) return null;
  return (
    <div className="mb-4 grid gap-3 lg:grid-cols-3" data-testid="plan-insights">
      {showHousehold && hh && (
        <div className="rounded-lg border border-slate-200 p-3 text-sm" data-testid="household-advice">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Who should pay</p>
          <p className="mt-1 font-medium">{hh.best?.member ?? 'You'}</p>
          <p className="text-xs text-slate-700">{hh.reason}</p>
          <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
            {hh.options.map((o) => (
              <li key={o.member ?? 'you'}>
                {o.member ?? 'You'}: {money(o.expectedCents)} with {o.cardName}
              </li>
            ))}
          </ul>
          {hh.preferred && (
            <p className="mt-2 text-xs text-slate-700">
              {hh.preferred.available
                ? `If ${hh.preferred.member ?? 'they'} pays: ${money(hh.preferred.expectedCents)}${hh.preferred.vsBestCents ? ` (${money(hh.preferred.vsBestCents)} less than the best)` : ''}.`
                : `${hh.preferred.member ?? 'That member'} has no card that can be used here.`}
            </p>
          )}
        </div>
      )}
      {expiry.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="expiry-impact">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-900">Before it expires</p>
          <ul className="mt-1 space-y-1 text-amber-950">
            {expiry.map((e) => (
              <li key={`${e.kind}-${e.label}`}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}
      {t && (
        <div className="rounded-lg border border-slate-200 p-3 text-sm" data-testid="best-time">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Best time to buy</p>
          <p className="mt-1 font-medium">{shortDate(t.date)}</p>
          <p className="text-xs text-slate-700">{t.reason}</p>
        </div>
      )}
    </div>
  );
}

function PlannedRow({ p, onChanged }: { p: PlannedPurchase; onChanged: () => void }) {
  const [actual, setActual] = useState(p.actualCents != null ? String(p.actualCents / 100) : '');
  const update = useApiMutation<Record<string, unknown>>((body) => ({ path: `/offers/intel/planned/${p.id}`, method: 'PATCH', body }), [['offer-intel', 'planned']]);
  const remove = useApiMutation<void>(() => ({ path: `/offers/intel/planned/${p.id}`, method: 'DELETE' }), [['offer-intel', 'planned']]);
  const best = p.result;
  const status = p.status ?? 'PLANNED';
  const first = best?.insights?.expiryImpact?.[0];
  return (
    <li className="py-3 text-sm" data-testid="planned-row" data-status={status}>
      <div className="flex flex-wrap items-center gap-2">
        <BrandLogo brand={{ name: p.merchantText }} size="sm" decorative hideUnknown />
        <span className="font-medium">{p.item ? `${p.item} · ${p.merchantText}` : p.merchantText}</span>
        <span>{money(p.amountCents)}</span>
        {p.plannedFor && <span className="text-slate-600">on {shortDate(p.plannedFor)}</span>}
        {p.priority && <Badge tone={p.priority === 'HIGH' ? 'red' : p.priority === 'MEDIUM' ? 'amber' : 'slate'}>{p.priority.toLowerCase()} priority</Badge>}
        <Badge tone={status === 'DONE' ? 'green' : status === 'CANCELLED' ? 'slate' : 'brand'}>{status.toLowerCase()}</Badge>
        <span className="ml-auto flex gap-1">
          {status === 'PLANNED' && (
            <Button
              variant="secondary"
              className="px-2 py-1 text-xs"
              onClick={() => update.mutate({ status: 'DONE', ...(best?.legs[0] ? { chosenWalletCardId: best.legs[0].walletCardId } : {}) }, { onSuccess: onChanged })}
            >
              Mark bought
            </Button>
          )}
          {status === 'PLANNED' && (
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => update.mutate({ status: 'CANCELLED' })}>
              Cancel
            </Button>
          )}
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => remove.mutate(undefined)}>
            Remove
          </Button>
        </span>
      </div>
      {best && status === 'PLANNED' && (
        <div className="mt-1 space-y-0.5 pl-7 text-xs text-slate-700">
          <p>
            Recommended: <strong>{best.legs.map((l) => `${l.cardName}${l.member ? ` (${l.member})` : ''}`).join(' + ')}</strong> · expected {money(best.expectedCents)}
          </p>
          {first && <p className="text-amber-900">{first.message}</p>}
          {best.insights?.bestTimeToBuy && best.insights.bestTimeToBuy.gainCents > 0 && <p>Best time: {best.insights.bestTimeToBuy.reason}</p>}
        </div>
      )}
      {status === 'DONE' && (
        <div className="mt-1 flex flex-wrap items-center gap-2 pl-7 text-xs text-slate-700">
          <span>Expected {money(p.expectedCents ?? 0)}</span>
          <label className="flex items-center gap-1">
            Actually returned ($)
            <input
              aria-label="Actual return in dollars"
              className="w-24 rounded border border-slate-300 px-2 py-1"
              type="number"
              min="0"
              step="0.01"
              value={actual}
              onChange={(e) => setActual(e.target.value)}
            />
          </label>
          <Button variant="secondary" className="px-2 py-1 text-xs" disabled={actual === ''} onClick={() => update.mutate({ actualCents: Math.round(Number(actual) * 100) })}>
            Save
          </Button>
          {p.actualCents != null && (
            <span>{p.actualCents >= (p.expectedCents ?? 0) ? 'Met the plan.' : `${money((p.expectedCents ?? 0) - p.actualCents)} short of the plan.`}</span>
          )}
        </div>
      )}
      <ErrorText error={update.error || remove.error} />
    </li>
  );
}

export default function PlanPurchasePage() {
  const [merchant, setMerchant] = useState('');
  const [item, setItem] = useState('');
  const [dollars, setDollars] = useState('');
  const [when, setWhen] = useState('');
  const [priority, setPriority] = useState<'' | 'LOW' | 'MEDIUM' | 'HIGH'>('');
  const [prefer, setPrefer] = useState('');
  const [res, setRes] = useState<PlanResponse | null>(null);
  const planned = useAuthedQuery<PlannedPurchase[]>(['offer-intel', 'planned'], '/offers/intel/planned');
  const members = useAuthedQuery<Member[]>(['household', 'members'], '/household/members');
  const plan = useApiMutation<{ save: boolean }, PlanResponse>(
    (v) => ({
      path: '/offers/intel/plan',
      method: 'POST',
      body: {
        ...(merchant.trim() ? { merchantText: merchant.trim() } : {}),
        ...(item.trim() ? { item: item.trim() } : {}),
        amountCents: Math.round(Number(dollars) * 100),
        save: v.save,
        ...(when ? { plannedFor: new Date(when).toISOString() } : {}),
        ...(priority ? { priority } : {}),
        ...(prefer ? { preferMember: prefer } : {}),
      },
    }),
    [['offer-intel']],
  );
  const valid = (merchant.trim().length >= 2 || item.trim().length >= 2) && Number(dollars) > 0;
  const tagsFor = (i: number) => (res?.strategies ?? []).filter((s) => s.planIndex === i);
  const list = (planned.data ?? [])
    .slice()
    .sort((a, b) => (a.status === 'PLANNED' ? 0 : 1) - (b.status === 'PLANNED' ? 0 : 1) || (a.plannedFor ?? '9999').localeCompare(b.plannedFor ?? '9999'));
  return (
    <div className="space-y-6" data-testid="plan-purchase">
      <PageHeader
        title="Plan a purchase"
        subtitle="About to spend? See which card and which household member returns the most, what to activate first, what expires, and why."
        action={
          <Link href="/offers/intel" className="text-sm text-brand-700 hover:underline">
            Offer intelligence →
          </Link>
        }
      />
      <Panel>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            plan.mutate({ save: false }, { onSuccess: (r) => setRes(r) });
          }}
        >
          <Field label="Item (optional)" htmlFor="pp-item" hint="MacBook Pro, Hilton stay, flight…">
            <Input id="pp-item" value={item} onChange={(e) => setItem(e.target.value)} placeholder="MacBook Pro" />
          </Field>
          <Field label="Merchant" htmlFor="pp-merchant">
            <Input id="pp-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="Marriott" />
          </Field>
          <Field label="Amount ($)" htmlFor="pp-amount">
            <Input id="pp-amount" type="number" min="0.01" step="0.01" value={dollars} onChange={(e) => setDollars(e.target.value)} placeholder="1200" required />
          </Field>
          <Field label="When (optional)" htmlFor="pp-when">
            <Input id="pp-when" type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
          <Field label="Priority" htmlFor="pp-priority">
            <Select id="pp-priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)}>
              <option value="">Not set</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </Select>
          </Field>
          {(members.data ?? []).length > 1 && (
            <Field label="Who would rather pay" htmlFor="pp-prefer">
              <Select id="pp-prefer" value={prefer} onChange={(e) => setPrefer(e.target.value)}>
                <option value="">No preference</option>
                {(members.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nickname}
                    {m.isPrimary ? ' (you)' : ''}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Button type="submit" disabled={!valid} loading={plan.isPending} data-testid="plan-go" className="lg:col-start-4">
            Find the best way to pay
          </Button>
        </form>
        <ErrorText error={plan.error} />
      </Panel>

      {res && (
        <Panel
          title={
            <span className="flex items-center gap-2">
              <BrandLogo brand={{ name: res.merchant.name }} name={res.merchant.name} size="md" decorative />
              {`${res.item ? `${res.item} · ` : ''}${res.merchant.name} · ${money(res.amountCents)}`}
            </span>
          }
          action={
            res.plans.length > 0 && (
              <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => plan.mutate({ save: true }, { onSuccess: (r) => setRes(r) })} data-testid="plan-save">
                Save as planned purchase
              </Button>
            )
          }
        >
          {res.merchantConfidence < 0.8 && (
            <p className="mb-2 rounded bg-amber-50 p-2 text-sm text-amber-900">
              We matched “{merchant || item}” to {res.merchant.name} with low confidence — check it is the right merchant.
            </p>
          )}
          {res.plans.length === 0 ? (
            <EmptyState title="No plan available">Add a card to your wallet, then try again.</EmptyState>
          ) : (
            <>
              <Strategies res={res} />
              <Insights res={res} />
              {res.cashback && <div className="mb-4"><CashbackCard rec={res.cashback} merchant={res.merchant.name} /></div>}
              <ol className="space-y-3" data-testid="plans">
                {res.plans.map((p, i) => (
                  <PlanCard key={`${p.kind}-${p.legs.map((l) => l.walletCardId).join('-')}`} plan={p} rank={i} amountCents={res.amountCents} tags={tagsFor(i)} />
                ))}
              </ol>
            </>
          )}
          <p className="mt-3 text-xs text-slate-600">
            General information, not financial advice. Every figure above comes from your cards’ earn rules and the offers, credits and certificates you track, and is recorded in
            your audit trail.
          </p>
        </Panel>
      )}

      <Panel title="Upcoming purchases">
        {list.length === 0 ? (
          <p className="text-sm text-slate-600">None saved.</p>
        ) : (
          <ul className="divide-y divide-slate-100" data-testid="planned-list">
            {list.map((p) => (
              <PlannedRow key={p.id} p={p} onChanged={() => planned.refetch()} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
