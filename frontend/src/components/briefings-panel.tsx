'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, ErrorText, Panel, Spinner } from '@/components/ui';
import { BRIEF_LABEL, BriefKind, Briefing, StoredBriefing } from '@/lib/copilot';
import { money, shortDate } from '@/lib/format';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

const TONE: Record<string, { icon: string; word: string; cls: string }> = {
  urgent: { icon: '●', word: 'Urgent', cls: 'text-red-700' },
  warn: { icon: '●', word: 'Worth attention', cls: 'text-amber-700' },
  good: { icon: '●', word: 'Going well', cls: 'text-emerald-700' },
  info: { icon: '●', word: 'For your awareness', cls: 'text-slate-500' },
};
const KINDS: BriefKind[] = ['DAILY', 'WEEKLY', 'MONTHLY'];

export function Body({ b, narration }: { b: Briefing; narration: StoredBriefing['narration'] }) {
  return (
    <div className="space-y-4" data-testid="briefing-body">
      <div>
        <h3 className="text-base font-semibold text-slate-900" data-testid="briefing-headline">
          {b.headline}
        </h3>
        <p className="mt-1 text-sm text-slate-700">{narration ? narration.text : b.summary}</p>
        {narration && (
          <p className="mt-1 text-xs text-slate-600">
            Worded by {narration.model} ({narration.local ? 'on your own machine' : 'a cloud model that saw only a redacted summary'}).{' '}
            <Link href="/settings#copilot" className="underline">
              See what was sent
            </Link>
          </p>
        )}
      </div>
      {b.sections.map((s) => (
        <section key={s.key} aria-label={s.title} data-testid={`brief-${s.key}`}>
          <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">{s.title}</h4>
          {s.lines.length === 0 ? (
            <p className="text-sm text-slate-600">{s.empty}</p>
          ) : (
            <ul className="space-y-1.5">
              {s.lines.map((l, i) => (
                <li key={s.key + i} className="text-sm">
                  <span className={TONE[l.tone].cls} aria-hidden>
                    {TONE[l.tone].icon}{' '}
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
      {b.assumptions.length > 0 && (
        <details className="text-xs text-slate-600">
          <summary className="cursor-pointer">Assumptions</summary>
          <ul className="mt-1 list-disc pl-5">
            {b.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Your daily, weekly and monthly reviews: written for you by Copilot from your own data, kept for 90 days. */
export function BriefingsPanel() {
  const list = useAuthedQuery<StoredBriefing[]>(['copilot', 'briefings'], '/copilot/briefings');
  const [kind, setKind] = useState<BriefKind>('DAILY');
  const [picked, setPicked] = useState<string | null>(null);
  const make = useApiMutation<{ kind: BriefKind; fresh: boolean }>(
    (v) => ({ path: `/copilot/briefings/${v.kind.toLowerCase()}${v.fresh ? '?fresh=true' : ''}`, method: 'POST', body: {} }),
    [['copilot']],
  );
  if (!list.data) return <Spinner />;
  const ofKind = list.data.filter((b) => b.kind === kind);
  const shown = ofKind.find((b) => b.id === picked) ?? ofKind[0] ?? null;
  return (
    <Panel title="Briefings" data-testid="briefings-panel">
      <div id="briefings" />
      <div role="group" aria-label="Briefing type" className="flex flex-wrap gap-2">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={k === kind}
            onClick={() => (setKind(k), setPicked(null))}
            data-testid={`brief-tab-${k.toLowerCase()}`}
            className={`rounded-full px-3 py-1 text-sm font-medium ring-1 focus-visible:ring-2 focus-visible:ring-brand-500 ${k === kind ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'}`}
          >
            {BRIEF_LABEL[k]}
          </button>
        ))}
      </div>

      {shown ? (
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <Badge>{shown.content.periodKey}</Badge>
            <span>Written {shortDate(shown.createdAt)}</span>
            <Button variant="ghost" className="px-2 py-1 text-xs" loading={make.isPending} onClick={() => make.mutate({ kind, fresh: true })} data-testid="brief-refresh">
              Write a fresh one
            </Button>
          </div>
          <Body b={shown.content} narration={shown.narration} />
          {ofKind.length > 1 && (
            <div className="mt-4 border-t border-slate-100 pt-3" data-testid="brief-history">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-600">Earlier</p>
              <ul className="mt-1 flex flex-wrap gap-2">
                {ofKind.slice(1, 8).map((b) => (
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
      ) : (
        <div className="mt-4" data-testid="brief-empty">
          <p className="text-sm text-slate-700">
            No {BRIEF_LABEL[kind].toLowerCase()} briefing yet. With AI Mode on, one is written for you automatically
            {kind === 'DAILY' ? ' every morning' : kind === 'WEEKLY' ? ' every Monday' : ' on the 1st of the month'}. You can write one now.
          </p>
          <Button className="mt-3" loading={make.isPending} onClick={() => make.mutate({ kind, fresh: false })} data-testid="brief-make">
            Write the {BRIEF_LABEL[kind].toLowerCase()} briefing now
          </Button>
        </div>
      )}
      <ErrorText error={make.error} />
    </Panel>
  );
}
