'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, ErrorText, Field, Input, Panel, Spinner } from '@/components/ui';
import { MemoryRow, Preferences, PRIORITIES } from '@/lib/copilot';
import { shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

const LISTS = [
  ['airlines', 'Airlines you prefer', 'Delta, United'],
  ['hotels', 'Hotels you prefer', 'Hyatt, Hilton'],
  ['destinations', 'Places you want to go', 'Seoul, Lisbon'],
  ['merchants', 'Merchants you shop at most', 'Costco, Target'],
] as const;

const csv = (l: string[]) => l.join(', ');
const parse = (s: string) =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

/** What Copilot remembers about you. It reorders and hides plan items; it is kept only in PointWise and never sent to a model. */
export function MemoryPanel() {
  const prefs = useAuthedQuery<Preferences>(['copilot', 'prefs'], '/copilot/memory/preferences');
  const mem = useAuthedQuery<MemoryRow[]>(['copilot', 'memory'], '/copilot/memory');
  const save = useApiMutation<Partial<Preferences>>((body) => ({ path: '/copilot/memory/preferences', method: 'PUT', body }), [['copilot']]);
  const forget = useApiMutation<string>((id) => ({ path: `/copilot/memory/${id}`, method: 'DELETE' }), [['copilot']]);
  const forgetAll = useApiMutation<void>(() => ({ path: '/copilot/memory', method: 'DELETE' }), [['copilot']]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  // text typed but not saved yet must survive a refresh of the saved values (ticking a priority saves and refetches)
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (prefs.data && !dirty) setDraft(Object.fromEntries(LISTS.map(([k]) => [k, csv(prefs.data![k])])));
  }, [prefs.data, dirty]);
  if (!prefs.data || !mem.data) return <Spinner />;
  const decisions = mem.data.filter((m) => m.kind === 'DECISION' && m.value.until && new Date(m.value.until).getTime() > Date.now());
  const recs = mem.data.filter((m) => m.kind === 'RECOMMENDATION');
  const chosen = new Set(prefs.data.priorities);
  return (
    <Panel title="What Copilot remembers" data-testid="memory-panel">
      <div id="memory" />
      <form
        className="grid gap-3 sm:grid-cols-2"
        aria-label="Your preferences"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(Object.fromEntries(LISTS.map(([k]) => [k, parse(draft[k] ?? '')])) as Partial<Preferences>, { onSuccess: () => setDirty(false) });
        }}
      >
        {LISTS.map(([k, label, ph]) => (
          <Field key={k} label={label} htmlFor={`pref-${k}`} hint="Separate with commas">
            <Input
              id={`pref-${k}`}
              value={draft[k] ?? ''}
              onChange={(e) => {
                setDirty(true);
                setDraft({ ...draft, [k]: e.target.value });
              }}
              placeholder={ph}
            />
          </Field>
        ))}
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium text-slate-700">What matters most right now</legend>
          <div className="mt-1 flex flex-wrap gap-4">
            {PRIORITIES.map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.has(k)}
                  onChange={(e) => save.mutate({ priorities: e.target.checked ? [...chosen, k] : [...chosen].filter((x) => x !== k) })}
                  data-testid={`priority-${k}`}
                />
                {label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="sm:col-span-2">
          <Button type="submit" loading={save.isPending}>
            Save preferences
          </Button>
        </div>
      </form>

      <div className="mt-6" data-testid="memory-decisions">
        <h3 className="text-sm font-semibold text-slate-900">Put aside</h3>
        {decisions.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">Nothing. Use Done, Snooze or Not interested on a plan item and it will wait here.</p>
        ) : (
          <ul className="mt-1 divide-y divide-slate-100 text-sm">
            {decisions.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1 truncate">{d.key}</span>
                <Badge>{(d.value.action ?? '').toLowerCase()}</Badge>
                <span className="text-xs text-slate-600">until {shortDate(d.value.until)}</span>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => forget.mutate(d.id)} aria-label={`Show again: ${d.key}`}>
                  Show again
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {recs.length > 0 && (
        <p className="mt-4 text-xs text-slate-600" data-testid="memory-recs">
          Copilot has recommended {recs.length} thing{recs.length === 1 ? '' : 's'} so far; the most shown:{' '}
          {[...recs].sort((a, b) => (b.value.shown ?? 0) - (a.value.shown ?? 0))[0].value.title}.
        </p>
      )}
      <div className="mt-4">
        <Button variant="secondary" onClick={() => window.confirm('Forget everything Copilot remembers about you?') && forgetAll.mutate(undefined)} data-testid="forget-all">
          Forget everything
        </Button>
      </div>
      <ErrorText error={save.error || forget.error || forgetAll.error} />
    </Panel>
  );
}
