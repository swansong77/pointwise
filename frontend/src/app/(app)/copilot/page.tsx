'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PlanView } from '@/components/plan-view';
import { Button, ErrorText, Field, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { useApi, json } from '@/lib/api';
import { CopilotResponse, CopilotSettings } from '@/lib/copilot';
import { useAuthedQuery } from '@/lib/queries';
import { useMutation } from '@tanstack/react-query';

const QUICK = [
  ['Today', 'What should I do today?'],
  ['This week', 'What should I do this week?'],
  ['This month', 'What should I do this month?'],
] as const;

/** The Copilot: ask for a plan or a specific question; every reply says why, how sure it is and what it assumed. */
export default function CopilotPage() {
  const api = useApi();
  const settings = useAuthedQuery<CopilotSettings>(['copilot', 'settings'], '/copilot/settings');
  const [q, setQ] = useState('');
  const [mode, setMode] = useState('');
  const [res, setRes] = useState<CopilotResponse | null>(null);
  const session = { current: res?.sessionId ?? null };
  const ask = useMutation({
    mutationFn: (question: string) =>
      api<CopilotResponse>('/copilot/ask', { method: 'POST', ...json({ q: question, ...(mode ? { mode } : {}), ...(session.current ? { sessionId: session.current } : {}) }) }),
    onSuccess: setRes,
  });
  const go = (question: string) => {
    const t = question.trim();
    if (!t) return;
    setQ(t);
    ask.mutate(t);
  };
  if (!settings.data) return <Spinner label="Loading Copilot" />;
  const modes = settings.data.modes;
  return (
    <div className="space-y-6" data-testid="copilot-page">
      <PageHeader
        title="Copilot"
        subtitle="Your rewards strategist: it reads your offers, credits, points, certificates and cards and tells you what to do next, with the reason and how sure it is. It never applies, transfers, books or cancels anything."
        action={
          <Link href="/settings#copilot" className="text-sm text-brand-700 underline">
            AI Mode settings
          </Link>
        }
      />
      <Panel title="What should I do?">
        <div className="flex flex-wrap gap-2" data-testid="copilot-quick">
          {QUICK.map(([label, question]) => (
            <Button key={label} variant="secondary" onClick={() => go(question)} disabled={ask.isPending}>
              {label}
            </Button>
          ))}
        </div>
        <form
          className="mt-4 grid gap-3 sm:grid-cols-[1fr,12rem,auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            go(q);
          }}
        >
          <Field label="Ask" htmlFor="cp-q">
            <input
              id="cp-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              maxLength={300}
              placeholder="What card should I use for a $1,300 Hilton stay?"
              className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </Field>
          <Field label="Mode" htmlFor="cp-run-mode">
            <Select id="cp-run-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="">Default ({modes.find((m) => m.key === settings.data!.mode)?.label})</option>
              {modes.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button type="submit" disabled={ask.isPending || !q.trim()}>
            Ask
          </Button>
        </form>
      </Panel>
      {ask.isPending && <Spinner label="Working on it" />}
      <ErrorText error={ask.error} />
      {res && !ask.isPending && (
        <Panel title={res.plan.kind === 'AGENDA' ? 'Your plan' : 'Answer'}>
          <PlanView r={res} />
        </Panel>
      )}
    </div>
  );
}
