'use client';

import { use } from 'react';
import { Button, EmptyState, ErrorText, Panel, PageHeader, Spinner } from '@/components/ui';
import { RankedCardRow, categoryEmoji } from '@/components/card-bits';
import { useApiMutation, useCategoryRecommendation } from '@/lib/queries';

export default function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const rec = useCategoryRecommendation(slug);
  const key = ['rec', 'category', slug] as const;
  const pin = useApiMutation<{ walletCardId: string; categoryId: string }>((body) => ({ path: '/wallet/pins', method: 'POST', body }), [key, ['dashboard']]);
  const unpin = useApiMutation<string>((categoryId) => ({ path: `/wallet/pins?categoryId=${categoryId}`, method: 'DELETE' }), [key, ['dashboard']]);

  if (rec.isLoading) return <Spinner />;
  if (rec.error) return <ErrorText error={rec.error} />;
  if (!rec.data) return null;
  const { category, ranked } = rec.data;
  const pinned = ranked.find((r) => r.pinned);

  return (
    <div className="space-y-6">
      <PageHeader title={`${categoryEmoji(category.icon)} ${category.name}`} subtitle="Ranked by value per dollar: multiplier × your point valuation." />
      <Panel
        title="Your cards, best first"
        action={
          pinned && (
            <Button variant="ghost" onClick={() => unpin.mutate(category.id)}>
              Unpin {pinned.name}
            </Button>
          )
        }
        data-testid="category-ranking"
      >
        {ranked.length === 0 ? (
          <EmptyState title="No approved cards in your wallet" />
        ) : (
          <ol className="divide-y divide-slate-100">
            {ranked.map((r, i) => (
              <RankedCardRow
                key={r.walletCardId}
                r={r}
                rank={i + 1}
                action={
                  r.pinned ? (
                    <Button variant="ghost" className="text-xs" onClick={() => unpin.mutate(category.id)} aria-label={`Unpin ${r.name} from ${category.name}`}>
                      Unpin
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      className="text-xs"
                      onClick={() => pin.mutate({ walletCardId: r.walletCardId, categoryId: category.id })}
                      aria-label={`Always use ${r.name} for ${category.name}`}
                    >
                      Pin
                    </Button>
                  )
                }
              />
            ))}
          </ol>
        )}
        <ErrorText error={pin.error || unpin.error} />
      </Panel>
    </div>
  );
}
