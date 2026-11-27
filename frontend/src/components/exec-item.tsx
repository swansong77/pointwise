'use client';

import Link from 'next/link';
import { CallButton } from '@/components/call-button';
import { Decide } from '@/components/plan-view';
import { Badge } from '@/components/ui';
import { BAND_LABEL, BAND_TONE, ExecItem, IMPACT_WORD, RISK_WORD } from '@/lib/chief';
import { money, shortDate } from '@/lib/format';

/** One thing to do, with its priority and what it is worth, how long it takes and how risky it is; the reasoning opens underneath. */
export function ExecItemCard({ i, rank }: { i: ExecItem; rank?: number }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-3" data-testid="exec-item">
      <div className="flex flex-wrap items-start gap-2">
        {rank != null && (
          <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700" aria-hidden>
            {rank}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900">{i.title}</p>
          <p className="text-sm text-slate-700">{i.recommendation}</p>
        </div>
        <Badge tone={BAND_TONE[i.band]}>
          <span className="sr-only">Priority: </span>
          {BAND_LABEL[i.band]} · {i.score}
        </Badge>
      </div>
      <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700" data-testid="exec-facts">
        <div>
          <dt className="inline text-slate-600">Value </dt>
          <dd className="inline font-medium">{i.expectedValueCents ? money(i.expectedValueCents) : 'n/a'}</dd>
        </div>
        <div>
          <dt className="inline text-slate-600">Time </dt>
          <dd className="inline font-medium">~{i.timeMinutes} min</dd>
        </div>
        <div>
          <dt className="inline text-slate-600">Risk </dt>
          <dd className="inline font-medium">{RISK_WORD[i.risk.level]}</dd>
        </div>
        {i.deadline && (
          <div>
            <dt className="inline text-slate-600">Deadline </dt>
            <dd className="inline font-medium">{shortDate(i.deadline)}</dd>
          </div>
        )}
      </dl>
      <details className="mt-2 text-sm text-slate-700">
        <summary className="cursor-pointer text-xs text-slate-600">Why, alternatives and data used</summary>
        <div className="mt-2 space-y-2" data-testid="exec-why">
          <p>
            <span className="font-medium">Why: </span>
            {i.reason}
          </p>
          <p>
            <span className="font-medium">Expected value: </span>
            {IMPACT_WORD[i.impact.cls] ?? i.impact.cls}
            {i.expectedValueCents ? ` (${money(i.expectedValueCents)})` : ''}
            {i.impact.atRiskCents > 0 ? `; ${money(i.impact.atRiskCents)} is lost if nothing is done` : ''}
          </p>
          <p>
            <span className="font-medium">Risk: </span>
            {RISK_WORD[i.risk.level]}. {i.risk.note}
          </p>
          {i.alternatives.length > 0 && (
            <div>
              <span className="font-medium">Alternatives:</span>
              <ul className="list-disc pl-5">
                {i.alternatives.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-slate-600">
            <span className="font-medium">Confidence: </span>
            {i.confidence}% · <span className="font-medium">Data used: </span>
            {i.sources.join(', ') || 'your PointWise data'} · <span className="font-medium">Contributing agents: </span>
            {i.agents.map((a) => a.label).join(', ')}
          </p>
          {i.assumptions.length > 0 && <p className="text-xs text-slate-600">Assumes: {i.assumptions.join(' ')}</p>}
        </div>
      </details>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Link href={i.href} className="text-xs text-brand-700 underline">
          Open
        </Link>
        {i.calls.map((c) => (
          <CallButton key={c.id} c={c} />
        ))}
        <Decide id={i.id} />
      </div>
    </li>
  );
}
