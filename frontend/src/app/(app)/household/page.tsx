'use client';

import { useEffect, useState } from 'react';
import { StatTiles } from '@/components/charts';
import { WalletCardArt } from '@/components/card-bits';
import { Badge, Button, EmptyState, ErrorText, Field, Input, PageHeader, Panel, Select, Spinner } from '@/components/ui';
import { money } from '@/lib/format';
import { RELATIONSHIP_LABEL } from '@/lib/portfolio';
import type { HouseholdDashboard, Relationship } from '@/lib/portfolio-types';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';

const KEYS = [['household'], ['portfolio'], ['five24']] as const;

export default function HouseholdPage() {
  const q = useAuthedQuery<HouseholdDashboard>(['household', 'dashboard'], '/household/dashboard');
  if (q.isLoading) return <Spinner label="Loading household" />;
  if (q.error) return <ErrorText error={q.error} />;
  const d = q.data;
  if (!d) return null;
  return (
    <div className="space-y-6">
      <PageHeader title={d.household.name} subtitle="Everyone's cards in one place — separate portfolios, combined totals." action={<RenameHousehold name={d.household.name} />} />
      <StatTiles
        testId="household-totals"
        items={[
          ['Members', String(d.members.length)],
          ['Annual fees', money(d.totals.annualFeeCents)],
          ['Benefit value', money(d.totals.faceBenefitCents), `${money(d.totals.realizedBenefitCents)} used`],
          ['Effective value', money(d.totals.effectiveValueCents), 'benefits used + rewards − fees'],
        ]}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        {d.members.map((m) => (
          <Panel
            key={m.profile.id}
            title={
              <span className="flex items-center gap-2">
                {m.profile.nickname} <Badge>{RELATIONSHIP_LABEL[m.profile.relationship]}</Badge>
              </span>
            }
            action={m.five24 && <Badge tone={m.five24.underLimit ? 'green' : 'red'}>{m.five24.label}</Badge>}
            data-testid="household-member"
          >
            {m.cards.length === 0 ? (
              <EmptyState title="No cards yet" />
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {m.cards.map((c) => (
                  <li key={c.walletCardId} className="flex items-center gap-3 py-2">
                    <WalletCardArt walletCardId={c.walletCardId} name={c.name} color={c.card.color} size="md" />
                    <span className="min-w-0 flex-1 truncate">
                      {c.name}
                      {c.cardholder === 'AUTHORIZED_USER' && (
                        <>
                          {' '}
                          <Badge>AU</Badge>
                        </>
                      )}
                      {c.status === 'CLOSED' && (
                        <>
                          {' '}
                          <Badge tone="red">Closed</Badge>
                        </>
                      )}
                    </span>
                    <span className="tabular-nums text-slate-600">{money(c.annualFeeCents)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 border-t border-slate-100 pt-3 text-sm text-slate-600">
              Fees {money(m.totals.annualFeeCents)} · benefits {money(m.totals.faceBenefitCents)} · effective <strong>{money(m.totals.effectiveValueCents)}</strong>
            </p>
            {!m.profile.isPrimary && <MemberActions id={m.profile.id} nickname={m.profile.nickname} relationship={m.profile.relationship} />}
          </Panel>
        ))}
      </div>
      <AddMember />
    </div>
  );
}

function RenameHousehold({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  useEffect(() => setValue(name), [name]);
  const save = useApiMutation<void>(() => ({ path: '/household', method: 'PATCH', body: { name: value } }), KEYS);
  if (!editing)
    return (
      <Button variant="secondary" onClick={() => setEditing(true)}>
        Rename
      </Button>
    );
  return (
    <form
      className="flex items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined, { onSuccess: () => setEditing(false) });
      }}
    >
      <label htmlFor="hh-name" className="sr-only">
        Household name
      </label>
      <Input id="hh-name" value={value} maxLength={60} onChange={(e) => setValue(e.target.value)} />
      <Button type="submit" loading={save.isPending} disabled={!value.trim()}>
        Save
      </Button>
    </form>
  );
}

function MemberActions({ id, nickname, relationship }: { id: string; nickname: string; relationship: Relationship }) {
  const update = useApiMutation<Relationship>((r) => ({ path: `/household/members/${id}`, method: 'PATCH', body: { relationship: r } }), KEYS);
  const remove = useApiMutation<void>(() => ({ path: `/household/members/${id}`, method: 'DELETE' }), KEYS);
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div className="w-40">
        <label htmlFor={`rel-${id}`} className="sr-only">
          Relationship of {nickname}
        </label>
        <Select id={`rel-${id}`} value={relationship} onChange={(e) => update.mutate(e.target.value as Relationship)}>
          {(['SPOUSE', 'PARTNER', 'CHILD', 'PARENT', 'OTHER'] as Relationship[]).map((r) => (
            <option key={r} value={r}>
              {RELATIONSHIP_LABEL[r]}
            </option>
          ))}
        </Select>
      </div>
      <Button
        variant="ghost"
        onClick={() => {
          if (window.confirm(`Remove ${nickname}? Their cards move to you.`)) remove.mutate(undefined);
        }}
      >
        Remove
      </Button>
      <ErrorText error={update.error ?? remove.error} />
    </div>
  );
}

function AddMember() {
  const [nickname, setNickname] = useState('');
  const [relationship, setRelationship] = useState<Relationship>('SPOUSE');
  const add = useApiMutation<void>(() => ({ path: '/household/members', method: 'POST', body: { nickname, relationship } }), KEYS);
  return (
    <Panel title="Add a household member" data-testid="add-member">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, { onSuccess: () => setNickname('') });
        }}
      >
        <Field label="Name" htmlFor="m-name">
          <Input id="m-name" value={nickname} maxLength={40} onChange={(e) => setNickname(e.target.value)} />
        </Field>
        <Field label="Relationship" htmlFor="m-rel">
          <Select id="m-rel" value={relationship} onChange={(e) => setRelationship(e.target.value as Relationship)}>
            {(['SPOUSE', 'PARTNER', 'CHILD', 'PARENT', 'OTHER'] as Relationship[]).map((r) => (
              <option key={r} value={r}>
                {RELATIONSHIP_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={!nickname.trim()} loading={add.isPending}>
          Add member
        </Button>
      </form>
      <p className="mt-2 text-xs text-slate-500">Children can only hold authorized-user cards. Household members need the Pro plan.</p>
      <ErrorText error={add.error} />
    </Panel>
  );
}
