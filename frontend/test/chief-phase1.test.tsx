import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChiefCenter } from '../src/components/chief-center';
import { CopilotSettingsSection } from '../src/components/copilot-settings';
import { ExecItemCard } from '../src/components/exec-item';
import type { ChiefOverview, CenterList, ExecItem } from '../src/lib/chief';

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'USER' } } }) }));

const item = (id: string, over: Partial<ExecItem> = {}): ExecItem =>
  ({
    id,
    lens: 'OFFER',
    title: 'Hilton $100 ends tomorrow',
    recommendation: 'Spend $500 with Hilton',
    reason: '$100 is lost if it lapses unused.',
    evidence: ['Expiring offers: ends 2026-11-27'],
    assumptions: ['You would buy anyway.'],
    expectedValueCents: 10000,
    confidence: 90,
    href: '/offers/expirations',
    calls: [],
    score: 82,
    band: 'CRITICAL',
    timeMinutes: 10,
    risk: { level: 'LOW', note: 'Low risk.' },
    impact: { cls: 'PRESERVED', atRiskCents: 10000, preservedCents: 10000, createdCents: 0, lostCents: 0, futureCents: 0 },
    deadline: '2026-11-27',
    daysLeft: 1,
    alternatives: ['Snooze it if you will not shop there.'],
    sources: ['Expiring offers'],
    agents: [
      { key: 'merchant-offer-agent', label: 'Merchant Offer Agent' },
      { key: 'chief-of-staff', label: 'Chief of Staff' },
    ],
    center: 'TODAY',
    ...over,
  }) as ExecItem;

const OVERVIEW: ChiefOverview = {
  generatedAt: '2026-11-26T15:00:00Z',
  greeting: 'Good morning Hyun.',
  summary: { highPriority: 2, valueAtRiskCents: 84200, pointsAtRisk: 120000, certificatesExpiring: 2, newHighValueOffers: 6, totalActions: 3 },
  confidence: 80,
  top: [
    item('a'),
    item('b', {
      title: 'Hyatt free night expires in 5 days',
      band: 'HIGH',
      score: 61,
      center: 'WEEK',
      timeMinutes: 45,
      risk: { level: 'MEDIUM', note: 'Availability can be limited.' },
    }),
    item('c', { title: 'Update the Delta balance', band: 'LOW', score: 15, expectedValueCents: null, center: 'MONTH' }),
  ],
  center: [
    { key: 'TODAY', label: 'Today', count: 1, valueAtRiskCents: 10000 },
    { key: 'WEEK', label: 'This week', count: 1, valueAtRiskCents: 25000 },
    { key: 'MONTH', label: 'This month', count: 1, valueAtRiskCents: 0 },
    { key: 'QUARTER', label: 'This quarter', count: 0, valueAtRiskCents: 0 },
    { key: 'ANNUAL', label: 'Annual review', count: 0, valueAtRiskCents: 0 },
  ],
  recovery: {
    headline: '$420 lost so far; $350 can still be saved.',
    lostCents: 42000,
    lines: [
      { kind: 'OFFER', label: 'Expired offer: Hilton', cents: 8000 },
      { kind: 'CREDIT', label: 'Unused credits on Platinum', cents: 7000 },
    ],
    atRiskCents: 35000,
    recoverable: [
      { id: 'a', title: 'Hilton $100 ends tomorrow', recommendation: 'x', cents: 10000, href: '/offers/expirations', deadline: '2026-11-27', band: 'CRITICAL', score: 82 },
    ],
    recoveredCents: 4000,
  },
  hidden: 1,
};
const CENTER: CenterList[] = OVERVIEW.center.map((h) => ({ ...h, items: OVERVIEW.top.filter((i) => i.center === h.key) }));

let calls: Array<{ url: string; method?: string; body?: string }> = [];
let settings: Record<string, unknown> = {};
const ok = (data: unknown, status = 200) => ({ ok: true, status, statusText: 'OK', text: async () => JSON.stringify(data) }) as Response;
beforeEach(() => {
  calls = [];
  settings = {
    aiModeEnabled: true,
    mode: 'QUICK',
    temperature: null,
    reasoningDepth: null,
    responseStyle: 'BALANCED',
    cloudShare: { consented: false, consentedAt: null, providers: [] },
    briefings: { daily: true, weekly: true, monthly: true, alerts: true },
    chief: { enabled: false, quietMode: false },
    providers: [],
    modes: [{ key: 'QUICK', label: 'Quick', blurb: 'b' }],
    styles: ['BALANCED'],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body as string | undefined });
      if (u.endsWith('/chief/overview')) return ok(OVERVIEW);
      if (u.endsWith('/chief/actions')) return ok(CENTER);
      if (u.includes('/copilot/memory/decisions')) return ok({ itemId: 'x' }, 201);
      if (u.includes('/notifications/preferences') && init?.method === 'PUT') {
        (settings.chief as Record<string, boolean>).quietMode = JSON.parse(init.body as string).quietMode;
        return ok({});
      }
      if (u.includes('/copilot/settings') && init?.method === 'PUT') {
        const b = JSON.parse(init.body as string);
        if (b.chiefOfStaff !== undefined) (settings.chief as Record<string, boolean>).enabled = b.chiefOfStaff;
        return ok(settings);
      }
      if (u.includes('/copilot/settings')) return ok(settings);
      if (u.includes('/copilot/disclosures')) return ok([]);
      return ok({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('Executive item', () => {
  it('shows priority, value, time and risk, and the reasoning underneath', () => {
    wrap(<ExecItemCard i={item('a')} rank={1} />);
    expect(screen.getByText(/Critical · 82/)).toBeInTheDocument();
    const facts = screen.getByTestId('exec-facts');
    expect(facts).toHaveTextContent('Value $100');
    expect(facts).toHaveTextContent('Time ~10 min');
    expect(facts).toHaveTextContent('Risk Low');
    expect(facts).toHaveTextContent('Deadline');
    const why = screen.getByTestId('exec-why');
    expect(why).toHaveTextContent('Why: $100 is lost if it lapses unused.');
    expect(why).toHaveTextContent('Value preserved if you act');
    expect(why).toHaveTextContent('$100 is lost if nothing is done');
    expect(why).toHaveTextContent('Snooze it if you will not shop there.');
    expect(why).toHaveTextContent('Confidence: 90%');
    expect(why).toHaveTextContent('Data used: Expiring offers');
    expect(why).toHaveTextContent('Contributing agents: Merchant Offer Agent, Chief of Staff');
    expect(why).toHaveTextContent('Assumes: You would buy anyway.');
  });
  it('says n/a for an item with no dollar value and has no deadline line when there is none', () => {
    wrap(<ExecItemCard i={item('c', { expectedValueCents: null, deadline: null, band: 'INFO', score: 5 })} />);
    expect(screen.getByTestId('exec-facts')).toHaveTextContent('Value n/a');
    expect(screen.getByTestId('exec-facts')).not.toHaveTextContent('Deadline');
    expect(screen.getByText(/Informational · 5/)).toBeInTheDocument();
  });
  it('an item can be put aside from here', async () => {
    wrap(<ExecItemCard i={item('offer-exp:1')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Snooze 7 days' }));
    expect(await screen.findByTestId('decision-result')).toHaveTextContent('Snoozed');
    expect(JSON.parse(calls.find((c) => c.url.includes('decisions'))!.body!)).toEqual({ itemId: 'offer-exp:1', action: 'SNOOZE', days: 7 });
  });
});

describe('Chief of Staff centre', () => {
  it('greets, shows the numbers and lists the top actions in order', async () => {
    wrap(<ChiefCenter />);
    expect(await screen.findByTestId('chief-greeting')).toHaveTextContent('Good morning Hyun. You have 2 high-priority actions.');
    expect(screen.getByTestId('tile-risk')).toHaveTextContent('$842');
    expect(screen.getByTestId('tile-points')).toHaveTextContent('120,000');
    expect(screen.getByTestId('tile-certs')).toHaveTextContent('2');
    expect(screen.getByTestId('tile-offers')).toHaveTextContent('6');
    const items = within(screen.getByTestId('chief-top-list')).getAllByTestId('exec-item');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('Hilton $100 ends tomorrow');
    expect(items[1]).toHaveTextContent('Hyatt free night');
    expect(screen.getByText(/1 item you put aside is hidden/)).toBeInTheDocument();
  });

  it('the Action Center switches between today, this week, this month, this quarter and the annual review', async () => {
    wrap(<ChiefCenter />);
    await screen.findByTestId('chief-greeting');
    await waitFor(() => expect(within(screen.getByTestId('center-list')).getAllByTestId('exec-item')).toHaveLength(1));
    expect(screen.getByTestId('center-tab-today')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('center-list')).toHaveTextContent('Hilton $100 ends tomorrow');
    fireEvent.click(screen.getByTestId('center-tab-week'));
    expect(screen.getByTestId('center-list')).toHaveTextContent('Hyatt free night');
    fireEvent.click(screen.getByTestId('center-tab-quarter'));
    expect(screen.getByTestId('center-empty')).toHaveTextContent('Nothing here.');
    expect(['today', 'week', 'month', 'quarter', 'annual'].every((k) => screen.getByTestId(`center-tab-${k}`))).toBe(true);
  });

  it('shows what was lost and what can still be saved', async () => {
    wrap(<ChiefCenter />);
    expect(await screen.findByTestId('recovery-headline')).toHaveTextContent('$420 lost so far; $350 can still be saved.');
    expect(screen.getByTestId('recovery-lost')).toHaveTextContent('Expired offer: Hilton');
    expect(screen.getByTestId('recovery-lost')).toHaveTextContent('$80');
    expect(within(screen.getByTestId('recovery-recoverable')).getByRole('link', { name: 'Hilton $100 ends tomorrow' })).toHaveAttribute('href', '/offers/expirations');
    expect(screen.getByText(/already saved \$40/)).toBeInTheDocument();
  });
});

describe('Chief of Staff settings', () => {
  it('turns the Chief of Staff on, and Quiet Mode on separately', async () => {
    wrap(<CopilotSettingsSection />);
    const on = await screen.findByTestId('chief-enabled');
    const quiet = screen.getByTestId('chief-quiet');
    expect(on).not.toBeChecked();
    expect(quiet).not.toBeChecked();
    fireEvent.click(on);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/copilot/settings'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PUT' && c.url.includes('/copilot/settings'))!.body!)).toEqual({ chiefOfStaff: true });
    fireEvent.click(quiet);
    await waitFor(() => expect(calls.some((c) => c.url.includes('/notifications/preferences'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.url.includes('/notifications/preferences'))!.body!)).toEqual({ quietMode: true });
    expect(screen.getByText(/Deadlines, renewals, failures and your reminders still arrive at once/)).toBeInTheDocument();
  });
});
