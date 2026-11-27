'use client';

import { useState } from 'react';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { AdminRate, AdminSite, HEALTH_LABEL, HEALTH_TONE } from '@/lib/cashback';
import { shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

const KEYS = [['admin', 'cashback']] as const;

function siteState(s: AdminSite): 'UP' | 'DOWN' | 'UNKNOWN' {
  if (s.reachable == null) return 'UNKNOWN';
  if (s.reachable) return 'UP';
  return s.failures >= 2 ? 'DOWN' : 'UNKNOWN';
}

/** The administrator's view: whether each site answers, and the rates (typed, imported from a CSV, or read from pasted text). */
export default function AdminCashbackPage() {
  const sites = useAuthedQuery<AdminSite[]>(['admin', 'cashback', 'sites'], '/admin/cashback/sites');
  const rates = useAuthedQuery<AdminRate[]>(['admin', 'cashback', 'rates'], '/admin/cashback/rates');
  const check = useApiMutation<string | undefined>((site) => ({ path: '/admin/cashback/status', method: 'POST', body: site ? { site } : {} }), KEYS);
  const remove = useApiMutation<string>((id) => ({ path: `/admin/cashback/rates/${id}`, method: 'DELETE' }), KEYS);
  if (sites.isLoading) return <Spinner label="Loading cash-back sites" />;
  return (
    <div className="space-y-6">
      <PageHeader title="Cash-back sites" subtitle="One list for the whole server. The shopping plan and every member use these sites and rates." action={<Button variant="secondary" onClick={() => check.mutate(undefined)} loading={check.isPending && check.variables === undefined} data-testid="check-all">Check all sites now</Button>} />
      <ErrorText error={sites.error ?? check.error} />
      <Panel title="Sites and their status" data-testid="admin-sites">
        <ul className="divide-y divide-slate-100 text-sm">
          {sites.data?.map((s) => {
            const st = siteState(s);
            return (
              <li key={s.code} className="flex flex-wrap items-center gap-3 py-2" data-testid="admin-site" data-site={s.code}>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{s.name}</span> <span className="text-slate-600">{s.homeUrl}</span>
                  <span className="block text-xs text-slate-600">
                    {s.lastCheckedAt ? `checked ${shortDate(s.lastCheckedAt)}${s.httpStatus ? ` (HTTP ${s.httpStatus})` : ''}` : 'never checked'}
                    {s.lastError ? ` · ${s.lastError}` : ''}
                  </span>
                </span>
                <Badge tone={HEALTH_TONE[st]}>{HEALTH_LABEL[st]}</Badge>
                <Button variant="ghost" onClick={() => check.mutate(s.code)} loading={check.isPending && check.variables === s.code} aria-label={`Check ${s.name} now`}>
                  Check now
                </Button>
                <AutoRead site={s} />
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-slate-600">A site is checked once a day with a single request to its public home page. It is called not answering only after two failed checks in a row.</p>
      </Panel>
      <ReadSettings sites={sites.data ?? []} />
      <AddRate sites={sites.data ?? []} />
      <Panel title={`Rates on file (${rates.data?.length ?? 0})`} data-testid="admin-rates">
        {rates.data?.length === 0 ? (
          <EmptyState title="No rates yet">Add one above, import a CSV, or paste the text of a store page.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {rates.data?.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-2" data-testid="admin-rate">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{r.merchant}</span> at {r.site}:{' '}
                  {r.ratePercent != null ? `${r.upTo ? 'up to ' : ''}${r.ratePercent}%` : `${r.upTo ? 'up to ' : ''}${r.pointsPerDollar} points per $1`}
                  <span className="block text-xs text-slate-600">
                    {r.method.toLowerCase()} · seen {shortDate(r.observedAt)}
                    {r.expiresAt ? ` · ${r.expired ? 'expired' : 'expires'} ${shortDate(r.expiresAt)}` : ''}
                    {r.conditions ? ` · ${r.conditions}` : ''}
                  </span>
                </span>
                <Button variant="ghost" onClick={() => remove.mutate(r.id)} aria-label={`Delete the ${r.site} rate for ${r.merchant}`}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
        <ErrorText error={remove.error} />
      </Panel>
      <ImportCsv />
      <PasteComparison />
      <PasteText sites={sites.data ?? []} />
    </div>
  );
}

function AddRate({ sites }: { sites: AdminSite[] }) {
  const [f, setF] = useState({ site: '', merchant: '', rate: '', upTo: false, conditions: '' });
  const add = useApiMutation<void>(() => ({ path: '/admin/cashback/rates', method: 'POST', body: { site: f.site, merchant: f.merchant, ratePercent: Number(f.rate), upTo: f.upTo, ...(f.conditions ? { conditions: f.conditions } : {}) } }), KEYS);
  return (
    <Panel title="Add a rate" data-testid="admin-add-rate">
      <form
        className="grid gap-3 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, { onSuccess: () => setF({ ...f, rate: '', conditions: '' }) });
        }}
      >
        <Field label="Site" htmlFor="ar-site">
          <Select id="ar-site" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} required>
            <option value="">Choose…</option>
            {sites.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Store" htmlFor="ar-merchant">
          <Input id="ar-merchant" value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })} placeholder="Target" required />
        </Field>
        <Field label="Cash back (%)" htmlFor="ar-rate">
          <Input id="ar-rate" type="number" min={0} max={100} step="0.1" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} required />
        </Field>
        <Field label="Conditions (optional)" htmlFor="ar-cond">
          <Input id="ar-cond" value={f.conditions} onChange={(e) => setF({ ...f, conditions: e.target.value })} />
        </Field>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={f.upTo} onChange={(e) => setF({ ...f, upTo: e.target.checked })} /> It says &ldquo;up to&rdquo; (the best case)
        </label>
        <div className="sm:col-span-2">
          <Button type="submit" loading={add.isPending} data-testid="admin-add-rate-submit">
            Save rate
          </Button>
        </div>
      </form>
      <ErrorText error={add.error} />
    </Panel>
  );
}

function ImportCsv() {
  const [csv, setCsv] = useState('');
  const run = useApiMutation<void, { created: number; updated: number; errors: Array<{ line: number; message: string }> }>(() => ({ path: '/admin/cashback/rates/import', method: 'POST', body: { csv } }), KEYS);
  return (
    <Panel title="Import a CSV" data-testid="admin-import">
      <p className="mb-2 text-sm text-slate-700">One row per rate. Columns: site, merchant, rate (5%, up to 5%), expires, conditions. A points rate uses a points column instead.</p>
      <label htmlFor="csv-text" className="sr-only">
        CSV rows
      </label>
      <textarea id="csv-text" value={csv} onChange={(e) => setCsv(e.target.value)} rows={5} className="block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" placeholder={'site,merchant,rate,expires,conditions\nrakuten,target,2%,2026-12-31,'} />
      <div className="mt-2 flex items-center gap-3">
        <Button onClick={() => run.mutate(undefined)} loading={run.isPending} disabled={csv.trim().length < 10} data-testid="admin-import-go">
          Import
        </Button>
        {run.data && (
          <span role="status" className="text-sm" data-testid="admin-import-result">
            {run.data.created} added, {run.data.updated} updated{run.data.errors.length ? `, ${run.data.errors.length} problem${run.data.errors.length === 1 ? '' : 's'}` : ''}
          </span>
        )}
      </div>
      {run.data?.errors.length ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-red-700" data-testid="admin-import-errors">
          {run.data.errors.map((e) => (
            <li key={`${e.line}-${e.message}`}>
              Line {e.line}: {e.message}
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorText error={run.error} />
    </Panel>
  );
}

function PasteText({ sites }: { sites: AdminSite[] }) {
  const [f, setF] = useState({ site: '', merchant: '', text: '' });
  const read = useApiMutation<boolean, { saved: boolean; ratePercent: number | null; pointsPerDollar: number | null; upTo: boolean; evidence: string; alsoSeen: string[] }>((save) => ({ path: '/admin/cashback/rates/paste', method: 'POST', body: { ...f, save } }), KEYS);
  const r = read.data;
  return (
    <Panel title="Read a pasted store page" data-testid="admin-paste">
      <p className="mb-2 text-sm text-slate-700">Open the store&apos;s page on the cash-back site, copy its text, and paste it here. PointWise shows the rate it found before anything is saved.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Site" htmlFor="ps-site">
          <Select id="ps-site" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })}>
            <option value="">Choose…</option>
            {sites.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Store" htmlFor="ps-merchant">
          <Input id="ps-merchant" value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })} placeholder="Target" />
        </Field>
      </div>
      <label htmlFor="ps-text" className="mt-3 block text-sm font-medium text-slate-700">
        Page text
      </label>
      <textarea id="ps-text" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} rows={4} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => read.mutate(false)} loading={read.isPending} disabled={!f.site || !f.merchant || f.text.length < 3} data-testid="admin-paste-read">
          Read the rate
        </Button>
        {r && !r.saved && (
          <Button onClick={() => read.mutate(true)} data-testid="admin-paste-save">
            Save it
          </Button>
        )}
      </div>
      {r && (
        <p role="status" className="mt-2 text-sm" data-testid="admin-paste-result">
          {r.saved ? 'Saved: ' : 'Found: '}
          {r.ratePercent != null ? `${r.upTo ? 'up to ' : ''}${r.ratePercent}%` : `${r.pointsPerDollar} points per $1`} (from &ldquo;{r.evidence}&rdquo;)
          {r.alsoSeen.length ? `. Also on the page, not used: ${r.alsoSeen.join(', ')}` : ''}
        </p>
      )}
      <ErrorText error={read.error} />
    </Panel>
  );
}

interface CompareRead {
  saved: boolean;
  merchant: string;
  monitorUrl: string;
  rates: Array<{ site: string; siteName: string; ratePercent: number | null; pointsPerDollar: number | null; upTo: boolean; note: string | null; inList: boolean }>;
  unknown: string[];
  created?: number;
  updated?: number;
  skipped?: string[];
}

function PasteComparison() {
  const [f, setF] = useState({ merchant: '', text: '' });
  const read = useApiMutation<boolean, CompareRead>((save) => ({ path: '/admin/cashback/rates/compare', method: 'POST', body: { ...f, save } }), KEYS);
  const r = read.data;
  const slug = f.merchant.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return (
    <Panel title="Read a comparison page (Cashback Monitor)" data-testid="admin-compare">
      <p className="mb-2 text-sm text-slate-700">
        One page lists every site&apos;s rate for a store.{' '}
        {slug ? (
          <a href={`https://www.cashbackmonitor.com/cashback-store/${slug}/`} target="_blank" rel="noreferrer noopener" className="font-medium text-brand-700 underline">
            Open the store on Cashback Monitor
          </a>
        ) : (
          'Type the store, then open its page on Cashback Monitor'
        )}
        , select the table of rates, copy it, and paste it below. PointWise shows what it read for each site before anything is saved. A star on a rate means a special or &ldquo;up to&rdquo; rate and is counted as the best case.
      </p>
      <Field label="Store" htmlFor="pc-merchant">
        <Input id="pc-merchant" value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })} placeholder="Target" />
      </Field>
      <label htmlFor="pc-text" className="mt-3 block text-sm font-medium text-slate-700">
        Comparison table text
      </label>
      <textarea id="pc-text" value={f.text} onChange={(e) => setF({ ...f, text: e.target.value })} rows={5} className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => read.mutate(false)} loading={read.isPending} disabled={!f.merchant || f.text.length < 3} data-testid="admin-compare-read">
          Read the table
        </Button>
        {r && !r.saved && r.rates.some((x) => x.inList) && (
          <Button onClick={() => read.mutate(true)} data-testid="admin-compare-save">
            Save {r.rates.filter((x) => x.inList).length} rate{r.rates.filter((x) => x.inList).length === 1 ? '' : 's'}
          </Button>
        )}
      </div>
      {r && (
        <div role="status" className="mt-3 text-sm" data-testid="admin-compare-result">
          <p className="font-medium">
            {r.saved ? `Saved ${r.created} new and ${r.updated} updated for ${r.merchant}` : `Found ${r.rates.length} site${r.rates.length === 1 ? '' : 's'} for ${r.merchant}`}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {r.rates.map((x) => (
              <li key={x.site}>
                {x.siteName}: {x.ratePercent != null ? `${x.upTo ? 'up to ' : ''}${x.ratePercent}%` : `${x.pointsPerDollar} points per $1`}
                {!x.inList ? ' (not in your list: not saved)' : ''}
              </li>
            ))}
          </ul>
          {r.unknown.length > 0 && <p className="mt-1 text-slate-700">Sites it did not recognise: {r.unknown.join(', ')}. Add them under the site list to track them.</p>}
        </div>
      )}
      <ErrorText error={read.error} />
    </Panel>
  );
}

/** Per site: let PointWise read this site's public store pages (off by default), and where those pages live. */
function AutoRead({ site }: { site: AdminSite }) {
  const [template, setTemplate] = useState(site.storeUrlTemplate ?? '');
  const save = useApiMutation<Partial<{ autoRead: boolean; storeUrlTemplate: string | null }>>((body) => ({ path: `/admin/cashback/sites/${site.code}`, method: 'PUT', body }), KEYS);
  return (
    <div className="w-full basis-full rounded-lg bg-slate-50 p-3" data-testid="admin-autoread" data-site={site.code}>
      <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
        <input
          type="checkbox"
          checked={site.autoRead}
          disabled={!site.storeUrlTemplate && !site.autoRead}
          aria-label={`Read ${site.name}'s public store pages automatically`}
          onChange={(e) => {
            if (!e.target.checked) return save.mutate({ autoRead: false });
            if (window.confirm(`Let PointWise read ${site.name}'s public store pages for rates?\n\nIt reads only a few stores a day, honours the site's robots.txt, never signs in and sends no cookies. Many sites' terms of use forbid automated access, so you are responsible for allowing it. It switches itself off after repeated failures.`)) save.mutate({ autoRead: true });
          }}
        />
        Read this site&apos;s public store pages automatically
      </label>
      {site.lastReadNote && (
        <p className="mt-1 text-xs text-slate-600" data-testid="admin-read-note">
          Last read {site.lastReadAt ? shortDate(site.lastReadAt) : ''}: {site.lastReadNote}
        </p>
      )}
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ storeUrlTemplate: template.trim() || null });
        }}
      >
        <div className="min-w-0 flex-1">
          <label htmlFor={`tpl-${site.code}`} className="block text-xs font-medium text-slate-700">
            Store page address ({'{host}'} = the store&apos;s web address, {'{slug}'} = its dashed name)
          </label>
          <Input id={`tpl-${site.code}`} value={template} onChange={(e) => setTemplate(e.target.value)} placeholder={`https://www.example.com/${'{host}'}`} />
        </div>
        <Button type="submit" variant="secondary" loading={save.isPending}>
          Save address
        </Button>
      </form>
      <ErrorText error={save.error} />
    </div>
  );
}

/** Server-wide: the comparison-site cross-check, and reading one store now to see what a site returns. */
function ReadSettings({ sites }: { sites: AdminSite[] }) {
  const settings = useAuthedQuery<{ benchmark: boolean }>(['admin', 'cashback', 'settings'], '/admin/cashback/settings');
  const save = useApiMutation<boolean>((benchmark) => ({ path: '/admin/cashback/settings', method: 'PUT', body: { benchmark } }), KEYS);
  const [f, setF] = useState({ site: '', merchant: '' });
  const readNow = useApiMutation<void, { url: string; saved: boolean; read: { ratePercent: number | null; pointsPerDollar: number | null; upTo: boolean; where: string; evidence: string } | null; reason: string | null }>(() => ({ path: '/admin/cashback/read', method: 'POST', body: f }), KEYS);
  const allowed = sites.filter((s) => s.autoRead);
  const r = readNow.data;
  return (
    <Panel title="Automatic reading" data-testid="admin-reading">
      <p className="mb-2 text-sm text-slate-700">
        Off by default. Allow it per site above; PointWise then reads that site&apos;s public store pages for a few stores a day (those where a purchase is planned or that already have a rate), and a site that keeps failing is switched off by itself.
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={!!settings.data?.benchmark} onChange={(e) => save.mutate(e.target.checked)} data-testid="admin-benchmark" />
        Also compare with Cashback Monitor&apos;s best rate for each store (one public page per store), to warn when a rate on file looks out of date
      </label>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <Field label="Read one store now: site" htmlFor="rn-site">
          <Select id="rn-site" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })}>
            <option value="">{allowed.length ? 'Choose…' : 'No site allowed yet'}</option>
            {allowed.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Store" htmlFor="rn-merchant">
          <Input id="rn-merchant" value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })} placeholder="Target" />
        </Field>
        <Button variant="secondary" onClick={() => readNow.mutate(undefined)} loading={readNow.isPending} disabled={!f.site || !f.merchant} data-testid="admin-read-now">
          Read it now
        </Button>
      </div>
      {r && (
        <p role="status" className="mt-2 text-sm" data-testid="admin-read-result">
          {r.saved && r.read ? `Saved ${r.read.ratePercent != null ? `${r.read.upTo ? 'up to ' : ''}${r.read.ratePercent}%` : `${r.read.pointsPerDollar} points per $1`} (from the page ${r.read.where}: “${r.read.evidence}”).` : r.reason}
        </p>
      )}
      <ErrorText error={save.error ?? readNow.error ?? settings.error} />
    </Panel>
  );
}
