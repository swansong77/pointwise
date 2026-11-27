'use client';

import Link from 'next/link';
import { CallButton } from '@/components/call-button';
import { Badge, Panel, Spinner } from '@/components/ui';
import { Alert, confidenceWord, DashItem, Dashboard } from '@/lib/copilot';
import { money } from '@/lib/format';
import { useAuthedQuery } from '@/lib/queries';

const tone = (c: number) => (c >= 80 ? 'green' : c >= 55 ? 'amber' : 'red');
const STATE: Record<string, [string, 'green' | 'amber' | 'red' | 'slate']> = {
  ACHIEVED: ['Reached', 'green'],
  ON_TRACK: ['On track', 'green'],
  AT_RISK: ['At risk', 'amber'],
  BEHIND: ['Behind', 'red'],
  UNKNOWN: ['Not tracked', 'slate'],
};

function Items({ items, empty, testId }: { items: DashItem[]; empty: string; testId: string }) {
  if (items.length === 0) return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <ul className="space-y-2" data-testid={testId}>
      {items.map((i) => (
        <li key={i.id} className="text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={i.href} className="min-w-0 flex-1 font-medium text-slate-900 underline-offset-2 hover:underline">
              {i.title}
            </Link>
            <Badge tone={tone(i.confidence)}>{confidenceWord(i.confidence)}</Badge>
            {i.expectedValueCents ? <Badge tone="brand">{money(i.expectedValueCents)}</Badge> : null}
          </div>
          <p className="text-xs text-slate-600">{i.recommendation}</p>
          {i.calls.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {i.calls.map((c) => (
                <CallButton key={c.id} c={c} />
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/** One screen: what to do today, what is expiring, the household, travel and savings opportunities, portfolio health and goals. */
export function CopilotDashboard() {
  const q = useAuthedQuery<Dashboard>(['copilot', 'dashboard'], '/copilot/dashboard');
  const alerts = useAuthedQuery<Alert[]>(['copilot', 'alerts'], '/copilot/alerts');
  if (q.isLoading) return <Spinner label="Loading your dashboard" />;
  const d = q.data;
  if (!d) return null;
  return (
    <section aria-label="Copilot dashboard" className="space-y-4" data-testid="copilot-dashboard">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold text-slate-900" data-testid="dash-headline">
            {d.headline}
          </h2>
          <Badge tone={tone(d.confidence)}>
            Confidence {confidenceWord(d.confidence)} ({d.confidence}%)
          </Badge>
          {d.valueAtStakeCents > 0 && <Badge tone="brand">{money(d.valueAtStakeCents)} at stake</Badge>}
        </div>
        {d.briefing && (
          <p className="mt-1 text-sm text-slate-700" data-testid="dash-briefing">
            Latest {d.briefing.kind.toLowerCase()} briefing: {d.briefing.narration ? d.briefing.narration.text : d.briefing.headline}.{' '}
            <a href="#briefings" className="underline">
              Read it
            </a>
          </p>
        )}
        {(alerts.data?.length ?? 0) > 0 && (
          <ul className="mt-3 space-y-1" data-testid="dash-alerts" aria-label="Worth a look">
            {alerts.data!.map((a) => (
              <li key={a.key} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
                <Link href={a.link} className="font-medium underline">
                  {a.title}
                </Link>
                <span className="block text-xs">{a.body}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Today’s tasks" data-testid="dash-today">
          <Items items={d.today} empty="Nothing is due today or this week." testId="dash-today-list" />
        </Panel>
        <Panel title="Expiring assets" data-testid="dash-expiring">
          <Items items={d.expiring} empty="Nothing is close to expiring." testId="dash-expiring-list" />
        </Panel>
        <Panel title="Recommended actions" data-testid="dash-actions">
          <Items items={d.actions} empty="No actions to suggest right now." testId="dash-actions-list" />
        </Panel>

        <Panel title="Household insights" data-testid="dash-household">
          <ul className="space-y-1 text-sm">
            {d.household.members.map((m) => (
              <li key={m.member} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{m.member}</span>
                <Badge tone={m.underLimit ? 'green' : 'amber'}>{m.count}/24</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-700">
            {d.household.applyPick ? (
              <>
                Best next card: {d.household.applyPick.card} for {d.household.applyPick.member}, about {money(d.household.applyPick.firstYearCents)} the first year.{' '}
                <Link href="/next-card" className="underline">
                  See why
                </Link>
              </>
            ) : (
              'No one has a card worth applying for right now.'
            )}
          </p>
        </Panel>
        <Panel title="Travel opportunities" data-testid="dash-travel">
          <Items items={d.travel} empty="No transfer bonuses or certificates to act on." testId="dash-travel-list" />
        </Panel>
        <Panel title="Savings opportunities" data-testid="dash-savings">
          <p className="text-2xl font-semibold text-slate-900">{money(d.savings.totalCents)}</p>
          <p className="text-xs text-slate-600">
            {money(d.savings.offersCents)} in offers and {money(d.savings.creditsCents)} in unused credits that you could still capture.
          </p>
          <Link href="/offers/inventory" className="mt-2 inline-block text-xs underline">
            Open the offer inbox
          </Link>
        </Panel>

        <Panel title="AI recommendations" data-testid="dash-recommendations">
          <Items items={d.recommendations} empty="No recommendations right now." testId="dash-recommendations-list" />
        </Panel>
        <Panel title="Portfolio health" data-testid="dash-portfolio">
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-600">Loyalty health</dt>
              <dd>{d.portfolio.healthScore != null ? `${d.portfolio.healthScore}/100` : 'not enough data'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Annual fees</dt>
              <dd>{money(d.portfolio.feesCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Returned (12 months)</dt>
              <dd>{money(d.portfolio.valueCents)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-600">Cards worth a decision</dt>
              <dd>
                {d.portfolio.toReview} of {d.portfolio.cards}
              </dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Goal progress" data-testid="dash-goals">
          {d.goals.length === 0 ? (
            <p className="text-sm text-slate-600">
              No goals yet.{' '}
              <a href="#goals" className="underline">
                Add one
              </a>
            </p>
          ) : (
            <ul className="space-y-2 text-sm" data-testid="dash-goals-list">
              {d.goals.slice(0, 5).map((g) => {
                const [label, t] = STATE[g.progress.state];
                return (
                  <li key={g.id}>
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{g.title}</span>
                      <Badge tone={t}>{label}</Badge>
                    </div>
                    {g.progress.pct != null && (
                      <div
                        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={g.progress.pct}
                        aria-label={`Progress: ${g.title}`}
                      >
                        <div className="h-full rounded-full bg-brand-600" style={{ width: `${g.progress.pct}%` }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
      {d.hidden > 0 && (
        <p className="text-xs text-slate-600">
          {d.hidden} item{d.hidden === 1 ? '' : 's'} you put aside {d.hidden === 1 ? 'is' : 'are'} hidden.{' '}
          <a href="#memory" className="underline">
            Manage
          </a>
        </p>
      )}
    </section>
  );
}
