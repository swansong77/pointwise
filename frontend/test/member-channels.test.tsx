import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AutoCapture } from '../src/components/auto-capture';
import { MailboxPanel } from '../src/components/mailbox-panel';
import { MemberLogin } from '../src/components/member-login';
import type { Member } from '../src/lib/portfolio-types';

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'USER' } } }), signIn: vi.fn() }));

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const calls: Array<{ url: string; method?: string; body?: string }> = [];

const MEMBERS: Partial<Member>[] = [
  { id: 'p-owner', nickname: 'Jo', isPrimary: true, relationship: 'SELF' },
  { id: 'p-riley', nickname: 'Riley', isPrimary: false, relationship: 'SPOUSE' },
];
const MAILBOX = { id: 'm1', kind: 'IMAP', label: 'Riley mail', host: 'imap.example.com', port: 993, username: 'riley@example.com', folder: 'INBOX', active: true, lastSyncAt: null, lastStatus: null, lastError: null, processed: 0, profile: { id: 'p-riley', nickname: 'Riley' } };

function stub(extra: (u: string, init?: RequestInit) => Response | null = () => null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body as string | undefined });
      const e = extra(u, init);
      if (e) return e;
      if (u.endsWith('/mailboxes/providers')) return ok({ gmail: true, outlook: true, redirectUri: 'x' });
      if (u.endsWith('/mailboxes') && (!init?.method || init.method === 'GET')) return ok([MAILBOX]);
      if (u.endsWith('/household')) return ok({ id: 'h', name: 'The Parks', members: MEMBERS });
      return ok({});
    }),
  );
}
beforeEach(() => {
  calls.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TC-MCHAN-UI: mailboxes per person', () => {
  it('the owner chooses whose cards a mailbox feeds, and each mailbox shows who it feeds', async () => {
    stub();
    wrap(<MailboxPanel assignable />);
    const sel = (await screen.findByLabelText(/Whose cards and points does this mailbox feed/)) as HTMLSelectElement;
    expect(within(sel).getAllByRole('option').map((o) => o.textContent)).toEqual(['The whole household', 'Jo', 'Riley']);
    expect(await screen.findByText('Feeds Riley')).toBeTruthy();
    fireEvent.change(sel, { target: { value: 'p-riley' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'riley2@example.com' } });
    fireEvent.change(screen.getByLabelText('App password'), { target: { value: 'app-pass' } });
    fireEvent.click(screen.getByTestId('mailbox-connect'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/mailboxes'))).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.method === 'POST' && c.url.endsWith('/mailboxes'))!.body as string)).toMatchObject({ username: 'riley2@example.com', profileId: 'p-riley' });
  });

  it('household-wide is the default and sends no profile', async () => {
    stub();
    wrap(<MailboxPanel assignable />);
    await screen.findByLabelText(/Whose cards and points does this mailbox feed/);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'jo@example.com' } });
    fireEvent.change(screen.getByLabelText('App password'), { target: { value: 'app-pass' } });
    fireEvent.click(screen.getByTestId('mailbox-connect'));
    await waitFor(() => expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/mailboxes'))).toBeTruthy());
    expect(JSON.parse(calls.find((c) => c.method === 'POST' && c.url.endsWith('/mailboxes'))!.body as string)).not.toHaveProperty('profileId');
  });

  it("a member's panel has no choice of person and never asks for the household", async () => {
    stub();
    wrap(<MailboxPanel />);
    await screen.findByTestId('mailbox-list');
    expect(screen.queryByTestId('mailbox-feeds')).toBeNull();
    expect(calls.some((c) => c.url.endsWith('/household'))).toBe(false);
  });
});

describe('TC-MCHAN-UI: the capture panel for a member', () => {
  const STATUS = {
    inbox: { configured: true, address: 'u-abc@in.example.test', enabled: true, received: 0, lastReceivedAt: null, gmailFilter: 'from:(chase.com)', confirmation: null },
    cards: [{ walletCardId: 'w1', name: 'Gold Card', issuer: 'Contoso', color: '#000', lastFour: '2222', automatic: false, via: 'MANUAL', bank: null, lastAlertAt: null, lastTransactionAt: null, statements: null, statementDue: true, hint: null }],
    automated: 0,
    needsCard: [],
    recent: [],
  };
  it('offers the private address but no bank connection link', async () => {
    stub((u) => (u.endsWith('/capture/status') ? ok(STATUS) : null));
    wrap(<AutoCapture member />);
    expect(await screen.findByTestId('inbox-address')).toBeTruthy();
    expect(screen.getByTestId('inbox-address').textContent).toBe('u-abc@in.example.test');
    expect(screen.queryByRole('link', { name: 'bank connection' })).toBeNull();
  });
  it('the owner still sees the bank connection link', async () => {
    stub((u) => (u.endsWith('/capture/status') ? ok(STATUS) : null));
    wrap(<AutoCapture />);
    await screen.findByTestId('inbox-address');
    expect(screen.getByRole('link', { name: 'bank connection' })).toBeTruthy();
  });
});

describe('TC-MCHAN-UI: the owner sees each member\'s channel health, never addresses', () => {
  const m = (channels: Member['channels'], status: 'ACTIVE' | 'NONE' = 'ACTIVE'): Member =>
    ({ id: 'p-riley', nickname: 'Riley', relationship: 'SPOUSE', isPrimary: false, email: null, birthYear: null, visibility: 'OWN', channels, login: { status, canHaveLogin: true, email: status === 'ACTIVE' ? 'riley@example.test' : null, since: '2026-12-01T00:00:00Z', inviteExpiresAt: null } }) as Member;
  it('summarises mailboxes, last read, alert address and problems', () => {
    stub();
    wrap(<MemberLogin member={m({ mailboxes: 2, needsAttention: 1, lastSyncAt: '2026-12-10T00:00:00Z', alertAddress: true })} />);
    const t = screen.getByTestId('member-channels').textContent ?? '';
    expect(t).toContain('2 mailboxes connected');
    expect(t).toContain('alert address on');
    expect(t).toContain('1 need attention');
    expect(t).not.toContain('@');
  });
  it('says when nothing is connected', () => {
    stub();
    wrap(<MemberLogin member={m({ mailboxes: 0, needsAttention: 0, lastSyncAt: null, alertAddress: false })} />);
    expect(screen.getByTestId('member-channels').textContent).toContain('No mailbox connected');
  });
  it('a member without a sign-in shows mailboxes the owner assigned to them', () => {
    stub();
    wrap(<MemberLogin member={m({ mailboxes: 1, needsAttention: 0, lastSyncAt: null, alertAddress: null }, 'NONE')} />);
    expect(screen.getByTestId('member-channels').textContent).toContain('1 of your mailboxes feed Riley');
  });
});
