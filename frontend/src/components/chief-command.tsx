'use client';

import Link from 'next/link';
import { ExecItemCard } from '@/components/exec-item';
import { Badge, Panel, Spinner } from '@/components/ui';
import { CommandCenterData, ExecItem, GRADE_LABEL, GRADE_TONE } from '@/lib/chief';
import { money } from '@/lib/format';
import { useAuthedQuery } from '@/lib/queries';

const VALUES: Array<[keyof CommandCenterData['values'], string]> = [
  ['totalHouseholdCents', 'Total household value'],
  ['pointsCents', 'Points value'],
  ['benefitsCents', 'Benefits used (12 months)'],
  ['certificatesCents', 'Certificate value'],
  ['travelCreditsCents', 'Unused card credits'],
  ['offersAvailableCents', 'Offers available'],
  ['expiringAssetsCents', 'Expiring assets'],
  ['recentSavingsCents', 'Saved this month'],
  ['projectedSavingsCents', 'Projected savings (rest of year)'],
];

function List({ items, empty, testId }: { items: ExecItem[]; empty: string; testId: string }) {
  if (items.length === 0) return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <ul className="space-y-2" data-testid={testId}>
      {items.map((i) => (
        <ExecItemCard key={i.id} i={i} />
      ))}
    </ul>
  );
}

/** The executive dashboard: what the household is worth, five scores with their reasons, the year's outlook, the biggest risks and chances. */
export function ChiefCommand() {
  const q = useAuthedQuery<CommandCenterData>(['chief', 'command'], '/chief/command-center');
  if (q.isLoading) return <Spinner label="Loading the command center" />;
  const d = q.data;
  if (!d) return null;
  const o = d.outlook;
  return (
    <div className="space-y-6" data-testid="chief-command">
      <section aria-label="Household value" data-testid="cmd-values">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          {VALUES.map(([k, label]) => (
            <div key={k} className="rounded-xl border border-slate-200 bg-white p-3" data-testid={`val-${k}`}>
              <p className="text-xs text-slate-600">{label}</p>
              <p className="mt-1 text-lg font-semibold text-slate-900">{money(d.values[k])}</p>
            </div>
          ))}
          <div className="rounded-xl border border-slate-200 bg-white p-3" data-testid="val-opportunities">
            <p className="text-xs text-slate-600">Current opportunities</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">{d.values.opportunitiesCount}</p>
            <p className="text-xs text-slate-600">worth about {money(d.values.opportunitiesCents)}</p>
          </div>
        </div>
      </section>

      <Panel title="Scores" data-testid="cmd-scores">
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {d.scores.map((s) => (
            <li key={s.key} className="rounded-lg border border-slate-200 bg-white p-3" data-testid={`score-${s.key.toLowerCase()}`}>
              <div className="flex items-center gap-2">
                <Link href={s.href} className="min-w-0 flex-1 font-medium text-slate-900 underline-offset-2 hover:underline">
                  {s.label}
                </Link>
                <span className="text-xl font-semibold text-slate-900">{s.score}</span>
                <Badge tone={GRADE_TONE[s.grade]}>{GRADE_LABEL[s.grade]}</Badge>
              </div>
              <div
                className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={s.score}
                aria-label={`${s.label} score`}
              >
                <div className="h-full rounded-full bg-brand-600" style={{ width: `${s.score}%` }} />
              </div>
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-slate-700">
                {s.reasons.slice(0, 3).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Annual outlook" data-testid="cmd-outlook">
        <p className="text-2xl font-semibold text-slate-900" data-testid="outlook-net">
          {money(o.netCents)} <span className="text-sm font-normal text-slate-600">expected this year</span>
        </p>
        <p className="text-sm text-slate-700">
          Likely range {money(o.lowCents)} to {money(o.highCents)}. {money(o.realizedYtdCents)} realized so far, about {money(o.projectedAdditionalCents)} still to come, less{' '}
          {money(o.feesRemainingCents)} in fees still to post. Confidence {o.confidence}%.
        </p>
        <details className="mt-2 text-xs text-slate-600">
          <summary className="cursor-pointer">What this assumes</summary>
          <ul className="mt-1 list-disc pl-5">
            {o.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Top risks" data-testid="cmd-risks">
          <List items={d.risks} empty="Nothing is at risk." testId="risk-list" />
        </Panel>
        <Panel title="Top opportunities" data-testid="cmd-opportunities">
          <List items={d.opportunities} empty="No opportunities right now." testId="opportunity-list" />
        </Panel>
      </div>
    </div>
  );
}
