'use client';

import { useState } from 'react';
import { Badge, Button, ErrorText, Field, Input, Panel, Select, Spinner } from '@/components/ui';
import { AiModelOption, AiSettings, budgetLabel, usd } from '@/lib/ai';
import { shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

/** AI consent, preferred model and usage. */
export function AiSettingsSection() {
  const s = useAuthedQuery<AiSettings>(['ai', 'settings'], '/ai/settings');
  const models = useAuthedQuery<AiModelOption[]>(['ai', 'models'], '/ai/models');
  const save = useApiMutation<Partial<{ consent: boolean; preferredModelId: string | null; classifyMerchants: boolean }>>((body) => ({ path: '/ai/settings', method: 'PUT', body }), [['ai']]);
  if (!s.data) return <Spinner />;
  return (
    <Panel title="AI assistant" data-testid="ai-settings">
      <label className="flex items-center gap-3 text-sm">
        <input type="checkbox" checked={s.data.consented} onChange={(e) => save.mutate({ consent: e.target.checked })} data-testid="ai-consent-toggle" />
        Turn on the AI assistant (your card data is never sent to the AI model — only your question and public catalog data)
      </label>
      <label className="mt-3 flex items-center gap-3 text-sm">
        <input type="checkbox" checked={!!s.data.classifyMerchants} onChange={(e) => save.mutate({ classifyMerchants: e.target.checked })} data-testid="ai-classify-toggle" />
        Let the model name a benefit for merchants my rules could not recognise (it sees only the merchant name, e.g. “uber eats” — never amounts, dates, card numbers or your name)
      </label>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Preferred model" htmlFor="ai-pref-model" hint="Automatic uses each assistant's model chain with failover.">
          <Select id="ai-pref-model" value={s.data.preferredModelId ?? ''} onChange={(e) => save.mutate({ preferredModelId: e.target.value || null })}>
            <option value="">Automatic</option>
            {models.data?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.displayName} · {m.provider}
              </option>
            ))}
          </Select>
        </Field>
        <div className="text-sm text-slate-600">
          <p className="font-medium text-slate-700">This month</p>
          <p>{budgetLabel(s.data.monthTokens, s.data.monthBudget)}</p>
          <p>
            {s.data.monthRequests} requests · {usd(s.data.monthCostUsd)}
          </p>
        </div>
      </div>
      <ErrorText error={save.error} />
    </Panel>
  );
}

interface Token {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/** Personal access tokens for using Pointwise from an MCP client (Claude, ChatGPT…). */
export function TokensSection() {
  const list = useAuthedQuery<Token[]>(['tokens'], '/me/tokens');
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const create = useApiMutation<void, { token: string }>(() => ({ path: '/me/tokens', method: 'POST', body: { name, expiresInDays: 90 } }), [['tokens']]);
  const revoke = useApiMutation<string>((id) => ({ path: `/me/tokens/${id}`, method: 'DELETE' }), [['tokens']]);
  return (
    <Panel title="Connect an AI app (MCP)" data-testid="mcp-tokens">
      <p className="text-sm text-slate-600">
        Let your own AI app search the Pointwise card catalog over the Model Context Protocol. Your own cards and household data are never shared with it. Server URL: <code className="rounded bg-slate-100 px-1">{'<API URL>/mcp'}</code> (for this
        install <code className="rounded bg-slate-100 px-1">http://localhost:4000/mcp</code>). Tokens are read-only and can be revoked at any time.
      </p>
      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined, { onSuccess: (r) => (setCreated(r.token), setName('')) });
        }}
      >
        <Field label="Token name" htmlFor="pat-name">
          <Input id="pat-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="e.g. Claude desktop" />
        </Field>
        <Button type="submit" disabled={!name.trim()} loading={create.isPending}>
          Create token
        </Button>
      </form>
      {created && (
        <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status" data-testid="pat-created">
          Copy this token now — it won’t be shown again:
          <code className="mt-1 block break-all rounded bg-white px-2 py-1 text-xs">{created}</code>
        </div>
      )}
      <ErrorText error={create.error ?? revoke.error} />
      {!!list.data?.length && (
        <ul className="mt-3 divide-y divide-slate-100 text-sm">
          {list.data.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                {t.name} <span className="text-xs text-slate-500">{t.prefix}… · expires {shortDate(t.expiresAt)} · {t.lastUsedAt ? `used ${shortDate(t.lastUsedAt)}` : 'never used'}</span>{' '}
                <Badge>{t.scopes.join(', ')}</Badge>
              </span>
              <Button variant="ghost" onClick={() => revoke.mutate(t.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
