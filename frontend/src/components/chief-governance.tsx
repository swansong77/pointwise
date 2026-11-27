'use client';

import { Badge, Panel, Spinner } from '@/components/ui';
import { Governance, GovAdvice } from '@/lib/chief';
import { money, shortDate } from '@/lib/format';
import { useAuthedQuery } from '@/lib/queries';

const STATE = { OPEN: ['Open', 'green'], ONE_LEFT: ['One slot left', 'amber'], AT_LIMIT: ['At the limit', 'red'] } as const;
const KIND: Record<GovAdvice['kind'], string> = { WAIT: 'Wait', APPLY: 'Apply next', MOVE: 'Move it', BUSINESS: 'Business card', BONUS: 'Elevated offer', LAST_SLOT: 'Last slot' };

/** 5/24 for each member, when the next slot opens, and which application is worth making next. Advice only: you decide. */
export function ChiefGovernance() {
  const q = useAuthedQuery<Governance>(['chief', 'governance'], '/chief/governance');
  if (q.isLoading) return <Spinner label="Checking 5/24" />;
  const g = q.data;
  if (!g) return null;
  return (
    <Panel title="Application governance" data-testid="chief-governance">
      <div id="governance" />
      <p className="text-sm font-medium text-slate-900" data-testid="gov-headline">
        {g.headline}
      </p>
      <ul className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3" data-testid="gov-members">
        {g.members.map((m) => {
          const [label, tone] = STATE[m.state];
          return (
            <li key={m.member} className="rounded-lg border border-slate-200 bg-white p-3" data-testid="gov-member">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 font-medium text-slate-900">{m.member}</span>
                <span className="text-lg font-semibold">{m.label}</span>
                <Badge tone={tone}>{label}</Badge>
              </div>
              <p className="mt-1 text-xs text-slate-700">
                {m.state === 'AT_LIMIT'
                  ? m.nextSlotAt
                    ? 'Next slot opens ' + shortDate(m.nextSlotAt) + '.'
                    : 'No slot date is known yet.'
                  : m.slots + ' slot' + (m.slots === 1 ? '' : 's') + ' open.'}
                {m.upcomingDrops.length > 0 && ' Cards drop off ' + m.upcomingDrops.map((d) => shortDate(d)).join(', ') + '.'}
              </p>
              {m.recentApprovals.length > 0 && <p className="text-xs text-slate-600">Opened in the last 90 days: {m.recentApprovals.map((a) => a.card).join(', ')}.</p>}
            </li>
          );
        })}
      </ul>
      {g.advice.length === 0 ? (
        <p className="mt-3 text-sm text-slate-600">No application is worth making right now.</p>
      ) : (
        <ul className="mt-3 space-y-2" data-testid="gov-advice">
          {g.advice.map((a, i) => (
            <li key={a.kind + i} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={a.kind === 'WAIT' ? 'amber' : 'brand'}>{KIND[a.kind]}</Badge>
                <span className="min-w-0 flex-1 font-medium text-slate-900">{a.text}</span>
                {a.valueCents ? <span className="text-xs text-slate-600">{money(a.valueCents)}</span> : null}
              </div>
              <p className="mt-1 text-xs text-slate-700">{a.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
