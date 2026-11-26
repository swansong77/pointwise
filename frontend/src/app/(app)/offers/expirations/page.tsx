'use client';

import Link from 'next/link';
import { useState } from 'react';
import { StatTiles, Tabs } from '@/components/charts';
import { BrandLogo } from '@/components/brand-logo';
import { Badge, EmptyState, ErrorText, PageHeader, Panel, Spinner } from '@/components/ui';
import { daysLeftLabel, money, shortDate } from '@/lib/format';
import { ExpirationSummary, ExpiringKind, ExpiringRow, KIND_LABEL } from '@/lib/offer-dashboards';
import { useAuthedQuery } from '@/lib/queries';

type Filter = 'ALL' | ExpiringKind;

function Row({ r }: { r: ExpiringRow }) {
  const urgent = r.daysLeft <= 7;
  return (
    <li className="flex flex-wrap items-center gap-3 py-3 text-sm" data-testid="expiring-item" data-kind={r.kind}>
      {r.merchant ? <BrandLogo brand={{ name: r.merchant }} size="md" decorative /> : null}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900">
          {r.label} <Badge tone={r.kind === 'OFFER' ? 'brand' : r.kind === 'CREDIT' ? 'amber' : 'green'}>{KIND_LABEL[r.kind]}</Badge>
        </p>
        <p className="text-xs text-slate-600">
          {r.cardholder ? <strong className="font-medium text-slate-800">{r.cardholder}</strong> : null}
          {r.card ? (
            <>
              {r.cardholder ? ' · ' : ''}
              {r.walletCardId ? (
                <Link href={`/wallet/${r.walletCardId}`} className="text-brand-700 underline">
                  {r.card}
                </Link>
              ) : (
                r.card
              )}
            </>
          ) : null}
        </p>
        <p className="text-xs text-slate-700">{r.action}</p>
      </div>
      <div className="text-right text-xs">
        <p className={urgent ? 'font-semibold text-red-700' : 'text-slate-700'}>
          {shortDate(r.endsAt)} · {daysLeftLabel(r.daysLeft)}
        </p>
        <p>
          <span className="text-slate-600">Lost if missed </span>
          <strong className="text-slate-900">{money(r.valueCents)}</strong>
        </p>
      </div>
    </li>
  );
}

export default function ExpirationsPage() {
  const q = useAuthedQuery<ExpirationSummary>(['offers', 'expirations'], '/offers/intel/expirations');
  const [kind, setKind] = useState<Filter>('ALL');
  if (q.isLoading) return <Spinner label="Loading expirations" />;
  if (q.error) return <ErrorText error={q.error} />;
  const d = q.data;
  if (!d) return null;
  const buckets = d.buckets.map((b) => {
    const items = b.items.filter((i) => kind === 'ALL' || i.kind === kind);
    return { ...b, items, totalCents: items.reduce((s, i) => s + i.valueCents, 0) };
  });
  const shown = buckets.reduce((s, b) => s + b.items.length, 0);
  return (
    <div className="space-y-6" data-testid="expirations">
      <PageHeader title="Offer expirations" subtitle="Offers, credits and certificates that lapse in the next 60 days, and what you lose if you miss them." />
      <StatTiles
        testId="expiration-totals"
        items={[
          ['Expiring in 60 days', String(d.count), `${d.byKind.OFFER.count} offers · ${d.byKind.CREDIT.count} credits · ${d.byKind.CERTIFICATE.count} certificates`],
          ['At risk', money(d.totalCents)],
          ['This week', money(d.urgentCents), d.urgentCents > 0 ? 'act now' : 'nothing urgent'],
          ['Next deadline', d.nextDeadline ? shortDate(d.nextDeadline.endsAt) : '—', d.nextDeadline?.label],
        ]}
      />
      <Tabs<Filter>
        label="What expires"
        value={kind}
        onChange={setKind}
        options={[
          ['ALL', `All (${d.count})`],
          ['OFFER', `Offers (${d.byKind.OFFER.count})`],
          ['CREDIT', `Credits (${d.byKind.CREDIT.count})`],
          ['CERTIFICATE', `Certificates (${d.byKind.CERTIFICATE.count})`],
        ]}
      />
      {shown === 0 && <EmptyState title="Nothing is about to expire">New offers appear on the Offers page, and credits on the Benefits page.</EmptyState>}
      {buckets
        .filter((b) => b.items.length > 0)
        .map((b) => (
          <Panel
            key={b.key}
            title={
              <span className="flex items-center gap-2">
                {b.label} <Badge tone={b.key === 'WEEK' ? 'red' : 'slate'}>{b.items.length}</Badge>
              </span>
            }
            action={<span className="text-sm text-slate-700">{money(b.totalCents)} at risk</span>}
            data-testid={`bucket-${b.key}`}
          >
            <ul className="divide-y divide-slate-100">
              {b.items.map((r) => (
                <Row key={`${r.kind}-${r.id}`} r={r} />
              ))}
            </ul>
          </Panel>
        ))}
      <p className="text-xs text-slate-600">
        Plan a purchase before something expires on{' '}
        <Link href="/offers/plan" className="text-brand-700 underline">
          Plan a purchase
        </Link>
        .
      </p>
    </div>
  );
}
