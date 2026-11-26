'use client';

import { WalletCardArt } from '@/components/card-bits';
import { BrandLogo } from '@/components/brand-logo';
import { useState } from 'react';
import { Five24Gauge, Five24TimelineChart } from '@/components/charts';
import { Badge, Button, ErrorText, Field, Input, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { shortDate } from '@/lib/format';
import { FIVE24_REASON, monthYear, RELATIONSHIP_LABEL } from '@/lib/portfolio';
import type { Five24Response, Member } from '@/lib/portfolio-types';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

interface ReportAccount {
  id: string;
  bureau: string;
  creditorName: string;
  lastDigits: string | null;
  openedOn: string;
  isAuthorizedUser: boolean;
  status: string;
  walletCard: { id: string; nickname: string | null; approvedAt: string | null; card: { name: string } } | null;
  profile: { id: string; nickname: string } | null;
}

export default function Five24Page() {
  const q = useAuthedQuery<Five24Response>(['five24'], '/five24');
  if (q.isLoading) return <Spinner label="Calculating 5/24" />;
  if (q.error) return <ErrorText error={q.error} />;
  if (!q.data) return null;
  return (
    <div className="space-y-6">
      <PageHeader
        title="5/24 status"
        subtitle="Personal credit-card accounts opened in the last 24 months, per person. Many issuers deny new cards at 5 or more."
      />
      {q.data.members.map((m) => (
        <MemberPanel key={m.profile.id} m={m} />
      ))}
      <CreditReportPanel />
      <p className="text-xs text-slate-500">
        How it&apos;s counted: personal cards from any issuer (open or closed) and authorized-user cards count; business cards count only from issuers that report them to personal
        credit bureaus. A card stops counting 24 months after it was opened — when only the month is known, on the 1st of the 25th month. You can exclude a card on the wallet page
        (for example an authorized-user card removed on reconsideration).
      </p>
    </div>
  );
}

function MemberPanel({ m }: { m: Five24Response['members'][number] }) {
  const s = m.status;
  return (
    <Panel
      title={`${m.profile.nickname} · ${RELATIONSHIP_LABEL[m.profile.relationship]}`}
      action={s.underLimit ? <Badge tone="green">Under 5/24</Badge> : <Badge tone="red">At or over 5/24</Badge>}
      data-testid="five24-member"
    >
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <div className="space-y-2">
          <Five24Gauge count={s.count} label={s.label} limit={s.limit} />
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Next drop</dt>
              <dd>{s.nextDropAt ? shortDate(s.nextDropAt) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-slate-500">Under 5/24 on</dt>
              <dd data-testid="next-slot">{s.underLimit ? 'Now' : s.nextSlotAt ? shortDate(s.nextSlotAt) : '—'}</dd>
            </div>
          </dl>
          {s.unknown.length > 0 && (
            <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800" role="note">
              {s.unknown.length} card{s.unknown.length === 1 ? ' has' : 's have'} no open date, so the count may be low. Add the date on the wallet page or from your credit report below.
            </p>
          )}
        </div>
        <div className="min-w-0 space-y-4">
          <Five24TimelineChart points={m.timeline} title={`${m.profile.nickname}'s projected 5/24 count`} />
          {s.contributing.length > 0 && (
            <table className="w-full text-sm">
              <caption className="mb-1 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Counting toward 5/24</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">Card</th>
                  <th scope="col">Why</th>
                  <th scope="col">Opened</th>
                  <th scope="col">Counts until</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {s.contributing.map((c) => (
                  <tr key={c.cardId}>
                    <td className="py-2 pr-2 font-medium"><span className="inline-flex items-center gap-2"><WalletCardArt cardId={c.cardId} name={c.name} size="sm" />{c.name}</span></td>
                    <td className="py-2 pr-2 text-xs text-slate-500">{FIVE24_REASON[c.reason] ?? c.reason}</td>
                    <td className="py-2 pr-2 text-slate-600">{monthYear(c.openedAt)}</td>
                    <td className="py-2 text-right text-slate-600">{shortDate(c.dropsOffAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.excluded.length + s.unknown.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-slate-600">Not counted ({s.excluded.length + s.unknown.length})</summary>
              <ul className="mt-2 space-y-1">
                {[...s.unknown, ...s.excluded].map((c) => (
                  <li key={c.cardId} className="flex justify-between gap-3">
                    <span className="inline-flex items-center gap-2"><WalletCardArt cardId={c.cardId} name={c.name} size="sm" />{c.name}</span>
                    <span className="text-xs text-slate-500">
                      {FIVE24_REASON[c.reason] ?? c.reason}
                      {c.note ? ` — ${c.note}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </Panel>
  );
}

function CreditReportPanel() {
  const members = useAuthedQuery<Member[]>(['household', 'members'], '/household/members');
  const accounts = useAuthedQuery<ReportAccount[]>(['credit-reports'], '/credit-reports/accounts');
  const [creditorName, setCreditor] = useState('');
  const [lastDigits, setDigits] = useState('');
  const [opened, setOpened] = useState('');
  const [profileId, setProfileId] = useState('');
  const [isAU, setAU] = useState(false);
  const digitsError = lastDigits && !/^\d{4,5}$/.test(lastDigits) ? 'Last 4 or 5 digits only' : undefined;
  const add = useApiMutation<void>(
    () => ({
      path: '/credit-reports/accounts',
      method: 'POST',
      body: { creditorName, lastDigits: lastDigits || undefined, openedOn: `${opened}-01`, profileId: profileId || undefined, isAuthorizedUser: isAU },
    }),
    [['credit-reports']],
  );
  const apply = useApiMutation<string>((id) => ({ path: `/credit-reports/accounts/${id}/apply`, method: 'POST' }), [['credit-reports'], ['five24'], ['portfolio'], ['wallet']]);
  const remove = useApiMutation<string>((id) => ({ path: `/credit-reports/accounts/${id}`, method: 'DELETE' }), [['credit-reports']]);
  return (
    <Panel title="Open dates from your credit report" data-testid="credit-report">
      <p className="mb-4 text-sm text-slate-600">
        Banks don&apos;t share account open dates. Copy them from your free credit report (annualcreditreport.com) — Pointwise matches each account to your cards by last digits.
      </p>
      <form
        className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 lg:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, { onSuccess: () => (setCreditor(''), setDigits(''), setOpened('')) });
        }}
      >
        <Field label="Creditor" htmlFor="cr-name">
          <Input id="cr-name" value={creditorName} maxLength={80} onChange={(e) => setCreditor(e.target.value)} required />
        </Field>
        <Field label="Last digits" htmlFor="cr-digits" error={digitsError}>
          <Input id="cr-digits" inputMode="numeric" maxLength={5} value={lastDigits} onChange={(e) => setDigits(e.target.value)} />
        </Field>
        <Field label="Opened (month)" htmlFor="cr-opened">
          <Input id="cr-opened" type="month" value={opened} onChange={(e) => setOpened(e.target.value)} required />
        </Field>
        <Field label="Cardholder" htmlFor="cr-member">
          <Select id="cr-member" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">Me</option>
            {members.data?.filter((m) => !m.isPrimary).map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={isAU} onChange={(e) => setAU(e.target.checked)} /> Authorized user
        </label>
        <Button type="submit" disabled={!creditorName || !opened || !!digitsError} loading={add.isPending}>
          Add account
        </Button>
      </form>
      <ErrorText error={add.error ?? apply.error} />
      {!!accounts.data?.length && (
        <ul className="mt-4 divide-y divide-slate-100 text-sm">
          {accounts.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <span>
                <BrandLogo brand={{ name: a.creditorName }} kinds={['ISSUER']} size="sm" decorative hideUnknown /> <span className="font-medium">{a.creditorName}</span> {a.lastDigits && <span className="text-slate-500">•••• {a.lastDigits}</span>} · opened {monthYear(a.openedOn)}
                {a.isAuthorizedUser && ' · AU'}
              </span>
              <span className="flex items-center gap-2">
                {a.walletCard ? <Badge tone="green">Matched: {a.walletCard.nickname || a.walletCard.card.name}</Badge> : <Badge tone="amber">No matching card</Badge>}
                {a.walletCard && (
                  <Button variant="secondary" onClick={() => apply.mutate(a.id)} loading={apply.isPending && apply.variables === a.id}>
                    Use this date
                  </Button>
                )}
                <Button variant="ghost" onClick={() => remove.mutate(a.id)} aria-label={`Remove ${a.creditorName}`}>
                  ✕
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
