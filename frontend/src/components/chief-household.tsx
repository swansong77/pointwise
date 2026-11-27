'use client';

import Link from 'next/link';
import { Badge, Panel, Spinner } from '@/components/ui';
import { BAND_LABEL, BAND_TONE, HouseholdChiefData } from '@/lib/chief';
import { money } from '@/lib/format';
import { useAuthedQuery } from '@/lib/queries';

type Action = HouseholdChiefData['shared'][number];

function Actions({ items, empty }: { items: Action[]; empty: string }) {
  if (items.length === 0) return <p className="text-xs text-slate-600">{empty}</p>;
  return (
    <ul className="space-y-1">
      {items.map((a) => (
        <li key={a.id} className="text-sm">
          <Link href={a.href} className="font-medium text-slate-900 underline-offset-2 hover:underline">
            {a.title}
          </Link>{' '}
          <Badge tone={BAND_TONE[a.band]}>
            <span className="sr-only">Priority: </span>
            {BAND_LABEL[a.band]}
          </Badge>
          {a.valueCents ? <span className="ml-1 text-xs text-slate-600">{money(a.valueCents)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** What each person in the household should do, who could be added as an authorized user, and which card is best for what you spend most on. */
export function ChiefHousehold() {
  const q = useAuthedQuery<HouseholdChiefData>(['chief', 'household'], '/chief/household');
  if (q.isLoading) return <Spinner label="Looking at the household" />;
  const h = q.data;
  if (!h) return null;
  return (
    <Panel title="Household chief" data-testid="chief-household">
      <div id="household" />
      <p className="text-sm font-medium text-slate-900" data-testid="house-headline">
        {h.headline}
      </p>
      <ul className="mt-3 grid gap-3 md:grid-cols-2" data-testid="house-members">
        {h.members.map((m) => (
          <li key={m.member} className="rounded-lg border border-slate-200 bg-white p-3" data-testid="house-member">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 font-medium text-slate-900">{m.member}</span>
              <span className="text-xs text-slate-600">{m.relationship.toLowerCase()}</span>
              {m.five24 && <Badge>{m.five24}</Badge>}
            </div>
            <p className="text-xs text-slate-600">
              {m.cardsHeld} card{m.cardsHeld === 1 ? '' : 's'}
            </p>
            <div className="mt-2">
              <Actions items={m.actions} empty="Nothing for them right now." />
            </div>
          </li>
        ))}
      </ul>
      {h.shared.length > 0 && (
        <div className="mt-3" data-testid="house-shared">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">For the household</h3>
          <Actions items={h.shared} empty="" />
        </div>
      )}
      {h.authorizedUsers.length > 0 && (
        <div className="mt-3" data-testid="house-au">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Authorized users</h3>
          <ul className="list-disc pl-5 text-sm">
            {h.authorizedUsers.map((a) => (
              <li key={a.member + a.card}>{a.text}</li>
            ))}
          </ul>
        </div>
      )}
      {h.bestCardByCategory.length > 0 && (
        <div className="mt-3" data-testid="house-best">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Best household card for what you spend most on</h3>
          <ul className="list-disc pl-5 text-sm">
            {h.bestCardByCategory.map((c) => (
              <li key={c.category}>{c.text}</li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
