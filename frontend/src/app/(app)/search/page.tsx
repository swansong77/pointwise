'use client';

import Link from 'next/link';
import { StatTiles } from '@/components/charts';
import { BrandLogo } from '@/components/brand-logo';
import { Badge, Button, EmptyState, ErrorText, PageHeader, Panel, Spinner } from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import { askSearchBar, Reminder, SearchDashboard, SearchEntry } from '@/lib/search';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

const KEY = [['search', 'dashboard'], ['search', 'suggest'], ['search', 'saved-check'], ['reminders']] as const;

function EntryList({ items, onRemove, empty, testId }: { items: SearchEntry[]; onRemove?: (id: string) => void; empty: string; testId: string }) {
  if (items.length === 0) return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100" data-testid={testId}>
      {items.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-2 py-2 text-sm" data-testid="search-entry">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-slate-900">{e.name || e.query}</p>
            {e.name && <p className="truncate text-xs text-slate-600">{e.query}</p>}
            {e.summary && <p className="truncate text-xs text-slate-600">{e.summary}</p>}
          </div>
          {e.uses > 1 && <Badge tone="slate">{e.uses}×</Badge>}
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => askSearchBar(e.query)} aria-label={`Ask again: ${e.name || e.query}`}>
            Ask again
          </Button>
          {onRemove && (
            <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onRemove(e.id)} aria-label={`Remove: ${e.name || e.query}`}>
              Remove
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}

export default function SearchHistoryPage() {
  const q = useAuthedQuery<SearchDashboard>(['search', 'dashboard'], '/search/dashboard');
  const reminders = useAuthedQuery<Reminder[]>(['reminders'], '/reminders');
  const dismiss = useApiMutation<string>((id) => ({ path: `/reminders/${id}`, method: 'DELETE' }), [...KEY]);
  const remove = useApiMutation<string>((id) => ({ path: `/search/entries/${id}`, method: 'DELETE' }), [...KEY]);
  const clear = useApiMutation<void>(() => ({ path: '/search/history', method: 'DELETE' }), [...KEY]);
  if (q.isLoading) return <Spinner label="Loading search history" />;
  if (q.error) return <ErrorText error={q.error} />;
  const d = q.data;
  if (!d) return null;
  const empty = d.totals.questions === 0 && d.saved.length === 0;
  return (
    <div className="space-y-6" data-testid="search-dashboard">
      <PageHeader
        title="Search history"
        subtitle="What you ask the search bar, what you keep, and what you come back to. Press Ctrl+K (Cmd+K on a Mac) anywhere to ask."
        action={
          <Button variant="secondary" onClick={() => askSearchBar("What's expiring?")}>
            Open search
          </Button>
        }
      />
      <StatTiles
        testId="search-totals"
        items={[
          ['Questions asked', String(d.totals.questions)],
          ['Saved searches', String(d.totals.saved)],
          ['Favorite merchants', String(d.favoriteMerchants.length)],
          ['Cards in answers', String(d.recentCards.length)],
        ]}
      />
      {empty && (
        <EmptyState title="Nothing here yet">Ask something with Ctrl+K — for example “What card should I use at Costco for $1,500?” — and it will show up here.</EmptyState>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Saved searches" data-testid="search-saved">
          <EntryList items={d.saved} onRemove={(id) => remove.mutate(id)} empty="Save an answer with the ☆ in the search bar to keep it here." testId="saved-list" />
        </Panel>
        <Panel title="Most asked" data-testid="search-common">
          <EntryList items={d.mostCommon} empty="Questions you ask more than once appear here." testId="common-list" />
        </Panel>
        <Panel title="Recent recommendations" data-testid="search-recommendations">
          <EntryList items={d.recentRecommendations} empty="Shopping, travel and card questions appear here with their answer." testId="recommendation-list" />
        </Panel>
        <Panel
          title="Recent questions"
          action={
            d.recent.length > 0 && (
              <Button
                variant="ghost"
                className="px-2 py-1 text-xs"
                onClick={() => {
                  if (window.confirm('Clear your question history? Saved searches are kept.')) clear.mutate(undefined);
                }}
              >
                Clear history
              </Button>
            )
          }
          data-testid="search-recent"
        >
          <EntryList items={d.recent} onRemove={(id) => remove.mutate(id)} empty="No questions yet." testId="recent-list" />
        </Panel>
      </div>
      <ErrorText error={remove.error || clear.error} />

      <Panel title="Reminders" data-testid="search-reminders">
        {(reminders.data ?? []).length === 0 ? (
          <p className="text-sm text-slate-600">Ask “What’s expiring?” and choose Remind me to get a notification before something ends.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm" data-testid="reminder-list">
            {(reminders.data ?? []).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900">{r.title}</p>
                  <p className="text-xs text-slate-600">Notifies {shortDate(r.dueAt)}</p>
                </div>
                {r.link && (
                  <Link href={r.link} className="text-xs text-brand-700 underline">
                    Open
                  </Link>
                )}
                <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => dismiss.mutate(r.id)} aria-label={`Delete reminder: ${r.title}`}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <ErrorText error={dismiss.error} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Favorite merchants" data-testid="search-merchants">
          {d.favoriteMerchants.length === 0 ? (
            <p className="text-sm text-slate-600">Merchants you ask about most appear here.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {d.favoriteMerchants.map((m) => (
                <li key={m.name} className="flex items-center gap-2">
                  <BrandLogo brand={{ name: m.name }} size="sm" decorative />
                  {m.slug ? (
                    <Link href={`/merchants/${m.slug}`} className="text-brand-700 underline">
                      {m.name}
                    </Link>
                  ) : (
                    m.name
                  )}
                  <span className="ml-auto text-xs text-slate-600">{m.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recently viewed cards" data-testid="search-cards">
          {d.recentCards.length === 0 ? (
            <p className="text-sm text-slate-600">Cards that came up in your answers appear here.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.recentCards.map((c) => (
                <li key={c.walletCardId ?? c.name}>
                  {c.walletCardId ? (
                    <Link href={`/wallet/${c.walletCardId}`} className="text-brand-700 underline">
                      {c.name}
                    </Link>
                  ) : (
                    c.name
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent plans and trips" data-testid="search-plans">
          {d.recentPlans.length + d.recentTrips.length === 0 ? (
            <p className="text-sm text-slate-600">Saved shopping plans and travel plans appear here.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {d.recentPlans.map((p) => (
                <li key={p.id}>
                  <Link href="/offers/plan" className="text-brand-700 underline">
                    {p.item ? `${p.item} · ${p.merchantText}` : p.merchantText}
                  </Link>{' '}
                  <span className="text-xs text-slate-600">
                    {money(p.amountCents)} · {p.status.toLowerCase()}
                  </span>
                </li>
              ))}
              {d.recentTrips.map((t) => (
                <li key={t.id}>
                  <Link href="/loyalty" className="text-brand-700 underline">
                    Trip to {t.destination}
                  </Link>{' '}
                  <span className="text-xs text-slate-600">
                    {shortDate(t.dateFrom)}
                    {t.cabin ? ` · ${t.cabin.toLowerCase()}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
