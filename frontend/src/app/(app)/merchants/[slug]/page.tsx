'use client';

import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { use } from 'react';
import { Badge, EmptyState, ErrorText, Panel, PageHeader, Spinner } from '@/components/ui';
import { StatTiles } from '@/components/charts';
import { LIFECYCLE, offerValueText } from '@/lib/offer-inventory';
import type { MerchantDashboard } from '@/lib/offer-dashboards';
import { RankedCardRow, categoryEmoji } from '@/components/card-bits';
import { useAuthedQuery } from '@/lib/queries';
import { money, shortDate } from '@/lib/format';
import type { Offer, RankedCard } from '@/lib/types';

interface MerchantRec {
  merchant: { id: string; name: string; slug: string; hosts: string[]; category: { name: string; slug: string; icon: string } };
  ranked: RankedCard[];
  offers: Array<{ id: string; offer: Offer; walletCard: { nickname: string | null; card: { name: string } } }>;
}
interface MerchantDetail {
  offers: Array<Offer & { issuer: { name: string } | null }>;
  locations: Array<{ id: string; name: string; address: string | null }>;
}

function MerchantInsights({ slug }: { slug: string }) {
  const q = useAuthedQuery<MerchantDashboard>(['merchant', slug, 'dashboard'], `/offers/intel/merchants/${slug}/dashboard`);
  if (q.isLoading) return <Spinner label="Loading merchant dashboard" />;
  if (q.error || !q.data) return null;
  const d = q.data;
  const best = d.bestWayToPay;
  return (
    <section className="space-y-6" data-testid="merchant-dashboard" aria-label={`${d.merchant.name} dashboard`}>
      <StatTiles
        testId="merchant-dashboard-tiles"
        items={[
          ['Offers earning', String(d.offers.active.length), d.daysToNextExpiry != null ? `next ends in ${d.daysToNextExpiry} days` : undefined],
          ['Expected savings', money(d.expectedCents)],
          ['Received so far', money(d.receivedCents)],
          ['Spent here (12 mo)', money(d.spend.last12MonthsCents), `${d.spend.purchases} purchase${d.spend.purchases === 1 ? '' : 's'}`],
        ]}
      />
      {best && (
        <Panel title="Best way to pay here" data-testid="merchant-best-pay">
          <p className="text-sm">
            <strong>{best.legs.map((l) => `${l.card}${l.member ? ` (${l.member})` : ''}`).join(' + ')}</strong> returns about <strong>{money(best.expectedCents)}</strong> on{' '}
            {money(best.referenceAmountCents)} ({best.basedOn}), confidence {best.confidence}%.
          </p>
          <p className="mt-1 text-sm text-slate-700">{best.memberReason}</p>
          {best.actions.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-sm">
              {best.actions.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-600">
            <Link href="/offers/plan" className="text-brand-700 underline">
              Plan a specific purchase
            </Link>{' '}
            for an exact amount and date.
          </p>
        </Panel>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Offers across the household" data-testid="merchant-offer-inventory">
          {d.offers.active.length + d.offers.past.length === 0 ? (
            <p className="text-sm text-slate-600">No offers on your cards here.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {[...d.offers.active, ...d.offers.past].map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="min-w-0 flex-1">
                    {offerValueText(o, money)}
                    <span className="block text-xs text-slate-600">
                      {o.cardholder ?? 'You'} · {o.card}
                      {o.endsAt ? ` · ends ${shortDate(o.endsAt)}` : ''}
                    </span>
                  </span>
                  <Badge tone={LIFECYCLE[o.state].tone}>{LIFECYCLE[o.state].label}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Card multipliers here" data-testid="merchant-multipliers">
          <ul className="space-y-1 text-sm">
            {d.multipliers.map((m) => (
              <li key={m.walletCardId} className="flex justify-between gap-2">
                <span>
                  {m.card}
                  {m.member ? <span className="text-slate-600"> ({m.member})</span> : null}
                </span>
                <span className="tabular-nums">
                  {m.multiplier}× · {m.centsPerDollar.toFixed(1)}¢/$
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
      {(d.portalRates.length > 0 || d.certificates.length > 0 || d.transferRoutes.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-3">
          {d.portalRates.length > 0 && (
            <Panel title="Shopping portal bonuses" data-testid="merchant-portals">
              <ul className="space-y-1 text-sm">
                {d.portalRates.map((r) => (
                  <li key={r.portal}>
                    {r.portal}: {r.ratePercent != null ? `${r.ratePercent}% back` : `${r.pointsPerDollar} points per $`}
                    {r.expiresAt ? <span className="text-xs text-slate-600"> · until {shortDate(r.expiresAt)}</span> : null}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {d.certificates.length > 0 && (
            <Panel title="Certificates you hold" data-testid="merchant-certificates">
              <ul className="space-y-1 text-sm">
                {d.certificates.map((c) => (
                  <li key={c.id}>
                    {c.name} ({c.member}) · {money(c.valueCents)}
                    {c.expiresAt ? <span className="text-xs text-slate-600"> · expires {shortDate(c.expiresAt)}</span> : null}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {d.transferRoutes.length > 0 && (
            <Panel title="Transfer partners" data-testid="merchant-transfers">
              <ul className="space-y-1 text-sm">
                {d.transferRoutes.map((t) => (
                  <li key={`${t.currency}-${t.program}`}>
                    {t.currency} → {t.program} ({t.ratio}){t.bonusPercent > 0 ? <Badge tone="green">{t.bonusPercent}% bonus</Badge> : null}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
      {d.history.count > 0 && (
        <Panel title="How this merchant’s offers behave" data-testid="merchant-history">
          <p className="text-sm text-slate-700">
            {d.history.count} offers seen, about {d.history.perYear.toFixed(1)} a year, averaging {money(d.history.averageValueCents)}.
            {d.history.best ? ` The best was ${money(d.history.best.valueCents)}${d.history.best.issuer ? ` from ${d.history.best.issuer}` : ''}.` : ''}
            {d.history.currentRank != null ? ` A current offer is better than ${d.history.currentRank}% of past ones.` : ''}
          </p>
        </Panel>
      )}
    </section>
  );
}

export default function MerchantDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const rec = useAuthedQuery<MerchantRec>(['rec', 'merchant', slug], `/recommendations/merchants/${slug}`);
  const detail = useAuthedQuery<MerchantDetail>(['merchant', slug], `/merchants/${slug}`);

  if (rec.isLoading) return <Spinner />;
  if (rec.error) return <ErrorText error={rec.error} />;
  if (!rec.data) return null;
  const { merchant, ranked, offers } = rec.data;

  return (
    <div className="space-y-6">
      <BrandLogo brand={{ slug: merchant.slug, name: merchant.name }} name={merchant.name} size="lg" />
      <PageHeader
        title={merchant.name}
        subtitle={`${merchant.category.name}${merchant.hosts.length ? ` · ${merchant.hosts.join(', ')}` : ''}`}
        action={
          <Link href={`/categories/${merchant.category.slug}`} className="text-sm text-brand-700 hover:underline">
            {categoryEmoji(merchant.category.icon)} {merchant.category.name} →
          </Link>
        }
      />
      <Panel title="Your best cards here" data-testid="merchant-ranking">
        {ranked.length === 0 ? (
          <EmptyState title="No cards yet">
            <Link href="/wallet" className="text-brand-700 underline">
              Add a card
            </Link>
          </EmptyState>
        ) : (
          <ol className="divide-y divide-slate-100">
            {ranked.map((r, i) => (
              <RankedCardRow key={r.walletCardId} r={r} rank={i + 1} />
            ))}
          </ol>
        )}
      </Panel>
      <Panel title="Your offers at this merchant" data-testid="merchant-my-offers">
        {offers.length === 0 ? (
          <p className="text-sm text-slate-500">No tracked offers here.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {offers.map((o) => (
              <li key={o.id} className="flex justify-between py-2 text-sm">
                <span>
                  {o.offer.title} <span className="text-slate-500">({o.walletCard.nickname || o.walletCard.card.name})</span>
                </span>
                <Badge tone="green">{money(o.offer.valueCents)}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <MerchantInsights slug={slug} />
      {detail.data && detail.data.offers.length > 0 && (
        <Panel title="All current offers">
          <ul className="divide-y divide-slate-100">
            {detail.data.offers.map((o) => (
              <li key={o.id} className="flex justify-between py-2 text-sm">
                <span>
                  {o.title} {o.issuer && <span className="text-slate-500">· {o.issuer.name}</span>}
                </span>
                <span className="text-slate-500">ends {shortDate(o.endsAt)}</span>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
