import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyViewPage from '../src/app/(app)/my/page';
import { MemberAccountActions, MemberAddAccount, MemberAddCard, MemberCardActions, MemberUseCredit } from '../src/components/member-edit';
import { MemberLogin } from '../src/components/member-login';
import type { Member } from '../src/lib/portfolio-types';

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'USER' } } }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: ReactNode }) => <a href={href} {...r}>{children}</a> }));

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const calls: Array<{ url: string; method?: string; body?: string }> = [];

const CARD = { walletCardId: 'w1', name: 'Gold Card', status: 'APPROVED', cardholder: 'PRIMARY' as const, annualFeeCents: 25000, lastFour: '4242', card: { id: 'c1', name: 'Gold Card', issuer: 'Contoso', color: '#000' } };
const BENEFIT = { id: 'b1', name: 'Dining credit', period: 'MONTHLY', amountPerPeriodCents: 5000, walletCard: { id: 'w1', name: 'Gold Card', issuer: 'Contoso' }, currentPeriod: { end: '2026-12-31T00:00:00Z', allocatedCents: 5000, usedCents: 1000, remainingCents: 4000, percentUsed: 20, status: 'PARTIAL', daysLeft: 12 } };
const ACCOUNT = { id: 'l1', name: 'Test Air', nickname: null, accountLast4: '6789', balance: 5000, pendingBalance: 0, statusLevel: null, statusDeadline: null, expiresAt: null };
const OV = {
  asOf: '2026-12-01T00:00:00Z',
  cards: { groups: { active: [CARD], authorizedUser: [], closed: [], pending: [] }, totals: { annualFeeCents: 25000, faceBenefitCents: 40000, realizedBenefitCents: 10000, effectiveValueCents: 25000 }, counts: { total: 1, active: 1, authorizedUser: 0, closed: 0, pending: 0 } },
  benefits: [BENEFIT],
  loyalty: [ACCOUNT],
  transactions: [],
};
const ME = (canEdit: boolean) => ({ email: 'riley@example.test', nickname: 'Riley', relationship: 'SPOUSE', since: null, household: 'The Parks', visibility: 'OWN', canEdit });

function stub(handler: (u: string, init?: RequestInit) => Response | null) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body as string | undefined });
      return handler(u, init) ?? ok({});
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
const sent = (method: string, endsWith: string) => calls.find((c) => c.method === method && c.url.endsWith(endsWith));

describe('TC-MEDIT-UI: my view when the owner allows editing', () => {
  const page = (canEdit: boolean) =>
    stub((u) => (u.endsWith('/member/me') ? ok(ME(canEdit)) : u.endsWith('/member/overview') ? ok(OV) : u.endsWith('/member/loyalty/programs') ? ok({ programs: [], currencies: [] }) : null));

  it('shows no editing controls unless the owner allowed it', async () => {
    page(false);
    wrap(<MyViewPage />);
    await screen.findByText('Hi, Riley');
    for (const id of ['member-add-card', 'member-add-account', 'member-card-edit', 'member-use-credit', 'member-account-edit']) expect(screen.queryByTestId(id)).toBeNull();
  });

  it('shows them when allowed', async () => {
    page(true);
    wrap(<MyViewPage />);
    await screen.findByText('Hi, Riley');
    for (const id of ['member-add-card', 'member-add-account', 'member-card-edit', 'member-use-credit', 'member-account-edit']) expect(screen.getByTestId(id)).toBeTruthy();
  });
});

describe('TC-MEDIT-UI: the controls', () => {
  it("adds a card to the member's own profile: no profile is ever sent", async () => {
    stub((u) => (u.includes('/cards?') ? ok({ items: [{ id: 'cat-1', name: 'Sapphire', slug: 's', issuer: { id: 'i', name: 'Contoso' } }], total: 1, page: 1, pageSize: 20 }) : null));
    wrap(<MemberAddCard />);
    const select = (await screen.findByLabelText('Card')) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBeGreaterThan(1));
    expect(screen.getByTestId('member-add-card-submit')).toHaveProperty('disabled', true);
    fireEvent.change(select, { target: { value: 'cat-1' } });
    fireEvent.change(screen.getByLabelText(/Last 4 digits/), { target: { value: '4242' } });
    fireEvent.click(screen.getByTestId('member-add-card-submit'));
    await waitFor(() => expect(sent('POST', '/member/cards')).toBeTruthy());
    const body = JSON.parse(sent('POST', '/member/cards')!.body as string);
    expect(body).toEqual({ cardId: 'cat-1', lastFour: '4242' });
    expect(body).not.toHaveProperty('profileId');
  });

  it('edits and removes a card, asking before removing', async () => {
    stub(() => null);
    wrap(<MemberCardActions card={CARD} />);
    fireEvent.click(screen.getByTestId('member-card-edit'));
    fireEvent.change(screen.getByLabelText('Nickname'), { target: { value: 'Everyday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(sent('PATCH', '/member/cards/w1')).toBeTruthy());
    expect(JSON.parse(sent('PATCH', '/member/cards/w1')!.body as string)).toMatchObject({ nickname: 'Everyday', lastFour: '4242' });
    cleanup();
    stub(() => null);
    wrap(<MemberCardActions card={CARD} />);
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
    fireEvent.click(screen.getByTestId('member-card-remove'));
    expect(sent('DELETE', '/member/cards/w1')).toBeUndefined();
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    fireEvent.click(screen.getByTestId('member-card-remove'));
    await waitFor(() => expect(sent('DELETE', '/member/cards/w1')).toBeTruthy());
  });

  it('adds a points account from the program list and updates a balance', async () => {
    stub((u) => (u.endsWith('/member/loyalty/programs') ? ok({ programs: [{ code: 'MAR_BONVOY', name: 'Marriott Bonvoy' }], currencies: [{ code: 'T_BANK', name: 'Bank Points' }] }) : null));
    wrap(<MemberAddAccount />);
    const select = (await screen.findByLabelText('Program')) as HTMLSelectElement;
    await waitFor(() => expect(within(select).getAllByRole('option').length).toBe(3));
    fireEvent.change(select, { target: { value: 'program:MAR_BONVOY' } });
    fireEvent.change(screen.getByLabelText('Current balance'), { target: { value: '12000' } });
    fireEvent.click(screen.getByTestId('member-add-account-submit'));
    await waitFor(() => expect(sent('POST', '/member/loyalty/accounts')).toBeTruthy());
    expect(JSON.parse(sent('POST', '/member/loyalty/accounts')!.body as string)).toEqual({ programCode: 'MAR_BONVOY', balance: 12000 });
    cleanup();

    stub(() => null);
    wrap(<MemberAccountActions account={ACCOUNT} />);
    fireEvent.click(screen.getByTestId('member-account-edit'));
    fireEvent.change(screen.getByLabelText('Balance'), { target: { value: '7500' } });
    fireEvent.click(screen.getByTestId('member-account-save'));
    await waitFor(() => expect(sent('PATCH', '/member/loyalty/accounts/l1')).toBeTruthy());
    expect(JSON.parse(sent('PATCH', '/member/loyalty/accounts/l1')!.body as string)).toEqual({ balance: 7500 });
  });

  it('marks a credit used for the amount left, and offers nothing when nothing is left', async () => {
    stub(() => null);
    wrap(<MemberUseCredit benefit={BENEFIT} />);
    fireEvent.click(screen.getByTestId('member-use-credit'));
    await waitFor(() => expect(sent('POST', '/member/benefits/b1/usage')).toBeTruthy());
    expect(JSON.parse(sent('POST', '/member/benefits/b1/usage')!.body as string)).toEqual({ amountCents: 4000 });
    cleanup();
    const used = { ...BENEFIT, currentPeriod: { ...BENEFIT.currentPeriod, remainingCents: 0 } };
    wrap(<MemberUseCredit benefit={used} />);
    expect(screen.queryByTestId('member-use-credit')).toBeNull();
  });
});

describe("TC-MEDIT-UI: the owner's two switches", () => {
  const member = (over: Partial<Member>): Member =>
    ({ id: 'p1', nickname: 'Riley', relationship: 'SPOUSE', isPrimary: false, email: null, birthYear: null, visibility: 'OWN', canEdit: false, notifyOwner: true, login: { status: 'ACTIVE', canHaveLogin: true, email: 'riley@example.test', since: '2026-12-01T00:00:00Z', inviteExpiresAt: null }, ...over }) as Member;

  it('lets the owner allow editing and stop being told, and shows their current state', async () => {
    stub(() => null);
    wrap(<MemberLogin member={member({ canEdit: true, notifyOwner: false })} />);
    expect((screen.getByTestId('can-edit') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByTestId('notify-owner') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId('can-edit'));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toBe(JSON.stringify({ canEdit: false })));
    fireEvent.click(screen.getByTestId('notify-owner'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH').map((c) => c.body)).toContain(JSON.stringify({ notifyOwner: true })));
  });

  it('are not offered before the member has their own sign-in', () => {
    stub(() => null);
    wrap(<MemberLogin member={member({ login: { status: 'NONE', canHaveLogin: true, email: null, since: null, inviteExpiresAt: null } })} />);
    expect(screen.queryByTestId('can-edit')).toBeNull();
    expect(screen.queryByTestId('notify-owner')).toBeNull();
  });
});
