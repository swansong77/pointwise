'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { Tabs } from '@/components/charts';
import { money, shortDate } from '@/lib/format';
import {
  actionable,
  centsText,
  DECISION_LABEL,
  decisionPhrase,
  describeRule,
  dollarsToCents,
  EVENT_LABEL,
  EventRow,
  FACTOR_LABEL,
  HEALTH_LABEL,
  InboxItem,
  InboxTab,
  KIND_LABEL,
  MODE_LABEL,
  Mode,
  OfferAccountView,
  progressLine,
  RUN_LABEL,
  RuleRow,
  RULE_EXAMPLES,
  Savings,
  scoreTone,
  SyncDashboard,
  TAB_LABEL,
} from '@/lib/offer-automation';
import { useApiMutation, useAuthedQuery, useWallet } from '@/lib/queries';

type Section = 'inbox' | 'history' | 'savings' | 'sync' | 'accounts' | 'rules';
const SECTIONS: Array<[Section, string]> = [
  ['inbox', 'Offer Inbox'],
  ['history', 'Offer History'],
  ['savings', 'Savings Dashboard'],
  ['sync', 'Sync Dashboard'],
  ['accounts', 'Accounts'],
  ['rules', 'Rules & Mode'],
];
const INBOX_TABS: InboxTab[] = ['all', 'new', 'review', 'queued', 'enrolled', 'auto', 'expiring', 'redeemed'];
const KEY = ['offer-automation'] as const;
const REFRESH = [KEY] as const;

// ─────────────────────────── inbox ───────────────────────────

function InboxList({ tab }: { tab: InboxTab }) {
  const q = useAuthedQuery<InboxItem[]>([...KEY, 'inbox', tab], `/offer-automation/inbox?tab=${tab}`);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const approve = useApiMutation<string[], Array<{ itemId: string; result: string; message?: string }>>((ids) => ({ path: '/offer-automation/approve', method: 'POST', body: { itemIds: ids } }), REFRESH);
  const ignore = useApiMutation<string[]>((ids) => ({ path: '/offer-automation/ignore', method: 'POST', body: { itemIds: ids } }), REFRESH);
  const done = useApiMutation<string>((id) => ({ path: `/offer-automation/items/${id}/mark-enrolled`, method: 'POST' }), REFRESH);
  if (q.isLoading) return <Spinner />;
  const items = q.data ?? [];
  if (!items.length) return <EmptyState title="Nothing here yet">Press Sync Now, or add an account on the Accounts tab. New offers appear here with a score and a reason.</EmptyState>;
  const ids = [...picked].filter((id) => items.some((i) => i.id === id));
  const toggle = (id: string) => setPicked((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : new Set([...p, id])));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button className="px-3 py-1.5" disabled={!ids.length} loading={approve.isPending} onClick={() => approve.mutate(ids, { onSuccess: () => setPicked(new Set()) })} data-testid="add-selected">
          Add Selected ({ids.length})
        </Button>
        <Button variant="secondary" className="px-3 py-1.5" disabled={!ids.length} loading={ignore.isPending} onClick={() => ignore.mutate(ids, { onSuccess: () => setPicked(new Set()) })}>
          Ignore Selected
        </Button>
        <Button variant="ghost" className="px-3 py-1.5" onClick={() => setPicked(new Set(items.filter(actionable).map((i) => i.id)))}>
          Select All Addable
        </Button>
        <ErrorText error={approve.error ?? ignore.error ?? done.error} />
      </div>
      {approve.data && (
        <p className="mb-2 rounded bg-slate-50 p-2 text-sm" role="status" data-testid="approve-result">
          {approve.data.map((r) => r.result).join(', ')}
        </p>
      )}
      <ul className="divide-y divide-slate-100 text-sm" data-testid="inbox-list">
        {items.map((o) => (
          <li key={o.id} className="py-3" data-testid="inbox-item">
            <div className="flex flex-wrap items-center gap-2">
              {actionable(o) && <input type="checkbox" aria-label={`Select ${o.merchant} on ${o.card ?? o.holder}`} checked={picked.has(o.id)} onChange={() => toggle(o.id)} />}
              <Badge tone={scoreTone(o.score)}>Score {o.score ?? '—'}/100</Badge>
              <span className="font-medium">{o.merchant}</span>
              <span className="text-slate-600">{money(o.valueCents)}</span>
              <Badge tone={DECISION_LABEL[o.decision].tone}>{DECISION_LABEL[o.decision].label}</Badge>
              {o.daysLeft != null && <Badge tone={o.daysLeft <= 7 ? 'red' : 'slate'}>{o.daysLeft} day(s) left</Badge>}
              {o.sameOfferOnCards > 1 && <Badge tone="amber">Same offer on {o.sameOfferOnCards} cards</Badge>}
              <span className="ml-auto text-xs text-slate-600">
                {o.issuer} · {o.card ?? o.holder}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600">{o.title}</p>
            {o.reason && <p className="text-xs text-slate-600">{o.reason}</p>}
            <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
              <button type="button" className="text-brand-700 hover:underline" aria-expanded={open === o.id} onClick={() => setOpen(open === o.id ? null : o.id)}>
                {open === o.id ? 'Hide Why' : 'Why This Score?'}
              </button>
              {o.status === 'AVAILABLE' && o.decision === 'APPROVED' && (
                <button type="button" className="text-brand-700 hover:underline" onClick={() => done.mutate(o.id)}>
                  I Added It
                </button>
              )}
            </div>
            {open === o.id && (
              <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs" data-testid="score-detail">
                <p className="mb-1 font-medium">{decisionPhrase(o.score)}</p>
                <table className="w-full">
                  <tbody>
                    {Object.entries(o.scoreDetail?.scores ?? {}).map(([k, v]) => (
                      <tr key={k}>
                        <td className="py-0.5 pr-2">{FACTOR_LABEL[k] ?? k}</td>
                        <td className="py-0.5 text-right tabular-nums">{v}/100</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <ul className="mt-2 list-disc pl-5">
                  {(o.scoreDetail?.reasons ?? []).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Inbox() {
  const [tab, setTab] = useState<InboxTab>('all');
  const counts = useAuthedQuery<Record<InboxTab, number>>([...KEY, 'counts'], '/offer-automation/counts');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Offer lists">
        {INBOX_TABS.map((t) => (
          <button key={t} role="tab" type="button" aria-selected={tab === t} onClick={() => setTab(t)} data-testid={`inbox-tab-${t}`} className={`rounded-lg px-3 py-1.5 text-sm ${tab === t ? 'bg-brand-600 font-semibold text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}>
            {TAB_LABEL[t]}
            {counts.data ? ` (${counts.data[t] ?? 0})` : ''}
          </button>
        ))}
      </div>
      <Panel title={TAB_LABEL[tab]}>
        <InboxList tab={tab} />
      </Panel>
    </div>
  );
}

// ─────────────────────────── history, savings, sync ───────────────────────────

function History() {
  const q = useAuthedQuery<EventRow[]>([...KEY, 'history'], '/offer-automation/history?limit=150');
  if (q.isLoading) return <Spinner />;
  if (!q.data?.length) return <EmptyState title="No history yet">Every discovery, decision, enrollment, removal and expiration is recorded here.</EmptyState>;
  return (
    <ul className="divide-y divide-slate-100 text-sm" data-testid="history-list">
      {q.data.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="history-row">
          <span className="w-28 text-xs text-slate-600">{shortDate(e.createdAt)}</span>
          <Badge>{EVENT_LABEL[e.type] ?? e.type}</Badge>
          <span>{String(e.detail.merchant ?? e.detail.action ?? e.detail.label ?? '')}</span>
          <span className="ml-auto text-xs text-slate-500">{e.actor === 'USER' ? 'You' : e.actor === 'AGENT' ? 'Assistant' : 'PointWise'}</span>
        </li>
      ))}
    </ul>
  );
}

function SavingsDashboard() {
  const q = useAuthedQuery<Savings>([...KEY, 'savings'], '/offer-automation/savings');
  if (q.isLoading || !q.data) return <Spinner />;
  const s = q.data;
  const tiles: Array<[string, string, string]> = [
    ['Realized Savings', money(s.realizedCents), 'Statement credits matched to an offer'],
    ['Enrolled and Waiting', money(s.enrolledPotentialCents), `${s.enrolledCount} offer(s) you are enrolled in`],
    ['Not Yet Added', money(s.notYetAddedCents), 'Recommended or approved, not added'],
    ['Missed', money(s.missedCents), 'Recommended offers that ended unused'],
    ['Added Automatically', String(s.autoEnrolledCount), 'By your rules'],
  ];
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-5" data-testid="savings">
      {tiles.map(([label, value, hint]) => (
        <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          <p className="mt-0.5 text-xs text-slate-500">{hint}</p>
        </div>
      ))}
    </div>
  );
}

function SyncPanel() {
  const qc = useQueryClient();
  const [batch, setBatch] = useState<string | null>(null);
  const dash = useAuthedQuery<SyncDashboard>([...KEY, 'sync', batch ?? 'all'], batch ? `/offer-automation/sync?batchId=${batch}` : '/offer-automation/sync', { refetchInterval: batch ? 1500 : undefined });
  const start = useApiMutation<void, { batchId: string; runs: string[]; skipped: Array<{ holder: string; reason: string }> }>(() => ({ path: '/offer-automation/sync', method: 'POST', body: {} }), REFRESH);
  const active = !!batch && !dash.data?.done;
  const d = dash.data;
  const accounts = useAuthedQuery<OfferAccountView[]>([...KEY, 'accounts'], '/offer-automation/accounts', { refetchInterval: active ? 1500 : undefined });
  return (
    <div className="space-y-4">
      <Panel
        title="Sync Now"
        action={
          <Button
            loading={start.isPending || active}
            onClick={() => start.mutate(undefined, { onSuccess: (r) => { setBatch(r.batchId); void qc.invalidateQueries({ queryKey: [...KEY] }); } })}
            data-testid="sync-now"
          >
            Sync Now
          </Button>
        }
      >
        <p className="text-sm text-slate-700">Reads the offers on every account that can sync, finds what is new, scores it and applies your rules. Accounts fed by the extension, email or paste update when you send a page.</p>
        <ErrorText error={start.error} />
        {start.data && start.data.skipped.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
            {start.data.skipped.map((s) => (
              <li key={s.holder}>
                {s.holder}: {s.reason}
              </li>
            ))}
          </ul>
        )}
        {batch && d && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm" role="status" aria-live="polite" data-testid="sync-progress">
            <p className="font-medium">{d.done ? 'Finished' : 'Working…'}</p>
            <p>{progressLine(d.totals, d.runs.length)}</p>
          </div>
        )}
      </Panel>
      <Panel title="Accounts">
        {dash.isLoading || accounts.isLoading ? <Spinner /> : !accounts.data?.length ? <EmptyState title="No accounts yet">Add one on the Accounts tab.</EmptyState> : (
          <ul className="divide-y divide-slate-100 text-sm" data-testid="sync-accounts">
            {(accounts.data ?? []).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="sync-account">
                <span className="font-medium">{a.holderLabel}</span>
                <span className="text-slate-600">{a.issuer.name}</span>
                <Badge tone={HEALTH_LABEL[a.syncHealth].tone}>{HEALTH_LABEL[a.syncHealth].label}</Badge>
                <span className="ml-auto text-xs text-slate-600">
                  Last sync {a.lastSyncAt ? shortDate(a.lastSyncAt) : 'never'}
                  {a.nextRunAt ? ` · next ${shortDate(a.nextRunAt)} ${a.syncHour}:00` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Job History">
        {!d?.runs.length ? <EmptyState title="No runs yet" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm" data-testid="runs">
              <thead>
                <tr className="text-xs text-slate-500">
                  <th className="py-1">When</th>
                  <th>Account</th>
                  <th>Trigger</th>
                  <th>Status</th>
                  <th className="text-right">Found</th>
                  <th className="text-right">Added</th>
                  <th className="text-right">Errors</th>
                </tr>
              </thead>
              <tbody>
                {d.runs.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100" data-testid="run-row">
                    <td className="py-1.5">{shortDate(r.createdAt)}</td>
                    <td>{r.holder ?? '—'}</td>
                    <td>{r.trigger.toLowerCase()}{r.attempt > 1 ? ` (attempt ${r.attempt})` : ''}</td>
                    <td title={r.error ?? ''}>
                      <Badge tone={RUN_LABEL[r.status].tone}>{RUN_LABEL[r.status].label}</Badge>
                    </td>
                    <td className="text-right tabular-nums">{r.found}</td>
                    <td className="text-right tabular-nums">{r.added}</td>
                    <td className="text-right tabular-nums">{r.errors}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─────────────────────────── accounts ───────────────────────────

interface IssuerRow { id: string; name: string }
interface FlowInfo { switchOn: boolean; flows: Array<{ issuers: string[]; termsNote: string }> }

function AccountForm({ onDone }: { onDone: () => void }) {
  const issuers = useAuthedQuery<IssuerRow[]>(['catalog', 'issuers'], '/issuers');
  const wallet = useWallet();
  const info = useAuthedQuery<FlowInfo>([...KEY, 'connectors'], '/offer-automation/connectors');
  const [f, setF] = useState({ issuerId: '', holderLabel: '', connectorKind: 'EXTENSION', username: '', password: '', mfaMethod: 'NONE', syncHour: 2, optIn: false, ack: false, cards: [] as string[] });
  const create = useApiMutation<typeof f>((v) => ({ path: '/offer-automation/accounts', method: 'POST', body: { issuerId: v.issuerId, holderLabel: v.holderLabel, connectorKind: v.connectorKind, ...(v.connectorKind === 'MOCK' || v.connectorKind === 'ISSUER_LOGIN' ? { username: v.username, password: v.password, automationOptIn: v.optIn, ackTermsRisk: v.ack } : {}), mfaMethod: v.mfaMethod, syncHour: v.syncHour, walletCardIds: v.cards } }), REFRESH);
  const login = f.connectorKind === 'MOCK' || f.connectorKind === 'ISSUER_LOGIN';
  const issuerName = issuers.data?.find((i) => i.id === f.issuerId)?.name ?? '';
  const note = info.data?.flows.find((fl) => fl.issuers.some((n) => n.toLowerCase() === issuerName.toLowerCase()))?.termsNote;
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate(f, { onSuccess: () => { setF({ ...f, holderLabel: '', username: '', password: '', cards: [] }); onDone(); } });
      }}
      data-testid="account-form"
    >
      <Field label="Issuer" htmlFor="oa-issuer">
        <Select id="oa-issuer" value={f.issuerId} onChange={(e) => setF({ ...f, issuerId: e.target.value })} required>
          <option value="">Choose…</option>
          {(issuers.data ?? []).map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </Select>
      </Field>
      <Field label="Who Is This For" htmlFor="oa-holder" hint="For example: Alex — Platinum">
        <Input id="oa-holder" value={f.holderLabel} onChange={(e) => setF({ ...f, holderLabel: e.target.value })} required maxLength={80} />
      </Field>
      <Field label="How PointWise Gets the Offers" htmlFor="oa-kind">
        <Select id="oa-kind" value={f.connectorKind} onChange={(e) => setF({ ...f, connectorKind: e.target.value })}>
          {(['EXTENSION', 'MANUAL', 'EMAIL', 'ISSUER_LOGIN', 'MOCK'] as const).map((k) => (
            <option key={k} value={k}>{KIND_LABEL[k]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Run Time (Local Hour)" htmlFor="oa-hour" hint="Daily at this hour; default 2 AM">
        <Input id="oa-hour" type="number" min={0} max={23} value={f.syncHour} onChange={(e) => setF({ ...f, syncHour: Number(e.target.value) })} />
      </Field>
      {login && (
        <>
          <Field label="Username" htmlFor="oa-user" hint="Stored encrypted. Never shown again.">
            <Input id="oa-user" autoComplete="off" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} required />
          </Field>
          <Field label="Password" htmlFor="oa-pass" hint="Stored encrypted. Never shown again.">
            <Input id="oa-pass" type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
          </Field>
          <Field label="Verification Method" htmlFor="oa-mfa">
            <Select id="oa-mfa" value={f.mfaMethod} onChange={(e) => setF({ ...f, mfaMethod: e.target.value })}>
              {['NONE', 'SMS', 'APP', 'AUTHENTICATOR', 'PASSKEY'].map((m) => (
                <option key={m} value={m}>{m === 'NONE' ? 'None' : m === 'APP' ? 'App Prompt' : m.charAt(0) + m.slice(1).toLowerCase()}</option>
              ))}
            </Select>
          </Field>
          <div className="sm:col-span-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="risk-note">
            <p className="font-medium">Read this before turning on server-side login</p>
            <p className="mt-1">PointWise would sign in to the issuer on your behalf. Issuers can forbid scripted access and may lock the account. Passkeys cannot be completed by a server. These issuer flows have never been tested against the real sites.{info.data && !info.data.switchOn ? ' This server has issuer logins switched off, so only the demo issuer will run.' : ''}</p>
            {note && <p className="mt-1">{note}</p>}
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={f.ack} onChange={(e) => setF({ ...f, ack: e.target.checked, optIn: e.target.checked })} data-testid="ack-risk" /> I have read this and want server-side login for this account.
            </label>
          </div>
        </>
      )}
      <fieldset className="sm:col-span-2">
        <legend className="text-sm font-medium text-slate-700">Cards on This Account</legend>
        <div className="mt-1 flex flex-wrap gap-3 text-sm">
          {(wallet.data ?? []).map((w) => (
            <label key={w.id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={f.cards.includes(w.id)} onChange={(e) => setF({ ...f, cards: e.target.checked ? [...f.cards, w.id] : f.cards.filter((x) => x !== w.id) })} />
              {w.nickname || w.card.name}
              {w.lastFour ? ` ··${w.lastFour}` : ''}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2">
        <Button type="submit" loading={create.isPending} data-testid="add-account">Add Account</Button>
        <ErrorText error={create.error} />
      </div>
    </form>
  );
}

function AccountRow({ a }: { a: OfferAccountView }) {
  const [code, setCode] = useState('');
  const sync = useApiMutation<void>(() => ({ path: '/offer-automation/sync', method: 'POST', body: { accountId: a.id, wait: true } }), REFRESH);
  const mfa = useApiMutation<void>(() => ({ path: `/offer-automation/accounts/${a.id}/mfa`, method: 'POST', body: { code } }), REFRESH);
  const unlock = useApiMutation<void>(() => ({ path: `/offer-automation/accounts/${a.id}`, method: 'PUT', body: { unlock: true } }), REFRESH);
  const disconnect = useApiMutation<void>(() => ({ path: `/offer-automation/accounts/${a.id}/disconnect`, method: 'POST' }), REFRESH);
  const remove = useApiMutation<void>(() => ({ path: `/offer-automation/accounts/${a.id}`, method: 'DELETE' }), REFRESH);
  const h = HEALTH_LABEL[a.syncHealth];
  return (
    <li className="py-3 text-sm" data-testid="account">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{a.holderLabel}</span>
        <span className="text-slate-600">{a.issuer.name}</span>
        <Badge>{KIND_LABEL[a.connectorKind]}</Badge>
        <Badge tone={h.tone}>{h.label}</Badge>
        {a.connector.unverifiedFlow && <Badge tone="amber">Unverified Flow</Badge>}
        {a.hasCredential && <span className="text-xs text-slate-500">Login {a.credentialRef} (encrypted)</span>}
        <span className="ml-auto flex flex-wrap gap-2">
          {a.canSync && <Button variant="secondary" className="px-2 py-1 text-xs" loading={sync.isPending} onClick={() => sync.mutate()}>Sync This Account</Button>}
          {a.locked && <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => unlock.mutate()}>Unlock</Button>}
          {a.hasCredential && <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => disconnect.mutate()}>Forget Login</Button>}
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => remove.mutate()}>Remove</Button>
        </span>
      </div>
      {!a.canSync && a.cannotSyncBecause && <p className="mt-1 text-xs text-slate-600">{a.cannotSyncBecause}</p>}
      {a.lastError && <p className="mt-1 text-xs text-red-700">{a.lastError}</p>}
      {a.syncHealth === 'NEEDS_MFA' && (
        <form className="mt-2 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); mfa.mutate(); }}>
          <Field label="Verification Code" htmlFor={`mfa-${a.id}`}>
            <Input id={`mfa-${a.id}`} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
          </Field>
          <Button type="submit" loading={mfa.isPending}>Continue Sync</Button>
        </form>
      )}
      <ErrorText error={sync.error ?? mfa.error ?? remove.error} />
    </li>
  );
}

function Extension() {
  const tokens = useAuthedQuery<Array<{ id: string; name: string; prefix: string; lastUsedAt: string | null; expiresAt: string }>>([...KEY, 'tokens'], '/offer-automation/tokens');
  const create = useApiMutation<void, { token: string }>(() => ({ path: '/offer-automation/tokens', method: 'POST' }), REFRESH);
  const revoke = useApiMutation<string>((id) => ({ path: `/offer-automation/tokens/${id}`, method: 'DELETE' }), REFRESH);
  return (
    <Panel title="Browser Extension" action={<Button variant="secondary" className="px-3 py-1.5" loading={create.isPending} onClick={() => create.mutate()} data-testid="new-token">New Extension Token</Button>}>
      <p className="text-sm text-slate-700">The extension reads the offers page you have open in your own browser when you click it, and can add selected offers on the issuer&apos;s own page when you click Enroll Selected. It never sees your password. The token can only send offers.</p>
      {create.data && (
        <p className="mt-2 break-all rounded bg-amber-50 p-2 text-xs" role="status" data-testid="token-once">
          Copy it now, it is shown once: <code>{create.data.token}</code>
        </p>
      )}
      <ul className="mt-2 divide-y divide-slate-100 text-sm">
        {(tokens.data ?? []).map((t) => (
          <li key={t.id} className="flex items-center gap-2 py-1.5">
            {t.name} <code className="text-xs">{t.prefix}…</code> <span className="text-xs text-slate-500">expires {shortDate(t.expiresAt)}</span>
            <Button variant="ghost" className="ml-auto px-2 py-1 text-xs" onClick={() => revoke.mutate(t.id)}>Revoke</Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Accounts() {
  const q = useAuthedQuery<OfferAccountView[]>([...KEY, 'accounts'], '/offer-automation/accounts');
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <Panel title="Accounts" action={<Button variant="secondary" className="px-3 py-1.5" onClick={() => setAdding(!adding)}>{adding ? 'Close' : 'Add Account'}</Button>}>
        {adding && <div className="mb-4 rounded-lg border border-slate-200 p-3"><AccountForm onDone={() => setAdding(false)} /></div>}
        {q.isLoading ? <Spinner /> : !q.data?.length ? <EmptyState title="No accounts yet">Add the issuer accounts you hold offers on, one per household member.</EmptyState> : (
          <ul className="divide-y divide-slate-100" data-testid="accounts">
            {q.data.map((a) => <AccountRow key={a.id} a={a} />)}
          </ul>
        )}
      </Panel>
      <Extension />
    </div>
  );
}

// ─────────────────────────── rules and mode ───────────────────────────

interface Policy { mode: Mode; autoFilter: { allOffers?: boolean; categories?: string[]; minValueCents?: number; preferredMerchants?: string[]; matchSpendHistory?: boolean; minScore?: number } }

function PolicyPanel() {
  const q = useAuthedQuery<Policy>([...KEY, 'policy'], '/offer-automation/policy');
  const save = useApiMutation<Policy>((p) => ({ path: '/offer-automation/policy', method: 'PUT', body: p }), REFRESH);
  const [draft, setDraft] = useState<Policy | null>(null);
  const p = draft ?? q.data;
  if (!p) return <Spinner />;
  const f = p.autoFilter;
  const set = (patch: Partial<Policy['autoFilter']>) => setDraft({ ...p, autoFilter: { ...f, ...patch } });
  return (
    <Panel title="Enrollment Mode">
      <div className="space-y-2" role="radiogroup" aria-label="Enrollment mode">
        {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
          <label key={m} className="flex items-start gap-2 text-sm">
            <input type="radio" name="mode" checked={p.mode === m} onChange={() => setDraft({ ...p, mode: m })} data-testid={`mode-${m}`} />
            <span>
              <span className="font-medium">{MODE_LABEL[m].label}</span>
              <span className="block text-xs text-slate-600">{MODE_LABEL[m].help}</span>
            </span>
          </label>
        ))}
      </div>
      {p.mode === 'AUTO' && (
        <div className="mt-3 grid gap-3 rounded-lg bg-slate-50 p-3 sm:grid-cols-2" data-testid="auto-filter">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.allOffers} onChange={(e) => set({ allOffers: e.target.checked })} /> Enroll all offers</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!f.matchSpendHistory} onChange={(e) => set({ matchSpendHistory: e.target.checked })} /> Only merchants I already spend at</label>
          <Field label="Categories (comma separated)" htmlFor="af-cat" hint="travel, dining">
            <Input id="af-cat" value={(f.categories ?? []).join(', ')} onChange={(e) => set({ categories: e.target.value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean) })} />
          </Field>
          <Field label="Minimum Value ($)" htmlFor="af-min">
            <Input id="af-min" inputMode="decimal" defaultValue={f.minValueCents != null ? String(f.minValueCents / 100) : ''} onChange={(e) => set({ minValueCents: e.target.value ? (dollarsToCents(e.target.value) ?? undefined) : undefined })} />
          </Field>
          <Field label="Preferred Merchants (comma separated)" htmlFor="af-merch">
            <Input id="af-merch" value={(f.preferredMerchants ?? []).join(', ')} onChange={(e) => set({ preferredMerchants: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          </Field>
          <Field label="Minimum Score (0-100)" htmlFor="af-score">
            <Input id="af-score" type="number" min={0} max={100} value={f.minScore ?? ''} onChange={(e) => set({ minScore: e.target.value === '' ? undefined : Number(e.target.value) })} />
          </Field>
        </div>
      )}
      <div className="mt-3">
        <Button loading={save.isPending} onClick={() => save.mutate(p, { onSuccess: () => setDraft(null) })} data-testid="save-policy">Save Mode</Button>
        <ErrorText error={save.error} />
      </div>
    </Panel>
  );
}

function Rules() {
  const q = useAuthedQuery<RuleRow[]>([...KEY, 'rules'], '/offer-automation/rules');
  const [f, setF] = useState({ label: '', kind: 'ALWAYS', matcher: 'MERCHANT', value: '' });
  const create = useApiMutation<{ label: string; kind: string; matcher: string; matcherValue: string }>((b) => ({ path: '/offer-automation/rules', method: 'POST', body: b }), REFRESH);
  const remove = useApiMutation<string>((id) => ({ path: `/offer-automation/rules/${id}`, method: 'DELETE' }), REFRESH);
  const valueFor = () => (f.matcher === 'MIN_VALUE' ? String(dollarsToCents(f.value) ?? '') : f.value);
  return (
    <div className="space-y-4">
      <PolicyPanel />
      <Panel title="Your Rules">
        <p className="mb-2 text-sm text-slate-700">A never-rule always wins over an always-rule. Always-rules add offers automatically only in Automatic Enrollment mode.</p>
        <div className="mb-3 flex flex-wrap gap-2" aria-label="Rule examples">
          {RULE_EXAMPLES.map((r) => (
            <button key={r.label} type="button" className="rounded-full border border-slate-300 px-3 py-1 text-xs hover:bg-slate-50" onClick={() => create.mutate({ label: r.label, kind: r.kind, matcher: r.matcher, matcherValue: r.matcherValue })}>
              + {r.label}
            </button>
          ))}
        </div>
        <form className="grid gap-3 sm:grid-cols-5" onSubmit={(e) => { e.preventDefault(); create.mutate({ label: f.label || `${f.kind} ${f.value}`, kind: f.kind, matcher: f.matcher, matcherValue: valueFor() }, { onSuccess: () => setF({ ...f, label: '', value: '' }) }); }} data-testid="rule-form">
          <Field label="Name" htmlFor="ru-label"><Input id="ru-label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></Field>
          <Field label="Action" htmlFor="ru-kind">
            <Select id="ru-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option value="ALWAYS">Always Add</option><option value="NEVER">Never Add</option></Select>
          </Field>
          <Field label="When" htmlFor="ru-matcher">
            <Select id="ru-matcher" value={f.matcher} onChange={(e) => setF({ ...f, matcher: e.target.value })}>
              <option value="MERCHANT">Merchant Is</option><option value="CATEGORY">Category Is</option><option value="MIN_VALUE">Value Is At Least ($)</option><option value="OFFER_TYPE">Offer Type Is</option><option value="KEYWORD">Offer Mentions</option><option value="SPEND_HISTORY">I Already Spend There</option>
            </Select>
          </Field>
          <Field label="Value" htmlFor="ru-value"><Input id="ru-value" value={f.value} disabled={f.matcher === 'SPEND_HISTORY'} onChange={(e) => setF({ ...f, value: e.target.value })} /></Field>
          <div className="flex items-end"><Button type="submit" loading={create.isPending} data-testid="add-rule">Add Rule</Button></div>
        </form>
        <ErrorText error={create.error ?? remove.error} />
        <ul className="mt-3 divide-y divide-slate-100 text-sm" data-testid="rules">
          {(q.data ?? []).map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="rule">
              <Badge tone={r.kind === 'ALWAYS' ? 'green' : 'red'}>{r.kind === 'ALWAYS' ? 'Always' : 'Never'}</Badge>
              <span className="font-medium">{r.label}</span>
              <span className="text-xs text-slate-600">{describeRule(r)}{r.matcher === 'MIN_VALUE' ? ` (${centsText(r.matcherValue)})` : ''}</span>
              <Button variant="ghost" className="ml-auto px-2 py-1 text-xs" onClick={() => remove.mutate(r.id)}>Remove</Button>
            </li>
          ))}
          {q.data && !q.data.length && <li className="py-2 text-slate-600">No rules yet.</li>}
        </ul>
      </Panel>
    </div>
  );
}

// ─────────────────────────── page ───────────────────────────

export default function OfferAutomationPage() {
  const [section, setSection] = useState<Section>('inbox');
  return (
    <>
      <PageHeader title="Offer Automation" subtitle="Find every merchant offer on every card in your household, add the valuable ones by your rules, and keep a record of all of it." />
      <div className="mb-4">
        <Tabs<Section> value={section} onChange={setSection} options={SECTIONS} label="Offer automation sections" />
      </div>
      {section === 'inbox' && <Inbox />}
      {section === 'history' && <Panel title="Offer History"><History /></Panel>}
      {section === 'savings' && <SavingsDashboard />}
      {section === 'sync' && <SyncPanel />}
      {section === 'accounts' && <Accounts />}
      {section === 'rules' && <Rules />}
    </>
  );
}
