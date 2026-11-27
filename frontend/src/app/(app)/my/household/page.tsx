'use client';

import Link from 'next/link';
import { StatTiles } from '@/components/charts';
import { Badge, EmptyState, ErrorText, PageHeader, Panel, Spinner } from '@/components/ui';
import { money } from '@/lib/format';
import { RELATIONSHIP_LABEL } from '@/lib/portfolio';
import type { HouseholdDashboard } from '@/lib/portfolio-types';
import { useAuthedQuery } from '@/lib/queries';

/** The household overview, read only, for a member the owner chose to share it with. */
export default function MyHouseholdPage() {
  const q = useAuthedQuery<HouseholdDashboard>(['member', 'household'], '/member/household');
  if (q.isLoading) return <Spinner label="Loading household" />;
  if (q.error) {
    return (
      <div className="space-y-3">
        <ErrorText error={q.error} />
        <Link href="/my" className="text-sm font-medium text-brand-700 hover:underline">
          Back to my view
        </Link>
      </div>
    );
  }
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-6">
      <PageHeader title={d.household.name} subtitle="Everyone's cards in one place. Read only." />
      <StatTiles
        testId="my-household-totals"
        items={[
          ['Members', String(d.members.length)],
          ['Annual fees', money(d.totals.annualFeeCents)],
          ['Benefit value', money(d.totals.faceBenefitCents), `${money(d.totals.realizedBenefitCents)} used`],
          ['Effective value', money(d.totals.effectiveValueCents), 'benefits used + rewards − fees'],
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {d.members.map((m) => (
          <Panel
            key={m.profile.id}
            title={
              <span className="flex items-center gap-2">
                {m.profile.nickname} <Badge>{RELATIONSHIP_LABEL[m.profile.relationship]}</Badge>
              </span>
            }
            data-testid="my-household-member"
          >
            {m.cards.length === 0 ? (
              <EmptyState title="No cards yet" />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {m.cards.map((c) => (
                  <li key={c.walletCardId} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span className="tabular-nums text-slate-600">{money(c.annualFeeCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>
    </div>
  );
}
