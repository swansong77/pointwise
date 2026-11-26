'use client';

import { titleCase } from '@/lib/title-case';
import { BrandLogo } from '@/components/brand-logo';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { Tabs } from '@/components/charts';
import { Badge, Button, EmptyState, ErrorText, Field, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { useApi } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { ACCEPTED_UPLOADS, periodLabel, uploadProblem } from '@/lib/portfolio';
import type { ImportJob, ImportRow } from '@/lib/portfolio-types';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';
import { openPlaidLink } from '@/lib/plaid-link';
import { BUREAU_LABEL, conflictText, ReportAccount, ReportPreview, reportRowFor } from '@/lib/credit-report';
import { useWallet } from '@/lib/queries';

const RESULT_TONE: Record<ImportRow['result'], 'green' | 'brand' | 'slate' | 'amber' | 'red'> = {
  NEW: 'green',
  UPDATE: 'brand',
  DUPLICATE: 'slate',
  SKIPPED: 'amber',
  ERROR: 'red',
};
const AFTER_COMMIT = [['imports'], ['wallet'], ['portfolio'], ['benefits'], ['five24'], ['household'], ['dashboard']] as const;

export default function ImportPage() {
  const api = useApi();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [tab, setTab] = useState<'CARD' | 'BENEFIT'>('CARD');
  const problem = uploadProblem(file);

  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('file', file as File);
      return api<ImportJob>('/imports', { method: 'POST', body: fd });
    },
    onSuccess: (j) => {
      setJob(j);
      void qc.invalidateQueries({ queryKey: ['imports'] });
    },
  });
  const commit = useApiMutation<void, ImportJob['summary']['result']>(() => ({ path: `/imports/${job?.id}/commit`, method: 'POST' }), AFTER_COMMIT);
  const discard = useApiMutation<void>(() => ({ path: `/imports/${job?.id}`, method: 'DELETE' }), [['imports']]);
  const history = useAuthedQuery<ImportJob[]>(['imports'], '/imports');

  const rows = job?.rows?.filter((r) => r.kind === tab) ?? [];
  const s = job?.summary;

  return (
    <div className="space-y-6">
      <PageHeader title="Import cards" subtitle="Bring in your card list and benefits from a spreadsheet, CSV, bank connection or credit report." />

      <Panel title="1. Upload a spreadsheet or CSV" data-testid="import-upload">
        <p className="mb-3 text-sm text-slate-600">
          Works with a benefits-tracker workbook (sheets like <em>Cards</em> and <em>Benefits</em>) or any CSV with a <em>Card</em> column. Columns are matched by name; only the
          last 4–5 digits of a card are ever stored. Nothing changes until you confirm.
        </p>
        <form
          className="flex flex-wrap items-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!problem) upload.mutate();
          }}
        >
          <label htmlFor="import-file" className="sr-only">
            Spreadsheet file
          </label>
          <input
            ref={fileRef}
            id="import-file"
            type="file"
            accept={ACCEPTED_UPLOADS}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setJob(null);
            }}
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-brand-700"
          />
          <Button type="submit" disabled={!!problem} loading={upload.isPending}>
            Preview import
          </Button>
          <a href="/api/v1/imports/template.csv" download className="text-sm font-medium text-brand-700 hover:underline">
            Download CSV template
          </a>
        </form>
        {file && problem && (
          <p className="mt-2 text-sm text-red-700" role="alert">
            {problem}
          </p>
        )}
        <ErrorText error={upload.error} />
      </Panel>

      {job && (
        <Panel
          title={`2. Review ${job.fileName ?? 'import'}`}
          action={<Badge tone={job.status === 'FAILED' ? 'red' : job.status === 'COMMITTED' ? 'green' : 'brand'}>{job.status.toLowerCase()}</Badge>}
          data-testid="import-preview"
        >
          {job.status === 'FAILED' ? (
            <p className="text-sm text-red-700" role="alert">
              {job.errors?.[0]?.message ?? 'Nothing could be read from this file.'}
            </p>
          ) : (
            <>
              <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4" data-testid="import-summary">
                <Stat label="New cards" value={s?.cards?.NEW ?? 0} />
                <Stat label="Matched existing" value={s?.cards?.UPDATE ?? 0} />
                <Stat label="Duplicates / errors" value={(s?.cards?.DUPLICATE ?? 0) + (s?.cards?.ERROR ?? 0)} />
                <Stat label="New benefits" value={s?.benefits?.NEW ?? 0} />
              </dl>
              <p className="mb-3 text-xs text-slate-500">
                Cardholders: {s?.owners?.join(', ') || '—'} · closed cards: {s?.closedCards ?? 0} · authorized-user cards: {s?.authorizedUserCards ?? 0} · sheets read:{' '}
                {s?.sheetsRead?.join(', ')}
              </p>
              <Tabs<'CARD' | 'BENEFIT'>
                label="Rows"
                value={tab}
                onChange={setTab}
                options={[
                  ['CARD', `Cards (${job.rows?.filter((r) => r.kind === 'CARD').length ?? 0})`],
                  ['BENEFIT', `Benefits (${job.rows?.filter((r) => r.kind === 'BENEFIT').length ?? 0})`],
                ]}
              />
              <div className="-mx-5 mt-3 max-h-96 overflow-auto" tabIndex={0} role="region" aria-label="Import rows (scrollable)">
                <table className="w-full min-w-[640px] text-sm">
                  <caption className="sr-only">Import rows</caption>
                  <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-5 py-2 font-medium">
                        Row
                      </th>
                      <th scope="col" className="px-2 py-2 font-medium">
                        {tab === 'CARD' ? 'Card' : 'Benefit'}
                      </th>
                      <th scope="col" className="px-2 py-2 font-medium">
                        Details
                      </th>
                      <th scope="col" className="px-5 py-2 font-medium">
                        Result
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {rows.map((r) => (
                      <tr key={r.id} data-testid="import-row">
                        <td className="px-5 py-2 tabular-nums text-slate-500">{r.rowNumber}</td>
                        <td className="px-2 py-2 font-medium"><span className="inline-flex items-center gap-2">{r.data.card?.issuer && <BrandLogo brand={{ name: r.data.card.issuer }} kinds={['ISSUER']} size="sm" decorative hideUnknown />}{r.data.card?.cardName ?? r.data.benefit?.name}</span></td>
                        <td className="px-2 py-2 text-xs text-slate-600">
                          {r.data.card &&
                            [
                              r.data.card.owner,
                              r.data.card.issuer,
                              r.data.card.lastDigits && `•••• ${r.data.card.lastDigits}`,
                              r.data.card.annualFeeCents != null && `${money(r.data.card.annualFeeCents)} fee`,
                              r.data.card.openedAt && `opened ${shortDate(r.data.card.openedAt)}`,
                              r.data.card.isAuthorizedUser && 'AU',
                              r.data.card.closed && 'closed',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          {r.data.benefit &&
                            `${r.data.benefit.cardName} · ${money(r.data.benefit.annualValueCents)}/yr · ${periodLabel(r.data.benefit.period)} · used ${money(r.data.benefit.usedCents)}`}
                        </td>
                        <td className="px-5 py-2">
                          <Badge tone={RESULT_TONE[r.result]}>{r.result.toLowerCase()}</Badge>
                          {r.message && <p className="mt-0.5 text-xs text-slate-500">{r.message}</p>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {job.status === 'PREVIEW' && !commit.isSuccess && (
                <div className="mt-4 flex gap-3">
                  <Button onClick={() => commit.mutate(undefined)} loading={commit.isPending} data-testid="import-commit">
                    Import {s?.cards?.NEW ?? 0} cards and {s?.benefits?.NEW ?? 0} benefits
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => discard.mutate(undefined, { onSuccess: () => (setJob(null), setFile(null), fileRef.current && (fileRef.current.value = '')) })}
                  >
                    Discard
                  </Button>
                </div>
              )}
              {commit.isSuccess && commit.data && (
                <p className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800" role="status" data-testid="import-done">
                  Imported {commit.data.cardsCreated} cards ({commit.data.cardsUpdated} updated), {commit.data.benefitsCreated} benefits and {commit.data.membersCreated} household
                  member{commit.data.membersCreated === 1 ? '' : 's'}.
                </p>
              )}
              <ErrorText error={commit.error ?? discard.error} />
            </>
          )}
        </Panel>
      )}

      <BankConnections />
      <CreditReportImport />

      <Panel title="Previous imports">
        {history.isLoading ? (
          <Spinner />
        ) : !history.data?.length ? (
          <EmptyState title="No imports yet" />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {history.data.map((j) => (
              <li key={j.id} className="flex justify-between gap-3 py-2">
                <span>
                  {j.fileName ?? j.source} <span className="text-xs text-slate-500">· {shortDate(j.createdAt)}</span>
                </span>
                <Badge tone={j.status === 'COMMITTED' ? 'green' : j.status === 'FAILED' ? 'red' : 'slate'}>{j.status.toLowerCase()}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <dt className="text-xs text-slate-500">{titleCase(label)}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

interface ConnStatus {
  enabled: boolean;
  provider: string | null;
  environment: string | null;
  sandbox: boolean;
}

function BankConnections() {
  const status = useAuthedQuery<ConnStatus>(['connections', 'status'], '/connections/status');
  const list = useAuthedQuery<Array<{ id: string; institutionName: string | null; lastSyncedAt: string | null; needsReauth?: boolean; lastError?: string | null }>>(
    ['connections'],
    '/connections',
  );
  const api = useApi();
  const qc = useQueryClient();
  const link = useMutation({
    mutationFn: async (relinkId?: string) => {
      const { linkToken } = await api<{ linkToken: string }>(relinkId ? `/connections/${relinkId}/relink-token` : '/connections/plaid/link-token', { method: 'POST' });
      const publicToken = await openPlaidLink(linkToken);
      if (!publicToken) return null;
      return relinkId
        ? api(`/connections/${relinkId}/relinked`, { method: 'POST' })
        : api('/connections/plaid/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicToken }) });
    },
    onSuccess: () => {
      for (const k of [['connections'], ...AFTER_COMMIT, ['capture']]) void qc.invalidateQueries({ queryKey: [...k] });
    },
  });
  const sandbox = useApiMutation<void, { created: number; updated: number; note: string }>(
    () => ({ path: '/connections/plaid/sandbox', method: 'POST' }),
    [['connections'], ...AFTER_COMMIT],
  );
  const sync = useApiMutation<string, { created: number; updated: number }>((id) => ({ path: `/connections/${id}/sync`, method: 'POST' }), [['connections'], ...AFTER_COMMIT]);
  const remove = useApiMutation<string>((id) => ({ path: `/connections/${id}`, method: 'DELETE' }), [['connections']]);
  return (
    <Panel title="Connect a bank" data-testid="bank-connections">
      {!status.data ? (
        <Spinner />
      ) : !status.data.enabled ? (
        <p className="text-sm text-slate-600">
          Bank connections aren&apos;t set up on this server. They use an account aggregator (Plaid) and need API keys — see <code>docs/bank-and-bureau-feasibility.md</code>. Banks
          share card names, last digits and limits, but not open dates or annual fees.
        </p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">
            Connected through {status.data.provider} ({status.data.environment}). Banks share card names, last digits and credit limits — add open dates for 5/24.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => link.mutate(undefined)} loading={link.isPending && !link.variables}>
              Connect a bank
            </Button>
            {status.data.sandbox && (
              <Button variant="secondary" onClick={() => sandbox.mutate(undefined)} loading={sandbox.isPending}>
                Connect a sandbox test bank
              </Button>
            )}
          </div>
          <p className="text-xs text-slate-500">After connecting, new card transactions arrive automatically (the bank notifies PointWise; a daily sync is the fallback).</p>
          {sandbox.data && <p role="status">{sandbox.data.note}</p>}
          <ul className="divide-y divide-slate-100">
            {list.data?.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                <span>
                  <BrandLogo brand={{ name: c.institutionName }} kinds={['ISSUER']} size="sm" decorative hideUnknown /> {c.institutionName ?? 'Bank'} <span className="text-xs text-slate-500">· synced {c.lastSyncedAt ? shortDate(c.lastSyncedAt) : 'never'}</span>
                  {c.needsReauth && (
                    <span className="ml-2">
                      <Badge tone="red">Sign-in needed</Badge>
                    </span>
                  )}
                </span>
                <span className="flex gap-2">
                  {c.needsReauth && (
                    <Button onClick={() => link.mutate(c.id)} loading={link.isPending && link.variables === c.id}>
                      Sign in again
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => sync.mutate(c.id)} loading={sync.isPending && sync.variables === c.id}>
                    Sync
                  </Button>
                  <Button variant="ghost" onClick={() => remove.mutate(c.id)}>
                    Disconnect
                  </Button>
                </span>
              </li>
            ))}
          </ul>
          <ErrorText error={sandbox.error ?? sync.error ?? remove.error ?? link.error} />
        </div>
      )}
    </Panel>
  );
}

const BUREAU_NAME: Record<string, string> = { TRANSUNION: 'TransUnion report', EQUIFAX: 'Equifax report', EXPERIAN: 'Experian report', OTHER: 'Credit report' };

/** Credit Karma (TransUnion / Equifax): open dates for 5/24 from a printed report PDF or its copied text. */
function CreditReportImport() {
  const api = useApi();
  const qc = useQueryClient();
  const wallet = useWallet();
  const members = useAuthedQuery<Array<{ id: string; nickname: string; isPrimary: boolean }>>(['household', 'members'], '/household/members');
  const fileRef = useRef<HTMLInputElement>(null);
  const [reportFiles, setReportFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [profileId, setProfileId] = useState('');
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [rows, setRows] = useState<Record<number, { action: 'LINK' | 'ADD' | 'SKIP'; walletCardId?: string; overwrite?: boolean }>>({});
  const doPreview = useMutation({
    mutationFn: () => {
      if (reportFiles.length) {
        const fd = new FormData();
        for (const f of reportFiles) fd.append('files', f);
        if (text.trim()) fd.append('text', text);
        if (profileId) fd.append('profileId', profileId);
        return api<ReportPreview>('/credit-reports/import/preview', { method: 'POST', body: fd });
      }
      return api<ReportPreview>('/credit-reports/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...(profileId && { profileId }) }),
      });
    },
    onSuccess: (p) => {
      setPreview(p);
      setRows(Object.fromEntries(p.accounts.map((a, i) => [i, { action: a.suggested, walletCardId: a.match?.walletCardId }])));
    },
  });
  const doImport = useMutation({
    mutationFn: () =>
      api<{ linked: number; added: number; skipped: number; keptExistingDate: number; limitReached: number }>('/credit-reports/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileId: preview!.profileId,
          bureau: preview!.bureau,
          source: preview!.source,
          accounts: preview!.accounts.map((a, i) => reportRowFor(a, rows[i])),
        }),
      }),
    onSuccess: () => {
      setPreview(null);
      setReportFiles([]);
      setText('');
      if (fileRef.current) fileRef.current.value = '';
      for (const k of [...AFTER_COMMIT, ['credit-reports']]) void qc.invalidateQueries({ queryKey: [...k] });
    },
  });
  const cards = wallet.data ?? [];
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows({ ...rows, [i]: { ...rows[i], ...patch } });
  return (
    <Panel title="Credit reports (Experian, Equifax, TransUnion)" data-testid="credit-report-import">
      <p className="mb-2 text-sm text-slate-600">
        Fills in open dates for 5/24 and adds recent cards you haven&apos;t entered. Upload up to <strong>three reports — one per bureau</strong>; the same account on several
        reports is merged, and you see which bureaus list it and where their dates differ. Where to get them (free):
      </p>
      <ul className="mb-3 list-disc space-y-0.5 pl-5 text-sm text-slate-600">
        <li>
          <strong>annualcreditreport.com</strong> — free weekly reports from all three bureaus; open each report and download / print it as PDF.
        </li>
        <li>
          <strong>Experian</strong> (experian.com), <strong>Equifax</strong> (myEquifax) or <strong>TransUnion</strong> (transunion.com) — free account → credit report → download
          or print to PDF.
        </li>
        <li>
          <strong>Credit Karma</strong> — TransUnion and Equifax: open the report page listing your accounts with &quot;Date opened&quot; and print it to PDF, or copy its text.
        </li>
      </ul>
      <p className="mb-3 text-xs text-slate-500">
        None of these offer automated access, so PointWise never logs in to them. Reports are read here and discarded; only the card accounts are kept, and nothing is sent to any
        AI service.
      </p>
      <form
        className="grid gap-4 sm:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          doPreview.mutate();
        }}
      >
        <Field label="Report PDFs (up to 3)" htmlFor="cr-file" error={reportFiles.length > 3 ? 'Choose at most 3 reports (one per bureau)' : undefined}>
          <input
            id="cr-file"
            ref={fileRef}
            type="file"
            multiple
            accept=".pdf,application/pdf,.txt,text/plain"
            className="block w-full text-sm"
            onChange={(e) => (setReportFiles(Array.from(e.target.files ?? [])), setPreview(null))}
          />
        </Field>
        <Field label="…or paste the report text" htmlFor="cr-text">
          <textarea
            id="cr-text"
            rows={3}
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            value={text}
            onChange={(e) => (setText(e.target.value), setPreview(null))}
          />
        </Field>
        <Field label="Whose report" htmlFor="cr-member">
          <Select id="cr-member" value={profileId} onChange={(e) => (setProfileId(e.target.value), setPreview(null))}>
            <option value="">Me</option>
            {(members.data ?? [])
              .filter((m) => !m.isPrimary)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nickname}
                </option>
              ))}
          </Select>
        </Field>
        <div className="sm:col-span-3">
          <Button type="submit" disabled={(!reportFiles.length && text.trim().length < 20) || reportFiles.length > 3} loading={doPreview.isPending}>
            Read reports
          </Button>
        </div>
      </form>
      <ErrorText error={doPreview.error ?? doImport.error} />

      {preview && (
        <div className="mt-5 space-y-3" data-testid="credit-report-preview">
          <p className="text-sm text-slate-700" role="status">
            {preview.bureau === 'MULTIPLE' ? `${preview.bureaus.map((b) => BUREAU_LABEL[b]).join(' + ')} reports` : BUREAU_NAME[preview.bureau]}: {preview.accounts.length} credit
            card account
            {preview.accounts.length === 1 ? '' : 's'}
            {preview.skipped.length > 0 &&
              ` · ${preview.skipped.length} other account${preview.skipped.length === 1 ? '' : 's'} skipped (${preview.skipped.map((s) => s.creditorName).join(', ')})`}
          </p>
          <ul className="divide-y divide-slate-100 text-sm">
            {preview.accounts.map((a: ReportAccount, i) => (
              <li key={i} className="flex flex-wrap items-center gap-3 py-2" data-testid="credit-report-account">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{a.creditorName}</span>
                  {a.issuer && <span className="text-slate-500"> ({a.issuer})</span>}
                  {a.lastDigits && <span className="text-slate-500"> ··{a.lastDigits}</span>}
                  <span className="block text-xs text-slate-500">
                    opened {a.precision === 'DAY' ? shortDate(a.openedOn) : a.openedOn.slice(0, 7)} · {a.status.toLowerCase()}
                    {a.isAuthorizedUser && ' · authorized user'}
                    {a.creditLimitCents != null && ` · limit ${money(a.creditLimitCents)}`}
                    {a.bureaus && a.bureaus.length > 0 && ` · on ${a.bureaus.map((b) => BUREAU_LABEL[b]).join(', ')}`}
                    {a.dateConflict && ` · bureaus disagree: ${conflictText(a.dateConflict)} (earliest used)`}
                    {a.match && ` · matches ${a.match.name} (${a.match.by})`}
                    {a.match?.dateCheck === 'DIFFERENT' && ` · card says ${a.match.currentOpenDate}`}
                    {a.alreadyImported && ' · imported before'}
                    {!a.match && a.note && ` · ${a.note}`}
                  </span>
                </span>
                <label className="sr-only" htmlFor={`cr-action-${i}`}>
                  What to do with {a.creditorName}
                </label>
                <Select id={`cr-action-${i}`} value={rows[i]?.action ?? 'SKIP'} onChange={(e) => set(i, { action: e.target.value as 'LINK' | 'ADD' | 'SKIP' })}>
                  <option value="LINK">Set open date on a card</option>
                  <option value="ADD">Add as a new card</option>
                  <option value="SKIP">Skip</option>
                </Select>
                {rows[i]?.action === 'LINK' && (
                  <>
                    <label className="sr-only" htmlFor={`cr-card-${i}`}>
                      Card for {a.creditorName}
                    </label>
                    <Select id={`cr-card-${i}`} value={rows[i]?.walletCardId ?? ''} onChange={(e) => set(i, { walletCardId: e.target.value })}>
                      <option value="">Choose card…</option>
                      {cards.map((w) => (
                        <option key={w.id} value={w.id}>
                          {w.nickname || w.card.name}
                          {w.lastFour ? ` ··${w.lastFour}` : ''}
                        </option>
                      ))}
                    </Select>
                    {a.match?.dateCheck === 'DIFFERENT' && (
                      <label className="flex items-center gap-1 text-xs">
                        <input type="checkbox" checked={!!rows[i]?.overwrite} onChange={(e) => set(i, { overwrite: e.target.checked })} /> replace the card&apos;s date
                      </label>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
          <Button
            onClick={() => doImport.mutate()}
            loading={doImport.isPending}
            disabled={preview.accounts.some((_, i) => rows[i]?.action === 'LINK' && !rows[i]?.walletCardId) || preview.accounts.every((_, i) => rows[i]?.action === 'SKIP')}
          >
            Save open dates
          </Button>
        </div>
      )}
      {doImport.data && (
        <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" role="status" data-testid="credit-report-result">
          {doImport.data.linked} card{doImport.data.linked === 1 ? '' : 's'} updated, {doImport.data.added} added, {doImport.data.skipped} skipped
          {doImport.data.keptExistingDate > 0 && ` · kept ${doImport.data.keptExistingDate} exact date${doImport.data.keptExistingDate === 1 ? '' : 's'} you had entered`}
          {doImport.data.limitReached > 0 && ` · ${doImport.data.limitReached} not added (plan card limit)`}. See your updated 5/24 on the 5/24 page.
        </p>
      )}
    </Panel>
  );
}
