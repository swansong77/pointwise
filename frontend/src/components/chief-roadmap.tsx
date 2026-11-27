'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Panel, Spinner } from '@/components/ui';
import { RoadmapData } from '@/lib/chief';
import { money, shortDate } from '@/lib/format';
import { useAuthedQuery } from '@/lib/queries';

/** The phases and focus areas of a roadmap. Used on the Chief of Staff page and for strategic questions in AI Mode. */
export function RoadmapView({ r }: { r: RoadmapData }) {
  return (
    <div className="space-y-4" data-testid="roadmap-view">
      <p className="text-sm font-medium text-slate-900" data-testid="roadmap-headline">
        {r.headline}
      </p>
      {r.focus.length > 0 && (
        <section aria-label="Where to focus" data-testid="roadmap-focus">
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Where to focus</h4>
          <ol className="grid gap-2 md:grid-cols-3">
            {r.focus.map((f, n) => (
              <li key={f.area} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-sm font-medium text-slate-900">
                  {n + 1}. {f.label}
                </p>
                <p className="text-xs text-slate-600">
                  {f.events} thing{f.events === 1 ? '' : 's'} · about {money(f.valueCents)}
                </p>
                <p className="mt-1 text-xs text-slate-700">{f.advice}</p>
              </li>
            ))}
          </ol>
        </section>
      )}
      {r.phases.map((p) => (
        <section key={p.label} aria-label={p.label} data-testid="roadmap-phase">
          <h4 className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
            {p.label}
            <span className="font-normal normal-case text-slate-500">
              {shortDate(p.from)} to {shortDate(p.to)}
            </span>
            {p.atRiskCents > 0 && <Badge tone="amber">{money(p.atRiskCents)} at risk</Badge>}
          </h4>
          {p.events.length === 0 ? (
            <p className="text-sm text-slate-600">Nothing scheduled.</p>
          ) : (
            <ul className="space-y-1">
              {p.events.map((e, i) => (
                <li key={p.label + i} className="flex flex-wrap items-baseline gap-2 text-sm" data-testid="roadmap-event">
                  <span className="w-24 shrink-0 text-xs text-slate-600">{shortDate(e.date)}</span>
                  <Link href={e.href} className="min-w-0 flex-1 text-slate-900 underline-offset-2 hover:underline">
                    {e.title}
                  </Link>
                  {e.valueCents > 0 && <span className="text-xs text-slate-600">{money(e.valueCents)}</span>}
                  {e.atRisk && <span className="text-xs text-amber-800">lost if missed</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

/** The next 90 days or the year ahead, as a timeline of what is coming. */
export function ChiefRoadmap() {
  const [days, setDays] = useState<90 | 365>(90);
  const q = useAuthedQuery<RoadmapData>(['chief', 'roadmap', days], '/chief/roadmap?days=' + days);
  return (
    <Panel title="Roadmap" data-testid="chief-roadmap">
      <div id="roadmap" />
      <div role="group" aria-label="How far ahead" className="mb-3 flex gap-2">
        {([90, 365] as const).map((d) => (
          <button
            key={d}
            type="button"
            aria-pressed={days === d}
            onClick={() => setDays(d)}
            data-testid={'roadmap-' + d}
            className={
              'rounded-full px-3 py-1 text-sm font-medium ring-1 focus-visible:ring-2 focus-visible:ring-brand-500 ' +
              (days === d ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50')
            }
          >
            {d === 90 ? 'Next 90 days' : 'This year'}
          </button>
        ))}
      </div>
      {q.isLoading || !q.data ? <Spinner label="Building the roadmap" /> : <RoadmapView r={q.data} />}
    </Panel>
  );
}
