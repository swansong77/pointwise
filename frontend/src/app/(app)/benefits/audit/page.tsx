'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Badge, EmptyState, ErrorText, PageHeader, Panel, ProgressBar, Spinner, Button, Select } from '@/components/ui';
import { shortDate, money } from '@/lib/format';
import { useAuthedQuery, useApiMutation } from '@/lib/queries';
import { accountLabel, AuditResponse, LEVELS, Level, METHOD_LABEL, RollupResponse } from '@/lib/benefit-audit';

const KEY = ['benefit-audit'] as const;

export default function BenefitAuditPage() {
  const audit = useAuthedQuery<AuditResponse>([...KEY, 'audit'], '/benefit-audit');
  const [level, setLevel] = useState<Level>('account');
  const roll = useAuthedQuery<RollupResponse>([...KEY, 'rollup', level], `/benefit-audit/rollup?level=${level}`);
  const decide = useApiMutation<{ id: string; decision: 'ACCEPT' | 'REJECT' }>(
    ({ id, decision }) => ({ path: `/benefit-audit/detections/${id}`, method: 'PATCH', body: { decision } }),
    [KEY, ['benefits'], ['spending']],
  );
  const [open, setOpen] = useState<string | null>(null);
  const s = audit.data?.summary;

  return (
    <div className="space-y-6" data-testid="benefit-audit">
      <PageHeader
        title="Benefit audit"
        subtitle="Every credit detected on every card account, how it was matched, and the statement it came from."
        action={
          <Link href="/benefits/reconciliation" className="text-sm text-brand-700 hover:underline">
            Reconciliation →
          </Link>
        }
      />
      {audit.isLoading && <Spinner />}
      <ErrorText error={audit.error} />

      {s && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-testid="audit-summary">
          {[
            ['Benefits tracked', s.benefits],
            ['Detected', s.detected],
            ['Needs review', s.needsReview],
            ['Manual overrides', s.overrides],
            ['Unmatched credits', s.missedTransactions],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl border border-slate-200 bg-white p-3">
              <dt className="text-xs text-slate-500">{k}</dt>
              <dd className="text-xl font-semibold">{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <Panel
        title="Utilization"
        action={
          <Select aria-label="Level" value={level} onChange={(e) => setLevel(e.target.value as Level)} data-testid="level-select">
            {LEVELS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        }
      >
        {roll.isLoading && <Spinner />}
        <ul className="space-y-3" data-testid="rollup-list">
          {roll.data?.groups.map((g) => (
            <li key={g.key} data-testid="rollup-group">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{g.label}</span>
                <span className="text-slate-600">
                  {money(g.usedCents)} of {money(g.allocatedCents)} · {g.accounts} account{g.accounts === 1 ? '' : 's'}
                </span>
              </div>
              <ProgressBar value={g.utilizationPct} label={`${g.label} utilization`} />
            </li>
          ))}
        </ul>
        {roll.data && !roll.data.groups.length && <EmptyState title="No tracked benefits yet" />}
      </Panel>

      <Panel title="By card account and benefit">
        {audit.data && !audit.data.items.length && <EmptyState title="Nothing to audit yet">Add a card with benefits, then import a statement.</EmptyState>}
        <ul className="divide-y divide-slate-100" data-testid="audit-list">
          {audit.data?.items.map((i) => (
            <li key={i.benefitId} className="py-3" data-testid="audit-item">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{i.benefitName}</span>
                <span className="text-slate-600">{accountLabel(i)}</span>
                <Badge tone="slate">{i.frequency}</Badge>
                <Badge tone={i.verificationStatus === 'VERIFIED' ? 'green' : i.verificationStatus === 'NONE' ? 'slate' : 'amber'}>
                  {i.verificationStatus === 'NONE' ? 'No usage' : i.verificationStatus === 'VERIFIED' ? 'Verified' : 'Unverified'}
                </Badge>
                <span className="ml-auto text-slate-600">
                  {money(i.usedCents)} / {money(i.allocatedCents)} ({i.utilizationPct}%)
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {i.detected} detected · {i.matched} matched · {i.missed} unmatched credits on this card · {i.manualOverrides} manual override
                {i.manualOverrides === 1 ? '' : 's'} · period ends {shortDate(i.periodEnd)}
              </p>
              {i.detections.length > 0 && (
                <button className="mt-1 text-xs text-brand-700 hover:underline" onClick={() => setOpen(open === i.benefitId ? null : i.benefitId)}>
                  {open === i.benefitId ? 'Hide evidence' : 'Show evidence'}
                </button>
              )}
              {open === i.benefitId && (
                <ul className="mt-2 space-y-2" data-testid="evidence-list">
                  {i.detections.map((d) => (
                    <li key={d.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm" data-testid="detection">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{d.transaction?.description ?? 'Transaction'}</span>
                        {d.transaction && <span className="text-slate-600">{money(d.transaction.amountCents)} · {shortDate(d.transaction.occurredAt)}</span>}
                        <Badge tone={d.tier === 'ASSIGN' ? 'green' : 'amber'}>
                          {METHOD_LABEL[d.method] ?? d.method} · {d.confidence}%
                        </Badge>
                        {d.duplicateRisk && <Badge tone="amber">Duplicate risk</Badge>}
                        {d.status !== 'DETECTED' && <Badge tone={d.status === 'ACCEPTED' ? 'green' : 'red'}>{d.status === 'ACCEPTED' ? 'You accepted' : 'You rejected'}</Badge>}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">
                        Matched on “{d.rule}”
                        {d.statement && ` · from a ${d.statement.format.toUpperCase()} statement imported ${shortDate(d.statement.createdAt)}`}
                        {d.aiReasoning && ` · AI reasoning: ${d.aiReasoning}`}
                      </p>
                      {d.status === 'DETECTED' && (
                        <div className="mt-2 flex gap-2">
                          <Button variant="secondary" onClick={() => decide.mutate({ id: d.id, decision: 'ACCEPT' })} loading={decide.isPending}>
                            Correct
                          </Button>
                          <Button variant="ghost" onClick={() => decide.mutate({ id: d.id, decision: 'REJECT' })} loading={decide.isPending}>
                            Not this benefit
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
        <ErrorText error={decide.error} />
      </Panel>

      {audit.data && audit.data.missedTransactions.length > 0 && (
        <Panel title="Credits that matched no benefit">
          <ul className="divide-y divide-slate-100 text-sm" data-testid="missed-list">
            {audit.data.missedTransactions.slice(0, 20).map((t) => (
              <li key={t.id} className="flex justify-between py-2">
                <span>{t.description}</span>
                <span className="text-slate-600">
                  {money(t.amountCents)} · {shortDate(t.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
