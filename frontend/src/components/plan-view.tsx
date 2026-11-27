'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui';
import { CallButton } from '@/components/call-button';
import { confidenceWord, CopilotResponse, HORIZONS, HORIZON_LABEL, PlanItem } from '@/lib/copilot';
import { money } from '@/lib/format';

const tone = (c: number) => (c >= 80 ? 'green' : c >= 55 ? 'amber' : 'red');
const EFFECT = { UP: '▲', DOWN: '▼', NEUTRAL: '•' } as const;

function Item({ i, onNavigate }: { i: PlanItem; onNavigate?: () => void }) {
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

      {p.items.length === 0 && p.kind === 'AGENDA' && <p className="text-sm text-slate-700">You are on track. Check back tomorrow.</p>}

      {HORIZONS.filter((h) => p.items.some((i) => i.horizon === h)).map((h) => (
        <section key={h} aria-label={HORIZON_LABEL[h]} data-testid={`plan-${h.toLowerCase()}`}>
          {p.kind === 'AGENDA' && <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{HORIZON_LABEL[h]}</h4>}
          <ul className="space-y-2">
            {p.items
              .filter((i) => i.horizon === h)
              .map((i) => (
                <Item key={i.id} i={i} onNavigate={onNavigate} />
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
