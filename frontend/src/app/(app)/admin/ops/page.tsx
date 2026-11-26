'use client';

import { StatTiles } from '@/components/charts';
import { Badge, ErrorText, PageHeader, Panel, Spinner } from '@/components/ui';
import { shortDate } from '@/lib/format';
import { useAuthedQuery } from '@/lib/queries';
import { statusTone, uptime } from '@/lib/strategy';

interface Health {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  problems: string[];
  process: { uptimeSec: number; node: string; rssMb: number; version: string };
  dependencies: {
    database: { ok: boolean; latencyMs: number; error?: string };
    redis: { ok: boolean; latencyMs: number; error?: string };
  };
  queue: {
    counts: Record<'waiting' | 'active' | 'delayed' | 'failed' | 'completed', number> | null;
    schedulers: Array<{
      job: string;
      pattern: string | null;
      next: string | null;
      lastRun: {
        at: string;
        ok: boolean;
        error?: string;
        durationMs?: number;
      } | null;
    }>;
  };
  ai: {
    models: Array<{
      model: string;
      provider: string;
      kind: string;
      circuit: 'OPEN' | 'CLOSED';
      openUntil: string | null;
      requests24h: number;
      errorRate24h: number;
      avgLatencyMs: number | null;
    }>;
    note: string;
  };
  mcp: Array<{
    name: string;
    status: string;
    lastCheckedAt: string | null;
    lastError: string | null;
  }>;
  cardSources: {
    active: number;
    failing: Array<{
      card: string;
      url: string;
      failures: number;
      lastError: string | null;
    }>;
  };
}
interface LogEvent {
  at: string;
  level: 'error' | 'warn' | 'info';
  source: string;
  message: string;
}

const time = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

export default function OpsPage() {
  // refresh every 15 s while the page is open (queries wait for the session token)
  const health = useAuthedQuery<Health>(['admin', 'ops', 'health'], '/admin/ops/health', { refetchInterval: 15_000 });
  const logs = useAuthedQuery<LogEvent[]>(['admin', 'ops', 'logs'], '/admin/ops/logs?limit=100', { refetchInterval: 15_000 });
  const h = health.data;

  return (
    <div className="space-y-6">
      <PageHeader title="Operations" subtitle="Health of the API, database, queue, scheduled jobs, AI models, MCP servers and card sources. Refreshes every 15 seconds." />
      {health.isLoading && <Spinner label="Checking health" />}
      <ErrorText error={health.error} />
      {h && (
        <>
          <div className="flex flex-wrap items-center gap-3" data-testid="ops-status">
            <Badge tone={statusTone(h.status)}>{h.status === 'ok' ? 'All systems normal' : h.status === 'degraded' ? 'Degraded' : 'Down'}</Badge>
            <span className="text-xs text-slate-500">Checked {time(h.checkedAt)}</span>
          </div>
          {h.problems.length > 0 && (
            <div role="note" data-testid="ops-problems">
              <ul className="space-y-1 text-sm text-amber-800">
                {h.problems.map((p) => (
                  <li key={p} className="rounded bg-amber-50 px-3 py-1.5">
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <StatTiles
            testId="ops-tiles"
            items={[
              ['Database', h.dependencies.database.ok ? `${h.dependencies.database.latencyMs} ms` : 'Down', h.dependencies.database.error],
              ['Redis / queue', h.dependencies.redis.ok ? `${h.dependencies.redis.latencyMs} ms` : 'Down', h.dependencies.redis.error],
              [
                'Jobs waiting / failed',
                h.queue.counts ? `${h.queue.counts.waiting} / ${h.queue.counts.failed}` : '—',
                h.queue.counts ? `${h.queue.counts.active} running` : undefined,
              ],
              ['API uptime', uptime(h.process.uptimeSec), `${h.process.node} · ${h.process.rssMb} MB`],
            ]}
          />

          <Panel title="Scheduled jobs" data-testid="ops-jobs">
            {h.queue.schedulers.length === 0 ? (
              <p className="text-sm text-slate-500">No schedules registered — is the scheduler service running?</p>
            ) : (
              <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scheduled jobs table">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-1 font-semibold">Job</th>
                      <th className="py-1 font-semibold">Schedule (UTC)</th>
                      <th className="py-1 font-semibold">Next run</th>
                      <th className="py-1 font-semibold">Last run</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {h.queue.schedulers.map((s) => (
                      <tr key={s.job}>
                        <td className="py-2 font-medium">{s.job}</td>
                        <td className="py-2 font-mono text-xs">{s.pattern ?? '—'}</td>
                        <td className="py-2">{time(s.next)}</td>
                        <td className="py-2">
                          {s.lastRun ? (
                            <span className="inline-flex items-center gap-1.5">
                              <Badge tone={s.lastRun.ok ? 'green' : 'red'}>{s.lastRun.ok ? 'OK' : 'Failed'}</Badge>
                              {time(s.lastRun.at)}
                            </span>
                          ) : (
                            <span className="text-slate-500">Not run yet</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="AI models (last 24 h)" data-testid="ops-ai">
              <ul className="divide-y divide-slate-100 text-sm">
                {h.ai.models.map((m) => (
                  <li key={m.model} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      <span className="font-medium">{m.model}</span> <span className="text-slate-500">· {m.provider}</span>
                    </span>
                    <span className="flex items-center gap-2 text-xs text-slate-600">
                      {m.requests24h} req · {Math.round(m.errorRate24h * 100)} % errors
                      {m.avgLatencyMs != null ? ` · ${m.avgLatencyMs} ms` : ''}
                      <Badge tone={statusTone(m.circuit)}>{m.circuit === 'OPEN' ? 'Circuit open' : 'Healthy'}</Badge>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-slate-500">{h.ai.note}</p>
            </Panel>
            <Panel title="Integrations" data-testid="ops-integrations">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">MCP servers</h3>
              {h.mcp.length === 0 ? (
                <p className="text-sm text-slate-500">None registered.</p>
              ) : (
                <ul className="mb-3 text-sm">
                  {h.mcp.map((s) => (
                    <li key={s.name} className="flex items-center justify-between gap-2 py-1">
                      <span>{s.name}</span>
                      <span className="text-xs text-slate-600">
                        {s.lastError ? <Badge tone="red">Error</Badge> : <Badge tone={statusTone(s.status)}>{s.status === 'ACTIVE' ? 'Active' : 'Disabled'}</Badge>}{' '}
                        {time(s.lastCheckedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <h3 className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Card sources</h3>
              <p className="text-sm text-slate-700">
                {h.cardSources.active} active, {h.cardSources.failing.length} failing
              </p>
              {h.cardSources.failing.map((s) => (
                <p key={s.url} className="truncate text-xs text-red-700">
                  {s.card}: {s.lastError} ({s.failures}×)
                </p>
              ))}
            </Panel>
          </div>
        </>
      )}

      <Panel title="Recent events (7 days)" data-testid="ops-logs">
        {logs.isLoading ? (
          <Spinner label="Loading events" />
        ) : !logs.data?.length ? (
          <p className="text-sm text-slate-500">No events.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {logs.data.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex flex-wrap items-start gap-2 py-1.5">
                <Badge tone={e.level === 'error' ? 'red' : e.level === 'warn' ? 'amber' : 'slate'}>{e.level}</Badge>
                <span className="text-xs text-slate-500">{shortDate(e.at)}</span>
                <span className="text-xs font-medium text-slate-600">{e.source}</span>
                <span className="min-w-0 flex-1 break-words text-slate-800">{e.message}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
