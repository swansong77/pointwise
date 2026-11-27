'use client';

import { useState } from 'react';
import { Body } from '@/components/briefings-panel';
import { Badge, Button, EmptyState, ErrorText, PageHeader, Panel, Spinner } from '@/components/ui';
import { shortDate } from '@/lib/format';
import type { StoredBriefing } from '@/lib/copilot';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

type Kind = 'DAILY' | 'WEEKLY';
const LABEL: Record<Kind, string> = { DAILY: 'Daily', WEEKLY: 'Weekly' };

/** A household member's own briefings: built only from their own cards, credits, offers and points. */
export default function MyBriefingsPage() {
  const list = useAuthedQuery<StoredBriefing[]>(['member', 'briefings'], '/member/briefings');
  const [kind, setKind] = useState<Kind>('DAILY');
  const [message, setMessage] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const make = useApiMutation<Kind, { briefing: StoredBriefing | null; message: string | null }>((k) => ({ path: '/member/briefings', method: 'POST', body: { kind: k, force: true } }), [['member', 'briefings']]);

  if (list.isLoading) return <Spinner label="Loading briefings" />;
  const rows = list.data ?? [];
  const current = rows.find((r) => r.id === openId) ?? rows[0];

  async function makeNow(k: Kind) {
    setKind(k);
    setMessage(null);
    const r = await make.mutateAsync(k);
    setMessage(r.message);
    if (r.briefing) setOpenId(r.briefing.id);
  }

  return (
    <div className="space-y-6">
      <PageHeader title="My briefings" subtitle="What is due on your own cards and points. You get a daily one only on days something is due, and a weekly summary. Change this in Settings." />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Make a briefing now">
        {(['DAILY', 'WEEKLY'] as Kind[]).map((k) => (
          <Button key={k} variant="secondary" onClick={() => void makeNow(k)} loading={make.isPending && kind === k} data-testid={`brief-now-${k.toLowerCase()}`}>
            {k === 'DAILY' ? 'Make today’s briefing' : 'Make this week’s briefing'}
          </Button>
        ))}
      </div>
      {message && (
        <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700" data-testid="brief-message">
          {message}
        </p>
      )}
      <ErrorText error={list.error ?? make.error} />
      {rows.length === 0 ? (
        <EmptyState title="No briefings yet">Your first one arrives when something is due, or make one now.</EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[14rem_1fr]">
          <ul className="space-y-1 text-sm" aria-label="Your briefings" data-testid="brief-list">
            {rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(r.id)}
                  aria-current={r.id === current?.id ? 'true' : undefined}
                  className={'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-100 ' + (r.id === current?.id ? 'bg-brand-50 font-semibold text-brand-700' : 'text-slate-700')}
                >
                  <Badge tone={r.kind === 'DAILY' ? 'brand' : 'slate'}>{LABEL[r.kind as Kind] ?? r.kind}</Badge>
                  {shortDate(r.createdAt)}
                </button>
              </li>
            ))}
          </ul>
          {current && (
            <Panel title={`${LABEL[current.kind as Kind] ?? current.kind} briefing · ${current.periodKey}`}>
              <Body b={current.content} narration={null} />
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
