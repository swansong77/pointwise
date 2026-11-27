'use client';

import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { json, useApi } from '@/lib/api';
import { CallAction, isSafeCall } from '@/lib/search';

type CallState = { phase: 'idle' | 'confirm' | 'running' | 'done' | 'error'; message?: string };

/** One change offered with an answer: a button, an inline confirmation when the change matters, then the result. */
export function CallButton({ c }: { c: CallAction }) {
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
