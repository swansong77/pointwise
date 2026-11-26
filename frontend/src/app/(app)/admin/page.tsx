'use client';

import { useState } from 'react';
import { Badge, Button, ErrorText, Field, Input, Panel, PageHeader, Select, Spinner } from '@/components/ui';
import { useApiMutation, useAuthedQuery, useCardSearch, useMerchantSearch } from '@/lib/queries';
import { dollarsToCents, shortDate } from '@/lib/format';
import type { Page } from '@/lib/types';

interface Stats {
  users: number;
  newUsers: number;
  proSubscribers: number;
  events: number;
  topEvents: Array<{ name: string; count: number }>;
}
interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: 'USER' | 'ADMIN';
  createdAt: string;
  subscription: { plan: string; status: string } | null;
}
interface Audit {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  createdAt: string;
  actor: { email: string };
}

const JOBS = ['scan-expiring-offers', 'scan-renewals', 'scan-bonus-deadlines', 'match-offer-alerts', 'expire-offers', 'email-digest', 'scan-benefit-expirations', 'snapshot-524', 'sync-bank-connections', 'check-mcp-servers', 'refresh-card-sources', 'scan-transfer-bonuses'];

function OfferForm() {
  const merchants = useMerchantSearch('');
  const cards = useCardSearch('');
  const [f, setF] = useState({ title: '', value: '', merchantId: '', cardId: '', endsAt: '' });
  const create = useApiMutation<void>(
    () => ({
      path: '/admin/offers',
      method: 'POST',
      body: {
        title: f.title,
        kind: 'CASH',
        valueCents: dollarsToCents(f.value) ?? 0,
        merchantId: f.merchantId || undefined,
        cardId: f.cardId || undefined,
        issuerId: cards.data?.items.find((c) => c.id === f.cardId)?.issuer.id,
        endsAt: f.endsAt || undefined,
      },
    }),
    [['admin']],
  );
  return (
    <Panel title="Create catalog offer" data-testid="admin-offer-form">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined, { onSuccess: () => setF({ title: '', value: '', merchantId: '', cardId: '', endsAt: '' }) });
        }}
      >
        <Field label="Title" htmlFor="ao-title">
          <Input id="ao-title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        </Field>
        <Field label="Value ($)" htmlFor="ao-value">
          <Input id="ao-value" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
        </Field>
        <Field label="Merchant" htmlFor="ao-merchant">
          <Select id="ao-merchant" value={f.merchantId} onChange={(e) => setF({ ...f, merchantId: e.target.value })}>
            <option value="">—</option>
            {merchants.data?.items.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Card" htmlFor="ao-card">
          <Select id="ao-card" value={f.cardId} onChange={(e) => setF({ ...f, cardId: e.target.value })}>
            <option value="">— any card from issuer —</option>
            {cards.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ends" htmlFor="ao-ends">
          <Input id="ao-ends" type="date" value={f.endsAt} onChange={(e) => setF({ ...f, endsAt: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" disabled={f.title.length < 2 || dollarsToCents(f.value) == null} loading={create.isPending}>
            Create offer
          </Button>
        </div>
      </form>
      {create.isSuccess && <p className="mt-2 text-sm text-emerald-700">Offer created.</p>}
      <ErrorText error={create.error} />
    </Panel>
  );
}

export default function AdminPage() {
  const [q, setQ] = useState('');
  const stats = useAuthedQuery<Stats>(['admin', 'stats'], '/admin/stats');
  const users = useAuthedQuery<Page<AdminUser>>(['admin', 'users', q], `/admin/users?pageSize=20${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  const audit = useAuthedQuery<Audit[]>(['admin', 'audit'], '/admin/audit?pageSize=15');
  const runJob = useApiMutation<string, { job: string; created: number }>((name) => ({ path: `/admin/jobs/${name}/run`, method: 'POST' }), [['admin']]);
  const setRole = useApiMutation<{ id: string; role: 'USER' | 'ADMIN' }>(({ id, role }) => ({ path: `/admin/users/${id}/role`, method: 'PATCH', body: { role } }), [['admin']]);

  return (
    <div className="space-y-6">
      <PageHeader title="Admin portal" subtitle="Catalog management, users and background jobs." />
      {stats.isLoading ? (
        <Spinner />
      ) : (
        stats.data && (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="admin-stats">
            {[
              ['Users', stats.data.users],
              ['New (30d)', stats.data.newUsers],
              ['Pro subscribers', stats.data.proSubscribers],
              ['Events (30d)', stats.data.events],
            ].map(([k, v]) => (
              <div key={k} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs uppercase text-slate-500">{k}</p>
                <p className="text-2xl font-semibold">{v}</p>
              </div>
            ))}
          </div>
        )
      )}
      <Panel title="Background jobs" data-testid="admin-jobs">
        <div className="flex flex-wrap gap-2">
          {JOBS.map((j) => (
            <Button key={j} variant="secondary" onClick={() => runJob.mutate(j)} loading={runJob.isPending && runJob.variables === j}>
              Run {j}
            </Button>
          ))}
        </div>
        {runJob.data && (
          <p className="mt-2 text-sm text-emerald-700" role="status">
            {runJob.data.job}: {runJob.data.created} processed
          </p>
        )}
        <ErrorText error={runJob.error} />
      </Panel>
      <OfferForm />
      <Panel title="Users" action={<Input aria-label="Search users" placeholder="Search email" value={q} onChange={(e) => setQ(e.target.value)} className="w-56" />}>
        <table className="w-full text-sm" data-testid="admin-users">
          <thead>
            <tr className="border-b text-left text-xs uppercase text-slate-500">
              <th className="py-2">Email</th>
              <th>Plan</th>
              <th>Joined</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {users.data?.items.map((u) => (
              <tr key={u.id} className="border-b border-slate-100">
                <td className="py-2">{u.email}</td>
                <td>
                  <Badge tone={u.subscription?.plan === 'PRO' ? 'brand' : 'slate'}>{u.subscription?.plan ?? 'FREE'}</Badge>
                </td>
                <td>{shortDate(u.createdAt)}</td>
                <td>
                  <Select aria-label={`Role for ${u.email}`} value={u.role} className="w-28" onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value as 'USER' | 'ADMIN' })}>
                    <option value="USER">USER</option>
                    <option value="ADMIN">ADMIN</option>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ErrorText error={users.error || setRole.error} />
      </Panel>
      <Panel title="Audit log">
        <ul className="divide-y divide-slate-100 text-sm">
          {audit.data?.map((a) => (
            <li key={a.id} className="flex justify-between py-1.5">
              <span>
                <strong>{a.action}</strong> {a.entity} <code className="text-xs text-slate-500">{a.entityId.slice(0, 8)}</code>
              </span>
              <span className="text-slate-500">
                {a.actor.email} · {shortDate(a.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
