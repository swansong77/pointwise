'use client';

import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, EmptyState, ErrorText, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { money, shortDate } from '@/lib/format';
import { useAuthedQuery } from '@/lib/queries';
import {
  ADVICE_TONE,
  bonusLabel,
  DIFFICULTY,
  expiryLabel,
  Market,
  MARKET_SORTS,
  MarketSort,
  sortOffers,
  VERDICT,
} from '@/lib/offer-market';

export default function OfferMarketPage() {
  const q = useAuthedQuery<Market>(['offers', 'market'], '/offers/market');
  const [sort, setSort] = useState<MarketSort>('first-year');
  const m = q.data;
  const bySlug = new Map((m?.offers ?? []).map((o) => [o.slug, o]));

  return (
    <div className="space-y-6" data-testid="offer-market">
      <PageHeader
        title="Offer market"
        subtitle="Current welcome offers compared with each card's own history, and what they are worth to you."
        action={
          <Link href="/offers" className="text-sm text-brand-700 hover:underline">
            Your offers →
          </Link>
        }
      />
      {q.isLoading && <Spinner />}
      <ErrorText error={q.error} />

      {m?.recommended && (
        <Panel title="Recommended offer" data-testid="recommended-offer">
          <p className="text-sm">
            <strong>{m.recommended.card}</strong> — {m.recommended.why}
          </p>
        </Panel>
      )}

      {m && m.expiringSoon.length > 0 && (
        <Panel title="Upcoming expirations" data-testid="expiring-soon">
          <ul className="divide-y divide-slate-100 text-sm">
            {m.expiringSoon.map((slug) => {
              const o = bySlug.get(slug)!;
              return (
                <li key={slug} className="flex flex-wrap items-center gap-2 py-2">
                  <BrandLogo brand={{ name: o.issuer }} kinds={['ISSUER']} size="sm" decorative />
                  <span className="font-medium">{o.card}</span>
                  <Badge tone="amber">{expiryLabel(o.daysToExpiry)}</Badge>
                  <span className="text-slate-600">{bonusLabel(o)}</span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      {m && m.historicalHighs.length > 0 && (
        <Panel title="At or near their historic high" data-testid="historic-highs">
          <ul className="flex flex-wrap gap-2 text-sm">
            {m.historicalHighs.map((slug) => {
              const o = bySlug.get(slug)!;
              return (
                <li key={slug}>
                  <Badge tone={VERDICT[o.verdict].tone}>
                    {o.card} · {bonusLabel(o)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <Panel
        title="All current offers"
        action={
          <Select aria-label="Sort offers" value={sort} onChange={(e) => setSort(e.target.value as MarketSort)} data-testid="market-sort">
            {MARKET_SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </Select>
        }
      >
        {m && !m.offers.length && <EmptyState title="No current offers recorded yet" />}
        <ul className="divide-y divide-slate-100" data-testid="market-list">
          {m && sortOffers(m.offers, sort).map((o) => (
            <li key={o.slug} className="py-4" data-testid="market-offer">
              <div className="flex flex-wrap items-center gap-2">
                <BrandLogo brand={{ name: o.issuer }} kinds={['ISSUER']} size="md" decorative />
                <span className="font-medium">{o.card}</span>
                <span className="text-sm text-slate-600">{o.issuer}</span>
                <Badge tone={VERDICT[o.verdict].tone}>{VERDICT[o.verdict].label}</Badge>
                <Badge tone={DIFFICULTY[o.difficulty.level].tone}>Application: {DIFFICULTY[o.difficulty.level].label}</Badge>
                <span className="ml-auto text-sm font-semibold">{bonusLabel(o)}</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Worth about {money(o.valuationCents)} · min spend {money(o.minSpendCents)}
                {o.spendMonths ? ` in ${o.spendMonths} months` : ''} · annual fee {money(o.annualFeeCents)} ·{' '}
                {expiryLabel(o.daysToExpiry)}
                {o.bestEverCents != null && ` · best ever ${money(o.bestEverCents)}${o.bestEverSince ? ` (since ${shortDate(o.bestEverSince)})` : ''}`}
                {o.median24mCents != null && ` · 24-month typical ${money(o.median24mCents)}`}
                {o.percentile != null && ` · better than ${Math.round(o.percentile * 100)}% of its history`}
              </p>
              {o.advice.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-2" data-testid="advice">
                  {o.advice.map((a) => (
                    <li key={a.code}>
                      <Badge tone={ADVICE_TONE[a.tone]}>{a.text}</Badge>
                    </li>
                  ))}
                </ul>
              )}
              {o.you && (
                <p className="mt-2 text-sm text-slate-700" data-testid="you">
                  For {m.member.nickname}: first year {money(o.you.firstYearValueCents)} · long term {money(o.you.longTermValueCents)} ·{' '}
                  {o.you.five24.countsToward
                    ? `uses a 5/24 slot (${o.you.five24.before}/24 → ${o.you.five24.after}/24)`
                    : 'does not count toward 5/24'}
                  {!o.you.eligible && o.you.blockers[0] ? ` · not eligible: ${o.you.blockers[0]}` : ''}
                </p>
              )}
              <details className="mt-1 text-xs text-slate-500">
                <summary className="cursor-pointer">Why This Difficulty</summary>
                <ul className="mt-1 list-disc pl-5">
                  {o.difficulty.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </details>
            </li>
          ))}
        </ul>
      </Panel>
      {m && <p className="text-xs text-slate-500">{m.disclaimer}</p>}
    </div>
  );
}
