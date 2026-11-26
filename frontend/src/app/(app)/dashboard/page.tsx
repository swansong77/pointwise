'use client';

import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { Badge, EmptyState, ErrorText, Panel, PageHeader, ProgressBar, Spinner } from '@/components/ui';
import { CardSwatch, categoryEmoji, WalletCardArt } from '@/components/card-bits';
import { useDashboard } from '@/lib/queries';
import { centsPerDollar, daysLeftLabel, money, shortDate } from '@/lib/format';

export default function DashboardPage() {
  const { data, isLoading, error } = useDashboard();
  if (isLoading) return <Spinner label="Loading dashboard" />;
  if (error) return <ErrorText error={error} />;
  if (!data) return null;

  const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" subtitle="Your best cards, expiring offers and upcoming deadlines." action={<Badge tone={data.plan === 'PRO' ? 'brand' : 'slate'}>{data.plan} plan</Badge>} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4" data-testid="stats">
        {[
          ['Active cards', String(data.stats.cards)],
          ['Active offers', String(data.stats.activeOffers)],
          ['Offer value available', money(data.stats.availableOfferValueCents)],
          ['Saved with offers', money(data.stats.redeemedValueCents)],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
          </div>
        ))}
      </div>

      {data.stats.cards === 0 && (
        <EmptyState title="Add your first card">
          <Link href="/wallet" className="font-medium text-brand-700 hover:underline">
            Go to your wallet →
          </Link>
        </EmptyState>
      )}

      <Panel title="Best card by category" data-testid="best-by-category">
        <ul className="grid gap-2 sm:grid-cols-2">
          {data.bestByCategory.map(({ category, best }) => (
            <li key={category.id}>
              <Link href={`/categories/${category.slug}`} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 hover:border-brand-200 hover:bg-brand-50/40">
                <span className="text-xl" aria-hidden>
                  {categoryEmoji(category.icon)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-900">{category.name}</p>
                  <p className="truncate text-xs text-slate-500">{best ? best.name : 'No card yet'}</p>
                </div>
                {best && (
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <WalletCardArt walletCardId={best.walletCardId} cardId={best.cardId} name={best.name} color={best.color} size="sm" />
                    {centsPerDollar(best.centsPerDollar)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Expiring soon" action={<Link href="/offers" className="text-sm text-brand-700 hover:underline">All offers</Link>} data-testid="expiring-offers">
          {data.expiringOffers.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing expiring in the next few days. 🎉</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.expiringOffers.map((uo) => (
                <li key={uo.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {uo.offer.merchant ? <BrandLogo brand={{ name: uo.offer.merchant.name }} size="md" decorative /> : <CardSwatch color={uo.walletCard.card.color} size="sm" />}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{uo.offer.title}</p>
                      <p className="text-xs text-slate-500">{uo.walletCard.nickname || uo.walletCard.card.name}</p>
                    </div>
                  </div>
                  <Badge tone="amber">{uo.offer.endsAt ? daysLeftLabel(daysUntil(uo.offer.endsAt)) : 'No expiry'}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Welcome bonuses" data-testid="bonuses">
          {data.bonuses.length === 0 ? (
            <p className="text-sm text-slate-500">No welcome bonuses in progress.</p>
          ) : (
            <ul className="space-y-4">
              {data.bonuses.map((b) => (
                <li key={b.walletCardId}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-slate-500">
                      {money(b.spentCents)} / {money(b.requiredSpendCents)}
                    </span>
                  </div>
                  <ProgressBar value={b.percent} tone={b.atRisk ? 'amber' : 'brand'} label={`${b.name} bonus progress`} />
                  <p className="mt-1 text-xs text-slate-500">
                    {b.daysLeft} days left · deadline {shortDate(b.deadline)} {b.atRisk && <Badge tone="amber">At risk</Badge>}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Upcoming annual fees" data-testid="renewals">
          {data.renewals.length === 0 ? (
            <p className="text-sm text-slate-500">No annual fees in the next 60 days.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.renewals.map((r) => (
                <li key={r.walletCardId} className="flex justify-between py-2 text-sm">
                  <span className="flex items-center gap-2"><WalletCardArt walletCardId={r.walletCardId} name={r.name} size="sm" />{r.name}</span>
                  <span className="text-slate-600">
                    {money(r.annualFeeCents)} on {shortDate(r.renewsAt)} ({r.daysUntil}d)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="5/24 status" data-testid="five-twenty-four">
          <p className="text-3xl font-semibold">
            {data.fiveTwentyFour.count}
            <span className="text-base font-normal text-slate-500">/24</span>
          </p>
          <p className="mt-1 text-sm text-slate-600">
            Personal cards opened in the last 24 months.{' '}
            {data.fiveTwentyFour.underLimit ? <Badge tone="green">Under 5/24</Badge> : <Badge tone="red">At or over 5/24</Badge>}
          </p>
          {data.fiveTwentyFour.nextDropAt && <p className="mt-2 text-xs text-slate-500">Next drop: {shortDate(data.fiveTwentyFour.nextDropAt)}</p>}
        </Panel>
      </div>
    </div>
  );
}
