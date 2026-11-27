'use client';

import { useState } from 'react';
import { Badge, Button, ErrorText, Panel, Select, Spinner } from '@/components/ui';
import { WalletCardArt } from '@/components/card-bits';
import { BrandLogo } from '@/components/brand-logo';
import { useApiMutation, useAuthedQuery } from '@/lib/queries';
import { money, shortDate } from '@/lib/format';
import { CaptureStatus, INBOUND_STATUS_LABEL, VIA_LABEL, viaTone } from '@/lib/spend';

/**
 * How each card's transactions arrive, the private forwarding address and the "Which card?" list. Used on the owner's Spending page
 * and on a member's own page: the server pins it to the signed-in person's cards, so a member only ever sees theirs.
 */
export function AutoCapture({ member = false }: { member?: boolean }) {
  const q = useAuthedQuery<CaptureStatus>(['capture'], '/capture/status', { refetchInterval: 30_000 });
  const keys = [['capture'], ['spending'], ['benefits'], ['wallet']] as const;
  const assign = useApiMutation<{ id: string; walletCardId: string; remember: boolean }>(
    ({ id, walletCardId, remember }) => ({ path: `/capture/items/${id}/assign`, method: 'POST', body: { walletCardId, remember } }),
    keys,
  );
  const discard = useApiMutation<string>((id) => ({ path: `/capture/items/${id}`, method: 'DELETE' }), keys);
  const toggle = useApiMutation<boolean>((enabled) => ({ path: '/capture/inbox', method: 'PATCH', body: { enabled } }), keys);
  const rotate = useApiMutation<void>(() => ({ path: '/capture/inbox/rotate', method: 'POST' }), keys);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState('');
  const copy = (text: string, what: string) =>
    void navigator.clipboard?.writeText(text).then(
      () => setCopied(what),
      () => setCopied(''),
    );
  if (!q.data) return q.isLoading ? <Spinner /> : <ErrorText error={q.error} />;
  const s = q.data;
  const pending = s.cards.filter((c) => !c.automatic);
  return (
    <Panel title={`Automatic import · ${s.automated} of ${s.cards.length} cards automated`} data-testid="auto-capture">
      <p className="mb-3 text-sm text-slate-600">
        Set each card up once and its transactions arrive by themselves:{' '}
        {!member && (
          <>
            through a{' '}
            <a className="text-brand-700 underline" href="/import">
              bank connection
            </a>
            , or{' '}
          </>
        )}
        by forwarding the issuer&apos;s transaction alert emails to your private PointWise address. PointWise never asks for bank passwords and never sends your transactions
        to an AI service.
      </p>
      <ul className="divide-y divide-slate-100 text-sm" aria-label="Cards and how they are imported">
        {s.cards.map((c) => (
          <li key={c.walletCardId} className="flex flex-wrap items-center gap-3 py-2" data-testid="capture-card">
            <WalletCardArt walletCardId={c.walletCardId} name={c.name} color={c.color} />
            <span className="min-w-0 flex-1">
              <span className="font-medium">{c.name}</span>
              {c.lastFour && <span className="text-slate-500"> ··{c.lastFour}</span>}
              <span className="block text-xs text-slate-500">
                {c.lastTransactionAt ? `last transaction ${shortDate(c.lastTransactionAt)}` : 'no transactions yet'}
                {c.statements?.through && ` · statements through ${shortDate(c.statements.through)}`}
                {c.hint && ` · ${c.hint}`}
              </span>
            </span>
            {c.statementDue && <Badge tone="amber">Statement due</Badge>}
            <Badge tone={viaTone(c.via, c.bank?.needsReauth)}>{c.bank?.needsReauth ? 'Bank sign-in needed' : VIA_LABEL[c.via]}</Badge>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-lg border border-slate-200 p-4 text-sm" data-testid="alert-inbox">
        <p className="font-medium text-slate-900">Forward card alerts</p>
        {!s.inbox.configured ? (
          <p className="mt-1 text-slate-600">
            Alert forwarding isn&apos;t set up on this server (INBOUND_EMAIL_DOMAIN and an inbound mail provider — see docs/auto-capture.md). Use a bank connection instead.
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="rounded bg-slate-100 px-2 py-1 text-xs" data-testid="inbox-address">
                {s.inbox.address}
              </code>
              <Button variant="secondary" onClick={() => copy(s.inbox.address ?? '', 'address')}>
                {copied === 'address' ? 'Copied' : 'Copy address'}
              </Button>
              <Button variant="ghost" onClick={() => toggle.mutate(!s.inbox.enabled)}>
                {s.inbox.enabled ? 'Pause' : 'Resume'}
              </Button>
              <Button variant="ghost" onClick={() => rotate.mutate(undefined)} loading={rotate.isPending}>
                New address
              </Button>
              {!s.inbox.enabled && <Badge tone="amber">paused</Badge>}
            </div>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-slate-700">
              <li>
                On each card&apos;s website or app, turn on alerts for <strong>every transaction</strong> (any amount) and for statement credits, sent to your email.
              </li>
              <li>
                In Gmail: Settings → Forwarding → <em>Add a forwarding address</em> → paste the address above. The confirmation code appears here once Gmail sends it.
                {s.inbox.confirmation && (
                  <span className="mt-1 block rounded bg-amber-50 p-2 text-amber-900" role="status">
                    Gmail confirmation code: <strong>{s.inbox.confirmation.code ?? '—'}</strong>
                    {s.inbox.confirmation.url && (
                      <>
                        {' '}
                        ·{' '}
                        <a className="underline" href={s.inbox.confirmation.url} target="_blank" rel="noopener noreferrer">
                          confirm in Gmail
                        </a>
                      </>
                    )}
                  </span>
                )}
              </li>
              <li>
                Create a filter with this search and choose <em>Forward it to</em> your PointWise address:{' '}
                <code className="rounded bg-slate-100 px-1 text-xs">{s.inbox.gmailFilter}</code>{' '}
                <button type="button" className="text-brand-700 underline" onClick={() => copy(s.inbox.gmailFilter, 'filter')}>
                  {copied === 'filter' ? 'copied' : 'copy'}
                </button>
                . Outlook: Settings → Mail → Rules → forward messages from those senders.
              </li>
              <li>Add the last 4 digits to each card in your wallet so alerts find the right card.</li>
            </ol>
            <p className="mt-2 text-xs text-slate-500">
              {s.inbox.received} emails received{s.inbox.lastReceivedAt && ` · last ${shortDate(s.inbox.lastReceivedAt)}`}. Only alerts from card issuers are used; the email itself
              is not kept.
            </p>
          </>
        )}
        <ErrorText error={toggle.error ?? rotate.error} />
      </div>

      {s.needsCard.length > 0 && (
        <div className="mt-4" data-testid="needs-card">
          <p className="text-sm font-medium text-slate-900">Which card? ({s.needsCard.length})</p>
          <ul className="divide-y divide-slate-100 text-sm">
            {s.needsCard.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                {i.merchant && <BrandLogo brand={{ name: i.merchant }} size="sm" decorative hideUnknown />}
                <span className="min-w-0 flex-1">
                  {i.merchant ?? 'Statement'} {i.amountCents != null && `· ${i.credit ? '−' : ''}${money(i.amountCents)}`}
                  {i.occurredAt && ` · ${shortDate(i.occurredAt)}`}
                  <span className="block text-xs text-slate-500">{i.lastDigits ? `card ending ${i.lastDigits}` : 'the alert did not say which card'}</span>
                </span>
                {i.kind === 'ALERT' && (
                  <>
                    <label className="sr-only" htmlFor={`assign-${i.id}`}>
                      Card for {i.merchant}
                    </label>
                    <Select id={`assign-${i.id}`} value={choice[i.id] ?? ''} onChange={(e) => setChoice({ ...choice, [i.id]: e.target.value })}>
                      <option value="">Choose card…</option>
                      {s.cards.map((c) => (
                        <option key={c.walletCardId} value={c.walletCardId}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    <Button
                      disabled={!choice[i.id]}
                      onClick={() => assign.mutate({ id: i.id, walletCardId: choice[i.id], remember: !!i.lastDigits })}
                      loading={assign.isPending && assign.variables?.id === i.id}
                    >
                      Add{i.lastDigits ? ' & remember digits' : ''}
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={() => discard.mutate(i.id)}>
                  Discard
                </Button>
              </li>
            ))}
          </ul>
          <ErrorText error={assign.error ?? discard.error} />
        </div>
      )}

      {s.recent.length > 0 && (
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-slate-700">Recent alert emails ({s.recent.length})</summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-600">
            {s.recent.map((r) => (
              <li key={r.id}>
                {shortDate(r.receivedAt)} · {r.fromDomain} · {r.merchant ? `${r.merchant} ${r.amountCents != null ? money(r.amountCents) : ''}` : r.subject} ·{' '}
                {INBOUND_STATUS_LABEL[r.status] ?? r.status}
                {r.note && ` (${r.note})`}
                {r.verified && ' · sender verified'}
              </li>
            ))}
          </ul>
        </details>
      )}
      {pending.length === 0 && s.cards.length > 0 && <p className="mt-3 text-sm text-emerald-700">Every card imports automatically.</p>}
    </Panel>
  );
}

/** Drop every statement at once: each file is matched to its card by the account digits it shows. */
