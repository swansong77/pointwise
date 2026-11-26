'use client';

import { useSession } from 'next-auth/react';
import { useRef, useState } from 'react';
import { Badge, Button, ErrorText, Field, Input, Panel } from '@/components/ui';
import { API_BASE, ApiError } from '@/lib/api';
import { ImportReport, reportRows, reportSummary } from '@/lib/data-transfer';

/** Download everything of yours as one file, and bring such a file back (here or on another PointWise). */
export function DataSection() {
  const { data: session } = useSession();
  const token = session?.accessToken;
  const [gzip, setGzip] = useState(false);
  const [exported, setExported] = useState(false);
  const [busy, setBusy] = useState<'export' | 'preview' | 'import' | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [report, setReport] = useState<ImportReport | null>(null);
  const [ack, setAck] = useState(false);
  const [typed, setTyped] = useState('');
  const input = useRef<HTMLInputElement>(null);

  async function exportData() {
    setBusy('export');
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/me/data-export${gzip ? '?gzip=true' : ''}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new ApiError(res.status, (await res.json().catch(() => ({}))).message ?? res.statusText);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pointwise-data-${new Date().toISOString().slice(0, 10)}.pointwise-data.json${gzip ? '.gz' : ''}`;
      a.click();
      URL.revokeObjectURL(a.href);
      setExported(true);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  async function send(dryRun: boolean) {
    if (!file) return;
    setBusy(dryRun ? 'preview' : 'import');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      form.append('mode', mode);
      form.append('dryRun', String(dryRun));
      const res = await fetch(`${API_BASE}/me/data-import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, Array.isArray(body.message) ? body.message.join(', ') : (body.message ?? res.statusText));
      setReport(body as ImportReport);
      if (!dryRun) {
        setFile(null);
        setAck(false);
        setTyped('');
        if (input.current) input.current.value = '';
      }
    } catch (e) {
      setError(e);
      setReport(null);
    } finally {
      setBusy(null);
    }
  }

  const replace = mode === 'replace';
  const canImport = !!file && !!report?.dryRun && report.mode === mode && (!replace || (ack && typed === 'REPLACE'));
  return (
    <Panel title="Your data">
      <p className="text-sm text-slate-700">Download everything you have in PointWise (cards, offers, spending, loyalty, offer rules and all your settings) as one file, and bring it back here or into another PointWise. The file never contains passwords, bank or mailbox logins, or tokens, so after importing you reconnect those yourself.</p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={exportData} loading={busy === 'export'} data-testid="data-export">
          Download all my data
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={gzip} onChange={(e) => setGzip(e.target.checked)} /> Compress the file
        </label>
        {exported && <Badge tone="green">Downloaded</Badge>}
      </div>

      <div className="mt-6 border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold">Import a data file</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Data file" htmlFor="data-file" hint="A .pointwise-data.json file, optionally compressed (.gz)">
            <input
              id="data-file"
              ref={input}
              type="file"
              accept=".json,.gz,application/json,application/gzip"
              className="block w-full text-sm"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReport(null);
              }}
            />
          </Field>
          <fieldset>
            <legend className="text-sm font-medium text-slate-700">What to do</legend>
            <label className="mt-1 flex items-start gap-2 text-sm">
              <input type="radio" name="import-mode" checked={mode === 'merge'} onChange={() => { setMode('merge'); setReport(null); }} data-testid="mode-merge" />
              <span>
                <span className="font-medium">Add what is missing</span>
                <span className="block text-xs text-slate-600">Nothing you have is removed. Importing the same file twice adds nothing. Your notification, AI and offer settings are taken from the file.</span>
              </span>
            </label>
            <label className="mt-2 flex items-start gap-2 text-sm">
              <input type="radio" name="import-mode" checked={mode === 'replace'} onChange={() => { setMode('replace'); setReport(null); }} data-testid="mode-replace" />
              <span>
                <span className="font-medium">Replace my data with the file</span>
                <span className="block text-xs text-slate-600">Removes your cards, offers, transactions and settings first. Your account, password and plan stay.</span>
              </span>
            </label>
          </fieldset>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!file} loading={busy === 'preview'} onClick={() => void send(true)} data-testid="data-preview">
            Preview
          </Button>
        </div>
        <ErrorText error={error} />

        {report && (
          <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm" role="status" data-testid="import-report">
            <p className="font-medium" data-testid="import-summary">{reportSummary(report)}</p>
            <table className="mt-2 w-full text-left text-xs">
              <thead>
                <tr className="text-slate-500">
                  <th className="py-1">What</th>
                  <th className="text-right">{report.dryRun ? 'Would add' : 'Added'}</th>
                  <th className="text-right">Settings updated</th>
                  <th className="text-right">Already there</th>
                  <th className="text-right">Not matched</th>
                </tr>
              </thead>
              <tbody>
                {reportRows(report).map((r) => (
                  <tr key={r.model} className="border-t border-slate-200" data-testid="import-row">
                    <td className="py-1">{r.label}</td>
                    <td className="text-right tabular-nums">{r.created}</td>
                    <td className="text-right tabular-nums">{r.updated}</td>
                    <td className="text-right tabular-nums">{r.duplicates}</td>
                    <td className="text-right tabular-nums">{r.unmapped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {report.notRestored.length > 0 && (
              <p className="mt-2 text-xs text-slate-700">
                Not brought back: {report.notRestored.map((n) => `${n.model === 'BankConnection' ? 'bank links' : n.model === 'Mailbox' ? 'mailboxes' : n.model.toLowerCase()} (${n.why})`).join('; ')}.
              </p>
            )}
            {report.warnings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-xs text-amber-900">
                {report.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
            {!report.dryRun && <p className="mt-2 text-xs text-green-800">Done. Reconnect your bank links and mailboxes, create new extension tokens, and confirm your AI consent again if you use the assistant.</p>}
          </div>
        )}

        {report?.dryRun && (
          <div className="mt-4 space-y-3">
            {replace && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                <p className="text-sm font-medium text-red-800">This removes your current cards, offers, transactions and settings first.</p>
                <label className="mt-2 flex items-center gap-2 text-sm text-red-900">
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="replace-ack" /> I have a copy of my current data (use Download above).
                </label>
                <div className="mt-2 max-w-[12rem]">
                  <Input aria-label="Type REPLACE to confirm" placeholder="Type REPLACE" value={typed} onChange={(e) => setTyped(e.target.value)} data-testid="replace-typed" />
                </div>
              </div>
            )}
            <Button variant={replace ? 'danger' : 'primary'} disabled={!canImport} loading={busy === 'import'} onClick={() => void send(false)} data-testid="data-import">
              {replace ? 'Replace my data' : 'Import'}
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}
