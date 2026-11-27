import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MyBriefingsPage from '../src/app/(app)/my/briefings/page';
import MySettingsPage from '../src/app/(app)/my/settings/page';
import { NotificationPrefs } from '../src/components/notification-prefs';

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'USER' } } }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: ReactNode }) => <a href={href} {...r}>{children}</a> }));

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const calls: Array<{ url: string; method?: string; body?: string }> = [];

const PREFS = { offerExpiring: true, cardRenewal: true, bonusDeadline: true, offerAlerts: true, emailDigest: true, expiringDays: 7, benefitExpiring: true, benefitEmail: true, benefitPush: false, transferBonuses: true, quietMode: false, briefingDaily: true, briefingWeekly: false };
const brief = (id: string, kind: 'DAILY' | 'WEEKLY', headline: string) => ({
  id,
  kind,
  periodKey: kind === 'DAILY' ? '2026-12-07' : '2026-12-07',
  createdAt: '2026-12-07T13:00:00Z',
  narration: null,
  content: {
    kind,
    periodKey: '2026-12-07',
    generatedAt: '2026-12-07T13:00:00Z',
    headline,
    summary: 'About $300 is at stake.',
    confidence: 80,
    assumptions: ['Built from your own cards and accounts as they are recorded today.'],
    stats: {},
    sections: [
      { key: 'today', title: 'Needs you now', empty: 'Nothing is due.', lines: [{ text: 'Dining credit: $25 left on Gold', detail: 'Use it in 2 days.', tone: 'urgent', valueCents: 2500 }] },
      { key: 'money', title: 'Fees and bonuses', empty: 'No fee or bonus decisions.', lines: [] },
    ],
  },
});

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

describe('TC-MBRIEF-UI: my briefings', () => {
  it('lists my briefings and shows the newest with what is due', async () => {
    stub((u) => (u.endsWith('/member/briefings') ? ok([brief('b2', 'DAILY', 'Riley: 1 thing to do now'), brief('b1', 'WEEKLY', 'Riley: A quiet week')]) : null));
    wrap(<MyBriefingsPage />);
    expect(await screen.findByText('Riley: 1 thing to do now')).toBeTruthy();
    expect(within(screen.getByTestId('brief-list')).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByTestId('brief-today').textContent).toContain('Dining credit: $25 left on Gold');
    fireEvent.click(within(screen.getByTestId('brief-list')).getAllByRole('button')[1]);
    expect(await screen.findByText('Riley: A quiet week')).toBeTruthy();
  });

  it('makes a briefing now, and says plainly when there is nothing due', async () => {
    stub((u, init) => {
      if (u.endsWith('/member/briefings') && init?.method === 'POST') return ok({ briefing: null, message: 'Nothing is due today, so there is no briefing.' });
      if (u.endsWith('/member/briefings')) return ok([]);
      return null;
    });
    wrap(<MyBriefingsPage />);
    fireEvent.click(await screen.findByTestId('brief-now-daily'));
    expect((await screen.findByTestId('brief-message')).textContent).toContain('Nothing is due today');
    const post = calls.find((c) => c.method === 'POST')!;
    expect(JSON.parse(post.body as string)).toEqual({ kind: 'DAILY', force: true });
  });

  it('an empty list invites the first one', async () => {
    stub((u) => (u.endsWith('/member/briefings') ? ok([]) : null));
    wrap(<MyBriefingsPage />);
    expect(await screen.findByText(/no briefings yet/i)).toBeTruthy();
  });
});

describe('TC-MNOTE-UI: my settings', () => {
  it("a member gets their own briefing and Quiet Mode switches and saves only their own preferences", async () => {
    stub((u, init) => {
      if (u.endsWith('/notifications/preferences') && init?.method === 'PUT') return ok({ ...PREFS, ...JSON.parse(init.body as string) });
      if (u.endsWith('/notifications/preferences')) return ok(PREFS);
      if (u.endsWith('/notifications/push/key')) return ok({ publicKey: null });
      if (u.endsWith('/member/me')) return ok({ email: 'riley@example.test', nickname: 'Riley', relationship: 'SPOUSE', since: null, household: 'The Parks', visibility: 'OWN' });
      return null;
    });
    wrap(<MySettingsPage />);
    expect(await screen.findByTestId('my-signin')).toBeTruthy();
    expect(screen.getByTestId('my-signin').textContent).toContain('riley@example.test');
    const weekly = (await screen.findByLabelText('Send me my own weekly briefing')) as HTMLInputElement;
    expect(weekly.checked).toBe(false);
    expect((screen.getByLabelText(/Send me my own daily briefing/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(weekly);
    await waitFor(() => expect(calls.find((c) => c.method === 'PUT')?.body).toBe(JSON.stringify({ briefingWeekly: true })));
    fireEvent.click(screen.getByLabelText(/Quiet Mode/));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT').map((c) => c.body)).toContain(JSON.stringify({ quietMode: true })));
    expect(calls.every((c) => !c.url.includes('/household') && !c.url.includes('/copilot'))).toBe(true);
  });

  it("the owner's preferences do not show the member-only switches", async () => {
    stub((u) => (u.endsWith('/notifications/preferences') ? ok(PREFS) : u.endsWith('/notifications/push/key') ? ok({ publicKey: null }) : null));
    wrap(<NotificationPrefs />);
    await screen.findByLabelText('Offers about to expire');
    expect(screen.queryByLabelText(/my own daily briefing/)).toBeNull();
    expect(screen.queryByLabelText(/Quiet Mode/)).toBeNull();
  });
});
