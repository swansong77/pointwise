'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui';
import { RoadmapView } from '@/components/chief-roadmap';
import { json, useApi } from '@/lib/api';
import { CallButton } from '@/components/call-button';
import { confidenceWord, CopilotResponse, HORIZONS, HORIZON_LABEL, PlanItem, WhatIfOutcome } from '@/lib/copilot';
import { money } from '@/lib/format';

const tone = (c: number) => (c >= 80 ? 'green' : c >= 55 ? 'amber' : 'red');
const EFFECT = { UP: '▲', DOWN: '▼', NEUTRAL: '•' } as const;
const DIRECTION = {
  BETTER: ['▲', 'better', 'text-emerald-700'],
  WORSE: ['▼', 'worse', 'text-red-700'],
  SAME: ['•', 'same', 'text-slate-600'],
  UNKNOWN: ['', '', 'text-slate-600'],
} as const;
const VERDICT = { FAVORABLE: ['Favorable', 'green'], UNFAVORABLE: ['Unfavorable', 'red'], MIXED: ['Mixed', 'amber'], NEUTRAL: ['About even', 'slate'] } as const;

/** Snooze, dismiss or mark done: Copilot remembers and stops showing the item for a while. */
export function Decide({ id }: { id: string }) {
  const api = useApi();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const act = async (action: 'SNOOZE' | 'DISMISS' | 'DONE', label: string, days?: number) => {
    setErr(null);
    try {
      await api('/copilot/memory/decisions', { method: 'POST', ...json({ itemId: id, action, ...(days ? { days } : {}) }) });
      setMsg(label);
      void qc.invalidateQueries({ queryKey: ['copilot'] });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'That did not work.');
    }
  };
  if (msg)
    return (
      <p role="status" className="text-xs text-slate-600" data-testid="decision-result">
        {msg}
      </p>
    );
  const b = 'rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500';
  return (
    <span className="inline-flex flex-wrap items-center gap-1" data-testid="decide">
      <button type="button" className={b} onClick={() => act('DONE', 'Marked done. It will stay hidden for 30 days.')}>
        Done
      </button>
      <button type="button" className={b} onClick={() => act('SNOOZE', 'Snoozed for 7 days.', 7)}>
        Snooze 7 days
      </button>
      <button type="button" className={b} onClick={() => act('DISMISS', 'Dismissed. It will stay hidden for 90 days.')}>
        Not interested
      </button>
      {err && (
        <span role="alert" className="text-xs text-red-700">
          {err}
        </span>
      )}
    </span>
  );
}

/** Before and after, by what it affects: money, points, benefits, 5/24 and the household. */
export function WhatIfView({ o }: { o: WhatIfOutcome }) {
  const [label, tone] = VERDICT[o.verdict];
  return (
    <div className="space-y-3" data-testid="whatif-view">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone as 'green'}>{label}</Badge>
        {o.netCents != null && <Badge tone="brand">{money(o.netCents)} a year</Badge>}
      </div>
      <p className="text-sm font-medium text-slate-900">{o.recommendation}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm" data-testid="whatif-table">
          <caption className="sr-only">{o.title}: before and after</caption>
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-600">
              <th scope="col" className="py-1 pr-3">
                What
              </th>
              <th scope="col" className="py-1 pr-3">
                Now
              </th>
              <th scope="col" className="py-1 pr-3">
                If
              </th>
              <th scope="col" className="py-1">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {o.deltas.map((d) => {
              const [icon, word, cls] = DIRECTION[d.direction];
              return (
                <tr key={d.label + d.dimension} className="border-t border-slate-100 align-top">
                  <th scope="row" className="py-1 pr-3 font-normal text-slate-800">
                    <span className="block text-xs text-slate-600">{d.dimension === 'FIVE24' ? '5/24' : d.dimension[0] + d.dimension.slice(1).toLowerCase()}</span>
                    {d.label}
                  </th>
                  <td className="py-1 pr-3 text-slate-700">{d.before}</td>
                  <td className="py-1 pr-3 text-slate-700">{d.after}</td>
                  <td className={`py-1 ${cls}`}>
                    <span aria-hidden>{icon} </span>
                    {word && <span className="sr-only">{word}: </span>}
                    {d.change}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {o.alternatives.length > 0 && (
        <p className="text-sm text-slate-700">
          <span className="font-medium">Instead, consider: </span>
          {o.alternatives.join(' ')}
        </p>
      )}
    </div>
  );
}

function Item({ i, onNavigate, decide }: { i: PlanItem; onNavigate?: () => void; decide?: boolean }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3" data-testid="plan-item">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{i.title}</p>
          <p className="text-sm text-slate-700">{i.recommendation}</p>
        </div>
        <Badge tone={tone(i.confidence)}>
          {confidenceWord(i.confidence)} ({i.confidence}%)
        </Badge>
        {i.expectedValueCents != null && i.expectedValueCents !== 0 && <Badge tone="brand">{money(i.expectedValueCents)}</Badge>}
      </div>
      <details className="mt-2 text-sm text-slate-700">
        <summary className="cursor-pointer text-xs text-slate-600">Why, evidence and risks</summary>
        <div className="mt-2 space-y-2">
          <p>
            <span className="font-medium">Why: </span>
            {i.reason}
          </p>
          {i.factors.length > 0 && (
            <ul className="text-xs text-slate-700">
              {i.factors.map((f) => (
                <li key={f.label + f.detail}>
                  <span aria-hidden>{EFFECT[f.effect]}</span> <span className="sr-only">{f.effect.toLowerCase()}: </span>
                  {f.label}: {f.detail}
                </li>
              ))}
            </ul>
          )}
          {i.evidence.length > 0 && <p className="text-xs text-slate-600">Evidence: {i.evidence.join(' · ')}</p>}
          {i.assumptions.length > 0 && <p className="text-xs text-slate-600">Assumes: {i.assumptions.join(' ')}</p>}
          {i.risks.length > 0 && <p className="text-xs text-amber-800">Risks: {i.risks.join(' ')}</p>}
        </div>
      </details>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link href={i.href} onClick={onNavigate} className="text-xs text-brand-700 underline">
          Open
        </Link>
        {i.calls.map((c) => (
          <CallButton key={c.id} c={c} />
        ))}
        {decide && <Decide id={i.id} />}
      </div>
    </li>
  );
}

/** A Copilot reply: the headline, the wording (a model's when one was allowed, else the planner's), the plan by when to do it, and why. */
export function PlanView({ r, onNavigate }: { r: CopilotResponse; onNavigate?: () => void }) {
  const p = r.plan;
  return (
    <div className="space-y-4" data-testid="plan-view" aria-live="polite">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold text-slate-900" data-testid="plan-headline">
            {p.headline}
          </h3>
          <Badge tone={tone(p.confidence)}>
            Confidence {confidenceWord(p.confidence)} ({p.confidence}%)
          </Badge>
          {p.valueAtStakeCents > 0 && <Badge tone="brand">{money(p.valueAtStakeCents)} at stake</Badge>}
        </div>
        {r.narration ? (
          <div className="mt-2" data-testid="plan-narration">
            <p className="text-sm text-slate-800">{r.narration.text}</p>
            <p className="mt-1 text-xs text-slate-600">
              Worded by {r.narration.model} ({r.narration.local ? 'on your own machine' : 'a cloud model that saw only a redacted summary'}).{' '}
              <Link href="/settings#copilot" onClick={onNavigate} className="underline">
                See what was sent
              </Link>
            </p>
          </div>
        ) : (
          <>
            <p className="mt-2 text-sm text-slate-800" data-testid="plan-summary">
              {p.summary}
            </p>
            {r.narrationSkipped && (
              <p className="mt-1 text-xs text-slate-600" data-testid="plan-skipped">
                {r.narrationSkipped}
              </p>
            )}
          </>
        )}
      </div>

      {p.kind === 'WHATIF' && p.whatIf && <WhatIfView o={p.whatIf} />}

      {p.kind === 'ROADMAP' && p.roadmap && <RoadmapView r={p.roadmap} />}

      {p.items.length === 0 && p.kind === 'AGENDA' && <p className="text-sm text-slate-700">You are on track. Check back tomorrow.</p>}

      {(p.memory?.hidden.length ?? 0) > 0 && (
        <p className="text-xs text-slate-600" data-testid="plan-hidden">
          {p.memory!.hidden.length} item{p.memory!.hidden.length === 1 ? '' : 's'} you put aside {p.memory!.hidden.length === 1 ? 'is' : 'are'} hidden.{' '}
          <Link href="/copilot#memory" onClick={onNavigate} className="underline">
            Manage what Copilot remembers
          </Link>
        </p>
      )}

      {HORIZONS.filter((h) => p.kind !== 'WHATIF' && p.kind !== 'ROADMAP' && p.items.some((i) => i.horizon === h)).map((h) => (
        <section key={h} aria-label={HORIZON_LABEL[h]} data-testid={`plan-${h.toLowerCase()}`}>
          {p.kind === 'AGENDA' && <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{HORIZON_LABEL[h]}</h4>}
          <ul className="space-y-2">
            {p.items
              .filter((i) => i.horizon === h)
              .map((i) => (
                <Item key={i.id} i={i} onNavigate={onNavigate} decide={p.kind === 'AGENDA'} />
              ))}
          </ul>
        </section>
      ))}

      {(p.assumptions.length > 0 || p.risks.length > 0) && (
        <details className="text-xs text-slate-600" data-testid="plan-assumptions">
          <summary className="cursor-pointer">Assumptions and risks</summary>
          <ul className="mt-1 list-disc pl-5">
            {[...p.assumptions, ...p.risks].map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </details>
      )}

      <details className="text-xs text-slate-600" data-testid="plan-specialists">
        <summary className="cursor-pointer">Specialists consulted ({p.lenses.length})</summary>
        <ul className="mt-1 grid gap-1 sm:grid-cols-2">
          {p.lenses.map((l) => (
            <li key={l.lens}>
              <span className="font-medium">{l.label}</span>: {l.note}
              {!l.ok && <span className="text-amber-800"> (incomplete)</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
