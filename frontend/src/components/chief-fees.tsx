'use client';

import { Badge, Panel, Spinner } from '@/components/ui';
import { FEE_VERDICT_LABEL, FEE_VERDICT_TONE, FeeReview } from '@/lib/chief';
import { money } from '@/lib/format';
import { useAuthedQuery } from '@/lib/queries';

/** Every card: keep, retention call, product change, downgrade, replace or cancel, with the reason in dollars. It recommends; you decide. */
export function ChiefFees() {
  const q = useAuthedQuery<FeeReview>(['chief', 'fees'], '/chief/fee-review');
  if (q.isLoading) return <Spinner label="Reviewing your cards" />;
  const d = q.data;
  if (!d) return null;
  return (
    <Panel title="Annual fee review board" data-testid="chief-fees">
      <div id="fees" />
      {d.verdicts.length === 0 ? (
        <p className="text-sm text-slate-600">No cards to review yet.</p>
      ) : (
        <>
          <p className="text-sm text-slate-700" data-testid="fees-summary">
            {d.totals.cards} card{d.totals.cards === 1 ? '' : 's'} paid {money(d.totals.feesCents)} in fees and returned {money(d.totals.valueCents)} over 12 months.
            {d.totals.impactCents > 0 ? ` Acting on the recommendations below is worth about ${money(d.totals.impactCents)} a year.` : ' Every card earns its place.'}
          </p>
          <ul className="mt-3 space-y-3" data-testid="fees-list">
            {d.verdicts.map((v) => (
              <li key={v.card} className="rounded-lg border border-slate-200 bg-white p-3" data-testid="fee-verdict">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 font-medium text-slate-900">
                    {v.card}
                    {v.member && <span className="ml-2 text-xs font-normal text-slate-600">{v.member}</span>}
                  </p>
                  <Badge tone={FEE_VERDICT_TONE[v.verdict]}>
                    <span className="sr-only">Recommendation: </span>
                    {FEE_VERDICT_LABEL[v.verdict]}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-slate-800">{v.justification}</p>
                <dl className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-700">
                  <div>
                    <dt className="inline text-slate-600">Net per year </dt>
                    <dd className="inline font-medium">{money(v.netCents)}</dd>
                  </div>
                  {v.impactCents > 0 && (
                    <div>
                      <dt className="inline text-slate-600">Worth acting on </dt>
                      <dd className="inline font-medium">{money(v.impactCents)} a year</dd>
                    </div>
                  )}
                  {v.daysToRenewal != null && (
                    <div>
                      <dt className="inline text-slate-600">Renews in </dt>
                      <dd className="inline font-medium">{v.daysToRenewal} days</dd>
                    </div>
                  )}
                  <div>
                    <dt className="inline text-slate-600">Confidence </dt>
                    <dd className="inline font-medium">{v.confidence}%</dd>
                  </div>
                </dl>
                {v.alternatives.length > 0 && (
                  <details className="mt-1 text-xs text-slate-700">
                    <summary className="cursor-pointer text-slate-600">Alternatives and evidence</summary>
                    <ul className="mt-1 list-disc pl-5">
                      {v.alternatives.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                    <p className="mt-1 text-slate-600">Evidence: {v.evidence.join(' · ')}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
