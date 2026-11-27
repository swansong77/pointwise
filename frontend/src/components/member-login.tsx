'use client';

import { useState } from 'react';
import { Badge, Button, ErrorText, Select } from '@/components/ui';
import { shortDate } from '@/lib/format';
import type { Member } from '@/lib/portfolio-types';
import { useApiMutation } from '@/lib/queries';

const KEYS = [['household'], ['portfolio'], ['five24']] as const;

interface InviteResult {
  url: string;
  expiresAt: string;
  emailed: boolean;
}

/** The owner's controls for one member's own sign-in: invite, share the link, choose what they see, remove. */
export function MemberLogin({ member }: { member: Member }) {
  const login = member.login;
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useApiMutation<void, InviteResult>(() => ({ path: `/household/members/${member.id}/invite`, method: 'POST' }), KEYS);
  const revoke = useApiMutation<void>(() => ({ path: `/household/members/${member.id}/invite`, method: 'DELETE' }), KEYS);
  const remove = useApiMutation<void>(() => ({ path: `/household/members/${member.id}/login`, method: 'DELETE' }), KEYS);
  const visibility = useApiMutation<string>((v) => ({ path: `/household/members/${member.id}`, method: 'PATCH', body: { visibility: v } }), KEYS);
  const rights = useApiMutation<Record<string, boolean>>((body) => ({ path: `/household/members/${member.id}`, method: 'PATCH', body }), KEYS);

  if (!login || !login.canHaveLogin) return null;

  async function makeInvite() {
    setCopied(false);
    setInvite(await create.mutateAsync(undefined));
  }
  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="mt-4 rounded-lg border border-slate-200 p-3 text-sm" data-testid="member-login" aria-label={`Sign-in for ${member.nickname}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-medium text-slate-900">Own sign-in</p>
        {login.status === 'ACTIVE' && <Badge tone="green">Active</Badge>}
        {login.status === 'INVITED' && <Badge tone="amber">Invited</Badge>}
        {login.status === 'NONE' && <Badge>None</Badge>}
      </div>

      {login.status !== 'ACTIVE' && member.channels && member.channels.mailboxes > 0 && (
        <p className="mt-1 text-slate-600" data-testid="member-channels">
          {member.channels.mailboxes} of your mailboxes feed {member.nickname}.
        </p>
      )}
      {login.status === 'NONE' && !invite && (
        <>
          <p className="mt-1 text-slate-600">{member.nickname} can have their own e-mail and password, see their own cards and points, and later get their own alerts and briefings.</p>
          <Button className="mt-2" variant="secondary" onClick={() => void makeInvite()} loading={create.isPending} data-testid="invite-member">
            Invite {member.nickname} to sign in
          </Button>
        </>
      )}

      {invite && (
        <div className="mt-2 rounded-lg bg-brand-50 p-3" data-testid="invite-link-box" role="status">
          <p className="text-slate-800">
            Share this link with {member.nickname}. It works once and expires {shortDate(invite.expiresAt)}.
            {invite.emailed && ' It was also e-mailed to the address on file.'}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input readOnly aria-label="Invitation link" value={invite.url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs" data-testid="invite-url" />
            <Button variant="secondary" onClick={() => void copy(invite.url)}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-slate-600">This is the only time the link is shown. If it is lost, make a new one.</p>
        </div>
      )}

      {login.status === 'INVITED' && !invite && (
        <div className="mt-1">
          <p className="text-slate-600">Waiting for {member.nickname} to accept{login.inviteExpiresAt ? ` (link valid until ${shortDate(login.inviteExpiresAt)})` : ''}. A link cannot be shown again.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void makeInvite()} loading={create.isPending}>
              New link
            </Button>
            <Button variant="ghost" onClick={() => revoke.mutate(undefined)} loading={revoke.isPending}>
              Cancel invitation
            </Button>
          </div>
        </div>
      )}

      {login.status === 'ACTIVE' && (
        <div className="mt-1">
          <p className="text-slate-600">
            Signs in as <strong>{login.email}</strong>
            {login.since ? ` since ${shortDate(login.since)}` : ''}.
          </p>
          {member.channels && (
            <p className="mt-1 text-slate-600" data-testid="member-channels">
              {member.channels.mailboxes === 0 ? 'No mailbox connected' : `${member.channels.mailboxes} mailbox${member.channels.mailboxes === 1 ? '' : 'es'} connected`}
              {member.channels.lastSyncAt ? `, last read ${shortDate(member.channels.lastSyncAt)}` : ''}
              {' · '}
              {member.channels.alertAddress ? 'alert address on' : 'no alert address in use'}
              {member.channels.needsAttention > 0 && (
                <>
                  {' '}
                  <Badge tone="red">{member.channels.needsAttention} need attention</Badge>
                </>
              )}
            </p>
          )}
          <ul className="mt-2 space-y-1" aria-label={`What ${member.nickname} may do`}>
            <li>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={!!member.canEdit} onChange={(e) => rights.mutate({ canEdit: e.target.checked })} data-testid="can-edit" />
                Let {member.nickname} add and edit their own cards and points
              </label>
            </li>
            <li>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={member.notifyOwner !== false} onChange={(e) => rights.mutate({ notifyOwner: e.target.checked })} data-testid="notify-owner" />
                Also tell me about {member.nickname}&apos;s alerts and reminders
              </label>
            </li>
          </ul>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="w-64">
              <label htmlFor={`vis-${member.id}`} className="mb-1 block text-xs font-medium text-slate-700">
                What {member.nickname} can see
              </label>
              <Select id={`vis-${member.id}`} value={member.visibility ?? 'OWN'} onChange={(e) => visibility.mutate(e.target.value)} data-testid="visibility">
                <option value="OWN">Only their own cards and points</option>
                <option value="HOUSEHOLD">Their own, plus the household overview</option>
              </Select>
            </div>
            <Button
              variant="ghost"
              onClick={() => {
                if (window.confirm(`Remove ${member.nickname}'s sign-in? They are signed out at once. Their cards and data stay.`)) remove.mutate(undefined);
              }}
              data-testid="remove-login"
            >
              Remove sign-in
            </Button>
          </div>
        </div>
      )}
      <ErrorText error={create.error ?? revoke.error ?? remove.error ?? visibility.error ?? rights.error} />
    </section>
  );
}
