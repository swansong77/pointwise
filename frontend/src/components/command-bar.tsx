'use client';

import clsx from 'clsx';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Spinner } from '@/components/ui';
import { json, useApi } from '@/lib/api';
import { ADMIN_NAV, NAV } from '@/lib/nav';
import {
  AnswerRelated,
  AskResponse,
  CallAction,
  isSafeCall,
  confidenceText,
  confidenceTone,
  matchPages,
  mergeSuggestions,
  moveIndex,
  SearchAnswer,
  SearchEntry,
  Slots,
  Suggestion,
  SuggestResponse,
} from '@/lib/search';

const RELATED_ICON: Record<AnswerRelated['type'], string> = { CARD: '💳', OFFER: '🏷️', BENEFIT: '🎁', CERTIFICATE: '🎟️', PROGRAM: '✈️', MERCHANT: '🏪', MEMBER: '👤' };
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

type CallState = { phase: 'idle' | 'confirm' | 'running' | 'done' | 'error'; message?: string };

/** One change offered with an answer: a button, an inline confirmation when the change matters, then the result. */
function CallButton({ c }: { c: CallAction }) {
  const api = useApi();
  const qc = useQueryClient();
  const [st, setSt] = useState<CallState>({ phase: 'idle' });
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (st.phase === 'confirm') confirmRef.current?.focus();
  }, [st.phase]);
  const run = async () => {
    if (!isSafeCall(c)) {
      setSt({ phase: 'error', message: 'That action is not allowed.' });
      return;
    }
    setSt({ phase: 'running' });
    try {
      await api(c.path, { method: c.method, ...json(c.body) });
      setSt({ phase: 'done', message: c.success });
      await qc.invalidateQueries();
    } catch (e) {
      setSt({ phase: 'error', message: e instanceof Error ? e.message : 'That did not work.' });
    }
  };
  if (st.phase === 'done' || st.phase === 'error')
    return (
      <p
        role="status"
        className={clsx('rounded-lg px-3 py-1.5 text-sm', st.phase === 'done' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-900')}
        data-testid="call-result"
      >
        {st.message}
      </p>
    );
  if (st.phase === 'confirm')
    return (
      <div role="group" aria-label={`Confirm: ${c.label}`} className="w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950" data-testid="call-confirm">
        <p>{c.confirm}</p>
        <div className="mt-2 flex gap-2">
          <button
            ref={confirmRef}
            type="button"
            onClick={run}
            className="rounded-lg bg-brand-600 px-3 py-1 text-sm font-medium text-white hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Confirm
          </button>
          <button
            type="button"
            onClick={() => setSt({ phase: 'idle' })}
            className="rounded-lg bg-white px-3 py-1 text-sm font-medium text-slate-800 ring-1 ring-slate-300 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  return (
    <button
      type="button"
      disabled={st.phase === 'running'}
      onClick={() => (c.confirm ? setSt({ phase: 'confirm' }) : run())}
      data-testid="call-action"
      className="rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-brand-800 ring-1 ring-brand-300 hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-60"
    >
      {st.phase === 'running' ? 'Working…' : c.label}
    </button>
  );
}

function AnswerView({
  a,
  onFollowUp,
  onClose,
  question,
  saved,
  onToggleSave,
  savePending,
}: {
  a: SearchAnswer;
  onFollowUp: (q: string) => void;
  onClose: () => void;
  question: string;
  saved: boolean;
  onToggleSave: () => void;
  savePending: boolean;
}) {
  return (
    <div className="space-y-4 px-4 pb-4 pt-3" data-testid="search-answer" aria-live="polite">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900">{a.title}</h2>
          {!a.unanswered && (
            <Badge tone={confidenceTone(a.confidence)}>
              Confidence {confidenceText(a.confidence)} ({a.confidence}%)
            </Badge>
          )}
          {!a.unanswered && (
            <button
              type="button"
              onClick={() => !savePending && onToggleSave()}
              aria-busy={savePending}
              aria-pressed={saved}
              data-testid="search-save"
              className="ml-auto rounded-lg px-2 py-1 text-xs text-slate-700 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              <span aria-hidden>{saved ? '★' : '☆'}</span> {saved ? 'Saved' : 'Save search'}
            </button>
          )}
        </div>
        {a.understood.length > 0 && (
          <p className="mt-1 flex flex-wrap gap-1.5 text-xs text-slate-600" aria-label="What I understood">
            {a.understood.map((u) => (
              <span key={`${u.type}-${u.label}`} className="rounded-full bg-slate-100 px-2 py-0.5">
                {u.label}
              </span>
            ))}
          </p>
        )}
        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-900" data-testid="search-summary">
          {a.summary}
        </p>
      </div>

      {a.warnings.length > 0 && (
        <ul className="list-disc rounded-lg bg-amber-50 p-3 pl-7 text-xs text-amber-950" data-testid="search-warnings">
          {a.warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {a.sections.map((s, i) => (
        <section key={`${s.heading}-${i}`}>
          {s.heading && <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{s.heading}</h3>}
          <ul className="mt-1 space-y-0.5 text-sm text-slate-800">
            {s.lines.slice(s.heading || i > 0 ? 0 : 1).map((l, j) => (
              <li key={`${j}-${l}`} className="whitespace-pre-wrap">
                {l}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {a.reasoning.length > 0 && (
        <section data-testid="search-reasoning">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-800">
            {a.reasoning.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      {a.related.length > 0 && (
        <section data-testid="search-related">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Related</h3>
          <ul className="mt-1 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {a.related.map((r) => (
              <li key={`${r.type}-${r.id}`}>
                <Link href={r.href} onClick={onClose} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 focus-visible:bg-slate-50 focus-visible:outline-none">
                  <span aria-hidden>{RELATED_ICON[r.type]}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-900">{r.title}</span>
                    {r.subtitle && <span className="block truncate text-xs text-slate-600">{r.subtitle}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {a.evidence.length > 0 && (
        <details className="text-xs text-slate-600" data-testid="search-evidence">
          <summary className="cursor-pointer">Evidence ({a.evidence.length})</summary>
          <ul className="mt-1 list-disc pl-5">
            {a.evidence.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </details>
      )}

      {(a.actions.length > 0 || a.unanswered) && (
        <div className="flex flex-wrap gap-2" data-testid="search-actions">
          {a.actions.map((x) => (
            <Link
              key={x.href + x.label}
              href={x.href}
              onClick={onClose}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            >
              {x.label}
            </Link>
          ))}
          {a.unanswered && (
            <Link
              href={`/assistant?q=${encodeURIComponent(question)}`}
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              Ask the assistant
            </Link>
          )}
        </div>
      )}

      {(a.calls?.length ?? 0) > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="search-calls" aria-label="Things you can do">
          {a.calls!.map((c) => (
            <CallButton key={c.id} c={c} />
          ))}
        </div>
      )}

      {a.followUps.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid="search-followups">
          {a.followUps.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onFollowUp(f)}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The universal search bar: ask in plain language or search everything. Opens with Ctrl/Cmd+K, from the header or the floating button.
 * Suggestions come as you type; Enter asks. Everything stays on this server — no AI provider is involved.
 */
export function CommandBar({ open, onClose, isAdmin, seed }: { open: boolean; onClose: () => void; isAdmin: boolean; seed?: { q: string; nonce: number } | null }) {
  const router = useRouter();
  const api = useApi();
  const qc = useQueryClient();
  const { status } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const [q, setQ] = useState('');
  const [dq, setDq] = useState('');
  const [active, setActive] = useState(-1);
  const [answer, setAnswer] = useState<AskResponse | null>(null);
  const [asked, setAsked] = useState('');
  const slots = useRef<Slots | null>(null);
  const session = useRef<string | null>(null);
  const pages = useMemo(() => (isAdmin ? [...NAV, ...ADMIN_NAV] : NAV), [isAdmin]);

  // debounce what is sent to the server while typing
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 120);
    return () => clearTimeout(t);
  }, [q]);

  const suggest = useQuery({
    queryKey: ['search', 'suggest', dq],
    queryFn: ({ signal }) => api<SuggestResponse>(`/search/suggest?q=${encodeURIComponent(dq)}`, { signal }),
    enabled: open && status === 'authenticated' && !answer,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
  const ask = useMutation({
    // the server remembers the conversation; the slots are only a fallback for a conversation it no longer has
    mutationFn: (question: string) =>
      api<AskResponse>('/search/ask', {
        method: 'POST',
        ...json({ q: question, ...(session.current ? { sessionId: session.current } : slots.current ? { slots: slots.current } : {}) }),
      }),
    onSuccess: (r) => {
      slots.current = r.slots;
      session.current = r.sessionId;
      setAnswer(r);
    },
  });

  // is this question saved? (for the star)
  const savedCheck = useQuery({
    queryKey: ['search', 'saved-check', asked],
    queryFn: () => api<{ saved: SearchEntry | null }>(`/search/saved/check?q=${encodeURIComponent(asked)}`),
    enabled: open && status === 'authenticated' && !!answer && !answer.answer.unanswered && !!asked,
  });
  const toggleSave = useMutation({
    mutationFn: async () => {
      const current = savedCheck.data?.saved;
      if (current) await api(`/search/entries/${current.id}`, { method: 'DELETE' });
      else await api('/search/saved', { method: 'POST', ...json({ query: asked }) });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['search', 'saved-check'] });
      void qc.invalidateQueries({ queryKey: ['search', 'suggest'] });
      void qc.invalidateQueries({ queryKey: ['search', 'dashboard'] });
    },
  });

  const items: Suggestion[] = useMemo(() => {
    if (answer) return [];
    return mergeSuggestions(suggest.data?.suggestions ?? [], matchPages(q, pages));
  }, [answer, suggest.data, q, pages]);

  // open: remember where focus was, lock scroll, focus the input. Close: reset the conversation and give focus back.
  useEffect(() => {
    if (!open) return;
    returnFocus.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      setQ('');
      setDq('');
      setAnswer(null);
      setAsked('');
      setActive(-1);
      slots.current = null;
      session.current = null;
      ask.reset();
      returnFocus.current?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // the highlight starts over when the person types or an answer appears, not when late results arrive; it never points past the list
  useEffect(() => setActive(-1), [q, answer]);
  useEffect(() => setActive((i) => (i >= items.length ? items.length - 1 : i)), [items.length]);

  const runAsk = useCallback(
    (question: string) => {
      const t = question.trim();
      if (!t) return;
      setQ(t);
      setAsked(t);
      ask.mutate(t);
    },
    [ask],
  );

  // a question sent from elsewhere on the page ("run this again") is asked as soon as the bar is open
  useEffect(() => {
    if (open && seed?.q) runAsk(seed.q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, seed?.nonce]);

  const activate = (s: Suggestion) => {
    if (s.query) return runAsk(s.query);
    if (s.href) {
      onClose();
      router.push(s.href);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (answer || q) {
        setAnswer(null);
        setQ('');
        inputRef.current?.focus();
      } else onClose();
      return;
    }
    if (e.key === 'Tab' && dialogRef.current) {
      const els = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  // Escape and the Tab trap listen on the document, so they keep working when focus falls to the page (a disabled button, a closed menu)
  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => keyHandler.current(e);
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [open]);

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => moveIndex(i, e.key === 'ArrowDown' ? 1 : -1, items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0 && items[active]) activate(items[active]);
      else runAsk(q);
    }
  };

  if (!open) return null;
  const showList = !answer && !ask.isPending;
  return (
    <div className="fixed inset-0 z-[60]" data-testid="command-bar">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} aria-hidden />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search and ask PointWise"
        className="absolute inset-x-0 top-0 mx-auto flex h-full flex-col bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl md:top-16 md:h-auto md:max-h-[78vh] md:max-w-2xl md:rounded-2xl"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
          <span aria-hidden className="text-slate-500">
            🔍
          </span>
          <input
            ref={inputRef}
            id="command-input"
            type="text"
            role="combobox"
            aria-label="Search or ask a question"
            aria-expanded={showList && items.length > 0}
            aria-controls="command-list"
            aria-autocomplete="list"
            aria-activedescendant={active >= 0 ? `command-opt-${active}` : undefined}
            autoComplete="off"
            spellCheck={false}
            maxLength={300}
            placeholder="Ask anything: “Costco $1500”, “What’s expiring?”, “Hilton offers”…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (answer) setAnswer(null);
            }}
            onKeyDown={onInputKeyDown}
            className="min-w-0 flex-1 bg-transparent py-2 text-base text-slate-900 placeholder:text-slate-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-brand-500"
            aria-label="Close search"
          >
            Esc
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {ask.isPending && (
            <div className="px-4 py-6">
              <Spinner label="Working on it" />
            </div>
          )}
          {ask.error && !ask.isPending && (
            <p role="alert" className="px-4 py-4 text-sm text-red-700">
              {(ask.error as Error).message || 'Something went wrong. Try again.'}
            </p>
          )}
          {answer && !ask.isPending && (
            <AnswerView
              a={answer.answer}
              question={asked}
              onClose={onClose}
              onFollowUp={runAsk}
              saved={!!savedCheck.data?.saved}
              onToggleSave={() => toggleSave.mutate()}
              savePending={toggleSave.isPending || savedCheck.isLoading}
            />
          )}
          {showList && (
            <ul id="command-list" role="listbox" aria-label="Suggestions" className="py-1" data-testid="command-list">
              {items.map((s, i) => (
                <li
                  key={s.id + i}
                  id={`command-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => activate(s)}
                  className={clsx('flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left text-sm', i === active ? 'bg-brand-50' : 'hover:bg-slate-50')}
                >
                  <span className="w-24 shrink-0 text-xs text-slate-600">{s.kind ?? (s.type === 'EXAMPLE' ? 'Try' : '')}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-slate-900">{s.label}</span>
                    {s.sublabel && <span className="block truncate text-xs text-slate-600">{s.sublabel}</span>}
                  </span>
                </li>
              ))}
              {items.length === 0 && suggest.isFetching && (
                <li className="px-4 py-3 text-sm text-slate-600" role="presentation">
                  Searching…
                </li>
              )}
            </ul>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-2 text-xs text-slate-600">
          <span>↑↓ to move · Enter to ask or open · Esc to clear</span>
          <span>
            <Link href="/search" onClick={onClose} className="underline">
              Search history
            </Link>{' '}
            · answers use only your own PointWise data
          </span>
        </div>
        <div aria-live="polite" className="sr-only" data-testid="command-status">
          {answer ? 'Answer ready.' : showList ? `${items.length} suggestion${items.length === 1 ? '' : 's'}.` : ''}
        </div>
      </div>
    </div>
  );
}
