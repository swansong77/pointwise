'use client';

import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { use } from 'react';
import { Badge, EmptyState, ErrorText, Panel, PageHeader, Spinner } from '@/components/ui';
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
