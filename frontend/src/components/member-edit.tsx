'use client';

import { useState } from 'react';
import { Button, ErrorText, Field, Input, Panel, Select } from '@/components/ui';
import { money } from '@/lib/format';
import type { Registry } from '@/lib/loyalty';
import type { MemberBenefit, MemberCard, MemberLoyalty } from '@/lib/member';
import { useApiMutation, useAuthedQuery, useCardSearch } from '@/lib/queries';

/**
 * Editing controls for a household member's OWN data. They are shown only when the household owner has allowed it; every request goes to
 * /member/*, where the server pins it to the member's own profile, so these controls cannot reach anyone else's cards or points.
 */
const KEYS = [['member', 'overview'], ['member', 'me']] as const;

export function MemberAddCard() {
  const [q, setQ] = useState('');
  const [cardId, setCardId] = useState('');
  const [f, setF] = useState({ lastFour: '', approvedAt: '', nickname: '' });
  const results = useCardSearch(q);
  const add = useApiMutation<void>(
    () => ({ path: '/member/cards', method: 'POST', body: { cardId, ...(f.lastFour ? { lastFour: f.lastFour } : {}), ...(f.approvedAt ? { approvedAt: f.approvedAt } : {}), ...(f.nickname ? { nickname: f.nickname } : {}) } }),
    KEYS,
  );
  const cards = results.data?.items ?? [];
  return (
    <Panel title="Add a card" data-testid="member-add-card">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, { onSuccess: () => { setCardId(''); setF({ lastFour: '', approvedAt: '', nickname: '' }); } });
        }}
      >
        <Field label="Find the card" htmlFor="mc-q" hint="Type part of its name or the bank">
          <Input id="mc-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Gold, Sapphire, Venture…" />
        </Field>
        <Field label="Card" htmlFor="mc-card">
          <Select id="mc-card" value={cardId} onChange={(e) => setCardId(e.target.value)} required>
            <option value="">Choose a card…</option>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.issuer.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Last 4 digits (optional)" htmlFor="mc-last" hint="Lets statements and alerts find this card. Never the full number.">
          <Input id="mc-last" inputMode="numeric" pattern="\d{4,5}" maxLength={5} value={f.lastFour} onChange={(e) => setF({ ...f, lastFour: e.target.value })} />
        </Field>
        <Field label="Opened on (optional)" htmlFor="mc-open">
          <Input id="mc-open" type="date" value={f.approvedAt} onChange={(e) => setF({ ...f, approvedAt: e.target.value })} />
        </Field>
        <Field label="Nickname (optional)" htmlFor="mc-nick">
          <Input id="mc-nick" value={f.nickname} maxLength={60} onChange={(e) => setF({ ...f, nickname: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" loading={add.isPending} disabled={!cardId} data-testid="member-add-card-submit">
            Add this card
          </Button>
        </div>
      </form>
      <ErrorText error={add.error} />
    </Panel>
  );
}

export function MemberCardActions({ card }: { card: MemberCard }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ nickname: card.name === card.card.name ? '' : card.name, lastFour: card.lastFour ?? '' });
  const save = useApiMutation<void>(() => ({ path: `/member/cards/${card.walletCardId}`, method: 'PATCH', body: { nickname: f.nickname || undefined, ...(f.lastFour ? { lastFour: f.lastFour } : {}) } }), KEYS);
  const remove = useApiMutation<void>(() => ({ path: `/member/cards/${card.walletCardId}`, method: 'DELETE' }), KEYS);
  if (!editing) {
    return (
      <span className="flex gap-2">
        <Button variant="ghost" onClick={() => setEditing(true)} aria-label={`Edit ${card.name}`} data-testid="member-card-edit">
          Edit
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            if (window.confirm(`Remove ${card.name} from your cards?`)) remove.mutate(undefined);
          }}
          aria-label={`Remove ${card.name}`}
          data-testid="member-card-remove"
        >
          Remove
        </Button>
        <ErrorText error={remove.error} />
      </span>
    );
  }
  return (
    <form
      className="flex w-full flex-wrap items-end gap-2 pt-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined, { onSuccess: () => setEditing(false) });
      }}
    >
      <Field label="Nickname" htmlFor={`cn-${card.walletCardId}`}>
        <Input id={`cn-${card.walletCardId}`} value={f.nickname} maxLength={60} onChange={(e) => setF({ ...f, nickname: e.target.value })} />
      </Field>
      <Field label="Last 4 digits" htmlFor={`cl-${card.walletCardId}`}>
        <Input id={`cl-${card.walletCardId}`} inputMode="numeric" pattern="\d{4,5}" maxLength={5} value={f.lastFour} onChange={(e) => setF({ ...f, lastFour: e.target.value })} />
      </Field>
      <Button type="submit" loading={save.isPending}>
        Save
      </Button>
      <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      <ErrorText error={save.error} />
    </form>
  );
}

export function MemberAddAccount() {
  const reg = useAuthedQuery<Registry>(['member', 'programs'], '/member/loyalty/programs');
  const [f, setF] = useState({ program: '', accountNumber: '', balance: '' });
  const add = useApiMutation<void>(() => {
    const [kind, code] = f.program.split(':');
    return {
      path: '/member/loyalty/accounts',
      method: 'POST',
      body: { ...(kind === 'program' ? { programCode: code } : { currencyCode: code }), ...(f.accountNumber ? { accountNumber: f.accountNumber } : {}), ...(f.balance ? { balance: Number(f.balance) } : {}) },
    };
  }, KEYS);
  return (
    <Panel title="Add a points or miles account" data-testid="member-add-account">
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate(undefined, { onSuccess: () => setF({ program: '', accountNumber: '', balance: '' }) });
        }}
      >
        <Field label="Program" htmlFor="ma-program">
          <Select id="ma-program" value={f.program} onChange={(e) => setF({ ...f, program: e.target.value })} required>
            <option value="">Choose a program…</option>
            {(reg.data?.programs ?? []).map((p) => (
              <option key={p.code} value={`program:${p.code}`}>
                {p.name}
              </option>
            ))}
            {(reg.data?.currencies ?? []).map((c) => (
              <option key={c.code} value={`currency:${c.code}`}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Current balance" htmlFor="ma-balance">
          <Input id="ma-balance" type="number" min={0} value={f.balance} onChange={(e) => setF({ ...f, balance: e.target.value })} />
        </Field>
        <Field label="Member number (optional)" htmlFor="ma-number" hint="Stored encrypted; only the last 4 are shown.">
          <Input id="ma-number" autoComplete="off" value={f.accountNumber} onChange={(e) => setF({ ...f, accountNumber: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" loading={add.isPending} disabled={!f.program} data-testid="member-add-account-submit">
            Add this account
          </Button>
        </div>
      </form>
      <ErrorText error={add.error} />
    </Panel>
  );
}

export function MemberAccountActions({ account }: { account: MemberLoyalty }) {
  const [editing, setEditing] = useState(false);
  const [balance, setBalance] = useState(String(account.balance));
  const save = useApiMutation<void>(() => ({ path: `/member/loyalty/accounts/${account.id}`, method: 'PATCH', body: { balance: Number(balance) } }), KEYS);
  const remove = useApiMutation<void>(() => ({ path: `/member/loyalty/accounts/${account.id}`, method: 'DELETE' }), KEYS);
  if (!editing) {
    return (
      <span className="flex gap-2">
        <Button variant="ghost" onClick={() => setEditing(true)} aria-label={`Update ${account.nickname || account.name}`} data-testid="member-account-edit">
          Update
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            if (window.confirm(`Remove ${account.nickname || account.name}?`)) remove.mutate(undefined);
          }}
          aria-label={`Remove ${account.nickname || account.name}`}
        >
          Remove
        </Button>
        <ErrorText error={remove.error} />
      </span>
    );
  }
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined, { onSuccess: () => setEditing(false) });
      }}
    >
      <Field label="Balance" htmlFor={`ab-${account.id}`}>
        <Input id={`ab-${account.id}`} type="number" min={0} value={balance} onChange={(e) => setBalance(e.target.value)} />
      </Field>
      <Button type="submit" loading={save.isPending} data-testid="member-account-save">
        Save
      </Button>
      <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      <ErrorText error={save.error} />
    </form>
  );
}

/** Marks a credit as used: the amount left by default, in dollars. */
export function MemberUseCredit({ benefit }: { benefit: MemberBenefit }) {
  const left = benefit.currentPeriod.remainingCents;
  const use = useApiMutation<void>(() => ({ path: `/member/benefits/${benefit.id}/usage`, method: 'POST', body: { amountCents: left } }), KEYS);
  if (left <= 0) return null;
  return (
    <span>
      <Button variant="ghost" onClick={() => use.mutate(undefined)} loading={use.isPending} aria-label={`Mark ${benefit.name} used (${money(left)})`} data-testid="member-use-credit">
        Mark used
      </Button>
      <ErrorText error={use.error} />
    </span>
  );
}
