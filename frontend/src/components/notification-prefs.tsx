'use client';

import { useState } from 'react';
import { ErrorText, Field, Input, Panel, Spinner } from '@/components/ui';
import { json, useApi } from '@/lib/api';
import { pushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/push';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

export interface Prefs {
  offerExpiring: boolean;
  cardRenewal: boolean;
  bonusDeadline: boolean;
  offerAlerts: boolean;
  emailDigest: boolean;
  expiringDays: number;
  benefitExpiring: boolean;
  benefitEmail: boolean;
  benefitPush: boolean;
  transferBonuses: boolean;
  quietMode?: boolean;
  briefingDaily?: boolean;
  briefingWeekly?: boolean;
}

/**
 * Notification switches. A household member's own sign-in (`member`) also gets Quiet Mode and their own daily and weekly briefing;
 * everything saved here is theirs alone.
 */
export function NotificationPrefs({ member = false }: { member?: boolean }) {
  const api = useApi();
  const prefs = useAuthedQuery<Prefs>(['prefs'], '/notifications/preferences');
  const save = useApiMutation<Partial<Prefs>>((body) => ({ path: '/notifications/preferences', method: 'PUT', body }), [['prefs']]);
  if (!prefs.data) return <Spinner />;
  const toggles: Array<[keyof Prefs, string]> = [
    ['offerExpiring', 'Offers about to expire'],
    ['cardRenewal', 'Upcoming annual fees'],
    ['bonusDeadline', 'Welcome bonus deadlines at risk'],
    ['offerAlerts', 'New offers matching my alerts'],
    ['transferBonuses', 'Transfer bonuses for points I hold'],
    ['emailDigest', 'Email me a daily digest'],
    ['benefitExpiring', 'Benefits about to expire (in-app)'],
    ['benefitEmail', 'Also email me benefit expiry alerts'],
    ...(member
      ? ([
          ['briefingDaily', 'Send me my own daily briefing (only on days something is due)'],
          ['briefingWeekly', 'Send me my own weekly briefing'],
          ['quietMode', 'Quiet Mode: hold routine updates; urgent ones still arrive at once'],
        ] as Array<[keyof Prefs, string]>)
      : []),
  ];
  return (
    <Panel title="Notifications" data-testid="notification-prefs">
      <ul className="space-y-2">
        {toggles.map(([key, label]) => (
          <li key={key}>
            <label className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={!!prefs.data[key]} onChange={(e) => save.mutate({ [key]: e.target.checked })} />
              {label}
            </label>
          </li>
        ))}
      </ul>
      <div className="mt-4 max-w-xs">
        <Field label="Warn me this many days before an offer expires" htmlFor="expiring-days">
          <Input id="expiring-days" type="number" min={1} max={60} defaultValue={prefs.data.expiringDays} onBlur={(e) => save.mutate({ expiringDays: Number(e.target.value) })} />
        </Field>
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Benefit alerts arrive before each credit resets: monthly credits 7 and 1 days ahead; quarterly 30/7/1; twice-yearly 60/30/7/1; yearly 90/60/30/7/1.
      </p>
      <PushToggle enabled={prefs.data.benefitPush} onChange={(v) => save.mutate({ benefitPush: v })} />
      <ErrorText error={save.error} />
    </Panel>
  );
}

function PushToggle({ enabled, onChange }: { enabled: boolean; onChange: (v: boolean) => void }) {
  const api = useApi();
  const key = useAuthedQuery<{ publicKey: string | null }>(['push-key'], '/notifications/push/key');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!key.data) return null;
  if (!key.data.publicKey || !pushSupported()) {
    return <p className="mt-3 text-xs text-slate-500">Browser push notifications are not available{key.data.publicKey ? ' in this browser' : ' on this server'}.</p>;
  }
  const toggle = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (on) {
        const sub = await subscribeToPush(key.data!.publicKey as string);
        await api('/notifications/push/subscriptions', { method: 'POST', ...json({ endpoint: sub.endpoint, keys: sub.keys }) });
      } else {
        const endpoint = await unsubscribeFromPush();
        if (endpoint) await api('/notifications/push/subscriptions', { method: 'DELETE', ...json({ endpoint }) });
      }
      onChange(on);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3">
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={enabled} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
        Push benefit alerts to this browser
      </label>
      {error && (
        <p className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
