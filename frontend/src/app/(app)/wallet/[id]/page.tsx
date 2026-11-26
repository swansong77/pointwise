'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { CardArt } from '@/components/card-bits';
import { StatTiles, Tabs } from '@/components/charts';
import { Badge, EmptyState, ErrorText, PageHeader, Panel, Spinner } from '@/components/ui';
import { daysLeftLabel, money, shortDate } from '@/lib/format';
import { CardDetail, LIFECYCLE, offerValueText, UnifiedOffer } from '@/lib/offer-inventory';
import { useAuthedQuery } from '@/lib/queries';

type Tab = 'overview' | 'offers' | 'benefits' | 'certificates' | 'savings';
type OfferTab = 'active' | 'pending' | 'expired' | 'redeemed' | 'missed';

function OfferList({ items, empty }: { items: UnifiedOffer[]; empty: string }) {
  if (items.length === 0) return <p className="py-4 text-sm text-slate-500">{empty}</p>;
  return (
    <ul className="divide-y divide-slate-100" data-testid="card-offer-list">
      {items.map((o) => (
        <li key={o.id} className="flex flex-wrap items-center gap-3 py-3 text-sm" data-state={o.state}>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-slate-900">{o.merchant?.name ?? o.merchantText}</p>
            <p className="text-xs text-slate-600">{offerValueText(o, money)}</p>
            <p className="text-xs text-slate-500">
              {o.endsAt ? `Ends ${shortDate(o.endsAt)} · ${daysLeftLabel(o.daysLeft)}` : 'No expiry'} · added {shortDate(o.addedAt)}
              {o.redeemedAt ? ` · redeemed ${shortDate(o.redeemedAt)}` : ''}
            </p>
          </div>
          <div className="text-right text-xs text-slate-600">
            <p>
              Expected <strong>{money(o.expectedSavingsCents)}</strong>
            </p>
            <p>
              Received <strong>{money(o.actualSavingsCents)}</strong>
            </p>
          </div>
          <Badge tone={LIFECYCLE[o.state].tone}>{LIFECYCLE[o.state].label}</Badge>
        </li>
      ))}
    </ul>
  );
}

export default function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useAuthedQuery<CardDetail>(['wallet', 'detail', id], `/offers/intel/cards/${id}`);
  const [tab, setTab] = useState<Tab>('overview');
  const [offerTab, setOfferTab] = useState<OfferTab>('active');
  if (q.isLoading) return <Spinner label="Loading card" />;
  if (q.error) return <ErrorText error={q.error} />;
  const d = q.data;
  if (!d) return null;
  const { card, offers } = d;
  const count = (t: OfferTab) => (t === 'missed' ? offers.missed.items.length : offers[t].length);

  return (
    <div className="space-y-6" data-testid="card-detail">
      <p className="text-sm">
        <Link href="/wallet" className="text-brand-700 underline">
          ← Wallet
        </Link>
      </p>
      <PageHeader
        title={card.name}
        subtitle={`${card.issuer} · ${card.network}${card.lastFour ? ` · •••• ${card.lastFour}` : ''} · held by ${card.cardholder ?? 'you'}${card.isAuthorizedUser ? ' (authorized user)' : ''}`}
        action={<CardArt name={card.name} color={card.color} issuer={card.issuer} size="lg" />}
      />
      <StatTiles
        testId="card-detail-tiles"
        items={[
          ['Annual fee', money(card.annualFeeCents), card.approvedAt ? `approved ${shortDate(card.approvedAt)}` : undefined],
          ['Offers earning', String(d.summary.live), `${d.summary.expiringSoon} ending in 30 days`],
          ['Savings so far', money(d.savings.totalCents), `${money(d.savings.offersCents)} offers · ${money(d.savings.creditsThisYearCents)} credits this year`],
          ['Missed offers', money(offers.missed.totalLostCents), `${offers.missed.items.length} found`],
        ]}
      />
      <Tabs<Tab>
        label="Card sections"
        value={tab}
        onChange={setTab}
        options={[
          ['overview', 'Overview'],
          ['offers', 'Offers'],
          ['benefits', 'Benefits & credits'],
          ['certificates', 'Certificates'],
          ['savings', 'Savings'],
        ]}
      />

      {tab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Panel title="Earning rates">
            {d.rewards.length === 0 ? (
              <p className="text-sm text-slate-500">No earning rates are recorded for this card.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {d.rewards.map((r) => (
                  <li key={r.id}>
                    {r.description}
                    {r.isRotating && (
                      <>
                        {' '}
                        <Badge tone={d.selectedCategoryIds.includes(r.categoryId ?? '') ? 'green' : 'amber'}>
                          {d.selectedCategoryIds.includes(r.categoryId ?? '') ? 'activated' : 'needs activation'}
                        </Badge>
                      </>
                    )}
                    {r.conditional && (
                      <>
                        {' '}
                        <Badge>portal or linked account</Badge>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Points: {card.currency.name} at {card.currency.centsPerPoint}¢ each.
            </p>
          </Panel>
          <Panel title="Upcoming expirations">
            {d.upcomingExpirations.length === 0 ? <p className="text-sm text-slate-500">Nothing is about to expire.</p> : <OfferList items={d.upcomingExpirations} empty="" />}
          </Panel>
          {card.bonus.requiredCents ? (
            <Panel title="Welcome bonus">
              <p className="text-sm">
                {card.bonus.earned
                  ? 'Earned.'
                  : `${money(card.bonus.spendCents)} of ${money(card.bonus.requiredCents)} spent${card.bonus.months ? ` in the first ${card.bonus.months} months` : ''}.`}
              </p>
            </Panel>
          ) : null}
        </div>
      )}

      {tab === 'offers' && (
        <Panel title="Offers on this card">
          <Tabs<OfferTab>
            label="Offer status"
            value={offerTab}
            onChange={setOfferTab}
            options={(['active', 'pending', 'expired', 'redeemed', 'missed'] as OfferTab[]).map((t) => [t, `${t} (${count(t)})`])}
          />
          <div className="mt-3">
            {offerTab === 'missed' ? (
              offers.missed.items.length === 0 ? (
                <p className="py-4 text-sm text-slate-500">No missed offers found for this card.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {offers.missed.items.map((m) => (
                    <li key={`${m.offerId}-${m.cause}`} className="py-3 text-sm">
                      <p className="font-medium">
                        {m.offer.merchant ?? m.offer.title} <Badge tone="red">{m.cause.replace(/_/g, ' ').toLowerCase()}</Badge>
                      </p>
                      <p className="text-xs text-slate-600">
                        {m.lostCents > 0 ? `${money(m.lostCents)} missed. ` : ''}
                        {m.action}
                      </p>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <OfferList
                items={offers[offerTab]}
                empty={offerTab === 'active' ? 'No activated offers.' : offerTab === 'pending' ? 'No offers waiting to be added or activated.' : `No ${offerTab} offers.`}
              />
            )}
          </div>
          {offers.removed.length > 0 && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer text-slate-600">Removed or rejected ({offers.removed.length})</summary>
              <OfferList items={offers.removed} empty="" />
            </details>
          )}
        </Panel>
      )}

      {tab === 'benefits' && (
        <Panel title="Benefits and credits this year">
          {d.benefits.length === 0 ? (
            <EmptyState title="No benefits tracked">Track this card’s credits on the Benefits page.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm" data-testid="card-benefits">
              {d.benefits.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-slate-900">{b.name}</p>
                    <p className="text-xs text-slate-500">
                      {b.kind.toLowerCase()} · {money(b.annualValueCents)} a year · {b.currentPeriod.daysLeft} days left in this period
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-600">
                    <p>
                      Used this year <strong>{money(b.year.usedThisYearCents)}</strong>
                    </p>
                    <p>
                      Left now <strong>{money(b.currentPeriod.remainingCents)}</strong>
                    </p>
                  </div>
                  <Badge tone={b.currentPeriod.status === 'EXPIRING_SOON' ? 'red' : b.currentPeriod.status === 'COMPLETED' ? 'green' : 'amber'}>
                    {b.currentPeriod.status.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'certificates' && (
        <Panel title={`Certificates held by ${card.cardholder ?? 'you'}`}>
          {d.certificates.length === 0 ? (
            <p className="text-sm text-slate-500">No available certificates.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm" data-testid="card-certificates">
              {d.certificates.map((c) => (
                <li key={c.id} className="flex items-center gap-3 py-3">
                  <div className="flex-1">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-slate-500">
                      {c.category.replace(/_/g, ' ').toLowerCase()}
                      {c.subtype ? ` · ${c.subtype.toLowerCase()}` : ''} · {c.quantity} available
                    </p>
                  </div>
                  <div className="text-right text-xs text-slate-600">
                    <p>{c.potentialValueCents ? money(c.potentialValueCents) : '—'}</p>
                    <p>{c.expiresAt ? `expires ${shortDate(c.expiresAt)}` : 'no expiry'}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}

      {tab === 'savings' && (
        <Panel title="Savings generated">
          <dl className="grid gap-3 text-sm sm:grid-cols-2" data-testid="card-savings">
            <div>
              <dt className="text-slate-500">Offer credits received</dt>
              <dd className="text-lg font-semibold">{money(d.savings.offersCents)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Benefit credits used this year</dt>
              <dd className="text-lg font-semibold">{money(d.savings.creditsThisYearCents)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Expected from offers still earning</dt>
              <dd className="text-lg font-semibold">{money(d.savings.expectedOffersCents)}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Annual fee</dt>
              <dd className="text-lg font-semibold">{money(d.savings.annualFeeCents)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-sm text-slate-600">
            {d.savings.totalCents >= d.savings.annualFeeCents
              ? 'Savings so far cover this card’s annual fee.'
              : `${money(d.savings.annualFeeCents - d.savings.totalCents)} more in savings would cover the annual fee.`}
          </p>
        </Panel>
      )}
    </div>
  );
}
