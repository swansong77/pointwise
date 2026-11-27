'use client';

import { useState } from 'react';
import { Badge, Button, ErrorText, Field, Input, Panel, Select, Spinner } from '@/components/ui';
import { LIFE_KINDS, LifeEstimate, LifeEvent, LifeKind } from '@/lib/chief';
import { money, shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

function Estimate({ e }: { e: LifeEstimate }) {
  return (
    <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3 text-sm" data-testid="life-estimate">
      <p className="font-medium text-slate-900">
        Expected value about {money(e.expectedValueCents)} <span className="text-xs font-normal text-slate-600">· confidence {e.confidence}%</span>
      </p>
      {e.bestCards.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Best cards</p>
          <ul className="list-disc pl-5">
            {e.bestCards.map((c) => (
              <li key={c.use}>
                {c.use}: {c.card}
                {c.member ? ' (' + c.member + ')' : ''}, expected return {money(c.expectedCents)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {e.offers.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Offers and steps first</p>
          <ul className="list-disc pl-5">
            {e.offers.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </div>
      )}
      {e.certificates.length > 0 && <p>Certificates: {e.certificates.map((c) => c.name + ' (' + money(c.cents) + (c.usable ? '' : ', expires too soon') + ')').join('; ')}</p>}
      {e.travelCredits.cents > 0 && <p>Travel credits you could use: {money(e.travelCredits.cents)}</p>}
      {e.pointsUse && (
        <p>
          Points: {e.pointsUse.program}, {e.pointsUse.pointsNeeded.toLocaleString('en-US')} needed,{' '}
          {e.pointsUse.shortfall > 0 ? e.pointsUse.shortfall.toLocaleString('en-US') + ' short' : 'covered'}.
        </p>
      )}
      {e.transferBonuses.length > 0 && <p>Transfer bonuses: {e.transferBonuses.join('; ')}</p>}
      <details className="text-xs text-slate-600">
        <summary className="cursor-pointer">Assumptions and risks</summary>
        <ul className="mt-1 list-disc pl-5">
          {[...e.assumptions, ...e.risks].map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** Upcoming events (a family vacation, a move, a big purchase) with what your cards, credits and points can do for each. */
export function ChiefLife() {
  const q = useAuthedQuery<LifeEvent[]>(['chief', 'life'], '/chief/life-events');
  const create = useApiMutation<Record<string, unknown>>((body) => ({ path: '/chief/life-events', method: 'POST', body }), [['chief']]);
  const estimate = useApiMutation<string>((id) => ({ path: '/chief/life-events/' + id + '/estimate', method: 'POST', body: {} }), [['chief']]);
  const remove = useApiMutation<string>((id) => ({ path: '/chief/life-events/' + id, method: 'DELETE' }), [['chief']]);
  const [kind, setKind] = useState<LifeKind>('FAMILY_VACATION');
  const [title, setTitle] = useState('');
  const [dest, setDest] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [travelers, setTravelers] = useState('1');
  const [budget, setBudget] = useState('');
  const travel = LIFE_KINDS.find((k) => k.kind === kind)!.travel;

  const submit = (ev: React.FormEvent) => {
    ev.preventDefault();
    create.mutate(
      {
        kind,
        title: title.trim(),
        ...(dest.trim() ? { destination: dest.trim() } : {}),
        ...(start ? { startsOn: new Date(start + 'T12:00:00Z').toISOString() } : {}),
        ...(end ? { endsOn: new Date(end + 'T12:00:00Z').toISOString() } : {}),
        travelers: Number(travelers) || 1,
        ...(budget ? { budgetCents: Math.round(Number(budget) * 100) } : {}),
      },
      {
        onSuccess: () => {
          setTitle('');
          setDest('');
          setStart('');
          setEnd('');
          setBudget('');
        },
      },
    );
  };

  return (
    <Panel title="Life events" data-testid="chief-life">
      <div id="life" />
      {!q.data ? (
        <Spinner />
      ) : q.data.length === 0 ? (
        <p className="text-sm text-slate-600" data-testid="life-empty">
          Nothing coming up yet. Add a family vacation, a college visit, a move or a big purchase and the Chief of Staff will line up your best cards, credits and points for it.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="life-list">
          {q.data.map((e) => (
            <li key={e.id} className="rounded-lg border border-slate-200 bg-white p-3" data-testid="life-event">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 font-medium text-slate-900">{e.title}</span>
                <Badge>{LIFE_KINDS.find((k) => k.kind === e.kind)?.label}</Badge>
                <Badge tone={e.status === 'BOOKED' ? 'green' : 'slate'}>{e.status.toLowerCase()}</Badge>
              </div>
              <p className="text-xs text-slate-600">
                {[
                  e.destination,
                  e.startsOn ? shortDate(e.startsOn) + (e.endsOn ? ' to ' + shortDate(e.endsOn) : '') : null,
                  e.travelers > 1 ? e.travelers + ' travelers' : null,
                  e.budgetCents ? 'budget ' + money(e.budgetCents) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              {e.estimate ? <Estimate e={e.estimate} /> : null}
              <div className="mt-2 flex gap-1">
                <Button
                  variant="secondary"
                  className="px-3 py-1 text-xs"
                  loading={estimate.isPending && estimate.variables === e.id}
                  onClick={() => estimate.mutate(e.id)}
                  aria-label={(e.estimate ? 'Refresh the estimate for ' : 'Estimate ') + e.title}
                >
                  {e.estimate ? 'Refresh estimate' : 'Estimate value'}
                </Button>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => window.confirm('Delete this event?') && remove.mutate(e.id)} aria-label={'Delete ' + e.title}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2" aria-label="Add a life event" data-testid="life-form">
        <Field label="What is it?" htmlFor="life-kind">
          <Select id="life-kind" value={kind} onChange={(e) => setKind(e.target.value as LifeKind)}>
            {LIFE_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name it" htmlFor="life-title">
          <Input id="life-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="for example Church mission trip to Honduras" />
        </Field>
        {travel && (
          <Field label="Where to" htmlFor="life-dest">
            <Input id="life-dest" value={dest} onChange={(e) => setDest(e.target.value)} maxLength={80} />
          </Field>
        )}
        <Field label="Starts (optional)" htmlFor="life-start">
          <Input id="life-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="Ends (optional)" htmlFor="life-end">
          <Input id="life-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        {travel && (
          <Field label="Travelers" htmlFor="life-travelers">
            <Input id="life-travelers" type="number" min={1} max={20} value={travelers} onChange={(e) => setTravelers(e.target.value)} />
          </Field>
        )}
        <Field label="Budget in dollars (optional)" htmlFor="life-budget">
          <Input id="life-budget" type="number" min={0} value={budget} onChange={(e) => setBudget(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={create.isPending} disabled={!title.trim() || (travel && !dest.trim())}>
            Add event
          </Button>
        </div>
      </form>
      <ErrorText error={create.error || estimate.error || remove.error} />
    </Panel>
  );
}
