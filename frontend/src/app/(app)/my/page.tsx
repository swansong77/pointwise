'use client';

import Link from 'next/link';
import { StatTiles } from '@/components/charts';
import { Badge, EmptyState, ErrorText, PageHeader, Panel, Spinner } from '@/components/ui';
import { daysLeftLabel, money, shortDate } from '@/lib/format';
import type { MemberMe, MemberOverview } from '@/lib/member';
import { MemberAccountActions, MemberAddAccount, MemberAddCard, MemberCardActions, MemberCashbackSites, MemberUseCredit } from '@/components/member-edit';
import { useAuthedQuery } from '@/lib/queries';

const STATUS_TONE: Record<string, 'green' | 'amber' | 'red' | 'slate' | 'brand'> = {
  COMPLETED: 'green',
  PARTIAL: 'brand',
  UNUSED: 'slate',
  EXPIRING_SOON: 'amber',
  EXPIRED: 'red',
};
const STATUS_LABEL: Record<string, string> = { COMPLETED: 'Used', PARTIAL: 'Part used', UNUSED: 'Not used', EXPIRING_SOON: 'Expiring soon', EXPIRED: 'Missed' };

/** What a household member sees with their own sign-in: their cards, credits, points and recent spending. Read only. */
export default function MyViewPage() {
  const me = useAuthedQuery<MemberMe>(['member', 'me'], '/member/me');
  const ov = useAuthedQuery<MemberOverview>(['member', 'overview'], '/member/overview');
  if (me.isLoading || ov.isLoading) return <Spinner label="Loading your view" />;
  if (me.error || ov.error) return <ErrorText error={me.error ?? ov.error} />;
  if (!me.data || !ov.data) return null;
  const d = ov.data;
  const cards = [...d.cards.groups.active, ...d.cards.groups.authorizedUser];
  const canEdit = me.data.canEdit;
  return (
    <div className="space-y-6">
      <PageHeader title={`Hi, ${me.data.nickname}`} subtitle={`Your cards and points in ${me.data.household}. The household owner keeps the details up to date.`} />
      <StatTiles
        testId="my-totals"
        items={[
          ['Cards', String(d.cards.counts.active + d.cards.counts.authorizedUser)],
          ['Annual fees', money(d.cards.totals.annualFeeCents)],
          ['Credits available', money(d.cards.totals.faceBenefitCents), `${money(d.cards.totals.realizedBenefitCents)} used`],
          ['Points and miles', d.loyalty.reduce((a, l) => a + l.balance, 0).toLocaleString('en-US')],
        ]}
      />
      <p className="text-sm">
        <Link href="/my/mail" className="font-medium text-brand-700 hover:underline" data-testid="my-mail-link">
          Set up your mail and alerts
        </Link>{' '}
        <span className="text-slate-500">so your transactions and points update by themselves.</span>
      </p>
      {me.data.visibility === 'HOUSEHOLD' && (
        <p className="text-sm">
          <Link href="/my/household" className="font-medium text-brand-700 hover:underline">
            See the household overview
          </Link>
        </p>
      )}

      <Panel title="My cards" data-testid="my-cards">
        {cards.length === 0 ? (
          <EmptyState title="No cards yet">Cards appear here once the household owner adds them to your profile.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {cards.map((c) => (
              <li key={c.walletCardId} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {c.name}
                  {c.lastFour && <span className="text-slate-500"> ··{c.lastFour}</span>}
                  {c.cardholder === 'AUTHORIZED_USER' && (
                    <>
                      {' '}
                      <Badge>AU</Badge>
                    </>
                  )}
                </span>
                <span className="tabular-nums text-slate-600">{money(c.annualFeeCents)} / yr</span>
                {canEdit && <MemberCardActions card={c} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="My credits and benefits" data-testid="my-benefits">
        {d.benefits.length === 0 ? (
          <EmptyState title="No tracked benefits" />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {d.benefits.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-slate-900">{b.name}</span>
                  <span className="block text-xs text-slate-500">
                    {b.walletCard.name} · {money(b.currentPeriod.usedCents)} of {money(b.currentPeriod.allocatedCents)} used · {daysLeftLabel(b.currentPeriod.daysLeft)}
                  </span>
                </span>
                <Badge tone={STATUS_TONE[b.currentPeriod.status] ?? 'slate'}>{STATUS_LABEL[b.currentPeriod.status] ?? b.currentPeriod.status}</Badge>
                {canEdit && <MemberUseCredit benefit={b} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="My points and miles" data-testid="my-loyalty">
        {d.loyalty.length === 0 ? (
          <EmptyState title="No loyalty accounts yet" />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {d.loyalty.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center gap-3 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-slate-900">{l.nickname || l.name}</span>
                  {l.accountLast4 && <span className="text-slate-500"> ··{l.accountLast4}</span>}
                  <span className="block text-xs text-slate-500">
                    {l.statusLevel ? `${l.statusLevel} · ` : ''}
                    {l.expiresAt ? `expires ${shortDate(l.expiresAt)}` : 'no expiry date known'}
                  </span>
                </span>
                <span className="tabular-nums font-medium">{l.balance.toLocaleString('en-US')}</span>
                {canEdit && <MemberAccountActions account={l} />}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canEdit && (
        <>
          <MemberAddCard />
          <MemberAddAccount />
        </>
      )}

      <MemberCashbackSites canEdit={canEdit} />

      <Panel title="Recent spending on my cards" data-testid="my-transactions">
        {d.transactions.length === 0 ? (
          <EmptyState title="No transactions yet" />
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {d.transactions.map((t) => (
              <li key={t.id} className="flex items-center gap-3 py-2">
                <span className="w-24 shrink-0 text-slate-500">{shortDate(t.occurredAt)}</span>
                <span className="min-w-0 flex-1 truncate">
                  {t.description || 'Transaction'}
                  <span className="text-slate-500"> · {t.card}</span>
                </span>
                <span className="tabular-nums">{t.kind === 'PURCHASE' || t.kind === 'FEE' ? '' : '+'}{money(t.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <p className="text-xs text-slate-500">Signed in as {me.data.email}. You can see your own cards, points and spending{me.data.visibility === 'HOUSEHOLD' ? ', and the household overview' : ''}.</p>
    </div>
  );
}
