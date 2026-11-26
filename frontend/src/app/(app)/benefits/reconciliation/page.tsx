'use client';

import Link from 'next/link';
import { Badge, EmptyState, ErrorText, PageHeader, Panel, Spinner } from '@/components/ui';
import { money } from '@/lib/format';
import { useAuthedQuery } from '@/lib/queries';
import { accountLabel, ReconcileRow, ReconciliationResponse } from '@/lib/benefit-audit';

function Table({ rows, testid, empty }: { rows: ReconcileRow[]; testid: string; empty: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100 text-sm" data-testid={testid}>
      {rows.map((r) => (
        <li key={r.benefitId} className="flex flex-wrap items-center gap-2 py-2" data-testid={`${testid}-row`}>
          <span className="font-medium">{r.benefitName}</span>
          <span className="text-slate-600">{accountLabel(r)}</span>
          <Badge tone="slate">{r.frequency}</Badge>
          <span className="ml-auto text-slate-600">
            expected {money(r.expectedCents)} · detected {money(r.detectedCents)}
            {r.pendingCents > 0 && ` · pending ${money(r.pendingCents)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function ReconciliationPage() {
  const q = useAuthedQuery<ReconciliationResponse>(['benefit-audit', 'reconciliation'], '/benefit-audit/reconciliation');
  const t = q.data?.totals;
  return (
    <div className="space-y-6" data-testid="reconciliation">
      <PageHeader
        title="Benefit reconciliation"
        subtitle="What each card account should have earned this benefit year, what was found on statements, and what is left."
        action={
          <Link href="/benefits/audit" className="text-sm text-brand-700 hover:underline">
            Audit →
          </Link>
        }
      />
      {q.isLoading && <Spinner />}
      <ErrorText error={q.error} />
      {t && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-6" data-testid="recon-totals">
          {[
            ['Expected credits', t.expectedCents],
            ['Detected credits', t.detectedCents],
            ['Waiting for credit', t.pendingCents],
            ['Missing credits', t.missingCents],
            ['Expired', t.expiredCents],
            ['Unused now', t.unusedCents],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl border border-slate-200 bg-white p-3">
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd className="text-lg font-semibold">{money(v as number)}</dd>
            </div>
          ))}
        </dl>
      )}
      {q.data && !q.data.rows.length && <EmptyState title="No benefits to reconcile">Add a card with benefits to start tracking.</EmptyState>}
      {q.data && q.data.rows.length > 0 && (
        <>
          <Panel title="Suggested actions">
            {q.data.actions.length === 0 ? (
              <p className="text-sm text-slate-500">Everything is on track.</p>
            ) : (
              <ul className="space-y-2 text-sm" data-testid="actions">
                {q.data.actions.map((a) => (
                  <li key={a.benefitId} data-testid="action">
                    <span className="font-medium">{a.benefit}</span> <span className="text-slate-600">on {accountLabel({ card: a.card, lastFour: a.lastFour, cardholder: a.cardholder })}:</span> {a.suggestion}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Potential missed benefits">
            <Table rows={q.data.potentialMissed} testid="potential" empty="No benefits at risk right now." />
          </Panel>
          <Panel title="Unused benefits">
            <Table rows={q.data.unused} testid="unused" empty="Every benefit has some use." />
          </Panel>
          <Panel title="Expired benefits">
            <Table rows={q.data.expired} testid="expired" empty="Nothing has expired." />
          </Panel>
          <Panel title="All benefits by card account">
            <Table rows={q.data.rows} testid="all" empty="" />
          </Panel>
        </>
      )}
    </div>
  );
}
