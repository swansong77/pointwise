'use client';

import { useState } from 'react';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import type { Member } from '@/lib/portfolio-types';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';
import { AwardPlan, Balance, highlightParts, parsePoints, PartnersResponse, points, TermHit, TransferAdvice } from '@/lib/strategy';

export default function TravelPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Travel & points"
        subtitle="Your household's points, the best transfer partner for each balance, and how to cover an award. Award availability isn't tracked — check the airline or hotel before transferring."
      />
      <Balances />
      <AwardPlanner />
      <TermsSearch />
      <PartnerTable />
    </div>
  );
}

function Balances() {
  const balances = useAuthedQuery<Balance[]>(['travel', 'balances'], '/me/balances');
  const advice = useAuthedQuery<TransferAdvice>(['travel', 'transfers'], '/travel/transfers');
  const members = useAuthedQuery<Member[]>(['household', 'members'], '/household/members');
  const partners = useAuthedQuery<PartnersResponse>(['travel', 'partners'], '/transfer-partners');
  const [form, setForm] = useState({ profileId: '', code: '', points: '' });
  const save = useApiMutation<{
    profileId: string;
    code: string;
    points: number;
  }>((body) => ({ path: '/me/balances', method: 'PUT', body }), [['travel']]);
  const remove = useApiMutation<string>((id) => ({ path: `/me/balances/${id}`, method: 'DELETE' }), [['travel']]);
  const pts = parsePoints(form.points);
  const codes = [
    ...(partners.data?.currencies ?? []).map((c) => ({
      code: c.code,
      name: c.name,
    })),
    ...(partners.data?.programs ?? []).map((p) => ({
      code: p.code,
      name: p.name,
    })),
  ];

  return (
    <Panel title="Balances" data-testid="travel-balances">
      {balances.isLoading ? (
        <Spinner label="Loading balances" />
      ) : !balances.data?.length ? (
        <EmptyState title="No balances yet">Add the points and miles each person holds to get transfer advice.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-1 font-semibold">Member</th>
              <th className="py-1 font-semibold">Program</th>
              <th className="py-1 text-right font-semibold">Points</th>
              <th className="py-1 text-right font-semibold">Value</th>
              <th className="py-1">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {balances.data.map((b) => (
              <tr key={b.id} data-testid="travel-balance">
                <td className="py-2">{b.member}</td>
                <td className="py-2">{b.name}</td>
                <td className="py-2 text-right tabular-nums">{points(b.points)}</td>
                <td className="py-2 text-right tabular-nums">{money(b.valueCents, { compact: true })}</td>
                <td className="py-2 text-right">
                  <Button variant="ghost" onClick={() => remove.mutate(b.id)} aria-label={`Remove ${b.member}'s ${b.name}`}>
                    Remove
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {advice.data && advice.data.balances.length > 0 && (
        <div className="mt-5 space-y-2" data-testid="travel-advice">
          <h3 className="text-sm font-semibold text-slate-900">
            Best use of each balance — up to {money(advice.data.totals.bestValueCents, { compact: true })} vs {money(advice.data.totals.cashValueCents, { compact: true })} redeemed
            directly
          </h3>
          <ul className="space-y-2">
            {advice.data.balances.map((a) => (
              <li key={`${a.profileId}-${a.currency}`} className="rounded-lg border border-slate-200 p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {a.member} · {points(a.points)} {a.currencyName}
                  </span>
                  {a.best?.bonusPercent ? <Badge tone="green">{a.best.bonusPercent} % transfer bonus</Badge> : null}
                </div>
                <p className="mt-1 text-slate-600">{a.advice}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form
        className="mt-5 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_1fr_140px_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (pts == null || !form.profileId || !form.code) return;
          save.mutate({ profileId: form.profileId, code: form.code, points: pts }, { onSuccess: () => setForm((f) => ({ ...f, points: '' })) });
        }}
        data-testid="travel-balance-form"
      >
        <Field label="Member" htmlFor="bal-member">
          <Select id="bal-member" value={form.profileId} onChange={(e) => setForm({ ...form, profileId: e.target.value })} required>
            <option value="">Choose…</option>
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Points or miles" htmlFor="bal-code">
          <Select id="bal-code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required>
            <option value="">Choose…</option>
            {codes.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Balance" htmlFor="bal-points" error={form.points && pts == null ? 'Use a number like 60,000 or 60k' : undefined}>
          <Input id="bal-points" inputMode="numeric" value={form.points} onChange={(e) => setForm({ ...form, points: e.target.value })} placeholder="60,000" required />
        </Field>
        <Button type="submit" disabled={pts == null || !form.profileId || !form.code} loading={save.isPending}>
          Save balance
        </Button>
      </form>
      <ErrorText error={save.error ?? remove.error} />
    </Panel>
  );
}

function AwardPlanner() {
  const partners = useAuthedQuery<PartnersResponse>(['travel', 'partners'], '/transfer-partners');
  const members = useAuthedQuery<Member[]>(['household', 'members'], '/household/members');
  const [program, setProgram] = useState('');
  const [cost, setCost] = useState('');
  const [booker, setBooker] = useState('');
  const plan = useApiMutation<{ program: string; points: number; profileId?: string }, AwardPlan>((body) => ({ path: '/travel/plan', method: 'POST', body }));
  const pts = parsePoints(cost);
  return (
    <Panel title="Plan an award" data-testid="travel-planner">
      <form
        className="grid gap-3 sm:grid-cols-[1fr_160px_1fr_auto] sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!program || !pts) return;
          plan.mutate({ program, points: pts, profileId: booker || undefined });
        }}
      >
        <Field label="Program" htmlFor="plan-program">
          <Select id="plan-program" value={program} onChange={(e) => setProgram(e.target.value)} required>
            <option value="">Choose…</option>
            {partners.data?.programs.map((p) => (
              <option key={p.code} value={p.code}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Award price (points)" htmlFor="plan-points" error={cost && !pts ? 'Use a number like 60,000 or 60k' : undefined}>
          <Input id="plan-points" inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="60,000" required />
        </Field>
        <Field label="Who books" htmlFor="plan-booker">
          <Select id="plan-booker" value={booker} onChange={(e) => setBooker(e.target.value)}>
            <option value="">Primary member</option>
            {members.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={!program || !pts} loading={plan.isPending}>
          Plan it
        </Button>
      </form>
      <ErrorText error={plan.error} />
      {plan.data && (
        <div className="mt-4 space-y-3" data-testid="travel-plan">
          <p className={`text-sm font-medium ${plan.data.shortfall ? 'text-amber-800' : 'text-slate-900'}`}>{plan.data.summary}</p>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            {plan.data.steps.map((s, i) => (
              <li key={i}>
                {s.kind === 'TRANSFER'
                  ? `Transfer ${points(s.pointsUsed)} ${s.from} from ${s.member} → ${points(s.programPoints)} ${plan.data!.program.code}${s.transferDays ? ` (up to ${s.transferDays} day${s.transferDays > 1 ? 's' : ''})` : ' (instant)'}`
                  : `Use ${points(s.pointsUsed)} ${plan.data!.program.code} from ${s.member}`}
              </li>
            ))}
          </ol>
          <p className="text-xs text-slate-500">
            Points given up: worth about {money(plan.data.totalCostCents, { compact: true })}
            {plan.data.costCentsPerProgramPoint != null ? ` (${plan.data.costCentsPerProgramPoint}¢ per ${plan.data.program.code} point)` : ''}.
          </p>
          {plan.data.warnings.length > 0 && (
            <div role="note">
              <ul className="space-y-1 text-sm text-amber-800">
                {plan.data.warnings.map((w) => (
                  <li key={w} className="rounded bg-amber-50 px-2 py-1">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function PartnerTable() {
  const partners = useAuthedQuery<PartnersResponse>(['travel', 'partners'], '/transfer-partners');
  if (partners.isLoading) return <Spinner label="Loading partners" />;
  if (partners.error) return <ErrorText error={partners.error} />;
  return (
    <Panel title="Transfer partners" data-testid="travel-partners">
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Transfer partners table">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="py-1 font-semibold">From</th>
              <th className="py-1 font-semibold">To</th>
              <th className="py-1 text-right font-semibold">Ratio</th>
              <th className="py-1 text-right font-semibold">Value / point</th>
              <th className="py-1 font-semibold">Timing</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {partners.data?.currencies.flatMap((c) =>
              c.options.map((o) => (
                <tr key={`${c.code}-${o.program}`}>
                  <td className="py-2">{c.name}</td>
                  <td className="py-2">
                    {o.programName}
                    {o.bonusPercent > 0 && (
                      <span className="ml-1">
                        <Badge tone="green">
                          +{o.bonusPercent} %{o.bonusEndsAt ? ` until ${shortDate(o.bonusEndsAt)}` : ''}
                        </Badge>
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-right tabular-nums">1 : {o.programPointsPerPoint}</td>
                  <td className="py-2 text-right tabular-nums">{o.centsPerPoint}¢</td>
                  <td className="py-2">{o.transferDays ? `${o.transferDays} day${o.transferDays > 1 ? 's' : ''}` : 'Instant'}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function TermsSearch() {
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');
  const r = useAuthedQuery<{ query: string; hits: TermHit[] }>(['terms', submitted], `/card-terms/search?q=${encodeURIComponent(submitted)}&limit=10`, {
    enabled: submitted.length >= 2,
  });
  return (
    <Panel title="Search card fine print" data-testid="terms-search">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(q.trim());
        }}
      >
        <label htmlFor="terms-q" className="sr-only">
          Search card terms
        </label>
        <Input id="terms-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="lounge access, trip delay, rental car…" />
        <Button type="submit" disabled={q.trim().length < 2}>
          Search
        </Button>
      </form>
      {r.isLoading && submitted && <Spinner label="Searching" />}
      <ErrorText error={r.error} />
      {r.data && (
        <ul className="mt-3 space-y-2 text-sm" data-testid="terms-results">
          {r.data.hits.length === 0 && <li className="text-slate-500">Nothing in the catalog terms mentions “{r.data.query}”.</li>}
          {r.data.hits.map((h, i) => (
            <li key={`${h.cardId}-${i}`} className="rounded-lg border border-slate-200 p-2">
              <span className="font-medium">{h.card}</span> <span className="text-xs text-slate-500">· {h.kind}</span>
              <p className="text-slate-700">
                {highlightParts(h.snippet).map((p, j) =>
                  p.hit ? (
                    <mark key={j} className="rounded bg-amber-100 px-0.5 text-slate-900">
                      {p.text}
                    </mark>
                  ) : (
                    <span key={j}>{p.text}</span>
                  ),
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
