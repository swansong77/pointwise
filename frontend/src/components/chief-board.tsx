'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, ErrorText, Panel, Spinner } from '@/components/ui';
import { StoredBoard } from '@/lib/chief';
import { money, shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

const TONE: Record<string, { word: string; cls: string }> = {
  urgent: { word: 'Urgent', cls: 'text-red-700' },
  warn: { word: 'Worth attention', cls: 'text-amber-700' },
  good: { word: 'Going well', cls: 'text-emerald-700' },
  info: { word: 'For your awareness', cls: 'text-slate-500' },
};

/** The monthly board report: the month in numbers, what was missed, the fee verdicts and the household's progress. */
export function ChiefBoard() {
  const list = useAuthedQuery<StoredBoard[]>(['chief', 'board'], '/chief/board');
  const [picked, setPicked] = useState<string | null>(null);
  const make = useApiMutation<{ fresh: boolean }>((v) => ({ path: `/chief/board${v.fresh ? '?fresh=true' : ''}`, method: 'POST', body: {} }), [['chief']]);
  if (!list.data) return <Spinner />;
  const shown = list.data.find((b) => b.id === picked) ?? list.data[0] ?? null;
  return (
    <Panel title="Monthly board report" data-testid="chief-board">
      <div id="board" />
      {!shown ? (
        <div data-testid="board-empty">
          <p className="text-sm text-slate-700">No board report yet. With the Chief of Staff on, one is written on the 1st of each month. You can write this month’s now.</p>
          <Button className="mt-3" loading={make.isPending} onClick={() => make.mutate({ fresh: false })} data-testid="board-make">
            Write this month’s board report
          </Button>
        </div>
      ) : (
        <div className="space-y-4" data-testid="board-body">
          <div>
            <h3 className="text-base font-semibold text-slate-900" data-testid="board-headline">
              {shown.content.headline}
            </h3>
            <p className="mt-1 text-sm text-slate-700">{shown.content.summary}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
              <Badge>{shown.periodKey}</Badge>
              <span>Written {shortDate(shown.createdAt)}</span>
              <Button variant="ghost" className="px-2 py-1 text-xs" loading={make.isPending} onClick={() => make.mutate({ fresh: true })} data-testid="board-refresh">
                Write a fresh one
              </Button>
            </div>
          </div>
          {shown.content.sections.map((s) => (
            <section key={s.key} aria-label={s.title} data-testid={`board-${s.key}`}>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{s.title}</h4>
              {s.lines.length === 0 ? (
                <p className="text-sm text-slate-600">{s.empty}</p>
              ) : (
                <ul className="space-y-1.5">
                  {s.lines.map((l, i) => (
                    <li key={s.key + i} className="text-sm">
                      <span className={TONE[l.tone].cls} aria-hidden>
                        ●{' '}
                      </span>
                      <span className="sr-only">{TONE[l.tone].word}: </span>
                      {l.href ? (
                        <Link href={l.href} className="font-medium text-slate-900 underline-offset-2 hover:underline">
                          {l.text}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-900">{l.text}</span>
                      )}
                      {l.valueCents ? <span className="ml-2 text-xs text-slate-600">{money(l.valueCents)}</span> : null}
                      {l.detail && <span className="block text-xs text-slate-600">{l.detail}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {shown.content.assumptions.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer">Assumptions</summary>
              <ul className="mt-1 list-disc pl-5">
                {shown.content.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </details>
          )}
          {list.data.length > 1 && (
            <div className="border-t border-slate-100 pt-3" data-testid="board-history">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Earlier reports</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {list.data.slice(1, 12).map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setPicked(b.id)}
                      className="rounded-lg bg-slate-100 px-2 py-1 text-xs hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-brand-500"
                    >
                      {b.periodKey}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <ErrorText error={make.error} />
    </Panel>
  );
}
