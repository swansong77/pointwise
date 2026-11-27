import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemberLogin } from '../src/components/member-login';
import MyViewPage from '../src/app/(app)/my/page';
import JoinPage from '../src/app/join/[token]/page';
import type { Member } from '../src/lib/portfolio-types';

const push = vi.fn();
vi.mock('next-auth/react', () => ({
  useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'USER' } } }),
  signIn: vi.fn(async () => ({ error: null })),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh: vi.fn() }), useParams: () => ({ token: 'tok-abcdefghijklmnopqrstuvwxyz' }), usePathname: () => '/my' }));

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

const member = (login: Member['login'], over: Partial<Member> = {}): Member => ({
  id: 'p1',
  nickname: 'Riley',
  relationship: 'SPOUSE',
  isPrimary: false,
  email: null,
  birthYear: null,
  visibility: 'OWN',
  login,
  ...over,
});
const calls: Array<{ url: string; method?: string; body?: string }> = [];

beforeEach(() => {
  calls.length = 0;
  push.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(handler: (u: string, init?: RequestInit) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method, body: init?.body as string | undefined });
      return handler(String(url), init);
    }),
  );
}

describe('TC-MEMBER-UI: the owner\'s sign-in controls', () => {
  it('offers an invitation, shows the one-time link once, and copies it', async () => {
    stub((u) => (u.endsWith('/members/p1/invite') ? ok({ url: 'https://pw.test/join/SECRETTOKEN', expiresAt: '2026-12-08T00:00:00Z', emailed: false }) : ok({})));
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    wrap(<MemberLogin member={member({ status: 'NONE', canHaveLogin: true, email: null, since: null, inviteExpiresAt: null })} />);
    fireEvent.click(screen.getByTestId('invite-member'));
    const box = await screen.findByTestId('invite-link-box');
    expect((screen.getByTestId('invite-url') as HTMLInputElement).value).toBe('https://pw.test/join/SECRETTOKEN');
    expect(box.textContent).toContain('only time the link is shown');
    fireEvent.click(within(box).getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://pw.test/join/SECRETTOKEN'));
    expect(calls[0]).toMatchObject({ method: 'POST' });
  });

  it('an open invitation can be replaced or cancelled, and a link is never shown again', async () => {
    stub(() => ok({}, 204));
    wrap(<MemberLogin member={member({ status: 'INVITED', canHaveLogin: true, email: null, since: null, inviteExpiresAt: '2026-12-08T00:00:00Z' })} />);
    expect(screen.getByText('Invited')).toBeTruthy();
    expect(screen.queryByTestId('invite-url')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invitation' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/members/p1/invite'))).toBe(true));
  });

  it('an active sign-in shows the address, changes what the member sees, and removes only after confirmation', async () => {
    stub(() => ok({}));
    wrap(<MemberLogin member={member({ status: 'ACTIVE', canHaveLogin: true, email: 'riley@example.test', since: '2026-12-01T00:00:00Z', inviteExpiresAt: null })} />);
    expect(screen.getByText('riley@example.test')).toBeTruthy();
    fireEvent.change(screen.getByTestId('visibility'), { target: { value: 'HOUSEHOLD' } });
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toBe(JSON.stringify({ visibility: 'HOUSEHOLD' })));

    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId('remove-login'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId('remove-login'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/members/p1/login'))).toBe(true));
  });

  it('the account owner (who cannot have a member sign-in) gets no controls', () => {
    stub(() => ok({}));
    const { container } = wrap(<MemberLogin member={member({ status: 'NONE', canHaveLogin: false, email: null, since: null, inviteExpiresAt: null }, { isPrimary: true })} />);
    expect(container.querySelector('[data-testid="member-login"]')).toBeNull();
  });
});

describe('TC-MEMBER-UI: accepting an invitation', () => {
  it('shows who invited, validates the password, creates the sign-in and goes to My view', async () => {
    stub((u) => {
      if (u.includes('/auth/invite/')) return ok({ nickname: 'Riley', household: 'The Parks', expiresAt: '2026-12-08T00:00:00Z' });
      if (u.endsWith('/auth/accept-invite')) return ok({ accessToken: 'a' });
      return ok({});
    });
    wrap(<JoinPage />);
    expect(await screen.findByText('Welcome, Riley')).toBeTruthy();
    expect(screen.getByText(/The Parks/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Your e-mail'), { target: { value: 'riley@example.test' } });
    fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: 'short' } });
    fireEvent.submit(screen.getByTestId('join-form'));
    expect(calls.some((c) => c.url.endsWith('/auth/accept-invite'))).toBe(false);
    fireEvent.change(screen.getByLabelText('Choose a password'), { target: { value: 'a-good-password-7' } });
    fireEvent.submit(screen.getByTestId('join-form'));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/my'));
    const accept = calls.find((c) => c.url.endsWith('/auth/accept-invite'))!;
    expect(JSON.parse(accept.body as string)).toMatchObject({ token: 'tok-abcdefghijklmnopqrstuvwxyz', email: 'riley@example.test', name: 'Riley' });
  });

  it('an expired or used link shows a clear message and no form', async () => {
    stub(() => ok({ message: 'This invitation is not valid.' }, 404));
    wrap(<JoinPage />);
    expect(await screen.findByTestId('invite-invalid')).toBeTruthy();
    expect(screen.queryByTestId('join-form')).toBeNull();
  });
});

describe('TC-MEMBER-UI: my view', () => {
  const OV = {
    asOf: '2026-12-01T00:00:00Z',
    cards: {
      groups: {
        active: [{ walletCardId: 'w1', name: 'Gold Card', status: 'APPROVED', cardholder: 'PRIMARY', annualFeeCents: 25000, lastFour: '4242', card: { id: 'c1', name: 'Gold', issuer: 'Contoso', color: '#000' } }],
        authorizedUser: [], closed: [], pending: [],
      },
      totals: { annualFeeCents: 25000, faceBenefitCents: 40000, realizedBenefitCents: 10000, effectiveValueCents: 25000 },
      counts: { total: 1, active: 1, authorizedUser: 0, closed: 0, pending: 0 },
    },
    benefits: [{ id: 'b1', name: 'Travel credit', period: 'ANNUAL', amountPerPeriodCents: 30000, walletCard: { id: 'w1', name: 'Gold Card', issuer: 'Contoso' }, currentPeriod: { end: '2026-12-31T00:00:00Z', allocatedCents: 30000, usedCents: 10000, remainingCents: 20000, percentUsed: 33, status: 'EXPIRING_SOON', daysLeft: 12 } }],
    loyalty: [{ id: 'l1', name: 'Test Air', nickname: null, accountLast4: '6789', balance: 5000, pendingBalance: 0, statusLevel: 'Silver', statusDeadline: null, expiresAt: '2027-03-01T00:00:00Z' }],
    transactions: [{ id: 't1', amountCents: 4200, description: 'Coffee Shop', occurredAt: '2026-11-30T00:00:00Z', kind: 'PURCHASE', card: 'Gold Card', lastFour: '4242' }],
  };
  const ME = { email: 'riley@example.test', nickname: 'Riley', relationship: 'SPOUSE', since: '2026-12-01T00:00:00Z', household: 'The Parks', visibility: 'OWN' };

  it('shows only the member\'s own cards, credits, points and spending', async () => {
    stub((u) => (u.endsWith('/member/me') ? ok(ME) : u.endsWith('/member/overview') ? ok(OV) : ok({})));
    wrap(<MyViewPage />);
    expect(await screen.findByText('Hi, Riley')).toBeTruthy();
    expect(within(screen.getByTestId('my-cards')).getByText(/Gold Card/)).toBeTruthy();
    expect(within(screen.getByTestId('my-benefits')).getByText('Travel credit')).toBeTruthy();
    expect(within(screen.getByTestId('my-benefits')).getByText('Expiring soon')).toBeTruthy();
    expect(within(screen.getByTestId('my-loyalty')).getByText('5,000')).toBeTruthy();
    expect(within(screen.getByTestId('my-transactions')).getByText(/Coffee Shop/)).toBeTruthy();
    expect(screen.queryByText('See the household overview')).toBeNull();
    // it never asks for anything outside /member
    expect(calls.every((c) => c.url.includes('/member/'))).toBe(true);
  });

  it('links to the household overview only when the owner shared it', async () => {
    stub((u) => (u.endsWith('/member/me') ? ok({ ...ME, visibility: 'HOUSEHOLD' }) : ok(OV)));
    wrap(<MyViewPage />);
    expect(await screen.findByText('See the household overview')).toBeTruthy();
  });
});
