'use client';

import { titleCase } from '@/lib/title-case';
import { BrandLogo } from '@/components/brand-logo';
import { useEffect, useState } from 'react';
import { Badge, Button, EmptyState, ErrorText, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { dollarsToCents, money } from '@/lib/format';
import type { Member } from '@/lib/portfolio-types';
import { useApiMutation, useAuthedQuery, useCategories } from '@/lib/queries';
import { factorLabel, GOAL_OPTIONS, probabilityLabel, SmartCard, SmartResponse, toggleGoal } from '@/lib/smart-recommendation';
import { ADVICE_TONE } from '@/lib/offer-market';
import { PRIVACY_NOTE, RunResult, stepLabel } from '@/lib/workflow';
import { CardScore, confidenceLabel, CREDIT_BANDS, five24Chip, oddsChip, HouseholdPlan, NextCardResponse, signedMoney, SPEND_SOURCE_LABEL, SpendProfile } from '@/lib/strategy';

export default function NextCardPage() {
  const members = useAuthedQuery<Member[]>(['household', 'members'], '/household/members');
  const plan = useAuthedQuery<HouseholdPlan>(['strategy', 'household'], '/household/next-card');
  const [profileId, setProfileId] = useState('');
  const [useRate, setUseRate] = useState('0.5');
  useEffect(() => {
    if (!profileId && members.data?.length) setProfileId(members.data.find((m) => m.isPrimary)?.id ?? members.data[0].id);
  }, [members.data, profileId]);
  const ranked = useAuthedQuery<NextCardResponse>(
    ['strategy', 'next-card', profileId, useRate],
    `/recommendations/next-card?profileId=${profileId}&benefitUseRate=${useRate}&limit=12`,
    { enabled: !!profileId },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Next card"
        subtitle="Which card each person should open next — first-year and ongoing value from your spending, current cards and 5/24 status. Calculated by PointWise; nothing is sent to an AI provider."
      />
      <HouseholdPick plan={plan.data} loading={plan.isLoading} error={plan.error} />
      <WorkflowPanel />
      <SmartPick profileId={profileId} member={members.data?.find((m) => m.id === profileId)} />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Panel
          title="Ranked for"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="nc-member" className="sr-only">
                Household member
              </label>
              <Select id="nc-member" value={profileId} onChange={(e) => setProfileId(e.target.value)} data-testid="nc-member">
                {members.data?.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nickname}
                  </option>
                ))}
              </Select>
              <label htmlFor="nc-use" className="sr-only">
                Expected use of card credits
              </label>
              <Select id="nc-use" value={useRate} onChange={(e) => setUseRate(e.target.value)}>
                <option value="0">Credits: ignore</option>
                <option value="0.5">Credits: use half</option>
                <option value="1">Credits: use all</option>
              </Select>
            </div>
          }
          data-testid="nc-ranked"
        >
          {ranked.isLoading && <Spinner label="Scoring cards" />}
          <ErrorText error={ranked.error} />
          {ranked.data && (
            <>
              <p className="mb-4 text-sm text-slate-600">
                {ranked.data.member.nickname} is <strong>{ranked.data.member.five24.count}/24</strong>
                {ranked.data.member.five24.underLimit ? '' : ' (issuers that enforce 5/24 will likely decline)'}. Spend from {SPEND_SOURCE_LABEL[ranked.data.spend.source]}:{' '}
                {money(ranked.data.spend.monthlyTotalCents, { compact: true })}
                /month.
              </p>
              {ranked.data.cards.length === 0 ? (
                <EmptyState title="No cards to score" />
              ) : (
                <ol className="space-y-4">
                  {ranked.data.cards.map((c, i) => (
                    <ScoreCard key={c.cardId} c={c} rank={c.eligible ? i + 1 : null} />
                  ))}
                </ol>
              )}
              <p className="mt-4 text-xs text-slate-500">{ranked.data.disclaimer}</p>
            </>
          )}
        </Panel>
        <div className="space-y-6">
          <CreditBandPicker member={members.data?.find((m) => m.id === profileId)} />
          <SpendEditor />
        </div>
      </div>
    </div>
  );
}

function HouseholdPick({ plan, loading, error }: { plan?: HouseholdPlan; loading: boolean; error: unknown }) {
  if (loading) return <Spinner label="Planning for the household" />;
  if (error) return <ErrorText error={error} />;
  if (!plan) return null;
  return (
    <Panel title="Who should apply next" data-testid="nc-household">
      <p className="text-sm font-medium text-slate-900" data-testid="nc-pick">
        {plan.why}
      </p>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {plan.members.map((m) => (
          <li key={m.profileId} className="rounded-lg border border-slate-200 p-3 text-sm">
            <p className="font-medium text-slate-900">{m.member}</p>
            {m.top.length ? (
              <ul className="mt-1 space-y-0.5 text-slate-600">
                {m.top.map((c) => (
                  <li key={c.cardId}>
                    {c.name} · {signedMoney(c.firstYearValueCents)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-slate-500">Nothing eligible right now</p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function ScoreCard({ c, rank }: { c: CardScore; rank: number | null }) {
  const conf = confidenceLabel(c.confidence);
  return (
    <li className={`rounded-xl border p-4 ${c.eligible ? 'border-slate-200' : 'border-dashed border-slate-300 bg-slate-50'}`} data-testid="nc-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <BrandLogo brand={{ name: c.issuer }} kinds={['ISSUER']} size="lg" />
          <div>
            <p className="font-semibold text-slate-900">
              {rank != null && <span className="mr-1 text-slate-500">{rank}.</span>}
              {c.name}
            </p>
            <p className="text-xs text-slate-500">{c.issuer}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {c.eligible ? <Badge tone={conf.tone}>{conf.label}</Badge> : <Badge tone="red">Not eligible</Badge>}
          {c.eligible && oddsChip(c.approvalOdds) && <Badge tone={oddsChip(c.approvalOdds)!.tone}>{oddsChip(c.approvalOdds)!.label}</Badge>}
          <Badge tone={c.five24.usesLastSlot || c.five24.blockedByRule ? 'amber' : 'slate'}>{five24Chip(c.five24)}</Badge>
        </div>
      </div>
      {c.eligible ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            <Stat label="First year" value={signedMoney(c.firstYearValueCents)} testid="nc-first-year" />
            <Stat label="Each year after" value={signedMoney(c.longTermValueCents)} />
            <Stat label="Annual fee" value={money(c.components.annualFeeCents, { compact: true })} />
            <Stat label="Return on fee" value={c.feeReturn == null ? 'No fee' : `${c.feeReturn}×`} />
          </dl>
          <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-slate-700">
            {c.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {c.warnings.length > 0 && (
            <div role="note">
              <ul className="mt-2 space-y-1 text-sm text-amber-800">
                {c.warnings.map((w) => (
                  <li key={w} className="rounded bg-amber-50 px-2 py-1">
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-slate-600">{c.blockers.join(' · ')}</p>
      )}
    </li>
  );
}

function Stat({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{titleCase(label)}</dt>
      <dd className="font-semibold text-slate-900" data-testid={testid}>
        {value}
      </dd>
    </div>
  );
}

function SpendEditor() {
  const spend = useAuthedQuery<SpendProfile>(['strategy', 'spend'], '/me/spend-profile');
  const cats = useCategories();
  const [rows, setRows] = useState<Record<string, string>>({});
  const save = useApiMutation<Array<{ categoryId: string; monthlyCents: number }>, SpendProfile>(
    (lines) => ({ path: '/me/spend-profile', method: 'PUT', body: { lines } }),
    [['strategy']],
  );
  useEffect(() => {
    if (spend.data) setRows(Object.fromEntries(spend.data.lines.map((l) => [l.categoryId, String(l.monthlyCents / 100)])));
  }, [spend.data]);
  const top = (cats.data ?? []).filter((c) => !c.parentId);
  const invalid = Object.values(rows).some((v) => v.trim() !== '' && dollarsToCents(v) == null);
  return (
    <Panel title="Your monthly spend" data-testid="nc-spend">
      {spend.isLoading || cats.isLoading ? (
        <Spinner label="Loading spend" />
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            const lines = Object.entries(rows)
              .map(([categoryId, v]) => ({
                categoryId,
                monthlyCents: dollarsToCents(v) ?? 0,
              }))
              .filter((l) => l.monthlyCents > 0);
            save.mutate(lines);
          }}
        >
          <p className="text-xs text-slate-500">Source now: {spend.data ? SPEND_SOURCE_LABEL[spend.data.source] : '—'}.</p>
          {top.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-2">
              <label htmlFor={`sp-${c.slug}`} className="text-sm text-slate-700">
                {c.name}
              </label>
              <input
                id={`sp-${c.slug}`}
                inputMode="decimal"
                value={rows[c.id] ?? ''}
                onChange={(e) => setRows((r) => ({ ...r, [c.id]: e.target.value }))}
                placeholder="$0"
                className="w-24 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          ))}
          {invalid && <p className="text-xs text-red-700">Enter dollar amounts like 450 or 450.50.</p>}
          <Button type="submit" disabled={invalid} loading={save.isPending} data-testid="nc-spend-save">
            Save spend
          </Button>
          <ErrorText error={save.error} />
          {save.isSuccess && (
            <p role="status" className="text-xs text-green-700">
              Saved — rankings updated.
            </p>
          )}
        </form>
      )}
    </Panel>
  );
}

function CreditBandPicker({ member }: { member?: Member }) {
  const save = useApiMutation<string>((band) => ({ path: `/household/members/${member?.id}`, method: 'PATCH', body: { creditBand: band || null } }), [['household'], ['strategy']]);
  if (!member) return null;
  return (
    <Panel title="Credit band" data-testid="nc-credit">
      <label htmlFor="nc-band" className="mb-1 block text-sm text-slate-700">
        {member.nickname}&apos;s approximate credit score
      </label>
      <Select id="nc-band" value={member.creditBand ?? ''} onChange={(e) => save.mutate(e.target.value)} disabled={save.isPending}>
        {CREDIT_BANDS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      <p className="mt-2 text-xs text-slate-500">Optional. Used only to estimate approval odds here — never sent to an AI provider or a credit bureau.</p>
      <ErrorText error={save.error} />
    </Panel>
  );
}

function SmartPick({ profileId, member }: { profileId: string; member?: Member }) {
  const q = useAuthedQuery<SmartResponse>(['strategy', 'smart', profileId], `/recommendations/smart?profileId=${profileId}`, { enabled: !!profileId });
  const save = useApiMutation<{ goals?: string[]; hasBusiness?: boolean }>(
    (body) => ({ path: `/household/members/${profileId}`, method: 'PATCH', body }),
    [['household'], ['strategy']],
  );
  // the checkboxes update at once; the saved value follows from the server
  const [goals, setGoals] = useState<string[]>(member?.goals ?? []);
  const [biz, setBiz] = useState<boolean>(!!member?.hasBusiness);
  useEffect(() => setGoals(member?.goals ?? []), [member?.goals]);
  useEffect(() => setBiz(!!member?.hasBusiness), [member?.hasBusiness]);
  const r = q.data?.recommended;
  return (
    <Panel title="Smart pick" data-testid="smart-pick">
      <fieldset className="mb-3" disabled={!member}>
        <legend className="mb-1 text-sm text-slate-700">What matters to {member?.nickname ?? 'you'}?</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {GOAL_OPTIONS.map((g) => (
            <label key={g.id} className="flex items-center gap-1">
              <input type="checkbox" checked={goals.includes(g.id)} onChange={() => { const next = toggleGoal(goals, g.id); setGoals(next); save.mutate({ goals: next }); }} data-testid={`goal-${g.id}`} />
              {g.label}
            </label>
          ))}
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={biz} onChange={(e) => { setBiz(e.target.checked); save.mutate({ hasBusiness: e.target.checked }); }} data-testid="has-business" />
            Has a business
          </label>
        </div>
      </fieldset>
      {q.isLoading && <Spinner />}
      <ErrorText error={q.error ?? save.error} />
      {q.data && !r && <EmptyState title="No eligible card found right now" />}
      {r && <SmartCardView c={r} headline />}
      {q.data && q.data.alternatives.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-medium text-slate-700">Alternatives</h3>
          <ul className="space-y-3" data-testid="smart-alternatives">
            {q.data.alternatives.map((a) => (
              <li key={a.cardId}>
                <SmartCardView c={a} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {q.data && <p className="mt-3 text-xs text-slate-500">{q.data.disclaimer} Goals and business status stay on this server and are never sent to an AI provider.</p>}
    </Panel>
  );
}

function SmartCardView({ c, headline }: { c: SmartCard; headline?: boolean }) {
  return (
    <div className={headline ? 'rounded-xl border border-brand-200 bg-brand-50/40 p-4' : 'rounded-lg border border-slate-200 p-3'} data-testid={headline ? 'smart-recommended' : 'smart-alt'}>
      <div className="flex flex-wrap items-center gap-2">
        <BrandLogo brand={{ name: c.issuer }} kinds={['ISSUER']} size="md" decorative />
        <span className="font-semibold">{c.name}</span>
        <span className="text-sm text-slate-600">{c.issuer}</span>
        <Badge tone={c.probability >= 0.6 ? 'green' : c.probability > 0 ? 'amber' : 'red'}>{probabilityLabel(c.probability)}</Badge>
        <Badge tone="slate">Confidence {Math.round(c.confidence * 100)}%</Badge>
      </div>
      <p className="mt-1 text-sm text-slate-700">
        First year {money(c.firstYearValueCents)} · long term {money(c.longTermValueCents)}
      </p>
      {c.advice.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {c.advice.map((a) => (
            <li key={a.code}>
              <Badge tone={ADVICE_TONE[a.tone]}>{a.text}</Badge>
            </li>
          ))}
        </ul>
      )}
      {c.risks.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-800" data-testid="smart-risks">
          {c.risks.slice(0, 4).map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <details className="mt-2 text-xs text-slate-600">
        <summary className="cursor-pointer">Why This Recommendation</summary>
        <ul className="mt-1 list-disc pl-5">
          {c.factors.map((f) => (
            <li key={f.key}>
              {factorLabel(f)} — {f.note}
            </li>
          ))}
          {c.confidenceReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function WorkflowPanel() {
  const run = useApiMutation<void, RunResult>(() => ({ path: '/ai/workflows/next-card', method: 'POST', body: { question: 'What card should I get next?' } }), []);
  const r = run.data;
  return (
    <Panel title="Step-by-step answer" data-testid="workflow-panel">
      <p className="mb-3 text-sm text-slate-600">
        Runs the offer, 5/24, portfolio and strategy checks in order and shows what each one found. Every step is saved so the reasoning can be reviewed later.
      </p>
      <Button onClick={() => run.mutate()} loading={run.isPending} data-testid="run-workflow">
        What card should I get next?
      </Button>
      <ErrorText error={run.error} />
      {r && (
        <div className="mt-4 space-y-3" data-testid="workflow-result">
          <pre className="whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-800" data-testid="workflow-answer">
            {r.answer}
          </pre>
          <ol className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm" data-testid="workflow-steps">
            {r.steps.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="workflow-step">
                <span className="text-slate-500">{s.ordinal}.</span>
                <span className="font-medium">{stepLabel(s.id)}</span>
                <Badge tone={s.status === 'OK' ? 'green' : s.status === 'SKIPPED' ? 'slate' : 'red'}>{s.status}</Badge>
                <span className="text-xs text-slate-500">{PRIVACY_NOTE[s.privacy]}</span>
                <span className="ml-auto text-xs text-slate-600">{s.durationMs} ms · {s.engine}</span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-slate-500">
            Run {r.runId.slice(0, 8)} saved. {r.narration ? `Reworded by ${r.narration.model}.` : r.narrationSkipped ?? ''}
          </p>
        </div>
      )}
    </Panel>
  );
}
