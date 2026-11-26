'use client';

import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, ErrorText, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { ApiError, json, useApi } from '@/lib/api';
import {
  AgentOption,
  AiModelOption,
  AiSettings,
  answerLines,
  applyStreamEvent,
  budgetLabel,
  ChatResult,
  ChatTurn,
  StreamError,
  StreamState,
  streamChat,
  SUGGESTED_QUESTIONS,
  toolLabel,
} from '@/lib/ai';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

export default function AssistantPage() {
  const settings = useAuthedQuery<AiSettings>(['ai', 'settings'], '/ai/settings');
  const models = useAuthedQuery<AiModelOption[]>(['ai', 'models'], '/ai/models');
  const agents = useAuthedQuery<AgentOption[]>(['ai', 'agents'], '/ai/agents');
  const consent = useApiMutation<void>(() => ({ path: '/ai/settings', method: 'PUT', body: { consent: true } }), [['ai']]);

  if (settings.isLoading) return <Spinner label="Loading assistant" />;
  if (settings.error) return <ErrorText error={settings.error} />;

  return (
    <div className="space-y-6">
      <PageHeader title="Assistant" subtitle="Ask about your cards, benefits, 5/24 status and household. Answers use your PointWise data." />
      {!settings.data?.consented ? (
        <Panel title="Turn on the assistant" data-testid="ai-consent">
          <p className="text-sm text-slate-700">
            Your cards, benefits, balances and household data never leave PointWise. The AI model only receives your question (with card numbers and emails removed) and public
            card-catalog information. Answers about your own data are computed by PointWise and shown only to you.
          </p>
          {!!models.data?.length && <p className="mt-2 text-sm text-slate-600">Available models: {models.data.map((m) => `${m.displayName} (${m.provider})`).join(', ')}.</p>}
          <div className="mt-4">
            <Button onClick={() => consent.mutate(undefined)} loading={consent.isPending} data-testid="ai-consent-accept">
              I agree — turn on the assistant
            </Button>
          </div>
          <ErrorText error={consent.error} />
        </Panel>
      ) : (
        <Chat models={models.data ?? []} agents={agents.data ?? []} settings={settings.data} />
      )}
    </div>
  );
}

function LiveAnswer({ live }: { live: NonNullable<ChatTurn['live']> }) {
  return (
    <div className="space-y-2 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-800" data-testid="ai-live" aria-busy="true">
      {live.tools.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Tools in progress">
          {live.tools.map((tool, i) => (
            <li key={`${tool.name}-${i}`}>
              <Badge tone={tool.status === 'error' ? 'red' : tool.status === 'done' ? 'green' : 'slate'}>
                {toolLabel(tool.name)}
                {tool.status === 'running' ? '…' : tool.status === 'done' ? ' ✓' : ' ✕'}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {live.text && <p className="whitespace-pre-wrap">{live.text}</p>}
    </div>
  );
}

function Chat({ models, agents, settings }: { models: AiModelOption[]; agents: AgentOption[]; settings: AiSettings }) {
  const api = useApi();
  const { data: session } = useSession();
  const [agent, setAgent] = useState('assistant');
  const [modelId, setModelId] = useState(settings.preferredModelId ?? '');
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const actions = useAuthedQuery<Array<{ id: string; summary: string }>>(['ai', 'actions'], '/ai/actions');
  const decide = useApiMutation<{ id: string; confirm: boolean }, { status: string; summary?: string }>(
    ({ id, confirm }) => ({
      path: `/ai/actions/${id}/${confirm ? 'confirm' : 'reject'}`,
      method: 'POST',
    }),
    [['ai', 'actions'], ['benefits'], ['portfolio']],
  );

  useEffect(() => endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }), [turns.length]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    const id = `${Date.now()}`;
    setTurns((t) => [...t, { id, question: q }]);
    setInput('');
    setBusy(true);
    const body = {
      message: q,
      agent,
      conversationId: conversationId ?? undefined,
      modelId: modelId || undefined,
    };
    try {
      let result: ChatResult;
      let live: StreamState = { text: '', tools: [] };
      try {
        // stream the answer as it is generated; fall back to the plain endpoint if streaming is unavailable
        result = await streamChat(body, session?.accessToken, (e) => {
          if (e.type === 'start') setConversationId(e.conversationId);
          live = applyStreamEvent(live, e);
          const snapshot = live;
          setTurns((t) => t.map((x) => (x.id === id ? { ...x, live: snapshot } : x)));
        });
      } catch (e) {
        if (e instanceof StreamError && e.status !== 404 && e.status !== 405 && e.status !== 502) throw new ApiError(e.status, e.message);
        result = await api<ChatResult>('/ai/chat', {
          method: 'POST',
          ...json(body),
        });
      }
      setConversationId(result.conversationId);
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, result, live: undefined } : x)));
      if (result.pendingActions.length) void actions.refetch();
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Something went wrong';
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: msg } : x)));
    } finally {
      setBusy(false);
    }
  };

  const newChat = () => {
    setConversationId(null);
    setTurns([]);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
      <Panel
        title={agents.find((a) => a.key === agent)?.name ?? 'Assistant'}
        action={
          <Button variant="ghost" onClick={newChat} disabled={!turns.length}>
            New chat
          </Button>
        }
        data-testid="ai-chat"
      >
        <div className="space-y-5" aria-live="polite">
          {turns.length === 0 && (
            <div>
              <p className="mb-2 text-sm text-slate-600">Try one of these:</p>
              <ul className="flex flex-wrap gap-2">
                {SUGGESTED_QUESTIONS.map((q) => (
                  <li key={q}>
                    <button
                      type="button"
                      onClick={() => void ask(q)}
                      className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:border-brand-300 hover:bg-brand-50"
                    >
                      {q}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {turns.map((t) => (
            <article key={t.id} className="space-y-2" data-testid="ai-turn">
              <p className="ml-auto max-w-[85%] rounded-2xl bg-brand-600 px-4 py-2 text-sm text-white">{t.question}</p>
              {!t.result && !t.error && !t.live?.text && !t.live?.tools.length && <Spinner label="Thinking" />}
              {!t.result && !t.error && t.live && (t.live.text || t.live.tools.length > 0) && <LiveAnswer live={t.live} />}
              {t.error && (
                <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {t.error}
                </p>
              )}
              {t.result && <Answer r={t.result} />}
            </article>
          ))}
          <div ref={endRef} />
        </div>
        <form
          className="mt-5 flex gap-2 border-t border-slate-100 pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(input);
          }}
        >
          <label htmlFor="ai-input" className="sr-only">
            Your question
          </label>
          <input
            id="ai-input"
            value={input}
            maxLength={4000}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your cards…"
            className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <Button type="submit" disabled={!input.trim() || busy} loading={busy}>
            Ask
          </Button>
        </form>
      </Panel>

      <aside className="space-y-4">
        <Panel title="Settings">
          <div className="space-y-3 text-sm">
            <div>
              <label htmlFor="ai-agent" className="mb-1 block font-medium text-slate-700">
                Assistant
              </label>
              <Select id="ai-agent" value={agent} onChange={(e) => (setAgent(e.target.value), newChat())}>
                {agents.map((a) => (
                  <option key={a.key} value={a.key}>
                    {a.name}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-slate-500">{agents.find((a) => a.key === agent)?.description}</p>
            </div>
            <div>
              <label htmlFor="ai-model" className="mb-1 block font-medium text-slate-700">
                Model
              </label>
              <Select id="ai-model" value={modelId} onChange={(e) => setModelId(e.target.value)}>
                <option value="">Automatic (with failover)</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} · {m.provider}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-xs text-slate-500" data-testid="ai-budget">
              This month: {budgetLabel(settings.monthTokens, settings.monthBudget)}
            </p>
          </div>
        </Panel>
        <Panel title="Waiting for you" data-testid="ai-actions">
          {!actions.data?.length ? (
            <p className="text-sm text-slate-500">Nothing to confirm.</p>
          ) : (
            <ul className="space-y-3">
              {actions.data.map((a) => (
                <li key={a.id} className="text-sm">
                  <p>{a.summary}</p>
                  <div className="mt-1 flex gap-2">
                    <Button onClick={() => decide.mutate({ id: a.id, confirm: true })} loading={decide.isPending && decide.variables?.id === a.id}>
                      Confirm
                    </Button>
                    <Button variant="ghost" onClick={() => decide.mutate({ id: a.id, confirm: false })}>
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {decide.data?.summary && (
            <p className="mt-2 text-xs text-emerald-700" role="status">
              {decide.data.summary}
            </p>
          )}
          <ErrorText error={decide.error} />
        </Panel>
        <p className="text-xs text-slate-500">
          Answers are general information, not financial advice. Manage AI access in{' '}
          <Link href="/settings" className="text-brand-700 underline">
            Settings
          </Link>
          .
        </p>
      </aside>
    </div>
  );
}

function Answer({ r }: { r: ChatResult }) {
  const lines = answerLines(r.answer);
  return (
    <div className="max-w-[95%] rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800" data-testid="ai-answer">
      {lines.length === 0 ? (
        <EmptyState title="No answer" />
      ) : (
        <div className="space-y-1">
          {lines.map((l, i) =>
            l.bullet ? (
              <p key={i} className="pl-4 before:-ml-3 before:mr-1 before:content-['•']">
                {l.text}
              </p>
            ) : (
              <p key={i}>{l.text}</p>
            ),
          )}
        </div>
      )}
      {!!r.pendingActions.length && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Confirm the proposed change in “Waiting for you” — nothing was changed yet.</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-500">
        {r.private && <Badge tone="green">Answered by PointWise — your data was not shared with the AI</Badge>}
        {r.model && <Badge tone={r.model.demo ? 'amber' : 'slate'}>{r.model.demo ? 'Demo model (no AI)' : `${r.model.displayName} · ${r.model.provider}`}</Badge>}
        {r.refused && <Badge tone="red">Declined</Badge>}
        {!!r.trace.length && (
          <details className="w-full" data-testid="ai-trace">
            <summary className="cursor-pointer">Data used ({r.trace.length})</summary>
            <ul className="mt-1 space-y-1">
              {r.trace.map((t, i) => (
                <li key={i}>
                  <span className={t.ok ? 'text-slate-700' : 'text-red-700'}>{toolLabel(t.tool)}</span>
                  {t.external && ' (external)'}: {t.summary}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </div>
  );
}
