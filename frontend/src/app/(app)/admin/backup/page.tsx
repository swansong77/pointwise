'use client';

import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { Tabs } from '@/components/charts';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, Spinner } from '@/components/ui';
import { API_BASE } from '@/lib/api';
import { BackupList, Check, checkTone, EnvRow, formatBytes, hasFailure, MIGRATION_STEPS, passphraseProblem, VerifyReport } from '@/lib/data-transfer';
import { shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

type Section = 'backups' | 'migration';
const KEY = ['admin', 'backups'] as const;

function Backups() {
  const { data: session } = useSession();
  const q = useAuthedQuery<BackupList>([...KEY, 'list'], '/admin/backups');
  const [pass, setPass] = useState('');
  const [ephemeral, setEphemeral] = useState(false);
  const [env, setEnv] = useState(false);
  const [target, setTarget] = useState<string | null>(null);
  const [verify, setVerify] = useState<VerifyReport | null>(null);
  const [typed, setTyped] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const create = useApiMutation<void, { name: string; rows: number; bytes: number; warnings: string[] }>(() => ({ path: '/admin/backups', method: 'POST', body: { passphrase: pass, includeEphemeral: ephemeral, includeEnv: env } }), [KEY]);
  const check = useApiMutation<string, VerifyReport>((name) => ({ path: `/admin/backups/${name}/verify`, method: 'POST', body: { passphrase: pass } }));
  const restore = useApiMutation<string, { rows: number; seconds: number; preBackup: string | null; warnings: string[] }>((name) => ({ path: `/admin/backups/${name}/restore`, method: 'POST', body: { passphrase: pass, confirm: 'RESTORE' } }), [KEY]);
  const remove = useApiMutation<string>((name) => ({ path: `/admin/backups/${name}`, method: 'DELETE' }), [KEY]);
  const problem = pass ? passphraseProblem(pass) : null;

  async function download(name: string) {
    const res = await fetch(`${API_BASE}/admin/backups/${name}/download`, { headers: { Authorization: `Bearer ${session?.accessToken}` } });
    if (!res.ok) return setMsg('The download failed.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(await res.blob());
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (q.isLoading) return <Spinner />;
  const d = q.data;
  return (
    <div className="space-y-4">
      <Panel title="Backups">
        <p className="text-sm text-slate-700">An encrypted copy of the whole system: every member, the catalog, settings and secrets. The passphrase is never stored: without it a backup cannot be read, so keep it safe. Backups are written to <code>{d?.folder}</code>; copy them to another place too.</p>
        <p className="mt-2 text-sm" data-testid="nightly-status">
          Nightly backup ({d?.nightly.schedule}):{' '}
          {d?.nightly.configured ? <Badge tone="green">On, keeps the newest {d.keep}</Badge> : <Badge tone="amber">Off. Set BACKUP_PASSPHRASE on the server to turn it on.</Badge>}
        </p>
        <form className="mt-3 grid gap-3 sm:grid-cols-[2fr_1fr]" onSubmit={(e) => { e.preventDefault(); create.mutate(undefined, { onSuccess: (r) => setMsg(`Backup ${r.name} written (${r.rows} rows, ${formatBytes(r.bytes)}).`) }); }}>
          <Field label="Passphrase" htmlFor="bk-pass" hint="At least 12 characters. Needed to verify, restore or move this backup." error={problem ?? undefined}>
            <Input id="bk-pass" type="password" autoComplete="new-password" value={pass} onChange={(e) => setPass(e.target.value)} data-testid="bk-pass" />
          </Field>
          <div className="space-y-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={env} onChange={(e) => setEnv(e.target.checked)} /> Carry environment secrets (keeps everyone signed in)</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={ephemeral} onChange={(e) => setEphemeral(e.target.checked)} /> Include sessions, notifications and logs</label>
            <Button type="submit" className="mt-2" disabled={!pass || !!problem} loading={create.isPending} data-testid="bk-create">Create backup</Button>
          </div>
        </form>
        <ErrorText error={create.error} />
        {msg && <p className="mt-2 rounded bg-green-50 p-2 text-sm" role="status" data-testid="bk-message">{msg}</p>}
      </Panel>

      <Panel title="Backup files">
        {!d?.files.length ? <EmptyState title="No backups yet" /> : (
          <ul className="divide-y divide-slate-100 text-sm" data-testid="bk-files">
            {d.files.map((f) => (
              <li key={f.name} className="py-3" data-testid="bk-file">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs">{f.name}</span>
                  <span className="text-xs text-slate-600">{formatBytes(f.bytes)} · {shortDate(f.modifiedAt)}</span>
                  <span className="ml-auto flex flex-wrap gap-2">
                    <Button variant="secondary" className="px-2 py-1 text-xs" disabled={!pass} loading={check.isPending && target === f.name} onClick={() => { setTarget(f.name); setVerify(null); check.mutate(f.name, { onSuccess: setVerify }); }} data-testid="bk-verify">Verify</Button>
                    <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => void download(f.name)}>Download</Button>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => { setTarget(f.name); setVerify(null); setTyped(''); }} data-testid="bk-restore-open">Restore…</Button>
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => remove.mutate(f.name)}>Delete</Button>
                  </span>
                </div>
                {target === f.name && verify && (
                  <div className="mt-2 rounded-lg bg-slate-50 p-3 text-xs" data-testid="bk-verify-result">
                    <p className="font-medium">{verify.ok && !verify.incompatible ? 'Verified: the file is intact and can be restored here.' : 'Problem found'}</p>
                    <p>Made {verify.createdAt ? shortDate(verify.createdAt) : '—'} · {verify.rows ?? '—'} rows · database version {verify.migration ?? '—'}{verify.hasEnv ? ' · carries environment secrets' : ''}</p>
                    {[...verify.problems, ...(verify.incompatible ? [verify.incompatible] : [])].map((p) => <p key={p} className="text-red-700">{p}</p>)}
                    {verify.warnings.map((w) => <p key={w} className="text-amber-800">{w}</p>)}
                  </div>
                )}
                {target === f.name && !verify && (
                  <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-3" data-testid="bk-restore-box">
                    <p className="text-sm font-medium text-red-800">Restoring replaces ALL current data with this backup.</p>
                    <p className="text-xs text-red-700">A backup of what is there now is made first. The restore is one step and is undone automatically if anything does not match. Enter the passphrase above, then type RESTORE.</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Input aria-label="Type RESTORE to confirm" placeholder="Type RESTORE" value={typed} onChange={(e) => setTyped(e.target.value)} className="max-w-[10rem]" data-testid="bk-restore-typed" />
                      <Button variant="danger" disabled={typed !== 'RESTORE' || !pass} loading={restore.isPending} onClick={() => restore.mutate(f.name, { onSuccess: (r) => setMsg(`Restored ${r.rows} rows in ${r.seconds}s. Pre-restore backup: ${r.preBackup ?? 'none (the system was empty)'}.`) })} data-testid="bk-restore">Restore this backup</Button>
                    </div>
                    <ErrorText error={restore.error} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <ErrorText error={check.error ?? remove.error} />
      </Panel>
    </div>
  );
}

function Migration() {
  const pre = useAuthedQuery<Check[]>([...KEY, 'preflight'], '/admin/migration/preflight');
  const env = useAuthedQuery<EnvRow[]>([...KEY, 'env'], '/admin/migration/env');
  const maint = useAuthedQuery<{ on: boolean; reason: string | null; since: string | null }>([...KEY, 'maintenance'], '/admin/maintenance');
  const verified = useAuthedQuery<Check[]>([...KEY, 'verified'], '/admin/migration/verify', { enabled: false });
  const [reason, setReason] = useState('');
  const set = useApiMutation<boolean>((on) => ({ path: '/admin/maintenance', method: 'POST', body: { on, reason: on ? reason || undefined : undefined } }), [[...KEY, 'maintenance'], [...KEY, 'list']]);
  return (
    <div className="space-y-4">
      <Panel title="Maintenance mode">
        <p className="text-sm text-slate-700">While on, only administrators can use PointWise; everyone else sees a short notice. Turn it on before making the final backup, and off again if you decide not to move.</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <Badge tone={maint.data?.on ? 'amber' : 'green'}>{maint.data?.on ? `On${maint.data.reason ? `: ${maint.data.reason}` : ''}` : 'Off'}</Badge>
          {!maint.data?.on && <Input aria-label="Reason shown to members" placeholder="Reason shown to members (optional)" value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-xs" />}
          <Button variant={maint.data?.on ? 'secondary' : 'primary'} loading={set.isPending} onClick={() => set.mutate(!maint.data?.on)} data-testid="maintenance-toggle">{maint.data?.on ? 'Turn off' : 'Turn on'}</Button>
        </div>
        <ErrorText error={set.error} />
      </Panel>

      <Panel title="Moving to another server">
        <ol className="space-y-3 text-sm" data-testid="migration-steps">
          {MIGRATION_STEPS.map((s, i) => (
            <li key={s.id} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">{i + 1}</span>
              <span>
                <span className="font-medium">{s.title}</span> <Badge tone="slate">{s.where}</Badge>
                <span className="block text-slate-600">{s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-slate-600">On a command line, the same steps are: <code>docker/migrate/rehearse.sh</code> (dry run), <code>docker/backup.sh</code>, <code>docker/restore.sh</code>. See docs/migration-runbook.md.</p>
      </Panel>

      <Panel title="This server's checks" action={<Button variant="secondary" className="px-3 py-1.5" onClick={() => void pre.refetch()}>Run again</Button>}>
        {pre.isLoading ? <Spinner /> : (
          <ul className="space-y-1 text-sm" data-testid="preflight">
            {(pre.data ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2" data-testid="preflight-check">
                <Badge tone={checkTone(c.status)}>{c.status === 'ok' ? 'OK' : c.status === 'warn' ? 'Check' : 'Fix'}</Badge>
                <span className="font-medium">{c.label}</span>
                <span className="text-xs text-slate-600">{c.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Settings to carry or change">
        <p className="mb-2 text-xs text-slate-600">Secret values are never shown. Carried settings can travel inside the encrypted backup. The others depend on the new address.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs" data-testid="env-table">
            <thead>
              <tr className="text-slate-500"><th className="py-1">Setting</th><th>What to do</th><th>Here</th><th>Why</th></tr>
            </thead>
            <tbody>
              {(env.data ?? []).map((e) => (
                <tr key={e.name} className="border-t border-slate-100">
                  <td className="py-1 font-mono">{e.name}</td>
                  <td>{e.kind === 'carry' ? 'Carry over' : 'Set for the new server'}</td>
                  <td>{e.value ?? e.state}</td>
                  <td className="text-slate-600">{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Check after a restore" action={<Button variant="secondary" className="px-3 py-1.5" loading={verified.isFetching} onClick={() => void verified.refetch()} data-testid="run-verify">Run verification</Button>}>
        <p className="text-sm text-slate-700">Every reference points at a row, a sample of each kind of secret decrypts with this server&apos;s key, and an administrator exists.</p>
        {verified.data && (
          <>
            <p className="mt-2 text-sm font-medium" data-testid="verify-outcome">{hasFailure(verified.data) ? 'Not verified: fix the items marked Fix.' : 'Verified.'}</p>
            <ul className="mt-1 space-y-1 text-sm">
              {verified.data.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={checkTone(c.status)}>{c.status === 'ok' ? 'OK' : c.status === 'warn' ? 'Check' : 'Fix'}</Badge>
                  <span>{c.label}</span>
                  <span className="text-xs text-slate-600">{c.detail}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
    </div>
  );
}

export default function BackupPage() {
  const [section, setSection] = useState<Section>('backups');
  return (
    <>
      <PageHeader title="Backup & Migration" subtitle="Encrypted backups of the whole system, restore, and moving PointWise to another server." />
      <div className="mb-4">
        <Tabs<Section> value={section} onChange={setSection} options={[['backups', 'Backups'], ['migration', 'Migration']]} label="Backup sections" />
      </div>
      {section === 'backups' ? <Backups /> : <Migration />}
    </>
  );
}
