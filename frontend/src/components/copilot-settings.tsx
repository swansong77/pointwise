'use client';

import { useState } from 'react';
import { Badge, Button, ErrorText, Field, Panel, Select, Spinner } from '@/components/ui';
import { Disclosure, CopilotSettings } from '@/lib/copilot';
import { shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

type Patch = Partial<{
  aiModeEnabled: boolean;
  mode: string;
  temperature: number | null;
  reasoningDepth: string | null;
  responseStyle: string;
  cloudShare: boolean;
  cloudProviders: string[];
  briefingDaily: boolean;
  briefingWeekly: boolean;
  briefingMonthly: boolean;
  copilotAlerts: boolean;
  chiefOfStaff: boolean;
}>;

/** AI Mode: on/off, mode, style, temperature, and the separate consent to share a redacted summary with cloud models. */
export function CopilotSettingsSection() {
  const s = useAuthedQuery<CopilotSettings>(['copilot', 'settings'], '/copilot/settings');
  const log = useAuthedQuery<Disclosure[]>(['copilot', 'disclosures'], '/copilot/disclosures');
  const save = useApiMutation<Patch>((body) => ({ path: '/copilot/settings', method: 'PUT', body }), [['copilot']]);
  const clear = useApiMutation<void>(() => ({ path: '/copilot/disclosures', method: 'DELETE' }), [['copilot']]);
  const quiet = useApiMutation<{ quietMode: boolean }>((body) => ({ path: '/notifications/preferences', method: 'PUT', body }), [['copilot'], ['notifications']]);
  const [temp, setTemp] = useState<number | null>(null);
  if (!s.data) return <Spinner />;
  const d = s.data;
  const t = temp ?? d.temperature ?? 0.5;
  const cloud = d.providers.filter((p) => !p.local);
  const allowed = new Set(d.cloudShare.providers);
  return (
    <Panel title="AI Mode (Copilot)" data-testid="copilot-settings">
      <div id="copilot" />
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={d.aiModeEnabled} onChange={(e) => save.mutate({ aiModeEnabled: e.target.checked })} data-testid="copilot-enabled" />
        Turn on AI Mode: the search bar and the Copilot page answer with a prioritized plan, with reasons, evidence and confidence
      </label>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Default mode" htmlFor="cp-mode" hint={d.modes.find((m) => m.key === d.mode)?.blurb}>
          <Select id="cp-mode" value={d.mode} onChange={(e) => save.mutate({ mode: e.target.value })}>
            {d.modes.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Response style" htmlFor="cp-style">
          <Select id="cp-style" value={d.responseStyle} onChange={(e) => save.mutate({ responseStyle: e.target.value })}>
            {d.styles.map((x) => (
              <option key={x} value={x}>
                {x[0] + x.slice(1).toLowerCase()}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reasoning depth" htmlFor="cp-depth" hint="Automatic follows the mode. Used by models that support it.">
          <Select id="cp-depth" value={d.reasoningDepth ?? ''} onChange={(e) => save.mutate({ reasoningDepth: e.target.value || null })}>
            <option value="">Automatic</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </Select>
        </Field>
        <Field
          label={`Temperature: ${d.temperature == null ? 'model default' : t.toFixed(2)}`}
          htmlFor="cp-temp"
          hint="Lower is steadier, higher is more varied. Ignored by models that do not accept it."
        >
          <input
            id="cp-temp"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={t}
            onChange={(e) => setTemp(Number(e.target.value))}
            onMouseUp={() => temp != null && save.mutate({ temperature: temp })}
            onKeyUp={() => temp != null && save.mutate({ temperature: temp })}
            onTouchEnd={() => temp != null && save.mutate({ temperature: temp })}
            className="w-full"
          />
        </Field>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 p-3" data-testid="chief-settings">
        <h3 className="text-sm font-semibold text-slate-900">Chief of Staff</h3>
        <p className="mt-1 text-sm text-slate-700">
          Ranks everything into one short list. With it on, your daily briefing opens with a greeting and your numbers, and each new Critical item is announced once. It only
          recommends; nothing is done for you.
        </p>
        <label className="mt-2 flex items-center gap-3 text-sm">
          <input type="checkbox" checked={!!d.chief?.enabled} onChange={(e) => save.mutate({ chiefOfStaff: e.target.checked })} data-testid="chief-enabled" />
          Turn on the Chief of Staff
        </label>
        <label className="mt-2 flex items-center gap-3 text-sm">
          <input type="checkbox" checked={!!d.chief?.quietMode} onChange={(e) => quiet.mutate({ quietMode: e.target.checked })} data-testid="chief-quiet" />
          Quiet Mode: hold routine notifications (offers, transfer bonuses, stale balances) for the briefing. Deadlines, renewals, failures and your reminders still arrive at once.
        </label>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 p-3" data-testid="copilot-briefing-settings">
        <h3 className="text-sm font-semibold text-slate-900">Briefings and alerts</h3>
        <p className="mt-1 text-sm text-slate-700">
          With AI Mode on, Copilot writes reviews from your own data and tells you in your notifications (and in your e-mail digest, if you use it). They are built on this server;
          a model only words them if you allowed it below.
        </p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {(
            [
              ['briefingDaily', 'Daily briefing every morning', d.briefings?.daily],
              ['briefingWeekly', 'Weekly review on Mondays', d.briefings?.weekly],
              ['briefingMonthly', 'Monthly portfolio review on the 1st', d.briefings?.monthly],
              ['copilotAlerts', 'Alerts for opportunities worth a look', d.briefings?.alerts],
            ] as const
          ).map(([k, label, on]) => (
            <label key={k} className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={!!on} onChange={(e) => save.mutate({ [k]: e.target.checked } as Patch)} data-testid={`copilot-${k}`} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-6 rounded-lg border border-slate-200 p-3" data-testid="copilot-cloud">
        <h3 className="text-sm font-semibold text-slate-900">Share a redacted summary with cloud models</h3>
        <p className="mt-1 text-sm text-slate-700">
          Off by default. PointWise builds every plan itself. With this on, a cloud model you allow below may reword the plan, seeing only a summary: members appear as “Member A
          (spouse)”, amounts and balances are rounded, and dates are day counts. It never sees names, e-mail addresses, card numbers or last four digits, account logins, statement
          lines, addresses, birth years or notes. Models on your own machine do not need this.
        </p>
        <label className="mt-3 flex items-center gap-3 text-sm">
          <input type="checkbox" checked={d.cloudShare.consented} onChange={(e) => save.mutate({ cloudShare: e.target.checked })} data-testid="copilot-cloud-consent" />I agree to
          share this redacted summary with the providers I allow
        </label>
        <fieldset className="mt-3 space-y-1" disabled={!d.cloudShare.consented}>
          <legend className="text-sm font-medium text-slate-700">Providers allowed to receive it</legend>
          {cloud.map((p) => (
            <label key={p.name} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={allowed.has(p.name)}
                onChange={(e) => save.mutate({ cloudProviders: e.target.checked ? [...allowed, p.name] : [...allowed].filter((n) => n !== p.name) })}
                data-testid={`copilot-provider-${p.name}`}
              />
              {p.name} {!p.enabled && <Badge>not enabled by an admin</Badge>}
            </label>
          ))}
          {cloud.length === 0 && <p className="text-sm text-slate-600">No cloud providers are set up.</p>}
        </fieldset>
      </div>

      <div className="mt-6" data-testid="copilot-disclosures">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900">What was sent to a model</h3>
          {(log.data?.length ?? 0) > 0 && (
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => window.confirm('Delete this record? Nothing is kept past 90 days anyway.') && clear.mutate(undefined)}
            >
              Clear
            </Button>
          )}
        </div>
        {(log.data?.length ?? 0) === 0 ? (
          <p className="mt-1 text-sm text-slate-600">Nothing yet. Each time AI Mode lets a model reword a plan, the exact summary it received is kept here for 90 days.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {log.data!.slice(0, 20).map((x) => (
              <li key={x.id} className="py-2">
                <details>
                  <summary className="cursor-pointer">
                    {shortDate(x.createdAt)} · {x.model}{' '}
                    <span className="text-xs text-slate-600">
                      ({x.provider}, {x.local ? 'on your machine' : 'cloud'})
                    </span>
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-50 p-2 text-xs" tabIndex={0} aria-label="Exact text sent">
                    {JSON.stringify(x.payload, null, 2)}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
      <ErrorText error={save.error || clear.error || quiet.error} />
    </Panel>
  );
}
