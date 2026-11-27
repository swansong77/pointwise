'use client';

import { BrandLogo } from '@/components/brand-logo';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StatTiles } from '@/components/charts';
import { WalletCardArt } from '@/components/card-bits';
import { Badge, Button, EmptyState, ErrorText, Field, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { useApi } from '@/lib/api';
import { money, shortDate } from '@/lib/format';
import { ValidationReport } from '@/components/validation-report';
import { AutoCapture } from '@/components/auto-capture';
import { MailboxPanel } from '@/components/mailbox-panel';
import type { Validation } from '@/lib/benefit-audit';
import { useApiMutation, useAuthedQuery, useWallet } from '@/lib/queries';
import {
  BenefitUpdate,
  BULK_STATUS,
  BulkResult,
  CaptureStatus,
  pickStatementFiles,
  batchBySize,
  mergeBulk,
  INBOUND_STATUS_LABEL,
  VIA_LABEL,
  viaTone,
  KIND_LABEL,
  kindTone,
  MATCH_LABEL,
  SpendSummary,
  SpendTx,
  StatementPreview,
  txAmount,
} from '@/lib/spend';
import type { WalletCard } from '@/lib/types';

const AFTER_IMPORT = [['spending'], ['benefits'], ['portfolio'], ['wallet'], ['dashboard']] as const;

export default function SpendingPage() {
  const summary = useAuthedQuery<SpendSummary>(['spending', 'summary'], '/spending/summary?days=30');
  return (
    <div className="space-y-6">
      <PageHeader
        title="Spending"
        subtitle="Card transactions from statements, bank sync and manual entry. Purchases and statement credits that match a benefit update your benefit tracker automatically."
      />
      {summary.data && (
        <StatTiles
          testId="spend-totals"
          items={[
            ['Spent (30 days)', money(summary.data.totalCents), `${summary.data.byCard.reduce((a, c) => a + c.count, 0)} purchases`],
            ['Top category', summary.data.byCategory[0]?.category?.name ?? '—', summary.data.byCategory[0] ? money(summary.data.byCategory[0].amountCents) : undefined],
            ['Benefit credits posted', money(summary.data.autoTracked.confirmedCents), 'tracked automatically'],
            ['Credits expected', money(summary.data.autoTracked.expectedCents), 'matching purchases, credit not posted yet'],
          ]}
        />
      )}
      <AutoCapture />
      <MailboxPanel assignable />
      <BulkStatements />
      <ImportStatement />
      <Transactions />
    </div>
  );
}

function BulkStatements() {
  const api = useApi();
  const qc = useQueryClient();
  const wallet = useWallet();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const cards = (wallet.data ?? []).filter((w: WalletCard) => w.status !== 'CLOSED');
  const take = (list: File[]) => {
    const picked = pickStatementFiles(list);
    setFiles(picked.files);
    setSkipped(picked.skipped);
    setResult(null);
    setChoice({});
  };
  const send = useMutation({
    mutationFn: async (batch: { files: File[]; assignments?: Record<string, string> }) => {
      // sent in size-limited batches: the web proxy refuses request bodies over 10 MB
      const parts: BulkResult[] = [];
      for (const group of batchBySize(batch.files)) {
        const fd = new FormData();
        for (const f of group) fd.append('files', f, f.name);
        if (batch.assignments) fd.append('assignments', JSON.stringify(batch.assignments));
        parts.push(await api<BulkResult>('/spending/statements/bulk', { method: 'POST', body: fd }));
      }
      return mergeBulk(parts);
    },
    onSuccess: (r, batch) => {
      // a resend only covers the files that needed a card: merge into the earlier result
      setResult((prev) => {
        if (!prev || !batch.assignments) return r;
        const updated = new Map(r.files.map((f) => [f.file, f]));
        const merged = prev.files.map((f) => updated.get(f.file) ?? f);
        const count = (s: string) => merged.filter((f) => f.status === s).length;
        return {
          files: merged,
          totals: {
            imported: count('IMPORTED'),
            alreadyImported: count('ALREADY_IMPORTED'),
            needsCard: count('NEEDS_CARD'),
            errors: count('ERROR'),
            transactions: merged.reduce((a, f) => a + (f.imported ?? 0), 0),
          },
        };
      });
      for (const k of [...AFTER_IMPORT, ['capture']]) void qc.invalidateQueries({ queryKey: [...k] });
    },
  });
  const waiting = result?.files.filter((f) => f.status === 'NEEDS_CARD') ?? [];
  const chosen = waiting.filter((f) => choice[f.file]);

  return (
    <Panel title="Import all your statements" data-testid="bulk-statements">
      <p className="mb-3 text-sm text-slate-600">
        Drop every statement you downloaded — PDFs or CSV exports, for any of your cards, up to 24 at a time. Each file is matched to its card by the account number ending printed
        on the statement (or in the CSV file name), transactions already recorded from your bank or an earlier statement are skipped, and the same file is never imported twice.
        Files are read on our server, never sent to an AI service, and not kept.
      </p>
      <div
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm ${dragging ? 'border-brand-500 bg-brand-50' : 'border-slate-300'}`}
        onDragOver={(e) => (e.preventDefault(), setDragging(true))}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(Array.from(e.dataTransfer.files));
        }}
        data-testid="bulk-drop"
      >
        <span className="text-slate-700">Drag statements here, or</span>
        <label htmlFor="bulk-files" className="cursor-pointer font-medium text-brand-700 underline">
          choose files
        </label>
        <input
          id="bulk-files"
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,application/pdf,.csv,text/csv"
          className="sr-only"
          onChange={(e) => take(Array.from(e.target.files ?? []))}
        />
        {files.length > 0 && (
          <span className="text-slate-600" role="status">
            {files.length} file{files.length === 1 ? '' : 's'} ready
            {skipped.length > 0 && ` · skipped ${skipped.length} (only PDF / CSV, 24 at a time)`}
          </span>
        )}
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={() => send.mutate({ files })} disabled={!files.length} loading={send.isPending && !chosen.length}>
          Import {files.length || ''} statement{files.length === 1 ? '' : 's'}
        </Button>
        {(files.length > 0 || result) && (
          <Button variant="ghost" onClick={() => (take([]), inputRef.current && (inputRef.current.value = ''))}>
            Clear
          </Button>
        )}
      </div>
      <ErrorText error={send.error} />

      {result && (
        <div className="mt-5 space-y-3" data-testid="bulk-result">
          <p className="text-sm text-slate-700" role="status">
            {result.totals.imported} imported · {result.totals.transactions} new transactions
            {result.totals.alreadyImported > 0 && ` · ${result.totals.alreadyImported} already imported`}
            {result.totals.needsCard > 0 && ` · ${result.totals.needsCard} need a card`}
            {result.totals.errors > 0 && ` · ${result.totals.errors} not imported`}
          </p>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {result.files.map((f) => (
              <li key={f.file} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" data-testid="bulk-file">
                <Badge tone={BULK_STATUS[f.status].tone}>{BULK_STATUS[f.status].label}</Badge>
                <span className="font-medium text-slate-800">{f.file}</span>
                <span className="text-slate-600">
                  {f.card && `→ ${f.card}${f.matchedBy === 'digits' ? ' (matched by account number)' : ''}`}
                  {f.period?.end && ` · closing ${shortDate(f.period.end)}`}
                  {f.status === 'IMPORTED' && ` · ${f.imported} new, ${f.duplicates} already recorded`}
                  {f.benefitUpdates ? ` · ${f.benefitUpdates} benefit update${f.benefitUpdates === 1 ? '' : 's'}` : ''}
                  {f.note && ` ${f.note}`}
                </span>
                {f.validation && f.validation.status !== 'PASS' && <div className="w-full"><ValidationReport v={f.validation} /></div>}
                {f.status === 'NEEDS_CARD' && (
                  <Select
                    aria-label={`Card for ${f.file}`}
                    value={choice[f.file] ?? ''}
                    onChange={(e) => setChoice((c) => ({ ...c, [f.file]: e.target.value }))}
                    className="ml-auto max-w-xs"
                  >
                    <option value="">Choose card…</option>
                    {cards.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.nickname || w.card.name}
                        {w.lastFour ? ` ··${w.lastFour}` : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </li>
            ))}
          </ul>
          {waiting.length > 0 && (
            <Button
              onClick={() =>
                send.mutate({
                  files: files.filter((f) => choice[f.name]),
                  assignments: Object.fromEntries(chosen.map((f) => [f.file, choice[f.file]])),
                })
              }
              disabled={!chosen.length}
              loading={send.isPending && chosen.length > 0}
            >
              Import {chosen.length || ''} with the chosen card{chosen.length === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}

function ImportStatement() {
  const api = useApi();
  const qc = useQueryClient();
  const wallet = useWallet();
  const fileRef = useRef<HTMLInputElement>(null);
  const [walletCardId, setWalletCardId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sign, setSign] = useState<'' | 'positive' | 'negative'>('');
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [result, setResult] = useState<{ imported: number; duplicates: number; benefitUpdates: BenefitUpdate[]; validation?: Validation } | null>(null);
  const form = () => {
    const fd = new FormData();
    fd.append('walletCardId', walletCardId);
    if (sign) fd.append('purchasesAre', sign);
    fd.append('file', file as File);
    return fd;
  };
  const doPreview = useMutation({
    mutationFn: () => api<StatementPreview>('/spending/statements/preview', { method: 'POST', body: form() }),
    onSuccess: (p) => (setPreview(p), setResult(null)),
  });
  const doImport = useMutation({
    mutationFn: () => api<{ imported: number; duplicates: number; benefitUpdates: BenefitUpdate[]; validation?: Validation }>('/spending/statements', { method: 'POST', body: form() }),
    onSuccess: (r) => {
      setResult(r);
      setPreview(null);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      for (const k of AFTER_IMPORT) void qc.invalidateQueries({ queryKey: [...k] });
    },
  });
  const cards = (wallet.data ?? []).filter((w: WalletCard) => w.status !== 'CLOSED');
  const matches = preview?.rows.filter((r) => r.benefit && !r.duplicate) ?? [];

  return (
    <Panel title="Review one statement before importing" data-testid="statement-import">
      <p className="mb-3 text-sm text-slate-600">
        Upload the monthly statement <strong>PDF</strong> from your card&apos;s website (or a CSV activity export, if your bank offers one). Transactions, credits and payments are
        read automatically and shown for review before anything is saved; importing the same statement twice adds nothing. Statements are read on our server and never sent to any
        AI service, and the file itself is not kept.
      </p>
      <form
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          doPreview.mutate();
        }}
      >
        <Field label="Card" htmlFor="st-card">
          <Select id="st-card" value={walletCardId} onChange={(e) => (setWalletCardId(e.target.value), setPreview(null))} required>
            <option value="">Choose…</option>
            {cards.map((w) => (
              <option key={w.id} value={w.id}>
                {w.nickname || w.card.name}
                {w.lastFour ? ` ··${w.lastFour}` : ''}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Statement file (PDF or CSV)" htmlFor="st-file">
          <input
            id="st-file"
            ref={fileRef}
            type="file"
            accept=".pdf,application/pdf,.csv,text/csv"
            className="block w-full text-sm"
            onChange={(e) => (setFile(e.target.files?.[0] ?? null), setPreview(null))}
          />
        </Field>
        <Field label="Purchases are shown as (CSV only)" htmlFor="st-sign">
          <Select id="st-sign" value={sign} onChange={(e) => (setSign(e.target.value as typeof sign), setPreview(null))}>
            <option value="">Detect automatically</option>
            <option value="positive">Positive amounts</option>
            <option value="negative">Negative amounts</option>
          </Select>
        </Field>
        <Button type="submit" disabled={!walletCardId || !file} loading={doPreview.isPending}>
          Preview
        </Button>
      </form>
      <ErrorText error={doPreview.error ?? doImport.error} />

      {preview && (
        <div className="mt-5 space-y-3" data-testid="statement-preview">
          <p className="text-sm text-slate-700" role="status">
            {preview.format === 'pdf' ? 'PDF statement' : 'CSV file'}
            {preview.period?.end && ` (closing ${shortDate(preview.period.end)})`}: {preview.totals.rows} transactions ({preview.totals.new} new, {preview.totals.duplicates}{' '}
            already imported) · purchases {money(preview.totals.purchasesCents)}
            {preview.format === 'csv' && ` · purchases are ${preview.purchasesAre} in this file`} · <strong>{matches.length}</strong> will update benefits
            {preview.errors.length > 0 && ` · ${preview.errors.length} lines skipped`}
          </p>
          {preview.validation && <ValidationReport v={preview.validation} />}
          <div className="max-h-80 overflow-auto rounded-lg border border-slate-200" tabIndex={0} role="region" aria-label="Statement preview">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-2 py-1.5">Date</th>
                  <th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5">Type</th>
                  <th className="px-2 py-1.5 text-right">Amount</th>
                  <th className="px-2 py-1.5">Category</th>
                  <th className="px-2 py-1.5">Benefit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {preview.rows.map((r, i) => (
                  <tr key={i} className={r.duplicate ? 'text-slate-400' : ''}>
                    <td className="whitespace-nowrap px-2 py-1.5">{shortDate(r.occurredAt)}</td>
                    <td className="px-2 py-1.5">
                      {r.description}
                      {r.duplicate && ' (already imported)'}
                    </td>
                    <td className="px-2 py-1.5">{KIND_LABEL[r.kind]}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right">{txAmount(r.kind, r.amountCents)}</td>
                    <td className="px-2 py-1.5">{r.merchant ?? r.category ?? '—'}</td>
                    <td className="px-2 py-1.5">
                      {r.benefit ? (
                        <span>
                          {r.benefit.name}{' '}
                          <span className="text-slate-500">
                            ({MATCH_LABEL[r.benefit.by] ?? r.benefit.by}: {r.benefit.term}{r.benefit.confidence != null && ` · ${r.benefit.confidence}%`})
                          </span>
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => doImport.mutate()} disabled={!preview.totals.new} loading={doImport.isPending}>
              Import {preview.totals.new} new transaction{preview.totals.new === 1 ? '' : 's'}
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-5 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900" role="status" data-testid="import-result">
          Imported {result.imported} transaction{result.imported === 1 ? '' : 's'}
          {result.duplicates > 0 && ` (${result.duplicates} already there)`}.{' '}
          {result.benefitUpdates.length ? `${result.benefitUpdates.length} benefit update${result.benefitUpdates.length === 1 ? '' : 's'}:` : 'No benefit updates.'}
          {result.benefitUpdates.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {result.benefitUpdates.map((u, i) => (
                <li key={i}>
                  {u.benefit} ({u.card}): {money(u.amountCents)} {u.status === 'EXPECTED' ? 'expected' : 'credit posted'} — {u.transaction}
                </li>
              ))}
            </ul>
          )}
          {result.validation && <ValidationReport v={result.validation} />}
        </div>
      )}
    </Panel>
  );
}

function Transactions() {
  const wallet = useWallet();
  const [walletCardId, setWalletCardId] = useState('');
  const [matched, setMatched] = useState<'' | 'true' | 'false'>('');
  const qs = new URLSearchParams({ limit: '200', ...(walletCardId && { walletCardId }), ...(matched && { matched }) }).toString();
  const q = useAuthedQuery<SpendTx[]>(['spending', 'transactions', qs], `/spending/transactions?${qs}`);
  const cards = wallet.data ?? [];
  return (
    <Panel
      title="Transactions"
      data-testid="transactions"
      action={
        <div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="tx-card">
            Card
          </label>
          <Select id="tx-card" value={walletCardId} onChange={(e) => setWalletCardId(e.target.value)}>
            <option value="">All cards</option>
            {cards.map((w: WalletCard) => (
              <option key={w.id} value={w.id}>
                {w.nickname || w.card.name}
              </option>
            ))}
          </Select>
          <label className="sr-only" htmlFor="tx-matched">
            Benefit matches
          </label>
          <Select id="tx-matched" value={matched} onChange={(e) => setMatched(e.target.value as typeof matched)}>
            <option value="">All transactions</option>
            <option value="true">Updated a benefit</option>
            <option value="false">No benefit</option>
          </Select>
        </div>
      }
    >
      {q.isLoading ? (
        <Spinner />
      ) : !q.data?.length ? (
        <EmptyState title="No transactions yet">Import a statement above, or sync a bank connection on the Import page.</EmptyState>
      ) : (
        <ul className="divide-y divide-slate-100">
          {q.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm" data-testid="transaction">
              <WalletCardArt walletCardId={t.walletCard.id} name={t.walletCard.name} color={t.walletCard.color} size="sm" />
              {t.merchant && <BrandLogo brand={{ name: t.merchant }} size="md" decorative hideUnknown />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-slate-900">{t.description || t.merchant || KIND_LABEL[t.kind]}</p>
                <p className="text-xs text-slate-500">
                  {shortDate(t.occurredAt)} · {t.walletCard.name} · {t.merchant ?? t.category?.name ?? t.bankCategory ?? 'Uncategorised'} · {t.source.toLowerCase()}
                </p>
                {t.benefits.length > 0 && (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {t.benefits.map((b) => (
                      <Badge key={b.usageId} tone={b.status === 'CONFIRMED' ? 'green' : b.status === 'EXPECTED' ? 'amber' : 'slate'}>
                        {b.name}: {money(b.amountCents)} {b.status === 'CONFIRMED' ? 'credit posted' : b.status === 'EXPECTED' ? 'credit expected' : 'dismissed'}
                      </Badge>
                    ))}
                  </p>
                )}
              </div>
              {t.kind !== 'PURCHASE' && <Badge tone={kindTone(t.kind)}>{KIND_LABEL[t.kind]}</Badge>}
              <span className="w-24 text-right font-medium tabular-nums">{txAmount(t.kind, t.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
      <ErrorText error={q.error} />
    </Panel>
  );
}
