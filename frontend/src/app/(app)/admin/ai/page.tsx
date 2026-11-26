'use client';

import { BrandLogo } from '@/components/brand-logo';
import { useState } from 'react';
import { BarList, StatTiles, Tabs } from '@/components/charts';
import { Badge, Button, ErrorText, Field, Input, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { usd } from '@/lib/ai';
import { shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

type Section = 'providers' | 'models' | 'agents' | 'usage' | 'mcp';

interface Provider {
  id: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  apiVersion: string | null;
  apiKeyEnv: string | null;
  status: 'ACTIVE' | 'DISABLED';
  hasStoredKey: boolean;
  usable: boolean;
  _count: { models: number };
}
interface Model {
  id: string;
  modelId: string;
  displayName: string;
  contextWindow: number | null;
  inputPrice: string | null;
  outputPrice: string | null;
  capabilities: string[];
  status: 'ACTIVE' | 'DISABLED';
  provider: { id: string; name: string; kind: string; status: string };
}
interface Agent {
  key: string;
  name: string;
  tools: string[];
  mcpToolIds: string[];
  modelChain: string[];
  effort: string | null;
  maxSteps: number;
  enabled: boolean;
}
interface Usage {
  days: number;
  totals: { requests: number; failures: number; inputTokens: number; outputTokens: number; costUsd: number; avgLatencyMs: number };
  byModel: Array<{ model: string; requests: number; inputTokens: number; outputTokens: number; costUsd: number }>;
  byAgent: Array<{ agent: string; requests: number; tokens: number; costUsd: number }>;
}
interface McpServer {
  id: string;
  name: string;
  url: string;
  authType: string;
  status: 'ACTIVE' | 'DISABLED';
  health: 'UNKNOWN' | 'UP' | 'DOWN';
  version: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  hasSecret: boolean;
  tools: Array<{ id: string; name: string; description: string; enabled: boolean; readOnly: boolean; approved: boolean; changedSinceApproval: boolean }>;
}

const KINDS = ['ANTHROPIC', 'OPENAI', 'AZURE_OPENAI', 'GEMINI', 'OPENAI_COMPATIBLE', 'OLLAMA'];

export default function AdminAiPage() {
  const [section, setSection] = useState<Section>('providers');
  return (
    <div className="space-y-6">
      <PageHeader title="AI & MCP" subtitle="Providers, API keys, models, assistants, usage and cost, and external MCP servers." />
      <Tabs<Section>
        label="Section"
        value={section}
        onChange={setSection}
        options={[
          ['providers', 'Providers & keys'],
          ['models', 'Models'],
          ['agents', 'Assistants'],
          ['usage', 'Usage & cost'],
          ['mcp', 'MCP servers'],
        ]}
      />
      {section === 'providers' && <Providers />}
      {section === 'models' && <Models />}
      {section === 'agents' && <Agents />}
      {section === 'usage' && <UsageView />}
      {section === 'mcp' && <Mcp />}
    </div>
  );
}

function Providers() {
  const q = useAuthedQuery<Provider[]>(['admin', 'ai', 'providers'], '/admin/ai/providers');
  const keys = [['admin', 'ai']] as const;
  const toggle = useApiMutation<{ id: string; status: string }>(({ id, status }) => ({ path: `/admin/ai/providers/${id}`, method: 'PATCH', body: { status } }), keys);
  const setKey = useApiMutation<{ id: string; apiKey: string }>(({ id, apiKey }) => ({ path: `/admin/ai/providers/${id}/key`, method: 'PUT', body: { apiKey } }), keys);
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [keyValue, setKeyValue] = useState('');
  const [f, setF] = useState({ name: '', kind: 'OPENAI_COMPATIBLE', baseUrl: '', apiKeyEnv: '' });
  const create = useApiMutation<void>(() => ({ path: '/admin/ai/providers', method: 'POST', body: { name: f.name, kind: f.kind, baseUrl: f.baseUrl || undefined, apiKeyEnv: f.apiKeyEnv || undefined } }), keys);
  if (!q.data) return <Spinner />;
  return (
    <>
      <Panel title="Providers" data-testid="ai-providers">
        <ul className="divide-y divide-slate-100 text-sm">
          {q.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  <BrandLogo brand={{ code: p.kind, name: p.name }} size="md" decorative />
                  {p.name} <Badge>{p.kind}</Badge> {p.usable ? <Badge tone="green">usable</Badge> : <Badge tone="amber">not usable</Badge>}
                </p>
                <p className="text-xs text-slate-500">
                  {p._count.models} models · key: {p.hasStoredKey ? 'stored (encrypted)' : p.apiKeyEnv ? `env ${p.apiKeyEnv}` : 'none'}
                  {p.baseUrl && ` · ${p.baseUrl}`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => toggle.mutate({ id: p.id, status: p.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}>
                  {p.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                </Button>
                {p.kind !== 'MOCK' && p.kind !== 'OLLAMA' && (
                  <Button variant="ghost" onClick={() => (setKeyFor(p.id), setKeyValue(''))}>
                    Set API key
                  </Button>
                )}
              </div>
              {keyFor === p.id && (
                <form
                  className="flex w-full flex-wrap items-end gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setKey.mutate({ id: p.id, apiKey: keyValue }, { onSuccess: () => setKeyFor(null) });
                  }}
                >
                  <Field label={`API key for ${p.name}`} htmlFor={`key-${p.id}`} hint="Write-only: stored encrypted, never shown again.">
                    <Input id={`key-${p.id}`} type="password" autoComplete="off" value={keyValue} onChange={(e) => setKeyValue(e.target.value)} />
                  </Field>
                  <Button type="submit" disabled={keyValue.length < 8} loading={setKey.isPending}>
                    Save key
                  </Button>
                </form>
              )}
            </li>
          ))}
        </ul>
        <ErrorText error={toggle.error ?? setKey.error} />
      </Panel>
      <Panel title="Add a provider">
        <form
          className="grid gap-3 sm:grid-cols-5 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined, { onSuccess: () => setF({ name: '', kind: 'OPENAI_COMPATIBLE', baseUrl: '', apiKeyEnv: '' }) });
          }}
        >
          <Field label="Name" htmlFor="np-name">
            <Input id="np-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Type" htmlFor="np-kind">
            <Select id="np-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </Select>
          </Field>
          <Field label="Base URL" htmlFor="np-url">
            <Input id="np-url" value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} placeholder="https://…/v1" />
          </Field>
          <Field label="Key env var" htmlFor="np-env">
            <Input id="np-env" value={f.apiKeyEnv} onChange={(e) => setF({ ...f, apiKeyEnv: e.target.value.toUpperCase() })} placeholder="MY_API_KEY" />
          </Field>
          <Button type="submit" disabled={f.name.length < 2} loading={create.isPending}>
            Add
          </Button>
        </form>
        <ErrorText error={create.error} />
      </Panel>
    </>
  );
}

function Models() {
  const q = useAuthedQuery<Model[]>(['admin', 'ai', 'models'], '/admin/ai/models');
  const providers = useAuthedQuery<Provider[]>(['admin', 'ai', 'providers'], '/admin/ai/providers');
  const keys = [['admin', 'ai']] as const;
  const toggle = useApiMutation<{ id: string; status: string }>(({ id, status }) => ({ path: `/admin/ai/models/${id}`, method: 'PATCH', body: { status } }), keys);
  const test = useApiMutation<string, { reply: string; latencyMs: number }>((id) => ({ path: `/admin/ai/models/${id}/test`, method: 'POST' }), []);
  const [f, setF] = useState({ providerId: '', modelId: '', displayName: '', inputPrice: '', outputPrice: '' });
  const create = useApiMutation<void>(
    () => ({
      path: '/admin/ai/models',
      method: 'POST',
      body: { providerId: f.providerId, modelId: f.modelId, displayName: f.displayName, inputPrice: f.inputPrice ? Number(f.inputPrice) : undefined, outputPrice: f.outputPrice ? Number(f.outputPrice) : undefined, capabilities: ['tools'] },
    }),
    keys,
  );
  if (!q.data) return <Spinner />;
  return (
    <>
      <Panel title="Models" data-testid="ai-models">
        <div className="-mx-5 overflow-x-auto" tabIndex={0} role="region" aria-label="Models table">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th scope="col" className="px-5 py-2">Model</th>
                <th scope="col" className="px-2 py-2">Provider</th>
                <th scope="col" className="px-2 py-2">$/1M in · Out</th>
                <th scope="col" className="px-2 py-2">Capabilities</th>
                <th scope="col" className="px-5 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.data.map((m) => (
                <tr key={m.id}>
                  <td className="px-5 py-2">
                    <p className="font-medium">{m.displayName}</p>
                    <p className="text-xs text-slate-500">{m.modelId}</p>
                  </td>
                  <td className="px-2 py-2">{m.provider.name}</td>
                  <td className="px-2 py-2 tabular-nums">{m.inputPrice != null ? `$${Number(m.inputPrice)} · $${Number(m.outputPrice)}` : '—'}</td>
                  <td className="px-2 py-2 text-xs">{m.capabilities.join(', ')}</td>
                  <td className="px-5 py-2 text-right">
                    <span className="inline-flex gap-1">
                      <Button variant="ghost" onClick={() => toggle.mutate({ id: m.id, status: m.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}>
                        {m.status === 'ACTIVE' ? 'Disable' : 'Enable'}
                      </Button>
                      <Button variant="ghost" onClick={() => test.mutate(m.id)} loading={test.isPending && test.variables === m.id}>
                        Test
                      </Button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {test.data && (
          <p className="mt-2 text-sm text-emerald-700" role="status">
            Reply “{test.data.reply}” in {test.data.latencyMs} ms
          </p>
        )}
        <ErrorText error={toggle.error ?? test.error} />
      </Panel>
      <Panel title="Add a model">
        <form
          className="grid gap-3 sm:grid-cols-6 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined);
          }}
        >
          <Field label="Provider" htmlFor="nm-provider">
            <Select id="nm-provider" value={f.providerId} onChange={(e) => setF({ ...f, providerId: e.target.value })}>
              <option value="">Choose…</option>
              {providers.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Model id" htmlFor="nm-id">
            <Input id="nm-id" value={f.modelId} onChange={(e) => setF({ ...f, modelId: e.target.value })} />
          </Field>
          <Field label="Display name" htmlFor="nm-name">
            <Input id="nm-name" value={f.displayName} onChange={(e) => setF({ ...f, displayName: e.target.value })} />
          </Field>
          <Field label="$ / 1M input" htmlFor="nm-in">
            <Input id="nm-in" inputMode="decimal" value={f.inputPrice} onChange={(e) => setF({ ...f, inputPrice: e.target.value })} />
          </Field>
          <Field label="$ / 1M output" htmlFor="nm-out">
            <Input id="nm-out" inputMode="decimal" value={f.outputPrice} onChange={(e) => setF({ ...f, outputPrice: e.target.value })} />
          </Field>
          <Button type="submit" disabled={!f.providerId || !f.modelId || !f.displayName} loading={create.isPending}>
            Add
          </Button>
        </form>
        <ErrorText error={create.error} />
      </Panel>
    </>
  );
}

function Agents() {
  const q = useAuthedQuery<Agent[]>(['admin', 'ai', 'agents'], '/admin/ai/agents');
  const models = useAuthedQuery<Model[]>(['admin', 'ai', 'models'], '/admin/ai/models');
  const update = useApiMutation<{ key: string; body: Partial<Agent> }>(({ key, body }) => ({ path: `/admin/ai/agents/${key}`, method: 'PATCH', body }), [['admin', 'ai']]);
  const name = (id: string) => models.data?.find((m) => m.id === id)?.displayName ?? '?';
  if (!q.data) return <Spinner />;
  return (
    <Panel title="Assistants" data-testid="ai-agents">
      <ul className="divide-y divide-slate-100 text-sm">
        {q.data.map((a) => (
          <li key={a.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                {a.name} {!a.enabled && <Badge tone="amber">disabled</Badge>}
              </p>
              <p className="text-xs text-slate-500">
                Models: {a.modelChain.map(name).join(' → ') || '—'} · {a.tools.length} tools{a.mcpToolIds.length ? ` + ${a.mcpToolIds.length} MCP` : ''} · effort {a.effort ?? 'default'} · max {a.maxSteps} steps
              </p>
            </div>
            <Button variant="secondary" onClick={() => update.mutate({ key: a.key, body: { enabled: !a.enabled } })}>
              {a.enabled ? 'Disable' : 'Enable'}
            </Button>
          </li>
        ))}
      </ul>
      <ErrorText error={update.error} />
    </Panel>
  );
}

function UsageView() {
  const [days, setDays] = useState(30);
  const q = useAuthedQuery<Usage>(['admin', 'ai', 'usage', days], `/admin/ai/usage?days=${days}`);
  if (!q.data) return <Spinner />;
  const t = q.data.totals;
  return (
    <div className="space-y-6" data-testid="ai-usage">
      <div className="w-40">
        <label htmlFor="usage-days" className="sr-only">
          Period
        </label>
        <Select id="usage-days" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </Select>
      </div>
      <StatTiles
        items={[
          ['Requests', String(t.requests), `${t.failures} failed`],
          ['Tokens', (t.inputTokens + t.outputTokens).toLocaleString('en-US'), `${t.inputTokens.toLocaleString('en-US')} in`],
          ['Cost', usd(t.costUsd)],
          ['Avg latency', `${t.avgLatencyMs} ms`],
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Cost by model">
          <BarList format={usd} items={q.data.byModel.map((m) => ({ label: m.model, value: m.costUsd, hint: `${m.requests} requests · ${(m.inputTokens + m.outputTokens).toLocaleString('en-US')} tokens` }))} />
        </Panel>
        <Panel title="Requests by assistant">
          <BarList format={(v) => String(v)} items={q.data.byAgent.map((a) => ({ label: a.agent, value: a.requests, hint: `${a.tokens.toLocaleString('en-US')} tokens · ${usd(a.costUsd)}` }))} />
        </Panel>
      </div>
    </div>
  );
}

function Mcp() {
  const q = useAuthedQuery<McpServer[]>(['admin', 'mcp'], '/admin/mcp/servers');
  const keys = [['admin', 'mcp']] as const;
  const check = useApiMutation<string>((id) => ({ path: `/admin/mcp/servers/${id}/check`, method: 'POST' }), keys);
  const toggle = useApiMutation<{ id: string; status: string }>(({ id, status }) => ({ path: `/admin/mcp/servers/${id}`, method: 'PATCH', body: { status } }), keys);
  const tool = useApiMutation<{ id: string; body: Record<string, boolean> }>(({ id, body }) => ({ path: `/admin/mcp/tools/${id}`, method: 'PATCH', body }), keys);
  const [f, setF] = useState({ name: '', url: '', authSecret: '' });
  const create = useApiMutation<void>(
    () => ({ path: '/admin/mcp/servers', method: 'POST', body: { name: f.name, url: f.url, authType: f.authSecret ? 'BEARER' : 'NONE', authSecret: f.authSecret || undefined, status: 'ACTIVE' } }),
    keys,
  );
  if (!q.data) return <Spinner />;
  return (
    <>
      <Panel title="Register an MCP server" data-testid="mcp-register">
        <p className="mb-3 text-sm text-slate-600">
          Remote servers only (Streamable HTTP over https, or an internal host listed in <code>MCP_ALLOWED_HOSTS</code>). New tools stay disabled until you approve them; a changed tool
          definition must be approved again. Only read-only tools can be attached to assistants. Filesystem, database, Git and browser MCP servers are for admin tooling and must not be
          attached to user assistants.
        </p>
        <form
          className="grid gap-3 sm:grid-cols-4 sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate(undefined, { onSuccess: () => setF({ name: '', url: '', authSecret: '' }) });
          }}
        >
          <Field label="Name" htmlFor="mcp-name">
            <Input id="mcp-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="URL" htmlFor="mcp-url">
            <Input id="mcp-url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://…/mcp" />
          </Field>
          <Field label="Bearer token (optional)" htmlFor="mcp-secret">
            <Input id="mcp-secret" type="password" autoComplete="off" value={f.authSecret} onChange={(e) => setF({ ...f, authSecret: e.target.value })} />
          </Field>
          <Button type="submit" disabled={!f.name || !f.url} loading={create.isPending}>
            Register
          </Button>
        </form>
        <ErrorText error={create.error} />
      </Panel>
      {q.data.map((s) => (
        <Panel
          key={s.id}
          title={
            <span className="flex items-center gap-2">
              {s.name} <Badge tone={s.health === 'UP' ? 'green' : s.health === 'DOWN' ? 'red' : 'slate'}>{s.health}</Badge> {s.status === 'DISABLED' && <Badge tone="amber">disabled</Badge>}
            </span>
          }
          action={
            <span className="flex gap-2">
              <Button variant="secondary" onClick={() => check.mutate(s.id)} loading={check.isPending && check.variables === s.id}>
                Check now
              </Button>
              <Button variant="ghost" onClick={() => toggle.mutate({ id: s.id, status: s.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })}>
                {s.status === 'ACTIVE' ? 'Disable' : 'Enable'}
              </Button>
            </span>
          }
          data-testid="mcp-server"
        >
          <p className="text-xs text-slate-500">
            {s.url} · {s.version ?? 'version unknown'} · checked {s.lastCheckedAt ? shortDate(s.lastCheckedAt) : 'never'}
            {s.lastError && <span className="text-red-700"> · {s.lastError}</span>}
          </p>
          <ul className="mt-3 divide-y divide-slate-100 text-sm">
            {s.tools.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0">
                  <span className="font-medium">{t.name}</span> {t.approved ? <Badge tone="green">approved</Badge> : t.changedSinceApproval ? <Badge tone="red">changed — review</Badge> : <Badge>not approved</Badge>}{' '}
                  {!t.readOnly && <Badge tone="amber">writes</Badge>}
                  <span className="block truncate text-xs text-slate-500">{t.description}</span>
                </span>
                <span className="flex gap-1">
                  <Button variant="ghost" onClick={() => tool.mutate({ id: t.id, body: { approve: !t.approved } })}>
                    {t.approved ? 'Revoke' : 'Approve'}
                  </Button>
                  <Button variant="ghost" onClick={() => tool.mutate({ id: t.id, body: { enabled: !t.enabled } })}>
                    {t.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
      <ErrorText error={check.error ?? toggle.error ?? tool.error} />
    </>
  );
}
