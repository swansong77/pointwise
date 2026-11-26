'use client';

import { titleCase } from '@/lib/title-case';
import { useState } from 'react';
import { BrandLogo } from '@/components/brand-logo';
import { Badge, Button, EmptyState, ErrorText, Field, Input, Panel, Select, Spinner } from '@/components/ui';
import { shortDate } from '@/lib/format';
import { useApi } from '@/lib/api';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';
import {
  AuditResponse,
  daysLabel,
  EmailSamplePreview,
  ExtensionToken,
  FIELD_LABEL,
  FRESH_LABEL,
  HEALTH_TONE,
  HealthResponse,
  ObservationRow,
  OUTCOME_LABEL,
  PRIORITY_TONE,
  RefreshStatus,
  showValue,
  SOURCE_LABEL,
  SourceType,
} from '@/lib/loyalty';

const KEYS = [['loyalty']] as const;

/** Where a value came from and how far to trust it. */
export function SourceBadge({ source, reliability }: { source: SourceType | null; reliability: number | null }) {
  if (!source) return <Badge tone="slate">No data</Badge>;
  return (
    <Badge tone={(reliability ?? 0) >= 75 ? 'green' : (reliability ?? 0) >= 50 ? 'amber' : 'slate'}>
      {SOURCE_LABEL[source]} · {reliability}
    </Badge>
  );
}

export function HealthPanel() {
  const q = useAuthedQuery<HealthResponse>(['loyalty', 'health'], '/loyalty/health');
  if (q.isLoading) return <Spinner />;
  const h = q.data;
  if (!h) return <ErrorText error={q.error} />;
  return (
    <Panel title="Loyalty health" data-testid="health">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-3xl font-semibold" data-testid="health-score">{h.household.score}</span>
        <span className="text-sm text-slate-600">/ 100 household</span>
        <Badge tone={HEALTH_TONE(h.household.score)}>{h.household.label.toLowerCase().replace('_', ' ')}</Badge>
      </div>
      {h.household.reasons.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-slate-700">
          {h.household.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {h.programs.length > 0 && (
        <table className="mt-3 w-full text-sm" data-testid="health-programs">
          <thead className="text-left text-xs text-slate-600">
            <tr>
              <th className="py-1">Program</th>
              <th>Health</th>
            </tr>
          </thead>
          <tbody>
            {h.programs.map((p) => (
              <tr key={p.program} className="border-t border-slate-100">
                <td className="py-1">{p.name}</td>
                <td>
                  <Badge tone={HEALTH_TONE(p.score)}>{p.score}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

export function RefreshHealth() {
  const q = useAuthedQuery<RefreshStatus>(['loyalty', 'refresh-status'], '/loyalty/refresh-status');
  const refresh = useApiMutation<void>(() => ({ path: '/loyalty/refresh', method: 'POST', body: {} }), KEYS);
  const audit = useAuthedQuery<AuditResponse>(['loyalty', 'audit'], '/loyalty/audit');
  const s = q.data;
  return (
    <div className="space-y-5" data-testid="refresh-health">
      <HealthPanel />
      <Panel
        title="Refresh health"
        action={
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => refresh.mutate()} loading={refresh.isPending} data-testid="refresh-now">
            Refresh now
          </Button>
        }
      >
        <p className="mb-3 text-sm text-slate-600">
          PointWise never signs in to your programs. An account refreshes when your mailbox, a statement or the browser extension supplies new data; anything that stays stale shows exactly what to do.
        </p>
        <ErrorText error={refresh.error} />
        {q.isLoading && <Spinner />}
        {s && (
          <>
            <dl className="mb-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5" data-testid="refresh-summary">
              {[
                ['Fresh', s.summary.fresh],
                ['Aging', s.summary.aging],
                ['Stale', s.summary.stale],
                ['Never refreshed', s.summary.never],
                ['Due now', s.summary.due],
              ].map(([k, v]) => (
                <div key={k as string} className="rounded-lg border border-slate-200 p-2">
                  <dt className="text-xs text-slate-600">{titleCase(k)}</dt>
                  <dd className="text-lg font-semibold">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mb-2 text-xs text-slate-600">
              Sources: mailbox {s.sources.mailbox ? 'connected' : 'not connected'} · browser extension {s.sources.extension ? 'token created' : 'not set up'}.
            </p>
            {s.accounts.length === 0 ? (
              <EmptyState title="No accounts yet">Add loyalty accounts on the Points tab.</EmptyState>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm" data-testid="refresh-accounts">
                {s.accounts.map((a) => (
                  <li key={a.accountId} className="py-3" data-testid="refresh-account">
                    <div className="flex flex-wrap items-center gap-2">
                      <BrandLogo brand={{ name: a.program }} name={a.program} size="sm" decorative />
                      <span className="font-medium">{a.program}</span>
                      <span className="text-slate-600">{a.member}</span>
                      <Badge tone={FRESH_LABEL[a.freshness].tone}>{FRESH_LABEL[a.freshness].label}</Badge>
                      <Badge tone={PRIORITY_TONE[a.priority]}>{a.priority.toLowerCase()} priority</Badge>
                      <SourceBadge source={a.source} reliability={a.reliability} />
                      <Badge tone="slate">Confidence {a.refreshConfidence}%</Badge>
                      <span className="ml-auto text-xs text-slate-600">{a.lastObservedAt ? `updated ${shortDate(a.lastObservedAt)}` : 'never updated'}</span>
                    </div>
                    <p className="text-xs text-slate-600">{a.reasons.join('; ')}</p>
                    {a.freshness !== 'FRESH' && (
                      <ul className="mt-1 list-disc pl-5 text-xs text-slate-700">
                        {a.plan.map((p) => (
                          <li key={p.kind}>
                            {p.text} {p.automated && <Badge tone="green">automatic</Badge>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Panel>
      <Panel title="Weekly audit" data-testid="audit">
        {audit.isLoading && <Spinner />}
        <dl className="space-y-2 text-sm">
          {(audit.data?.questions ?? []).map((x) => (
            <div key={x.question}>
              <dt className="font-medium">{x.question}</dt>
              <dd className="text-slate-700">{x.answer}</dd>
            </div>
          ))}
        </dl>
      </Panel>
    </div>
  );
}

function Conflicts() {
  const q = useAuthedQuery<ObservationRow[]>(['loyalty', 'observations', 'open'], '/loyalty/observations?outcome=CONFLICT');
  const pend = useAuthedQuery<ObservationRow[]>(['loyalty', 'observations', 'pending'], '/loyalty/observations?outcome=PENDING');
  const recent = useAuthedQuery<ObservationRow[]>(['loyalty', 'observations', 'all'], '/loyalty/observations');
  const resolve = useApiMutation<{ id: string; decision: 'ACCEPT' | 'REJECT' }>((v) => ({ path: `/loyalty/observations/${v.id}/resolve`, method: 'POST', body: { decision: v.decision } }), KEYS);
  const open = [...(q.data ?? []), ...(pend.data ?? [])];
  const name = (o: ObservationRow) => o.account?.program?.name ?? o.account?.currency?.name ?? o.account?.nickname ?? 'Account';
  return (
    <Panel title="Changes that need your decision" data-testid="conflicts">
      <p className="mb-2 text-sm text-slate-600">A lower-confidence source never overwrites a higher one. When two similar sources disagree, or the stored value is stale, the new value waits here.</p>
      {open.length === 0 ? (
        <p className="text-sm text-slate-600" data-testid="no-conflicts">Nothing is waiting for you.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {open.map((o) => (
            <li key={o.id} className="py-2" data-testid="conflict">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{name(o)}</span>
                <span>{FIELD_LABEL[o.field] ?? o.field}</span>
                <Badge tone={OUTCOME_LABEL[o.outcome].tone}>{OUTCOME_LABEL[o.outcome].label}</Badge>
              </div>
              <p className="text-xs text-slate-700">
                Stored {showValue(o.storedValue)} · {SOURCE_LABEL[o.sourceType]} ({o.reliability}) says {showValue(o.value)}. {o.reason}
              </p>
              <span className="mt-1 flex gap-2">
                <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => resolve.mutate({ id: o.id, decision: 'ACCEPT' })} data-testid="accept-conflict">
                  Use the new value
                </Button>
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => resolve.mutate({ id: o.id, decision: 'REJECT' })}>
                  Keep what I have
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={resolve.error} />
      <details className="mt-3 text-xs text-slate-600">
        <summary className="cursor-pointer">Audit trail ({recent.data?.length ?? 0})</summary>
        <ul className="mt-1 space-y-1" data-testid="observation-log">
          {(recent.data ?? []).slice(0, 30).map((o) => (
            <li key={o.id}>
              {shortDate(o.createdAt)} · {name(o)} · {FIELD_LABEL[o.field] ?? o.field} {showValue(o.value)} · {SOURCE_LABEL[o.sourceType]} ({o.reliability}) · {OUTCOME_LABEL[o.outcome].label}
            </li>
          ))}
        </ul>
      </details>
    </Panel>
  );
}

function EmailTester() {
  const [from, setFrom] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');
  const [res, setRes] = useState<EmailSamplePreview | null>(null);
  const run = useApiMutation<{ apply: boolean }, EmailSamplePreview>((v) => ({ path: '/loyalty/import/email-sample', method: 'POST', body: { fromDomain: from.trim(), subject, text, apply: v.apply } }), KEYS);
  return (
    <Panel title="Test a program email" data-testid="email-tester">
      <p className="mb-2 text-sm text-slate-600">Paste a loyalty email to see what PointWise would read from it. The text is not stored. Reading rules are generic and unverified, so check the result.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Sender domain" htmlFor="es-from">
          <Input id="es-from" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="e.marriott.com" />
        </Field>
        <Field label="Subject" htmlFor="es-subject">
          <Input id="es-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </Field>
      </div>
      <Field label="Email text" htmlFor="es-text">
        <textarea id="es-text" className="h-24 w-full rounded-lg border border-slate-300 p-2 text-sm" value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div className="mt-2 flex gap-2">
        <Button variant="secondary" onClick={() => run.mutate({ apply: false }, { onSuccess: setRes })} disabled={!from.trim() || text.trim().length < 10} loading={run.isPending} data-testid="preview-email">
          Preview
        </Button>
        {res && res.observations.length > 0 && (
          <Button onClick={() => run.mutate({ apply: true }, { onSuccess: setRes })} data-testid="apply-email">
            Apply to my accounts
          </Button>
        )}
      </div>
      <ErrorText error={run.error} />
      {res && (
        <div className="mt-3 text-sm" data-testid="email-result">
          <p>
            {res.program ? <strong>{res.program}</strong> : 'Unknown sender'} · {res.kind.toLowerCase()} · {res.observations.length} item(s) found
            {res.note ? ` — ${res.note}` : ''}
          </p>
          <ul className="mt-1 list-disc pl-5 text-xs text-slate-700">
            {res.observations.map((o, i) => (
              <li key={i}>
                {FIELD_LABEL[o.field] ?? o.field}: {showValue(o.value)} <span className="text-slate-500">({o.rule}, {o.ruleConfidence}%)</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function StatementImport() {
  const api = useApi();
  const [file, setFile] = useState<File | null>(null);
  const [out, setOut] = useState<{ applied: boolean; program: string | null; period: string | null; opening: number | null; closing: number | null; validation: { status: string; reasons: string[] }; lines?: Array<{ date: string; description: string; kind: string; points: number }> } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async (apply: boolean) => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('apply', apply ? 'true' : 'false');
      setOut(await api('/loyalty/import/statement', { method: 'POST', body: fd }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Import a program statement (PDF)" data-testid="statement-import">
      <p className="mb-2 text-sm text-slate-600">Balances and activity are read from the PDF, checked against its printed totals, and saved as a statement import. The file itself is not kept.</p>
      <input type="file" accept="application/pdf" aria-label="Program statement PDF" onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="statement-file" />
      <div className="mt-2 flex gap-2">
        <Button variant="secondary" onClick={() => void go(false)} disabled={!file} loading={busy} data-testid="preview-statement">
          Preview
        </Button>
        {out && !out.applied && out.validation.status !== 'FAILED' && (
          <Button onClick={() => void go(true)} loading={busy} data-testid="apply-statement">
            Import
          </Button>
        )}
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
      {out && (
        <div className="mt-3 text-sm" data-testid="statement-result">
          <p>
            <strong>{out.program ?? 'Unknown program'}</strong> {out.period ? `· ${out.period}` : ''} · opening {showValue(out.opening)} → closing {showValue(out.closing)} · <Badge tone={out.validation.status === 'PASS' ? 'green' : out.validation.status === 'WARNING' ? 'amber' : 'red'}>{out.validation.status}</Badge>
            {out.applied && ' · imported'}
          </p>
          {out.validation.reasons.map((r) => (
            <p key={r} className="text-xs text-amber-900">{r}</p>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ExtensionSetup() {
  const tokens = useAuthedQuery<ExtensionToken[]>(['loyalty', 'tokens'], '/loyalty/tokens');
  const [name, setName] = useState('My browser');
  const [shown, setShown] = useState<string | null>(null);
  const create = useApiMutation<void, { token: string }>(() => ({ path: '/loyalty/tokens', method: 'POST', body: { name } }), [['loyalty', 'tokens']]);
  const revoke = useApiMutation<string>((id) => ({ path: `/loyalty/tokens/${id}`, method: 'DELETE' }), [['loyalty', 'tokens']]);
  return (
    <Panel title="Browser extension" data-testid="extension-setup">
      <p className="mb-2 text-sm text-slate-600">
        The extension reads the text of a loyalty page you are viewing, only when you click “Capture this page”, and sends it to this server. It never reads passwords or form fields and never signs in for you. Some programs’ terms restrict automated tools; you confirm that in the extension before the first capture. Install steps are in <code>docs/loyalty-extension.md</code>.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Token name" htmlFor="tk-name">
          <Input id="tk-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Button onClick={() => create.mutate(undefined, { onSuccess: (r) => setShown(r.token) })} loading={create.isPending} disabled={!name.trim()} data-testid="create-token">
          Create extension token
        </Button>
      </div>
      <ErrorText error={create.error} />
      {shown && (
        <p className="mt-2 rounded bg-amber-50 p-2 text-sm" role="status" data-testid="new-token">
          Copy this token now; it is shown once: <code className="break-all">{shown}</code>
        </p>
      )}
      <ul className="mt-3 divide-y divide-slate-100 text-sm" data-testid="token-list">
        {(tokens.data ?? []).map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="font-medium">{t.name}</span>
            <code className="text-xs">{t.prefix}…</code>
            <span className="text-xs text-slate-600">{t.lastUsedAt ? `last used ${shortDate(t.lastUsedAt)}` : 'never used'}{t.expiresAt ? ` · expires ${shortDate(t.expiresAt)}` : ''}</span>
            <Button variant="ghost" className="ml-auto px-2 py-1 text-xs" onClick={() => revoke.mutate(t.id)}>
              Revoke
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ImportsAndConflicts() {
  return (
    <div className="space-y-5" data-testid="imports">
      <Conflicts />
      <StatementImport />
      <EmailTester />
      <ExtensionSetup />
    </div>
  );
}

export { daysLabel, Select };
