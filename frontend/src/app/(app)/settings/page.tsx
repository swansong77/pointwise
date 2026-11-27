'use client';

import { DataSection } from './data-section';
import { signOut } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { Badge, Button, ErrorText, Field, Input, Panel, PageHeader, Spinner } from '@/components/ui';
import { json, useApi } from '@/lib/api';
import { qk, useApiMutation, useAuthedQuery, useSubscription } from '@/lib/queries';
import { money, shortDate } from '@/lib/format';
import { pushSupported, subscribeToPush, unsubscribeFromPush } from '@/lib/push';
import { AiSettingsSection, TokensSection } from './ai-section';
import { CopilotSettingsSection } from '@/components/copilot-settings';

interface Me {
  id: string;
  email: string;
  name: string | null;
  countryCode: string;
  hasPassword: boolean;
  accounts: Array<{ provider: string }>;
}
interface Prefs {
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
}

function ProfileSection() {
  const api = useApi();
  const me = useAuthedQuery<Me>(['me'], '/me');
  const [name, setName] = useState('');
  useEffect(() => setName(me.data?.name ?? ''), [me.data?.name]);
  const save = useApiMutation<void>(() => ({ path: '/me', method: 'PATCH', body: { name } }), [['me']]);
  if (me.isLoading) return <Spinner />;
  return (
    <Panel title="Profile">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" htmlFor="email">
          <Input id="email" value={me.data?.email ?? ''} disabled />
        </Field>
        <Field label="Name" htmlFor="name">
          <Input id="name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </Field>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        Sign-in methods: {me.data?.hasPassword && 'password'} {me.data?.accounts.map((a) => a.provider).join(', ')}
      </p>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>
          Save profile
        </Button>
        {save.isSuccess && <span className="text-sm text-emerald-700">Saved</span>}
      </div>
      <ErrorText error={save.error} />
    </Panel>
  );
}

function NotificationPrefs() {
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

function SubscriptionSection() {
  const sub = useSubscription();
  const checkout = useApiMutation<'month' | 'year' | 'lifetime'>(
    (interval) => ({ path: '/subscription/checkout', method: 'POST', body: { interval } }),
    [qk.subscription, qk.dashboard],
  );
  const cancel = useApiMutation<void>(() => ({ path: '/subscription/cancel', method: 'POST' }), [qk.subscription]);
  const resume = useApiMutation<void>(() => ({ path: '/subscription/resume', method: 'POST' }), [qk.subscription]);
  if (!sub.data) return <Spinner />;
  const s = sub.data;
  return (
    <Panel title="Subscription" data-testid="subscription">
      <p className="text-sm">
        Current plan: <Badge tone={s.effectivePlan === 'PRO' ? 'brand' : 'slate'}>{s.effectivePlan}</Badge>{' '}
        {s.plan === 'PRO' && (
          <span className="text-slate-500">
            · {s.interval} · {s.status.toLowerCase()}
            {s.currentPeriodEnd && ` · ${s.cancelAtPeriodEnd ? 'ends' : 'renews'} ${shortDate(s.currentPeriodEnd)}`}
          </span>
        )}
      </p>
      {s.effectivePlan === 'FREE' ? (
        <>
          <p className="mt-2 text-sm text-slate-600">Pro unlocks unlimited cards and offers, keyword offer alerts, household profiles and card comparison.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {(['month', 'year', 'lifetime'] as const).map((k) => (
              <button
                key={k}
                className="rounded-xl border border-slate-200 p-4 text-left hover:border-brand-400 hover:bg-brand-50"
                onClick={() => checkout.mutate(k)}
                disabled={checkout.isPending}
                data-testid={`plan-${k}`}
              >
                <p className="font-semibold">{s.prices[k].label}</p>
                <p className="text-lg">{money(s.prices[k].cents)}</p>
                {s.prices[k].trialDays && <p className="text-xs text-emerald-700">{s.prices[k].trialDays}-day free trial</p>}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-4 flex gap-2">
          {s.status === 'CANCELED' ? (
            <Button variant="secondary" onClick={() => resume.mutate(undefined)} loading={resume.isPending}>
              Resume subscription
            </Button>
          ) : (
            s.interval !== 'lifetime' && (
              <Button variant="secondary" onClick={() => cancel.mutate(undefined)} loading={cancel.isPending} data-testid="cancel-subscription">
                Cancel at period end
              </Button>
            )
          )}
        </div>
      )}
      <ErrorText error={checkout.error || cancel.error || resume.error} />
    </Panel>
  );
}

function PrivacySection() {
  const api = useApi();
  const [confirm, setConfirm] = useState('');
  const del = useApiMutation<void>(() => ({ path: '/me', method: 'DELETE' }));
  async function exportData() {
    const data = await api<unknown>('/me/export');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pointwise-export.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }
  return (
    <Panel title="Privacy & data">
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={exportData} data-testid="export-data">
          Download my data
        </Button>
      </div>
      <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-medium text-red-800">Delete account</p>
        <p className="text-sm text-red-700">This permanently deletes your wallet, offers and history. Type DELETE to confirm.</p>
        <div className="mt-3 flex gap-2">
          <Input aria-label="Type DELETE to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="max-w-[10rem]" />
          <Button
            variant="danger"
            disabled={confirm !== 'DELETE'}
            loading={del.isPending}
            onClick={() => del.mutate(undefined, { onSuccess: () => signOut({ callbackUrl: '/' }) })}
          >
            Delete account
          </Button>
        </div>
        <ErrorText error={del.error} />
      </div>
    </Panel>
  );
}

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />
      <ProfileSection />
      <SubscriptionSection />
      <NotificationPrefs />
      <AiSettingsSection />
      <CopilotSettingsSection />
      <TokensSection />
      <DataSection />
      <PrivacySection />
    </div>
  );
}
