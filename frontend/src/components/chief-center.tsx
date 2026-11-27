'use client';

import { useState } from 'react';
import { ExecItemCard } from '@/components/exec-item';
import { Badge, Panel, Spinner } from '@/components/ui';
import { CenterKey, CenterList, ChiefOverview } from '@/lib/chief';
import { money } from '@/lib/format';
import { useAuthedQuery } from '@/lib/queries';

function Tile({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid={testId}>
      <p className="text-xs text-slate-600">{label}</p>
      <p className="mt-1 text-xl font-semibold text-slate-900">{value}</p>
    </div>
  );
}

/** Top ten actions, the Action Center by horizon, and what has been lost or can still be saved. */
export function ChiefCenter() {
  const o = useAuthedQuery<ChiefOverview>(['chief', 'overview'], '/chief/overview');
  const actions = useAuthedQuery<CenterList[]>(['chief', 'actions'], '/chief/actions');
  const [tab, setTab] = useState<CenterKey>('TODAY');
  if (o.isLoading) return <Spinner label="Preparing your briefing" />;
  const d = o.data;
  if (!d) return null;
  const s = d.summary;
  const list = actions.data?.find((h) => h.key === tab);
  return (
    <div className="space-y-6" data-testid="chief-center">
      <section aria-label="Today at a glance" className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900" data-testid="chief-greeting">
          {d.greeting} {s.highPriority ? `You have ${s.highPriority} high-priority action${s.highPriority === 1 ? '' : 's'}.` : 'Nothing urgent today.'}
        </h2>
        <p className="mt-1 text-xs text-slate-600">
          {s.totalActions} items ranked from everything PointWise knows about your cards, offers, points and certificates. Confidence {d.confidence}%.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Value at risk" value={money(s.valueAtRiskCents)} testId="tile-risk" />
          <Tile label="Points at risk" value={s.pointsAtRisk.toLocaleString('en-US')} testId="tile-points" />
          <Tile label="Certificates expiring" value={String(s.certificatesExpiring)} testId="tile-certs" />
          <Tile label="New high-value offers" value={String(s.newHighValueOffers)} testId="tile-offers" />
        </div>
      </section>

      <Panel title="Top 10 actions" data-testid="chief-top">
        {d.top.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing needs your attention. Check back tomorrow.</p>
        ) : (
          <ol className="space-y-2" data-testid="chief-top-list">
            {d.top.map((i, n) => (
              <ExecItemCard key={i.id} i={i} rank={n + 1} />
            ))}
          </ol>
        )}
        {d.hidden > 0 && (
          <p className="mt-2 text-xs text-slate-600">
            {d.hidden} item{d.hidden === 1 ? '' : 's'} you put aside {d.hidden === 1 ? 'is' : 'are'} hidden.
          </p>
        )}
      </Panel>

      <Panel title="Action Center" data-testid="chief-actions">
        <div role="group" aria-label="When" className="flex flex-wrap gap-2">
          {d.center.map((h) => (
            <button
              key={h.key}
              type="button"
              aria-pressed={h.key === tab}
              onClick={() => setTab(h.key)}
              data-testid={`center-tab-${h.key.toLowerCase()}`}
              className={`rounded-full px-3 py-1 text-sm font-medium ring-1 focus-visible:ring-2 focus-visible:ring-brand-500 ${h.key === tab ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
            >
              {h.label} <span className="ml-1 text-xs opacity-80">{h.count}</span>
            </button>
          ))}
        </div>
        <div className="mt-3" data-testid="center-list">
          {!actions.data ? (
            <Spinner />
          ) : list && list.items.length > 0 ? (
            <ul className="space-y-2">
              {list.items.map((i) => (
                <ExecItemCard key={i.id} i={i} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600" data-testid="center-empty">
              Nothing here.
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Value recovery" data-testid="chief-recovery">
        <div id="recovery" />
        <p className="text-sm font-medium text-slate-900" data-testid="recovery-headline">
          {d.recovery.headline}
        </p>
        {d.recovery.recoveredCents > 0 && <p className="text-xs text-slate-600">You have already saved {money(d.recovery.recoveredCents)} that was at risk.</p>}
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Lost so far</h3>
            {d.recovery.lines.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">Nothing lost.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm" data-testid="recovery-lost">
                {d.recovery.lines.map((l) => (
                  <li key={l.label} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate">{l.label}</span>
                    <span className="font-medium">{money(l.cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Can still be saved</h3>
            {d.recovery.recoverable.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">Nothing is at risk.</p>
            ) : (
              <ul className="mt-1 space-y-1 text-sm" data-testid="recovery-recoverable">
                {d.recovery.recoverable.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <a href={r.href} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                      {r.title}
                    </a>
                    <Badge tone={r.band === 'CRITICAL' ? 'red' : r.band === 'HIGH' ? 'amber' : 'slate'}>{money(r.cents)}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
