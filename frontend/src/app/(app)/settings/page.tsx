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
import { NotificationPrefs } from '@/components/notification-prefs';

interface Me {
  id: string;
  email: string;
  name: string | null;
  countryCode: string;
  hasPassword: boolean;
  accounts: Array<{ provider: string }>;
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
