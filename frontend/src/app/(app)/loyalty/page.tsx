'use client';

import { useState } from 'react';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import { HealthPanel, ImportsAndConflicts, RefreshHealth, SourceBadge } from '@/components/loyalty-automation';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';
import {
  AccountView,
  barHeights,
  CERT_LABEL,
  CertificateView,
  CertOpportunity,
  daysLabel,
  Dashboard,
  effortLabel,
  EVENT_KINDS,
  ExpirationItem,
  Forecast,
  FORECAST_TYPE_LABEL,
  HistoryResponse,
  HouseholdView,
  KIND_LABEL,
  Member,
  MEMBERSHIP_KINDS,
  MEMBERSHIP_LABEL,
  MembershipRow,
  POLICY_LABEL,
  pointsLabel,
  Registry,
  RISK_LABEL,
  RISK_TONE,
  StatusRow,
  TransferRoute,
  TripResult,
  Valuation,
  VERDICT_LABEL,
} from '@/lib/loyalty';

type Tab = 'overview' | 'miles' | 'points' | 'transfers' | 'refresh' | 'imports' | 'certificates' | 'status' | 'expirations' | 'valuation' | 'household' | 'award';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Loyalty dashboard' },
  { id: 'miles', label: 'Miles' },
  { id: 'points', label: 'Points' },
  { id: 'transfers', label: 'Transfer bonuses' },
  { id: 'certificates', label: 'Certificates' },
  { id: 'status', label: 'Status & memberships' },
  { id: 'expirations', label: 'Expirations' },
  { id: 'valuation', label: 'Asset valuation' },
  { id: 'household', label: 'Household' },
  { id: 'award', label: 'Award travel' },
  { id: 'refresh', label: 'Refresh health' },
  { id: 'imports', label: 'Imports & conflicts' },
];

const KEYS = [['loyalty']] as const;
const today = () => new Date().toISOString().slice(0, 10);

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div className="rounded-lg border border-slate-200 p-3">
    <dt className="text-xs text-slate-600">{label}</dt>
    <dd className={`text-lg font-semibold ${tone ?? ''}`}>{value}</dd>
  </div>
);

function useMembers() {
  return useAuthedQuery<Member[]>(['household', 'members'], '/household/members');
}

function MemberSelect({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const m = useMembers();
  const list = m.data ?? [];
  return (
    <Select id={id} value={value || list[0]?.id || ''} onChange={(e) => onChange(e.target.value)}>
      {list.map((x) => (
        <option key={x.id} value={x.id}>
          {x.nickname}
        </option>
      ))}
    </Select>
  );
}

// ───────────── overview ─────────────

function Overview() {
  const q = useAuthedQuery<Dashboard>(['loyalty', 'dashboard'], '/loyalty/dashboard');
  if (q.isLoading) return <Spinner />;
  const d = q.data;
  if (!d) return <ErrorText error={q.error} />;
  const v = d.valuation;
  const empty = v.currentCents === 0 && d.expiringAccounts.length === 0;
  return (
    <div className="space-y-5" data-testid="loyalty-overview">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Current value" value={money(v.currentCents)} />
        <Stat label="Potential value" value={money(v.potentialCents)} />
        <Stat label="At risk" value={money(v.atRiskCents)} tone={v.atRiskCents > 0 ? 'text-red-700' : ''} />
        <Stat label="Expired" value={money(v.expiredCents)} />
        <Stat label="Recovered" value={money(v.recoveredCents)} tone="text-emerald-700" />
      </dl>
      <HealthPanel />
      {empty && <EmptyState title="Nothing tracked yet">Add your loyalty accounts on the Points tab, then certificates, status and memberships. Pointwise will watch every expiration for you.</EmptyState>}
      {d.expiringAccounts.length > 0 && (
        <Panel title="Needs attention: points">
          <ul className="space-y-1 text-sm" data-testid="overview-expiring">
            {d.expiringAccounts.map((a) => (
              <li key={a.accountId}>
                <Badge tone={RISK_TONE[a.prediction.level]}>{RISK_LABEL[a.prediction.level]}</Badge> {a.message}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {d.certificates.length > 0 && (
        <Panel title="Certificates">
          <ul className="space-y-1 text-sm">
            {d.certificates.map((c) => (
              <li key={c.certId}>{c.message}</li>
            ))}
          </ul>
        </Panel>
      )}
      {d.statuses.length > 0 && (
        <Panel title="Status to watch">
          <ul className="space-y-1 text-sm">
            {d.statuses.map((s) => (
              <li key={s.id}>
                <Badge tone={RISK_TONE[s.view.risk]}>{RISK_LABEL[s.view.risk]}</Badge> {s.member}: {s.view.headline}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {d.memberships.length > 0 && (
        <Panel title="Memberships">
          <ul className="space-y-1 text-sm">
            {d.memberships.map((m) => (
              <li key={m.id}>
                {m.member}: {m.view.headline} {m.creditSuggestion}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="Next 30 days">
        {d.nextThirtyDays.items.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing expires in the next 30 days.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {d.nextThirtyDays.items.map((i, n) => (
              <li key={n}>
                {shortDate(i.date)} — {FORECAST_TYPE_LABEL[i.type] ?? i.type}: {i.label} ({i.member}) {money(i.valueCents)}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

// ───────────── points ─────────────

function AddAccount() {
  const reg = useAuthedQuery<Registry>(['loyalty', 'programs'], '/loyalty/programs');
  const [member, setMember] = useState('');
  const [which, setWhich] = useState('');
  const [custom, setCustom] = useState('');
  const [balance, setBalance] = useState('');
  const [last, setLast] = useState('');
  const [number, setNumber] = useState('');
  const create = useApiMutation<Record<string, unknown>>((b) => ({ path: '/loyalty/accounts', method: 'POST', body: b }), KEYS);
  const isCurrency = which.startsWith('c:');
  const code = which.slice(2);
  const members = useMembers();
  const profileId = member || members.data?.[0]?.id || '';
  return (
    <Panel title="Add a loyalty account" data-testid="add-account">
      <form
        className="grid gap-3 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = { profileId, balance: Number(balance) || 0, ...(last ? { lastActivityAt: new Date(last).toISOString() } : {}), ...(number ? { accountNumber: number } : {}) };
          if (custom.trim()) body.customName = custom.trim();
          else if (isCurrency) body.currencyCode = code;
          else body.programCode = code;
          create.mutate(body, { onSuccess: () => { setBalance(''); setCustom(''); setNumber(''); } });
        }}
      >
        <Field label="Member" htmlFor="la-member">
          <MemberSelect id="la-member" value={member} onChange={setMember} />
        </Field>
        <Field label="Program" htmlFor="la-program" hint="Or type a program that is not listed.">
          <Select id="la-program" value={which} onChange={(e) => setWhich(e.target.value)} disabled={!!custom.trim()}>
            <option value="">Choose…</option>
            {(['AIRLINE', 'HOTEL', 'OTHER'] as const).map((k) => (
              <optgroup key={k} label={KIND_LABEL[k]}>
                {(reg.data?.programs ?? []).filter((p) => (k === 'OTHER' ? !['AIRLINE', 'HOTEL'].includes(p.kind) : p.kind === k)).map((p) => (
                  <option key={p.code} value={`p:${p.code}`}>
                    {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label="Bank rewards">
              {(reg.data?.currencies ?? []).map((c) => (
                <option key={c.code} value={`c:${c.code}`}>
                  {c.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
        <Field label="Other program (optional)" htmlFor="la-custom">
          <Input id="la-custom" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Future or local program" />
        </Field>
        <Field label="Current balance" htmlFor="la-balance">
          <Input id="la-balance" type="number" min="0" value={balance} onChange={(e) => setBalance(e.target.value)} />
        </Field>
        <Field label="Last activity (optional)" htmlFor="la-last" hint="Used to predict expiration.">
          <Input id="la-last" type="date" max={today()} value={last} onChange={(e) => setLast(e.target.value)} />
        </Field>
        <Field label="Account number (optional)" htmlFor="la-number" hint="Stored encrypted; only the last 4 are shown.">
          <Input id="la-number" value={number} onChange={(e) => setNumber(e.target.value)} autoComplete="off" />
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" loading={create.isPending} disabled={!profileId || (!which && !custom.trim())} data-testid="save-account">
            Add account
          </Button>
          <ErrorText error={create.error} />
        </div>
      </form>
    </Panel>
  );
}

function AccountRow({ a }: { a: AccountView }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState('EARN');
  const [pts, setPts] = useState('');
  const hist = useAuthedQuery<HistoryResponse>(['loyalty', 'history', a.id], `/loyalty/accounts/${a.id}/history?months=12`, { enabled: open });
  const add = useApiMutation<{ kind: string; points: number }>((b) => ({ path: `/loyalty/accounts/${a.id}/events`, method: 'POST', body: b }), KEYS);
  const remove = useApiMutation<void>(() => ({ path: `/loyalty/accounts/${a.id}`, method: 'DELETE' }), KEYS);
  const p = a.prediction;
  const heights = hist.data ? barHeights(hist.data.months) : [];
  return (
    <li className="py-3" data-testid="account">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">{a.programName}</span>
        {a.nickname && <span className="text-slate-600">({a.nickname})</span>}
        <span className="text-slate-600">{a.member}{a.accountLast4 ? ` · ··${a.accountLast4}` : ''}</span>
        <span className="ml-auto font-semibold">{pointsLabel(a.balance, a.unit)}</span>
        <span className="text-slate-600">{money(a.valueCents)}</span>
        <Badge tone={RISK_TONE[p.level]}>{p.expiresAt ? `${RISK_LABEL[p.level]} · ${daysLabel(p.daysLeft)}` : RISK_LABEL[p.level]}</Badge>
        <SourceBadge source={a.balanceSource} reliability={a.balanceReliability} />
        <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Close' : 'Details'}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-3 rounded-lg bg-slate-50 p-3 text-sm" data-testid="account-details">
          <p>
            <strong>{POLICY_LABEL[a.policy.type]}</strong>
            {a.policy.months ? ` (${a.policy.months} months)` : ''} {a.policy.verified ? '' : '— not verified; confirm with the program.'}
          </p>
          <p className="text-slate-700">{p.reason} Confidence {p.confidence}%.</p>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              add.mutate({ kind, points: Number(pts) || 0 }, { onSuccess: () => setPts('') });
            }}
          >
            <Field label="Record" htmlFor={`ev-kind-${a.id}`}>
              <Select id={`ev-kind-${a.id}`} value={kind} onChange={(e) => setKind(e.target.value)}>
                {EVENT_KINDS.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Points" htmlFor={`ev-pts-${a.id}`}>
              <Input id={`ev-pts-${a.id}`} type="number" min="1" value={pts} onChange={(e) => setPts(e.target.value)} />
            </Field>
            <Button type="submit" variant="secondary" disabled={!pts} loading={add.isPending}>
              Record
            </Button>
            <Button type="button" variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
              Remove account
            </Button>
          </form>
          <ErrorText error={add.error} />
          {hist.data && (
            <div data-testid="history">
              <div className="flex h-24 items-end gap-1" role="img" aria-label={`Balance by month, from ${pointsLabel(hist.data.growth.startBalance, a.unit)} to ${pointsLabel(hist.data.growth.endBalance, a.unit)}`}>
                {hist.data.months.map((m, i) => (
                  <div key={m.month} className="flex-1 rounded-t bg-brand-500" style={{ height: `${Math.max(heights[i], 2)}%` }} title={`${m.month}: ${m.balance.toLocaleString('en-US')}`} />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {hist.data.months[0]?.month} → {hist.data.months[hist.data.months.length - 1]?.month} · change {hist.data.growth.change.toLocaleString('en-US')}
                {hist.data.growth.pct != null ? ` (${hist.data.growth.pct}%)` : ''} · earned {hist.data.totals.earned.toLocaleString('en-US')}, bonus {hist.data.totals.bonus.toLocaleString('en-US')}, redeemed {hist.data.totals.redeemed.toLocaleString('en-US')}, expired {hist.data.totals.expired.toLocaleString('en-US')}, transferred out {hist.data.totals.transferredOut.toLocaleString('en-US')}
              </p>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function Points({ only }: { only: 'miles' | 'points' }) {
  const q0 = useAuthedQuery<AccountView[]>(['loyalty', 'accounts'], '/loyalty/accounts');
  const q = { ...q0, data: q0.data?.filter((a) => (only === 'miles' ? a.kind === 'AIRLINE' : a.kind !== 'AIRLINE')) };
  return (
    <div className="space-y-5" data-testid={`${only}-tab`}>
      {only === 'points' && <AddAccount />}
      {only === 'miles' && <p className="text-sm text-slate-600">Airline miles. Add an airline account on the Points tab; it appears here.</p>}
      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && <EmptyState title="No accounts yet">Add an airline, hotel or bank rewards account above.</EmptyState>}
      {q.data && q.data.length > 0 && (
        <ul className="divide-y divide-slate-100" data-testid="accounts">
          {q.data.map((a) => (
            <AccountRow key={a.id} a={a} />
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────── certificates ─────────────

function Certificates() {
  const q = useAuthedQuery<CertificateView[]>(['loyalty', 'certificates'], '/loyalty/certificates');
  const ops = useAuthedQuery<CertOpportunity[]>(['loyalty', 'cert-ops'], '/loyalty/certificates/opportunities');
  const [member, setMember] = useState('');
  const [f, setF] = useState({ category: 'FREE_NIGHT', name: '', expiresAt: '', pointCap: '', value: '', eligible: '' });
  const members = useMembers();
  const profileId = member || members.data?.[0]?.id || '';
  const create = useApiMutation<Record<string, unknown>>((b) => ({ path: '/loyalty/certificates', method: 'POST', body: b }), KEYS);
  const use = useApiMutation<string>((id) => ({ path: `/loyalty/certificates/${id}`, method: 'PATCH', body: { status: 'USED' } }), KEYS);
  const remove = useApiMutation<string>((id) => ({ path: `/loyalty/certificates/${id}`, method: 'DELETE' }), KEYS);
  return (
    <div className="space-y-5" data-testid="certificates">
      {(ops.data ?? []).length > 0 && (
        <Panel title="Use these first">
          <ul className="space-y-1 text-sm" data-testid="cert-opportunities">
            {ops.data!.slice(0, 5).map((o) => (
              <li key={o.certId}>
                <Badge tone={o.urgency === 'HIGH' ? 'red' : o.urgency === 'MEDIUM' ? 'amber' : 'slate'}>{o.urgency === 'HIGH' ? 'Soon' : o.urgency === 'MEDIUM' ? 'This quarter' : 'Later'}</Badge> {o.message}
              </li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="Add a certificate">
        <form
          className="grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(
              { profileId, category: f.category, name: f.name, ...(f.expiresAt ? { expiresAt: new Date(f.expiresAt).toISOString() } : {}), ...(f.pointCap ? { pointCap: Number(f.pointCap) } : {}), ...(f.value ? { potentialValueCents: Math.round(Number(f.value) * 100) } : {}), ...(f.eligible ? { eligible: f.eligible.split(',').map((x) => x.trim()).filter(Boolean) } : {}) },
              { onSuccess: () => setF({ ...f, name: '', expiresAt: '', pointCap: '', value: '', eligible: '' }) },
            );
          }}
        >
          <Field label="Member" htmlFor="ct-member">
            <MemberSelect id="ct-member" value={member} onChange={setMember} />
          </Field>
          <Field label="Type" htmlFor="ct-cat">
            <Select id="ct-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
              <option value="FREE_NIGHT">Free night certificate</option>
              <option value="COMPANION">Companion certificate</option>
              <option value="UPGRADE">Upgrade certificate</option>
            </Select>
          </Field>
          <Field label="Name" htmlFor="ct-name">
            <Input id="ct-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="IHG free night" required />
          </Field>
          <Field label="Expires" htmlFor="ct-exp">
            <Input id="ct-exp" type="date" value={f.expiresAt} onChange={(e) => setF({ ...f, expiresAt: e.target.value })} />
          </Field>
          <Field label="Point cap (free nights)" htmlFor="ct-cap">
            <Input id="ct-cap" type="number" min="0" value={f.pointCap} onChange={(e) => setF({ ...f, pointCap: e.target.value })} />
          </Field>
          <Field label="Potential value ($)" htmlFor="ct-val">
            <Input id="ct-val" type="number" min="0" step="1" value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />
          </Field>
          <Field label="Eligible hotels / routes" htmlFor="ct-elig" hint="Comma separated; leave empty for any.">
            <Input id="ct-elig" value={f.eligible} onChange={(e) => setF({ ...f, eligible: e.target.value })} />
          </Field>
          <div className="sm:col-span-3">
            <Button type="submit" loading={create.isPending} disabled={!profileId || f.name.trim().length < 2} data-testid="save-cert">
              Add certificate
            </Button>
            <ErrorText error={create.error} />
          </div>
        </form>
      </Panel>
      {q.isLoading && <Spinner />}
      {q.data && q.data.length === 0 && <EmptyState title="No certificates">Free night, companion and upgrade certificates you add appear here.</EmptyState>}
      {q.data && q.data.length > 0 && (
        <ul className="divide-y divide-slate-100 text-sm" data-testid="cert-list">
          {q.data.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="cert">
              <Badge tone="brand">{CERT_LABEL[c.category]}</Badge>
              <span className="font-medium">{c.name}</span>
              <span className="text-slate-600">{c.member}{c.quantity > 1 ? ` · ×${c.quantity}` : ''}</span>
              {c.pointCap != null && <span className="text-slate-600">cap {c.pointCap.toLocaleString('en-US')} pts</span>}
              <Badge tone={c.view.state === 'EXPIRING' ? 'amber' : c.view.state === 'EXPIRED' ? 'red' : c.view.state === 'USED' ? 'slate' : 'green'}>
                {c.view.state === 'USED' ? 'Used' : c.view.state === 'EXPIRED' ? 'Expired' : c.expiresAt ? `${c.view.state === 'EXPIRING' ? 'Expires in ' : 'Valid ~'}${daysLabel(c.view.daysLeft)}` : 'No expiry'}
              </Badge>
              {c.potentialValueCents > 0 && <span className="text-slate-600">{money(c.potentialValueCents)}</span>}
              <span className="ml-auto flex gap-1">
                {c.view.state !== 'USED' && c.view.state !== 'EXPIRED' && (
                  <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => use.mutate(c.id)}>
                    Mark used
                  </Button>
                )}
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => remove.mutate(c.id)}>
                  Remove
                </Button>
              </span>
              {(c.restrictions || c.blackout || c.eligible.length > 0) && (
                <p className="basis-full text-xs text-slate-600">
                  {c.eligible.length > 0 && `Eligible: ${c.eligible.join(', ')}. `}
                  {c.blackout && `Blackout: ${c.blackout}. `}
                  {c.restrictions}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ───────────── status & memberships ─────────────

function StatusAndMemberships() {
  const st = useAuthedQuery<StatusRow[]>(['loyalty', 'status'], '/loyalty/status');
  const ms = useAuthedQuery<MembershipRow[]>(['loyalty', 'memberships'], '/loyalty/memberships');
  const [member, setMember] = useState('');
  const members = useMembers();
  const profileId = member || members.data?.[0]?.id || '';
  const [s, setS] = useState({ program: '', kind: 'AIRLINE', level: '', expires: '', metric: 'nights', progress: '', required: '', value: '' });
  const [m, setM] = useState({ kind: 'GLOBAL_ENTRY', name: '', expires: '', cost: '', auto: false });
  const addStatus = useApiMutation<Record<string, unknown>>((b) => ({ path: '/loyalty/status', method: 'POST', body: b }), KEYS);
  const addMember = useApiMutation<Record<string, unknown>>((b) => ({ path: '/loyalty/memberships', method: 'POST', body: b }), KEYS);
  const removeMember = useApiMutation<string>((id) => ({ path: `/loyalty/memberships/${id}`, method: 'DELETE' }), KEYS);
  const current = (st.data ?? []).filter((x) => x.current);
  const past = (st.data ?? []).filter((x) => !x.current);
  return (
    <div className="space-y-5" data-testid="status-tab">
      <Panel title="Elite status">
        {current.length === 0 ? (
          <p className="text-sm text-slate-600">No status recorded yet.</p>
        ) : (
          <ul className="space-y-3 text-sm" data-testid="status-list">
            {current.map((x) => (
              <li key={x.id} data-testid="status-row">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{x.member}</span>
                  <span>{x.program} {x.level}</span>
                  <Badge tone={RISK_TONE[x.view.risk]}>{x.view.risk === 'NONE' ? 'Maintained' : `${RISK_LABEL[x.view.risk]} · renewal ${x.view.renewalLikelihood}%`}</Badge>
                  {x.expiresAt && <span className="text-slate-600">expires {shortDate(x.expiresAt)}</span>}
                </div>
                {x.view.pct != null && (
                  <div className="mt-1 h-2 w-full max-w-sm rounded bg-slate-200" role="progressbar" aria-valuenow={x.view.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${x.program} ${x.level} progress`}>
                    <div className="h-2 rounded bg-brand-600" style={{ width: `${x.view.pct}%` }} />
                  </div>
                )}
                <p className="mt-1 text-xs text-slate-700">{x.view.headline}{x.view.actions[0] ? ` — ${x.view.actions[0]}` : ''}</p>
              </li>
            ))}
          </ul>
        )}
        {past.length > 0 && <p className="mt-3 text-xs text-slate-600">Qualification history: {past.map((x) => `${x.program} ${x.level}${x.expiresAt ? ` (to ${x.expiresAt.slice(0, 7)})` : ''}`).join(' · ')}</p>}
        <form
          className="mt-4 grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            addStatus.mutate({ profileId, programName: s.program, kind: s.kind, level: s.level, metric: s.metric, progress: Number(s.progress) || 0, required: Number(s.required) || 0, ...(s.expires ? { expiresAt: new Date(s.expires).toISOString(), periodStart: new Date(new Date(s.expires).getTime() - 365 * 86_400_000).toISOString() } : {}), valueCents: Math.round(Number(s.value) * 100) || 0 }, { onSuccess: () => setS({ ...s, program: '', level: '', progress: '', required: '' }) });
          }}
        >
          <Field label="Member" htmlFor="st-member"><MemberSelect id="st-member" value={member} onChange={setMember} /></Field>
          <Field label="Program" htmlFor="st-prog"><Input id="st-prog" value={s.program} onChange={(e) => setS({ ...s, program: e.target.value })} placeholder="Marriott" required /></Field>
          <Field label="Kind" htmlFor="st-kind">
            <Select id="st-kind" value={s.kind} onChange={(e) => setS({ ...s, kind: e.target.value })}>
              {['AIRLINE', 'HOTEL', 'RENTAL_CAR', 'CRUISE', 'CARD'].map((k) => <option key={k} value={k}>{KIND_LABEL[k] ?? k.replace('_', ' ').toLowerCase()}</option>)}
            </Select>
          </Field>
          <Field label="Level" htmlFor="st-level"><Input id="st-level" value={s.level} onChange={(e) => setS({ ...s, level: e.target.value })} placeholder="Platinum" required /></Field>
          <Field label="Expires" htmlFor="st-exp"><Input id="st-exp" type="date" value={s.expires} onChange={(e) => setS({ ...s, expires: e.target.value })} /></Field>
          <Field label="Counts (nights, PQP…)" htmlFor="st-metric"><Input id="st-metric" value={s.metric} onChange={(e) => setS({ ...s, metric: e.target.value })} /></Field>
          <Field label="Progress" htmlFor="st-prog-n"><Input id="st-prog-n" type="number" min="0" value={s.progress} onChange={(e) => setS({ ...s, progress: e.target.value })} /></Field>
          <Field label="Required" htmlFor="st-req"><Input id="st-req" type="number" min="0" value={s.required} onChange={(e) => setS({ ...s, required: e.target.value })} /></Field>
          <div className="sm:col-span-4">
            <Button type="submit" loading={addStatus.isPending} disabled={!profileId || !s.program.trim() || !s.level.trim()} data-testid="save-status">Add status</Button>
            <ErrorText error={addStatus.error} />
          </div>
        </form>
      </Panel>

      <Panel title="Memberships">
        {(ms.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-600">No memberships recorded.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm" data-testid="membership-list">
            {ms.data!.map((x) => (
              <li key={x.id} className="flex flex-wrap items-center gap-2 py-2" data-testid="membership">
                <span className="font-medium">{x.member}</span>
                <Badge tone="brand">{MEMBERSHIP_LABEL[x.kind] ?? x.kind}</Badge>
                <span>{x.view.headline}</span>
                {x.memberLast4 && <span className="text-slate-600">··{x.memberLast4}</span>}
                {x.creditSuggestion && <span className="basis-full text-xs text-emerald-800">{x.creditSuggestion}</span>}
                <Button variant="ghost" className="ml-auto px-2 py-1 text-xs" onClick={() => removeMember.mutate(x.id)}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
        <form
          className="mt-4 grid gap-3 sm:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            addMember.mutate({ profileId, kind: m.kind, name: m.name || MEMBERSHIP_LABEL[m.kind], autoRenew: m.auto, ...(m.expires ? { expiresAt: new Date(m.expires).toISOString() } : {}), renewalCostCents: Math.round(Number(m.cost) * 100) || 0 }, { onSuccess: () => setM({ ...m, name: '', expires: '', cost: '' }) });
          }}
        >
          <Field label="Type" htmlFor="mb-kind">
            <Select id="mb-kind" value={m.kind} onChange={(e) => setM({ ...m, kind: e.target.value })}>
              {MEMBERSHIP_KINDS.map((k) => <option key={k} value={k}>{MEMBERSHIP_LABEL[k]}</option>)}
            </Select>
          </Field>
          <Field label="Name (optional)" htmlFor="mb-name"><Input id="mb-name" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} /></Field>
          <Field label="Expires" htmlFor="mb-exp"><Input id="mb-exp" type="date" value={m.expires} onChange={(e) => setM({ ...m, expires: e.target.value })} /></Field>
          <Field label="Renewal cost ($)" htmlFor="mb-cost"><Input id="mb-cost" type="number" min="0" value={m.cost} onChange={(e) => setM({ ...m, cost: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-4"><input type="checkbox" checked={m.auto} onChange={(e) => setM({ ...m, auto: e.target.checked })} /> Renews automatically</label>
          <div className="sm:col-span-4">
            <Button type="submit" loading={addMember.isPending} disabled={!profileId} data-testid="save-membership">Add membership</Button>
            <ErrorText error={addMember.error} />
          </div>
        </form>
      </Panel>
    </div>
  );
}

// ───────────── expirations ─────────────

function Expirations() {
  const q = useAuthedQuery<{ atRiskPoints: number; items: ExpirationItem[] }>(['loyalty', 'expirations'], '/loyalty/expirations');
  const f = useAuthedQuery<Forecast>(['loyalty', 'forecast'], '/loyalty/forecast');
  return (
    <div className="space-y-5" data-testid="expirations">
      <Panel title="Points and expiration risk">
        {q.isLoading && <Spinner />}
        {q.data && q.data.items.length === 0 && <p className="text-sm text-slate-600">No balances to watch.</p>}
        <ul className="divide-y divide-slate-100 text-sm">
          {(q.data?.items ?? []).map((i) => (
            <li key={i.accountId} className="py-3" data-testid="expiration-item">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{i.program}</span>
                <span className="text-slate-600">{i.member}</span>
                <Badge tone={RISK_TONE[i.prediction.level]}>{RISK_LABEL[i.prediction.level]}</Badge>
                <Badge tone="slate">Confidence {i.prediction.confidence}%</Badge>
                <span className="ml-auto">{pointsLabel(i.balance, i.unit)}</span>
              </div>
              <p className="text-slate-700">{i.message ?? i.prediction.reason}</p>
              {i.preservation.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-xs text-slate-700" data-testid="preservation">
                  {i.preservation.slice(0, 3).map((m) => (
                    <li key={m.key}>
                      {m.label} — about {m.estCostCents ? money(m.estCostCents) : 'no extra cost'}, {effortLabel(m.effort).toLowerCase()}{m.fitsDeadline ? '' : ' (may not post in time)'}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Expiration forecast">
        {f.isLoading && <Spinner />}
        {f.data && f.data.overdue.length > 0 && (
          <p className="mb-2 rounded bg-red-50 p-2 text-sm text-red-800" data-testid="overdue">
            Past due: {f.data.overdue.map((o) => `${o.label} (${shortDate(o.date)})`).join(', ')}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid="forecast">
          {(f.data?.buckets ?? []).map((b) => (
            <div key={b.key} className="rounded-lg border border-slate-200 p-3" data-testid={`forecast-${b.key}`}>
              <h3 className="text-sm font-semibold">{b.label}</h3>
              <p className="text-xs text-slate-600">{b.items.length} item(s) · {money(b.totalCents)}</p>
              <ul className="mt-1 space-y-1 text-xs">
                {b.items.map((i, n) => (
                  <li key={n}>
                    {shortDate(i.date)} · {FORECAST_TYPE_LABEL[i.type] ?? i.type}: {i.label} ({i.member})
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ───────────── valuation & household ─────────────

function ValuationTab() {
  const q = useAuthedQuery<Valuation>(['loyalty', 'valuation'], '/loyalty/valuation');
  if (q.isLoading) return <Spinner />;
  const v = q.data;
  if (!v) return <ErrorText error={q.error} />;
  const cats: Array<[string, number]> = [['Points and miles', v.byCategory.points], ['Certificates', v.byCategory.certificates], ['Elite status', v.byCategory.status], ['Memberships', v.byCategory.memberships], ['Card credits', v.byCategory.credits]];
  return (
    <div className="space-y-5" data-testid="valuation">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Current value" value={money(v.currentCents)} />
        <Stat label="Potential value" value={money(v.potentialCents)} />
        <Stat label="At-risk value" value={money(v.atRiskCents)} />
        <Stat label="Expired value" value={money(v.expiredCents)} />
        <Stat label="Recovered value" value={money(v.recoveredCents)} />
        <Stat label="Net annual value" value={money(v.annualNetCents)} />
      </dl>
      <Panel title="By asset type">
        <ul className="space-y-1 text-sm" data-testid="valuation-categories">
          {cats.map(([label, cents]) => (
            <li key={label} className="flex justify-between"><span>{label}</span><span>{money(cents)}</span></li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-600">Points are valued at each program's planning estimate (¢ per point), not a price you can sell at. Net annual value is status and membership value less renewal costs.</p>
      </Panel>
    </div>
  );
}

function HouseholdTab() {
  const q = useAuthedQuery<HouseholdView>(['loyalty', 'household'], '/loyalty/household');
  if (q.isLoading) return <Spinner />;
  const h = q.data;
  if (!h) return <ErrorText error={q.error} />;
  return (
    <div className="space-y-5" data-testid="household">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Combined value" value={money(h.combined.currentCents)} />
        <Stat label="Combined points" value={h.combined.totalPoints.toLocaleString('en-US')} />
        <Stat label="At risk" value={money(h.combined.atRiskCents)} />
        <Stat label="Net annual value" value={money(h.combined.annualNetCents)} />
      </dl>
      <Panel title="By member">
        <table className="w-full text-sm" data-testid="household-members">
          <thead className="text-left text-xs text-slate-600"><tr><th className="py-1">Member</th><th>Points</th><th>Value</th><th>At risk</th></tr></thead>
          <tbody>
            {h.members.map((m) => (
              <tr key={m.memberId} className="border-t border-slate-100"><td className="py-1 font-medium">{m.member}</td><td>{m.points.toLocaleString('en-US')}</td><td>{money(m.currentCents)}</td><td>{money(m.atRiskCents)}</td></tr>
            ))}
          </tbody>
        </table>
      </Panel>
      {h.expiring.length > 0 && (
        <Panel title="Combined expirations">
          <ul className="space-y-1 text-sm">{h.expiring.map((e, i) => <li key={i}>{e.member}: {e.atRiskPoints.toLocaleString('en-US')} {e.program} — {daysLabel(e.daysLeft)}</li>)}</ul>
        </Panel>
      )}
      {h.transfers.length > 0 && (
        <Panel title="Transfer opportunities">
          <ul className="space-y-1 text-sm">{h.transfers.map((t, i) => <li key={i}>{t.member}: {t.points.toLocaleString('en-US')} {t.currency} → best at {t.program} ({t.centsPerPoint.toFixed(2)}¢{t.bonusPercent ? `, ${t.bonusPercent}% bonus` : ''})</li>)}</ul>
        </Panel>
      )}
    </div>
  );
}

// ───────────── award travel ─────────────

function TransferBonuses() {
  const routes = useAuthedQuery<TransferRoute[]>(['loyalty', 'transfers'], '/loyalty/transfers');
  if (routes.isLoading) return <Spinner />;
  const list = routes.data ?? [];
  return (
    <Panel title="Transfer partners and bonuses" data-testid="transfer-tab">
      <p className="mb-2 text-sm text-slate-600">Ratios are from general knowledge; confirm in your bank's portal. Bonus history builds as Pointwise observes bonuses, so early advice has low confidence.</p>
      {list.length === 0 ? (
        <EmptyState title="No transfer routes">Transfer partners appear once programs and bank currencies are in the catalog.</EmptyState>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-slate-600"><tr><th className="py-1">Route</th><th>Ratio</th><th>Bonus</th><th>Advice</th></tr></thead>
          <tbody>
            {list.map((r) => (
              <tr key={`${r.currency}-${r.program}`} className="border-t border-slate-100 align-top">
                <td className="py-1">{r.currencyName} → {r.programName}</td>
                <td>{r.ratio}</td>
                <td>{r.activeBonusPercent ? `${r.activeBonusPercent}%` : '—'}</td>
                <td><Badge tone={VERDICT_LABEL[r.advice.verdict].tone}>{VERDICT_LABEL[r.advice.verdict].label}</Badge> <span className="text-xs text-slate-700">{r.advice.text}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function AwardTravel() {
  const routes = useAuthedQuery<TransferRoute[]>(['loyalty', 'transfers'], '/loyalty/transfers');
  const [f, setF] = useState({ destination: '', from: '', to: '', cabin: 'BUSINESS', region: 'LONG_HAUL', points: '', airline: '', hotel: '' });
  const [res, setRes] = useState<TripResult | null>(null);
  const run = useApiMutation<{ save: boolean }, TripResult>(
    (v) => ({
      path: '/loyalty/award-trips',
      method: 'POST',
      body: { destination: f.destination, dateFrom: new Date(f.from).toISOString(), dateTo: new Date(f.to).toISOString(), cabin: f.cabin, region: f.region, ...(f.points ? { pointsNeeded: Number(f.points) } : {}), airlinePrefs: f.airline.split(',').map((x) => x.trim()).filter(Boolean), hotelPrefs: f.hotel.split(',').map((x) => x.trim()).filter(Boolean), save: v.save },
    }),
    [['loyalty', 'trips']],
  );
  const valid = f.destination.trim().length >= 2 && f.from && f.to && f.to >= f.from;
  const hot = (routes.data ?? []).filter((r) => r.activeBonusPercent || r.advice.verdict === 'WAIT').slice(0, 8);
  return (
    <div className="space-y-5" data-testid="award-travel">
      <Panel title="Plan an award trip">
        <form className="grid gap-3 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run.mutate({ save: false }, { onSuccess: setRes }); }}>
          <Field label="Destination" htmlFor="at-dest"><Input id="at-dest" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} placeholder="Tokyo" required /></Field>
          <Field label="From" htmlFor="at-from"><Input id="at-from" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} required /></Field>
          <Field label="To" htmlFor="at-to"><Input id="at-to" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} required /></Field>
          <Field label="Cabin" htmlFor="at-cabin">
            <Select id="at-cabin" value={f.cabin} onChange={(e) => setF({ ...f, cabin: e.target.value })}>
              <option value="ECONOMY">Economy</option><option value="PREMIUM_ECONOMY">Premium economy</option><option value="BUSINESS">Business</option><option value="FIRST">First</option>
            </Select>
          </Field>
          <Field label="Distance" htmlFor="at-region">
            <Select id="at-region" value={f.region} onChange={(e) => setF({ ...f, region: e.target.value })}>
              <option value="DOMESTIC">Domestic</option><option value="SHORT_INTERNATIONAL">Short international</option><option value="LONG_HAUL">Long haul</option>
            </Select>
          </Field>
          <Field label="Exact points (optional)" htmlFor="at-pts" hint="Otherwise a coarse estimate is used."><Input id="at-pts" type="number" min="1" value={f.points} onChange={(e) => setF({ ...f, points: e.target.value })} /></Field>
          <Field label="Airline preferences" htmlFor="at-air"><Input id="at-air" value={f.airline} onChange={(e) => setF({ ...f, airline: e.target.value })} placeholder="United, Aeroplan" /></Field>
          <Field label="Hotel preferences" htmlFor="at-hotel"><Input id="at-hotel" value={f.hotel} onChange={(e) => setF({ ...f, hotel: e.target.value })} placeholder="Hyatt, IHG" /></Field>
          <div className="sm:col-span-4 flex items-center gap-3">
            <Button type="submit" disabled={!valid} loading={run.isPending} data-testid="plan-trip">Evaluate trip</Button>
            <ErrorText error={run.error} />
          </div>
        </form>
      </Panel>
      {res && (
        <Panel title={`${res.destination} · ${pointsLabel(res.pointsNeeded)}${res.pointsEstimated ? ' (estimate)' : ''}`} action={<Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => run.mutate({ save: true }, { onSuccess: setRes })}>Save trip</Button>}>
          {res.estimateNote && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-900">{res.estimateNote}</p>}
          {res.options.length === 0 ? <EmptyState title="No program in reach">Add balances or bank points with transfer partners first.</EmptyState> : (
            <ol className="space-y-3" data-testid="trip-options">
              {res.options.map((o, i) => (
                <li key={o.programCode} className="rounded-lg border border-slate-200 p-3 text-sm" data-testid="trip-option">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={i === 0 ? 'green' : 'slate'}>{i === 0 ? 'Best' : `#${i + 1}`}</Badge>
                    <span className="font-medium">{o.programName}</span>
                    <span>{o.shortfall === 0 ? 'fully covered' : `${o.shortfall.toLocaleString('en-US')} short`}</span>
                    {o.activeBonusPercent && <Badge tone="brand">{o.activeBonusPercent}% bonus</Badge>}
                  </div>
                  <ul className="mt-1 list-disc pl-5 text-xs text-slate-700">{[...o.reasons, ...o.warnings].map((r) => <li key={r}>{r}</li>)}</ul>
                </li>
              ))}
            </ol>
          )}
          {res.certificates.length > 0 && <ul className="mt-3 text-sm" data-testid="trip-certificates">{res.certificates.map((c) => <li key={c.certId}>{c.usable ? '✔' : '✖'} {c.name} ({c.member}) — {c.note}</li>)}</ul>}
          {res.expiringAssets.length > 0 && <p className="mt-3 text-xs text-slate-700">Use first: {res.expiringAssets.map((a) => `${a.atRiskPoints.toLocaleString('en-US')} ${a.program} (${daysLabel(a.daysLeft)})`).join(', ')}.</p>}
        </Panel>
      )}
      <Panel title="Transfer bonuses">
        {hot.length === 0 ? <p className="text-sm text-slate-600">No active or expected bonuses. Bonus history builds as Pointwise observes them.</p> : (
          <ul className="space-y-2 text-sm" data-testid="transfer-bonuses">
            {hot.map((r) => (
              <li key={`${r.currency}-${r.program}`}>
                <Badge tone={VERDICT_LABEL[r.advice.verdict].tone}>{VERDICT_LABEL[r.advice.verdict].label}</Badge> {r.currencyName} → {r.programName} ({r.ratio}{r.activeBonusPercent ? `, ${r.activeBonusPercent}% bonus` : ''}). {r.advice.text}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

export default function LoyaltyPage() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="space-y-6" data-testid="loyalty">
      <PageHeader title="Loyalty assets" subtitle="Points, miles, certificates, status and memberships for your whole household — with every expiration watched." />
      <div role="tablist" aria-label="Loyalty" className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button key={t.id} role="tab" type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)} data-testid={`tab-${t.id}`} className={`rounded-t-lg px-3 py-2 text-sm ${tab === t.id ? 'border-b-2 border-brand-600 font-semibold text-brand-800' : 'text-slate-700 hover:bg-slate-100'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'miles' && <Points only="miles" />}
      {tab === 'points' && <Points only="points" />}
      {tab === 'transfers' && <TransferBonuses />}
      {tab === 'refresh' && <RefreshHealth />}
      {tab === 'imports' && <ImportsAndConflicts />}
      {tab === 'certificates' && <Certificates />}
      {tab === 'status' && <StatusAndMemberships />}
      {tab === 'expirations' && <Expirations />}
      {tab === 'valuation' && <ValuationTab />}
      {tab === 'household' && <HouseholdTab />}
      {tab === 'award' && <AwardTravel />}
    </div>
  );
}
