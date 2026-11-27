'use client';

import { useState } from 'react';
import { Badge, Button, ErrorText, Field, Input, Panel, Select, Spinner } from '@/components/ui';
import { Goal, GOAL_KINDS, GoalKind } from '@/lib/copilot';
import { shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

const STATE: Record<Goal['progress']['state'], [string, 'green' | 'amber' | 'red' | 'slate']> = {
  ACHIEVED: ['Reached', 'green'],
  ON_TRACK: ['On track', 'green'],
  AT_RISK: ['At risk', 'amber'],
  BEHIND: ['Behind', 'red'],
  UNKNOWN: ['Not tracked yet', 'slate'],
};

const TARGET_FIELDS: Record<GoalKind, Array<{ key: string; label: string; type: 'text' | 'number'; hint?: string; dollars?: boolean }>> = {
  STATUS: [
    { key: 'program', label: 'Program', type: 'text', hint: 'for example Hyatt' },
    { key: 'level', label: 'Level', type: 'text', hint: 'for example Globalist' },
  ],
  FIVE24: [{ key: 'max', label: 'Stay at or under', type: 'number', hint: 'cards in 24 months, usually 4' }],
  TRIP: [
    { key: 'destination', label: 'Destination', type: 'text' },
    { key: 'pointsNeeded', label: 'Points needed', type: 'number' },
    { key: 'program', label: 'Program (optional)', type: 'text' },
  ],
  CASHBACK: [{ key: 'annualCents', label: 'Cash back a year ($)', type: 'number', dollars: true }],
  FEES: [{ key: 'maxCents', label: 'Annual fees at most ($)', type: 'number', dollars: true }],
  MILES: [
    { key: 'program', label: 'Program', type: 'text' },
    { key: 'points', label: 'Target balance', type: 'number' },
  ],
  CUSTOM: [],
};

function Bar({ pct, label }: { pct: number | null; label: string }) {
  if (pct == null) return null;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="h-full rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
    </div>
  );
}

function GoalRow({ g, onPatch, onRemove }: { g: Goal; onPatch: (id: string, body: Record<string, unknown>) => void; onRemove: (id: string) => void }) {
  const [label, tone] = STATE[g.progress.state];
  return (
    <li className="space-y-2 py-3" data-testid="goal">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 font-medium text-slate-900">{g.title}</p>
        <Badge tone={tone}>{label}</Badge>
        {g.progress.pct != null && <span className="text-sm text-slate-700">{g.progress.pct}%</span>}
      </div>
      <Bar pct={g.progress.pct} label={`Progress: ${g.title}`} />
      <p className="text-sm text-slate-700">
        {g.progress.current} · target {g.progress.target}
        {g.dueAt ? ` · by ${shortDate(g.dueAt)}` : ''}
      </p>
      <p className="text-xs text-slate-600">{g.progress.detail}</p>
      {g.progress.next.length > 0 && <p className="text-xs text-slate-700">Next: {g.progress.next[0]}</p>}
      {g.kind === 'CUSTOM' && g.status === 'ACTIVE' && (
        <label className="flex items-center gap-2 text-xs text-slate-700">
          Progress
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            defaultValue={g.manualProgress ?? 0}
            onMouseUp={(e) => onPatch(g.id, { manualProgress: Number((e.target as HTMLInputElement).value) })}
            onKeyUp={(e) => onPatch(g.id, { manualProgress: Number((e.target as HTMLInputElement).value) })}
            aria-label={`Set progress for ${g.title}`}
          />
        </label>
      )}
      <div className="flex gap-1">
        {g.status === 'ACTIVE' && (
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onPatch(g.id, { status: 'DONE' })} aria-label={`Mark done: ${g.title}`}>
            Done
          </Button>
        )}
        <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onRemove(g.id)} aria-label={`Delete goal: ${g.title}`}>
          Delete
        </Button>
      </div>
    </li>
  );
}

/** What you are working toward, with progress worked out from your own cards, points and status. */
export function GoalsPanel() {
  const q = useAuthedQuery<Goal[]>(['copilot', 'goals'], '/copilot/goals');
  const create = useApiMutation<Record<string, unknown>>((body) => ({ path: '/copilot/goals', method: 'POST', body }), [['copilot']]);
  const patch = useApiMutation<{ id: string; body: Record<string, unknown> }>((v) => ({ path: `/copilot/goals/${v.id}`, method: 'PATCH', body: v.body }), [['copilot']]);
  const remove = useApiMutation<string>((id) => ({ path: `/copilot/goals/${id}`, method: 'DELETE' }), [['copilot']]);
  const [kind, setKind] = useState<GoalKind>('STATUS');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [vals, setVals] = useState<Record<string, string>>({});
  const fields = TARGET_FIELDS[kind];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const target: Record<string, unknown> = {};
    for (const f of fields) {
      const v = (vals[f.key] ?? '').trim();
      if (!v) continue;
      target[f.key] = f.type === 'number' ? (f.dollars ? Math.round(Number(v) * 100) : Number(v)) : v;
    }
    create.mutate(
      { kind, title: title.trim() || GOAL_KINDS.find((k) => k.kind === kind)!.label, target, ...(due ? { dueAt: new Date(due + 'T12:00:00Z').toISOString() } : {}) },
      {
        onSuccess: () => {
          setTitle('');
          setVals({});
          setDue('');
        },
      },
    );
  };

  return (
    <Panel title="Goals" data-testid="goals-panel">
      <div id="goals" />
      {!q.data ? (
        <Spinner />
      ) : q.data.length === 0 ? (
        <p className="text-sm text-slate-600" data-testid="goals-empty">
          No goals yet. Add one below, such as earning Hyatt Globalist, staying under 5/24 or saving points for Korea. Progress is worked out from your own data.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100" data-testid="goal-list">
          {q.data.map((g) => (
            <GoalRow key={g.id} g={g} onPatch={(id, body) => patch.mutate({ id, body })} onRemove={(id) => window.confirm('Delete this goal?') && remove.mutate(id)} />
          ))}
        </ul>
      )}

      <form onSubmit={submit} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2" aria-label="Add a goal" data-testid="goal-form">
        <Field label="Goal type" htmlFor="goal-kind">
          <Select id="goal-kind" value={kind} onChange={(e) => (setKind(e.target.value as GoalKind), setVals({}))}>
            {GOAL_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name it" htmlFor="goal-title">
          <Input id="goal-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="for example Hyatt Globalist" />
        </Field>
        {fields.map((f) => (
          <Field key={f.key} label={f.label} htmlFor={`goal-${f.key}`} hint={f.hint}>
            <Input
              id={`goal-${f.key}`}
              type={f.type}
              min={f.type === 'number' ? 0 : undefined}
              value={vals[f.key] ?? ''}
              onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })}
            />
          </Field>
        ))}
        <Field label="By when (optional)" htmlFor="goal-due">
          <Input id="goal-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={create.isPending}>
            Add goal
          </Button>
        </div>
      </form>
      <ErrorText error={create.error || patch.error || remove.error} />
    </Panel>
  );
}
