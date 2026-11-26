'use client';

import { BrandLogo } from '@/components/brand-logo';
import Link from 'next/link';
import { useState } from 'react';
import { EmptyState, ErrorText, Field, Input, Panel, PageHeader, Spinner } from '@/components/ui';
import { categoryEmoji } from '@/components/card-bits';
import { useCategories, useMerchantSearch } from '@/lib/queries';

export default function MerchantsPage() {
  const [q, setQ] = useState('');
  const merchants = useMerchantSearch(q);
  const categories = useCategories();
  return (
    <div className="space-y-6">
      <PageHeader title="Merchants & categories" subtitle="Find the best card for any store or spending category." />
      <Panel title="Categories">
        <ul className="flex flex-wrap gap-2" data-testid="category-chips">
          {categories.data?.map((c) => (
            <li key={c.id}>
              <Link href={`/categories/${c.slug}`} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm hover:border-brand-300 hover:bg-brand-50">
                <span aria-hidden>{categoryEmoji(c.icon)}</span> {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Merchants">
        <Field label="Search merchants" htmlFor="merchant-search">
          <Input id="merchant-search" placeholder="e.g. FreshCart, shopnow.example" value={q} onChange={(e) => setQ(e.target.value)} />
        </Field>
        {merchants.isLoading && <Spinner />}
        <ErrorText error={merchants.error} />
        {merchants.data?.items.length === 0 && <EmptyState title="No merchants found" />}
        <ul className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="merchant-results">
          {merchants.data?.items.map((m) => (
            <li key={m.id}>
              <Link href={`/merchants/${m.slug}`} className="flex items-center gap-3 rounded-xl border border-slate-100 p-3 hover:border-brand-200 hover:bg-brand-50/40">
                <BrandLogo brand={{ slug: m.slug, name: m.name }} size="md" decorative />
                <div>
                  <p className="text-sm font-medium">{m.name}</p>
                  <p className="text-xs text-slate-500">{m.category.name}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
