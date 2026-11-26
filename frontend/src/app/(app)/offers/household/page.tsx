'use client';

import Link from 'next/link';
import { BrandLogo } from '@/components/brand-logo';
import { StatTiles } from '@/components/charts';
import { Badge, EmptyState, ErrorText, PageHeader, Panel, Spinner } from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import { HouseholdOffers } from '@/lib/offer-dashboards';
import { useAuthedQuery } from '@/lib/queries';

export default function HouseholdOffersPage() {
  const q = useAuthedQuery<HouseholdOffers>(['offers', 'household'], '/offers/intel/household');
  if (q.isLoading) return <Spinner label="Loading household offers" />;
  if (q.error) return <ErrorText error={q.error} />;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-6" data-testid="household-offers">
      <PageHeader
        title="Household offers"
        subtitle="Who holds which offers, offers that sit on more than one card, and who should pay at each merchant."
        action={
          <Link href="/household" className="text-sm text-brand-700 hover:underline">
            Manage members →
          </Link>
        }
      />
      <StatTiles
        testId="household-offer-totals"
        items={[
          ['Members', String(d.members.length)],
          ['Offers earning', String(d.totals.liveOffers)],
          ['Expected savings', money(d.totals.expectedCents)],
          ['Offers on several cards', String(d.overlaps.length)],
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {d.members.map((m) => (
          <Panel
            key={m.profileId}
            title={
              <span className="flex items-center gap-2">
                {m.member} {m.isPrimary && <Badge tone="slate">you</Badge>}
              </span>
            }
            action={<span className="text-sm text-slate-700">{money(m.expectedCents)} expected</span>}
            data-testid="household-member-offers"
          >
            <p className="text-sm text-slate-700">
              {m.cards} card{m.cards === 1 ? '' : 's'} · {m.liveOffers} offer{m.liveOffers === 1 ? '' : 's'} earning
              {m.expiringSoon > 0 ? ` · ${m.expiringSoon} ending within 30 days` : ''} · {money(m.receivedCents)} received
            </p>
            {m.top.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No offers earning.</p>
            ) : (
              <ul className="mt-2 divide-y divide-slate-100 text-sm">
                {m.top.map((t) => (
                  <li key={`${t.merchant}-${t.title}`} className="flex items-center gap-2 py-1.5">
                    <BrandLogo brand={{ name: t.merchant }} size="sm" decorative />
                    <span className="flex-1">{t.merchant}</span>
                    <span className="text-xs text-slate-600">{t.endsAt ? `ends ${shortDate(t.endsAt)}` : 'no expiry'}</span>
                    <strong>{money(t.expectedCents)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>

      <Panel title="Who should pay at each merchant" data-testid="household-routing">
        {d.routing.length === 0 ? (
          <EmptyState title="No offers to route">Add offers on the Offers page to see who should pay where.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {d.routing.map((r) => (
              <li key={r.merchant} className="flex flex-wrap items-center gap-3 py-3" data-testid="routing-row">
                <BrandLogo brand={{ name: r.merchant }} size="md" decorative />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.merchant}</p>
                  <p className="text-xs text-slate-700">{r.advice}</p>
                </div>
                {r.merchantSlug && (
                  <Link href={`/merchants/${r.merchantSlug}`} className="text-xs text-brand-700 underline">
                    Merchant page
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {d.overlaps.length > 0 && (
        <Panel title="The same offer on several cards" data-testid="household-overlaps">
          <ul className="divide-y divide-slate-100 text-sm">
            {d.overlaps.map((o) => (
              <li key={`${o.merchant}-${o.valueCents}-${o.percent}-${o.minSpendCents}`} className="py-3">
                <p className="font-medium">
                  {o.merchant} <Badge tone="amber">{o.holders.length} cards</Badge>
                </p>
                <p className="text-xs text-slate-700">{o.advice}</p>
                <ul className="mt-1 text-xs text-slate-600">
                  {o.holders.map((h) => (
                    <li key={h.walletCardId ?? h.card}>
                      {h.member ?? 'You'} · {h.card} · {h.state.toLowerCase().replace(/_/g, ' ')} · {money(h.expectedCents)} expected
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
