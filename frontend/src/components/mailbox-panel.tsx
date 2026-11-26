'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, ErrorText, Field, Input, Panel, Select } from '@/components/ui';
import { shortDate } from '@/lib/format';
import { KIND_LABEL, MAILBOX_PRESETS, MailboxProviders, MailboxView, oauthBanner, syncLabel } from '@/lib/mailbox';
import { useApi } from '@/lib/api';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

/** Connect a mailbox (read-only IMAP) so card alert and statement emails are picked up automatically. */
export function MailboxPanel() {
  const list = useAuthedQuery<MailboxView[]>(['mailboxes'], '/mailboxes');
  const providers = useAuthedQuery<MailboxProviders>(['mailboxes', 'providers'], '/mailboxes/providers');
  const api = useApi();
  const [banner, setBanner] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  useEffect(() => setBanner(oauthBanner(window.location.search)), []);
  const signIn = async (path: 'google' | 'microsoft') => {
    setOauthError(null);
    try {
      const r = await api<{ url: string }>(`/mailboxes/oauth/${path}/start`);
      window.location.assign(r.url);
    } catch (e) {
      setOauthError((e as Error).message);
    }
  };
  const [preset, setPreset] = useState('gmail');
  const [f, setF] = useState({ label: '', host: 'imap.gmail.com', username: '', password: '', folder: 'INBOX' });
  const hint = MAILBOX_PRESETS.find((p) => p.id === preset)?.hint ?? '';
  const connect = useApiMutation<typeof f>((body) => ({ path: '/mailboxes', method: 'POST', body: { ...body, label: body.label || 'My mailbox' } }), [['mailboxes']]);
  const sync = useApiMutation<string>((id) => ({ path: `/mailboxes/${id}/sync`, method: 'POST' }), [['mailboxes'], ['capture'], ['spending']]);
  const remove = useApiMutation<string>((id) => ({ path: `/mailboxes/${id}`, method: 'DELETE' }), [['mailboxes']]);
  return (
    <Panel title="Connected mailboxes" data-testid="mailbox-panel">
      <p className="mb-3 text-sm text-slate-600">
        Pointwise reads your mailbox <strong>read-only</strong> (Gmail and Outlook use the provider's own sign-in; for any other provider use IMAP with an app password) and looks only at messages from card issuers (statements, transaction alerts, credits). Other mail is never opened, message bodies are
        not stored, and nothing is sent to an AI service. Use an app password you can revoke.
      </p>
      {banner && (
        <p role="status" className={banner.tone === 'ok' ? 'mb-3 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-900' : 'mb-3 rounded-lg bg-red-50 p-2 text-sm text-red-800'} data-testid="mailbox-banner">
          {banner.text}
        </p>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="mailbox-oauth">
        <Button variant="secondary" onClick={() => signIn('google')} disabled={!providers.data?.gmail} data-testid="connect-gmail">
          Connect Gmail
        </Button>
        <Button variant="secondary" onClick={() => signIn('microsoft')} disabled={!providers.data?.outlook} data-testid="connect-outlook">
          Connect Outlook
        </Button>
        {providers.data && !(providers.data.gmail && providers.data.outlook) && (
          <span className="text-xs text-slate-600">
            Gmail and Outlook sign-in need your own free app registration (see the setup notes in docs/email-ingestion-research.md). Redirect address to register: <code>{providers.data.redirectUri}</code>
          </span>
        )}
      </div>
      {oauthError && <p role="alert" className="mb-3 text-sm text-red-700">{oauthError}</p>}
      <ul className="mb-4 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm" data-testid="mailbox-list">
        {(list.data ?? []).map((m) => (
          <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="mailbox">
            <span className="font-medium">{m.label}</span>
            <span className="text-slate-600">{m.username}</span>
            <Badge tone="slate">{KIND_LABEL[m.kind]}</Badge>
            <Badge tone={m.lastStatus === 'ERROR' || m.lastStatus === 'RECONNECT' ? 'red' : m.lastSyncAt ? 'green' : 'slate'}>{syncLabel(m)}</Badge>
            <span className="text-xs text-slate-500">
              {m.processed} message{m.processed === 1 ? '' : 's'} read{m.lastSyncAt ? ` · last ${shortDate(m.lastSyncAt)}` : ''}
            </span>
            <span className="ml-auto flex gap-2">
              <Button variant="secondary" onClick={() => sync.mutate(m.id)} loading={sync.isPending && sync.variables === m.id}>
                Sync now
              </Button>
              <Button variant="ghost" onClick={() => remove.mutate(m.id)} loading={remove.isPending && remove.variables === m.id}>
                Disconnect
              </Button>
            </span>
          </li>
        ))}
        {list.data?.length === 0 && <li className="px-3 py-2 text-slate-500">No mailbox connected.</li>}
      </ul>
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          connect.mutate(f, { onSuccess: () => setF({ ...f, password: '' }) });
        }}
      >
        <Field label="Provider" htmlFor="mb-provider" hint={hint}>
          <Select
            id="mb-provider"
            value={preset}
            onChange={(e) => {
              setPreset(e.target.value);
              setF({ ...f, host: MAILBOX_PRESETS.find((p) => p.id === e.target.value)?.host ?? '' });
            }}
          >
            {MAILBOX_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="IMAP server" htmlFor="mb-host">
          <Input id="mb-host" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} required />
        </Field>
        <Field label="Name" htmlFor="mb-label">
          <Input id="mb-label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="Personal mail" />
        </Field>
        <Field label="Email address" htmlFor="mb-user">
          <Input id="mb-user" type="email" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
        </Field>
        <Field label="App password" htmlFor="mb-pass" hint="Stored encrypted and never shown again.">
          <Input id="mb-pass" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
        </Field>
        <Field label="Folder" htmlFor="mb-folder">
          <Input id="mb-folder" value={f.folder} onChange={(e) => setF({ ...f, folder: e.target.value })} />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" loading={connect.isPending} data-testid="mailbox-connect">
            Connect mailbox
          </Button>
        </div>
      </form>
      <ErrorText error={connect.error ?? sync.error ?? remove.error} />
    </Panel>
  );
}
