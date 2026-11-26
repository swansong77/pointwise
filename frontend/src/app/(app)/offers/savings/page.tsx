'use client';

import { useState } from 'react';
import { BarList, StatTiles, Tabs } from '@/components/charts';
import { EmptyState, ErrorText, PageHeader, Panel, Spinner } from '@/components/ui';
import { money } from '@/lib/format';
import { monthLabel, SavingsLine, SavingsSummary } from '@/lib/offer-dashboards';
import { useAuthedQuery } from '@/lib/queries';

type By = 'card' | 'member' | 'merchant';

const lines = (l: SavingsLine[]) =>
  l
    .filter((x) => x.actualCents + x.expectedCents > 0)
    .map((x) => ({ label: x.label, value: x.actualCents + x.expectedCents, hint: `${money(x.actualCents)} received · ${money(x.expectedCents)} still expected` }));

export default function SavingsPage() {
  const q = useAuthedQuery<SavingsSummary>(['offers', 'savings'], '/offers/intel/savings');
  const [by, setBy] = useState<By>('card');
  if (q.isLoading) return <Spinner label="Loading savings" />;
  if (q.error) return <ErrorText error={q.error} />;
  const d = q.data;
  if (!d) return null;
  const rows = by === 'card' ? lines(d.byCard) : by === 'member' ? lines(d.byMember) : lines(d.byMerchant);
  const months = d.byMonth.map((m) => ({ label: monthLabel(m.month), value: m.actualCents }));
  const hasMonths = months.some((m) => m.value > 0);
  return (
    <div className="space-y-6" data-testid="savings">
      <PageHeader title="Savings" subtitle="What your offers and credits have returned, what is still expected, and how your plans compared." />
      <StatTiles
        testId="savings-totals"
        items={[
          ['Saved so far', money(d.totals.savedCents), `${money(d.totals.actualCents)} offers · ${money(d.totals.creditsThisYearCents)} credits this year`],
          ['Still expected', money(d.totals.expectedCents), 'from offers still earning'],
          ['Missed', money(d.totals.missedCents), 'in the last 12 months'],
          [
            'Plans on target',
            d.plans.hitRate == null ? '—' : `${d.plans.hitRate}%`,
            d.plans.done ? `${d.plans.metCount} of ${d.plans.done} bought plans` : 'mark a plan bought to compare',
          ],
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Where it came from" data-testid="savings-breakdown">
          <Tabs<By>
            label="Group savings by"
            value={by}
            onChange={setBy}
            options={[
              ['card', 'By card'],
              ['member', 'By member'],
              ['merchant', 'By merchant'],
            ]}
          />
          <div className="mt-4">{rows.length === 0 ? <p className="text-sm text-slate-600">No savings yet.</p> : <BarList items={rows} format={money} />}</div>
        </Panel>
        <Panel title="Credit received by month" data-testid="savings-months">
          {hasMonths ? <BarList items={months} format={money} /> : <EmptyState title="No credits received yet">Mark an offer redeemed and the month appears here.</EmptyState>}
          <p className="mt-3 text-xs text-slate-600">Dated by the day the offer was redeemed, or else activated or added.</p>
        </Panel>
      </div>
      {d.plans.done > 0 && (
        <Panel title="Plans against reality" data-testid="savings-plans">
          <p className="text-sm">
            Plans you marked bought expected <strong>{money(d.plans.expectedCents)}</strong> and returned <strong>{money(d.plans.actualCents)}</strong>.
          </p>
        </Panel>
      )}
    </div>
  );
}
