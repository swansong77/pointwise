'use client';

import Link from 'next/link';
import { useState } from 'react';
import { BarList, StatTiles, Tabs } from '@/components/charts';
import { CardArt } from '@/components/card-bits';
import { Badge, EmptyState, ErrorText, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { money } from '@/lib/format';
import { monthYear, percent, RELATIONSHIP_LABEL } from '@/lib/portfolio';
import type { Member, Portfolio, PortfolioCard } from '@/lib/portfolio-types';
import { useAuthedQuery } from '@/lib/queries';

type Group = 'active' | 'authorizedUser' | 'closed' | 'pending';

export default function PortfolioPage() {
  const [profileId, setProfileId] = useState('');
  const [group, setGroup] = useState<Group>('active');
  const members = useAuthedQuery<Member[]>(['household', 'members'], '/household/members');
  const q = useAuthedQuery<Portfolio>(['portfolio', profileId], `/portfolio${profileId ? `?profileId=${profileId}` : ''}`);
  const memberName = (id: string | null) => members.data?.find((m) => m.id === id)?.nickname ?? '—';

  if (q.isLoading) return <Spinner label="Loading portfolio" />;
  if (q.error) return <ErrorText error={q.error} />;
  const p = q.data;
  if (!p) return null;
  const cards = p.groups[group];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Card portfolio"
        subtitle="Every card in your household with its fees, benefits and rewards over the last 12 months."
        action={
          <div className="w-48">
            <label htmlFor="member-filter" className="sr-only">
              Cardholder
            </label>
            <Select id="member-filter" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
              <option value="">Whole household</option>
              {members.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nickname} ({RELATIONSHIP_LABEL[m.relationship]})
                </option>
              ))}
            </Select>
          </div>
        }
      />

      <StatTiles
        testId="portfolio-totals"
        items={[
          ['Annual fees', money(p.totals.annualFeeCents), `${p.counts.active + p.counts.authorizedUser} open cards`],
          ['Benefit value', money(p.totals.faceBenefitCents), `${money(p.totals.realizedBenefitCents)} used this year`],
          ['Net value', money(p.totals.netValueCents), 'benefits − fees'],
          ['Effective value', money(p.totals.effectiveValueCents), `rewards ${money(p.totals.rewardsCents)} · return ${percent(p.totals.returnOnSpend)}`],
        ]}
      />

      <Panel
        title="Cards"
        action={
          <Tabs<Group>
            label="Card group"
            value={group}
            onChange={setGroup}
            options={[
              ['active', `Active (${p.counts.active})`],
              ['authorizedUser', `Authorized user (${p.counts.authorizedUser})`],
              ['closed', `Closed (${p.counts.closed})`],
              ...(p.counts.pending ? ([['pending', `Applied (${p.counts.pending})`]] as Array<[Group, string]>) : []),
            ]}
          />
        }
        data-testid="portfolio-cards"
      >
        {cards.length === 0 ? (
          <EmptyState title="No cards here">
            <Link href="/wallet" className="text-brand-700 underline">
              Add cards
            </Link>{' '}
            or{' '}
            <Link href="/import" className="text-brand-700 underline">
              import a spreadsheet
            </Link>
            .
          </EmptyState>
        ) : (
          <div className="-mx-5 overflow-x-auto" tabIndex={0} role="region" aria-label="Cards table (scrolls horizontally)">
            <table className="w-full min-w-[760px] text-sm">
              <caption className="sr-only">Cards and their annual value</caption>
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th scope="col" className="px-5 py-2 font-medium">Card</th>
                  <th scope="col" className="px-2 py-2 font-medium">Holder</th>
                  <th scope="col" className="px-2 py-2 font-medium">Opened</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Fee</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Benefits</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Rewards</th>
                  <th scope="col" className="px-2 py-2 text-right font-medium">Effective</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Break-even spend</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cards.map((c) => (
                  <CardRow key={c.walletCardId} c={c} holder={memberName(c.profileId)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Effective value by card" data-testid="value-by-card">
          <BarList
            format={(v) => money(v)}
            items={[...p.groups.active, ...p.groups.authorizedUser]
              .sort((a, b) => b.effectiveValueCents - a.effectiveValueCents)
              .map((c) => ({ label: c.name, value: c.effectiveValueCents, hint: `${money(c.realizedBenefitCents)} benefits + ${money(c.rewardsCents)} rewards − ${money(c.annualFeeCents)} fee` }))}
          />
        </Panel>
        <Panel title="By cardholder" data-testid="value-by-holder">
          <BarList
            format={(v) => money(v)}
            items={p.byHolder.map((h) => ({
              label: `${h.profile?.nickname ?? 'Unassigned'} · ${h.cards} card${h.cards === 1 ? '' : 's'}`,
              value: h.effectiveValueCents,
              hint: `fees ${money(h.annualFeeCents)} · benefits ${money(h.faceBenefitCents)} · return on spend ${percent(h.returnOnSpend)}`,
            }))}
          />
        </Panel>
      </div>
    </div>
  );
}

function CardRow({ c, holder }: { c: PortfolioCard; holder: string }) {
  return (
    <tr data-testid="portfolio-row">
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <CardArt name={c.card.name} color={c.card.color} issuer={c.card.issuer} network={c.card.network} />
          <div className="min-w-0">
            <p className="truncate font-medium text-slate-900">
              {c.name} {c.lastFour && <span className="text-xs font-normal text-slate-500">•••• {c.lastFour}</span>}
            </p>
            <p className="text-xs text-slate-500">
              {c.card.issuer}
              {c.card.type === 'BUSINESS' && ' · Business'}
              {c.source !== 'MANUAL' && ` · from ${c.source.toLowerCase().replace('_', ' ')}`}
            </p>
          </div>
        </div>
      </td>
      <td className="px-2 py-3">
        {holder} {c.cardholder === 'AUTHORIZED_USER' && <Badge>AU</Badge>}
      </td>
      <td className="px-2 py-3 text-slate-600">{c.openedAt ? monthYear(c.openedAt) : <Badge tone="amber">Unknown</Badge>}</td>
      <td className="px-2 py-3 text-right tabular-nums">{money(c.annualFeeCents)}</td>
      <td className="px-2 py-3 text-right tabular-nums">
        {money(c.realizedBenefitCents)}
        <span className="text-xs text-slate-500"> / {money(c.faceBenefitCents)}</span>
      </td>
      <td className="px-2 py-3 text-right tabular-nums">{money(c.rewardsCents)}</td>
      <td className={`px-2 py-3 text-right font-semibold tabular-nums ${c.effectiveValueCents < 0 ? 'text-red-700' : 'text-emerald-700'}`}>{money(c.effectiveValueCents)}</td>
      <td className="px-5 py-3 text-right tabular-nums text-slate-600">
        {c.annualFeeCents === 0 ? '—' : c.breakEvenSpendCents === 0 ? <Badge tone="green">Covered</Badge> : c.breakEvenSpendCents == null ? <span title="Earns no more than a 1.5% card">n/a</span> : money(c.breakEvenSpendCents)}
      </td>
    </tr>
  );
}
