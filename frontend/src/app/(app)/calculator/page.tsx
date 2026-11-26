'use client';

import { useMemo, useState } from 'react';
import { Badge, Button, ErrorText, Field, Input, Panel, PageHeader, Select, Spinner } from '@/components/ui';
import { categoryEmoji } from '@/components/card-bits';
import { useApiMutation, useCardSearch, useCategories, useSubscription } from '@/lib/queries';
import { centsPerDollar, dollarsToCents, money } from '@/lib/format';

interface CalcCategory {
  categoryId: string;
  annualSpendCents: number;
  bestCardName: string | null;
  centsPerDollar: number;
  rewardsCents: number;
}
interface CalcResult {
  categories: CalcCategory[];
  grossRewardsCents: number;
  annualFeesCents: number;
  netValueCents: number;
}
type Response = { result?: CalcResult; comparison?: { current: CalcResult; withCandidate: CalcResult; incrementalValueCents: number; firstYearValueCents: number } };

const DEFAULTS: Record<string, string> = { dining: '4800', groceries: '7200', gas: '2400', travel: '3000', 'online-shopping': '3600', 'everything-else': '12000' };

export default function CalculatorPage() {
  const categories = useCategories();
  const sub = useSubscription();
  const cards = useCardSearch('');
  const [spend, setSpend] = useState<Record<string, string>>({});
  const [candidate, setCandidate] = useState('');
  const calc = useApiMutation<void, Response>(() => ({
    path: '/calculator',
    method: 'POST',
    body: {
      spend: lines,
      ...(candidate ? { candidateCardId: candidate } : {}),
    },
  }));

  const values = useMemo(() => {
    const out: Record<string, string> = {};
    for (const c of categories.data ?? []) out[c.id] = spend[c.id] ?? DEFAULTS[c.slug] ?? '';
    return out;
  }, [categories.data, spend]);
  const lines = Object.entries(values)
    .map(([categoryId, v]) => ({ categoryId, annualSpendCents: v ? dollarsToCents(v) : 0 }))
    .filter((l): l is { categoryId: string; annualSpendCents: number } => l.annualSpendCents != null && l.annualSpendCents > 0);
  const invalid = Object.values(values).some((v) => v !== '' && dollarsToCents(v) == null);
  const name = (id: string) => categories.data?.find((c) => c.id === id)?.name ?? id;
  const result = calc.data?.result ?? calc.data?.comparison?.withCandidate;
  const canCompare = sub.data?.limits.calculatorCompare;

  if (categories.isLoading) return <Spinner />;

  return (
    <div className="space-y-6">
      <PageHeader title="Reward calculator" subtitle="Estimate a year of rewards from your wallet, and see what a new card would add." />
      <Panel title="Annual spending">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            calc.mutate(undefined);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.data?.map((c) => (
              <Field key={c.id} label={`${categoryEmoji(c.icon)} ${c.name}`} htmlFor={`spend-${c.slug}`}>
                <Input id={`spend-${c.slug}`} inputMode="decimal" placeholder="$0" value={values[c.id] ?? ''} onChange={(e) => setSpend({ ...spend, [c.id]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Field label="Compare a new card (Pro)" htmlFor="candidate" hint={canCompare ? undefined : 'Upgrade to Pro to compare cards.'}>
            <Select id="candidate" value={candidate} disabled={!canCompare} onChange={(e) => setCandidate(e.target.value)}>
              <option value="">— none —</option>
              {cards.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          {invalid && <p className="text-sm text-red-600">Enter dollar amounts like 1200 or 1,200.50</p>}
          <Button type="submit" disabled={invalid || lines.length === 0} loading={calc.isPending} data-testid="calculate">
            Calculate
          </Button>
          <ErrorText error={calc.error} />
        </form>
      </Panel>

      {result && (
        <Panel title="Results" data-testid="calc-results">
          <div className="mb-4 grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs uppercase text-slate-500">Rewards</p>
              <p className="text-xl font-semibold" data-testid="gross">{money(result.grossRewardsCents)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Annual fees</p>
              <p className="text-xl font-semibold">−{money(result.annualFeesCents)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-slate-500">Net value</p>
              <p className="text-xl font-semibold text-emerald-700" data-testid="net">{money(result.netValueCents)}</p>
            </div>
          </div>
          {calc.data?.comparison && (
            <p className="mb-4 rounded-lg bg-brand-50 p-3 text-sm text-brand-900" data-testid="comparison">
              Adding this card changes your yearly value by <strong>{money(calc.data.comparison.incrementalValueCents)}</strong>; first-year value including the welcome bonus:{' '}
              <strong>{money(calc.data.comparison.firstYearValueCents)}</strong>.
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500">
                <th className="py-2">Category</th>
                <th>Spend</th>
                <th>Best card</th>
                <th>Rate</th>
                <th className="text-right">Rewards</th>
              </tr>
            </thead>
            <tbody>
              {result.categories.map((c) => (
                <tr key={c.categoryId} className="border-b border-slate-100">
                  <td className="py-2">{name(c.categoryId)}</td>
                  <td>{money(c.annualSpendCents)}</td>
                  <td>{c.bestCardName ?? <Badge>none</Badge>}</td>
                  <td>{centsPerDollar(c.centsPerDollar)}</td>
                  <td className="text-right font-medium">{money(c.rewardsCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
