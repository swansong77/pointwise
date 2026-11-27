'use client';

import { useState } from 'react';
import { CashbackCard } from '@/components/cashback-card';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, Spinner } from '@/components/ui';
import { CashbackRec, CashbackSiteView, HEALTH_LABEL, HEALTH_TONE } from '@/lib/cashback';
import { shortDate } from '@/lib/format';
import type { Member } from '@/lib/portfolio-types';
import { useApi } from '@/lib/api';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

/** The household's cash-back and points shopping sites: which ones you use, whether each is answering, and which to use for a purchase. */
export default function CashbackPage() {
  const sites = useAuthedQuery<CashbackSiteView[]>(['cashback', 'sites'], '/cashback/sites');
  const household = useAuthedQuery<{ members: Member[] }>(['household', 'members', 'cashback'], '/household');
  const toggle = useApiMutation<{ site: string; profileId: string; has: boolean }>(({ site, profileId, has }) => ({ path: `/cashback/accounts/${site}`, method: 'PUT', body: { has, profileId } }), [['cashback']]);
  if (sites.isLoading) return <Spinner label="Loading cash-back sites" />;
  if (sites.error) return <ErrorText error={sites.error} />;
  const members = household.data?.members ?? [];
  const mine = (sites.data ?? []).filter((s) => s.accounts.length > 0).length;
  return (
    <div className="space-y-6">
      <PageHeader title="Cash-back sites" subtitle="Tick the sites you have an account on. The shopping plan then recommends only those, and tells you when a better one is worth joining." />
      <Panel title={`Your sites · ${mine} of ${sites.data?.length ?? 0}`} data-testid="cashback-sites">
        {sites.data?.length === 0 ? (
          <EmptyState title="No sites yet">The administrator adds cash-back sites under Admin.</EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sites.data?.map((s) => (
              <li key={s.code} className="flex flex-wrap items-center gap-3 py-3 text-sm" data-testid="cashback-site" data-site={s.code}>
                <span className="min-w-0 flex-1">
                  <a href={s.homeUrl} target="_blank" rel="noreferrer noopener" className="font-medium text-slate-900 underline-offset-2 hover:underline">
                    {s.name}
                  </a>{' '}
                  <Badge tone={s.kind === 'POINTS' ? 'brand' : 'slate'}>{s.kind === 'POINTS' ? 'Points' : 'Cash back'}</Badge>
                  <span className="block text-xs text-slate-600">
                    {s.rates} rate{s.rates === 1 ? '' : 's'} on file{s.ratesSeenAt ? `, newest ${shortDate(s.ratesSeenAt)}` : ''}
                    {s.notes ? ` · ${s.notes}` : ''}
                  </span>
                </span>
                <Badge tone={HEALTH_TONE[s.health]}>{HEALTH_LABEL[s.health]}</Badge>
                <span className="flex flex-wrap gap-3" role="group" aria-label={`Who has an account on ${s.name}`}>
                  {(members.length ? members : [{ id: '', nickname: 'Me' } as Member]).map((m) => {
                    const has = s.accounts.some((a) => (m.id ? a.profileId === m.id : true));
                    return (
                      <label key={m.id || 'me'} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={has}
                          aria-label={`${m.nickname} has an account on ${s.name}`}
                          onChange={(e) => toggle.mutate({ site: s.code, profileId: m.id, has: e.target.checked })}
                        />
                        {m.nickname}
                      </label>
                    );
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        <ErrorText error={toggle.error} />
        <p className="mt-3 text-xs text-slate-600">PointWise only records that you have an account. It never asks for or stores a username or password, and never signs in to these sites.</p>
      </Panel>
      <Lookup />
    </div>
  );
}

function Lookup() {
  const api = useApi();
  const [f, setF] = useState({ merchant: '', amount: '500' });
  const [rec, setRec] = useState<(CashbackRec & { merchant: { name: string } }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true);
    setError(null);
    try {
      setRec(await api<CashbackRec & { merchant: { name: string } }>(`/cashback/recommend?merchant=${encodeURIComponent(f.merchant)}&amount=${Math.round(Number(f.amount) * 100)}`));
    } catch (e) {
      setRec(null);
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Panel title="Which site for a purchase?" data-testid="cashback-lookup">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <Field label="Store" htmlFor="cb-merchant">
            <Input id="cb-merchant" value={f.merchant} onChange={(e) => setF({ ...f, merchant: e.target.value })} placeholder="Target, Hilton…" required />
          </Field>
          <Field label="Amount ($)" htmlFor="cb-amount">
            <Input id="cb-amount" type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} required />
          </Field>
          <Button type="submit" loading={busy}>
            Find the best site
          </Button>
        </form>
        <ErrorText error={error} />
      </Panel>
      {rec && <CashbackCard rec={rec} merchant={rec.merchant.name} />}
    </>
  );
}
