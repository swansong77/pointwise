import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BriefingsPanel } from '../src/components/briefings-panel';
import { CopilotDashboard } from '../src/components/copilot-dashboard';
import { CopilotSettingsSection } from '../src/components/copilot-settings';
import type { Dashboard, StoredBriefing } from '../src/lib/copilot';

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'USER' } } }) }));

const item = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  lens: 'OFFER',
  horizon: 'TODAY',
  title: 'Hilton $100 ends tomorrow',
  recommendation: 'Spend $500 with Hilton',
  reason: 'r',
  confidence: 90,
  expectedValueCents: 10000,
  href: '/offers/expirations',
  calls: [],
  ...over,
});
const DASH = {
  generatedAt: '2026-11-26T15:00:00Z',
  headline: '1 thing to do today, 2 more this week.',
  summary: 's',
  confidence: 72,
  counts: { TODAY: 1, WEEK: 2, MONTH: 0, LATER: 0 },
  valueAtStakeCents: 12000,
  today: [
    item('a'),
    item('b', {
      title: 'Uber $20 ends in 5 days',
      horizon: 'WEEK',
      calls: [
        { type: 'CALL', id: 'r1', kind: 'REMINDER', label: 'Remind me on 2026-11-27: Uber', method: 'POST', path: '/reminders', body: {}, confirm: null, success: 'Reminder set.' },
      ],
    }),
  ],
  expiring: [item('c', { title: 'Hyatt free night expires in 20 days' })],
  actions: [item('a')],
  travel: [],
  savings: { offersCents: 32400, creditsCents: 1500, totalCents: 33900 },
  household: {
    members: [
      { member: 'Alex', count: 2, underLimit: true, nextSlotAt: null },
      { member: 'Riley', count: 6, underLimit: false, nextSlotAt: '2027-03-01' },
    ],
    applyPick: { member: 'Riley', card: 'Sapphire Preferred', firstYearCents: 90000, usesSlot: true },
  },
  portfolio: { healthScore: 62, healthLabel: 'FAIR', feesCents: 39500, valueCents: 30000, cards: 2, toReview: 1 },
  goals: [
    {
      id: 'g1',
      kind: 'FEES',
      title: 'No annual fees',
      status: 'ACTIVE',
      dueAt: null,
      manualProgress: null,
      progress: { pct: 40, current: '$395', target: '$0', state: 'BEHIND', detail: 'd', next: [], confidence: 80 },
    },
  ],
  recommendations: [item('a')],
  briefing: { id: 'b1', kind: 'DAILY', periodKey: '2026-11-26', headline: '1 thing to do today', narration: null },
  hidden: 1,
} as unknown as Dashboard;

const brief = (kind: StoredBriefing['kind'], periodKey: string, headline: string, extra: Partial<StoredBriefing> = {}): StoredBriefing => ({
  id: kind + periodKey,
  kind,
  periodKey,
  createdAt: '2026-11-26T13:10:00Z',
  narration: null,
  content: {
    kind,
    periodKey,
    generatedAt: '2026-11-26T13:10:00Z',
    headline,
    summary: 'Summary of ' + headline,
    sections: [
      {
        key: 'today',
        title: 'Today’s priorities',
        lines: [{ text: 'Hilton $100 ends tomorrow', detail: 'Spend $500', tone: 'urgent', href: '/offers/expirations', valueCents: 10000 }],
        empty: 'Nothing is due today.',
      },
      { key: 'new', title: 'New since yesterday', lines: [], empty: 'No new offers.' },
    ],
    stats: {},
    confidence: 70,
    assumptions: ['Assumes you would buy anyway.'],
  },
  ...extra,
});

let calls: Array<{ url: string; method?: string; body?: string }> = [];
let briefings: StoredBriefing[] = [];
let settings: Record<string, unknown> = {};
const ok = (data: unknown, status = 200) => ({ ok: true, status, statusText: 'OK', text: async () => JSON.stringify(data) }) as Response;
beforeEach(() => {
  calls = [];
  briefings = [];
  settings = {
    aiModeEnabled: true,
    mode: 'QUICK',
    temperature: null,
    reasoningDepth: null,
    responseStyle: 'BALANCED',
    cloudShare: { consented: false, consentedAt: null, providers: [] },
    briefings: { daily: true, weekly: true, monthly: false, alerts: true },
    providers: [],
    modes: [{ key: 'QUICK', label: 'Quick', blurb: 'b' }],
    styles: ['BALANCED'],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body as string | undefined });
      if (u.endsWith('/copilot/dashboard')) return ok(DASH);
      if (u.endsWith('/copilot/alerts'))
        return ok([{ key: 'savings', title: 'You can save about $324 using available offers', body: '5 offers on your cards', link: '/offers/inventory', dedupeKey: 'k' }]);
      if (u.includes('/copilot/briefings/') && init?.method === 'POST') {
        const kind = u.split('/copilot/briefings/')[1].split('?')[0].toUpperCase() as StoredBriefing['kind'];
        const b = brief(kind, '2026-11-26', `Fresh ${kind}`);
        briefings = [b, ...briefings.filter((x) => x.kind !== kind)];
        return ok({ briefing: b, created: true }, 201);
      }
      if (u.endsWith('/copilot/briefings')) return ok(briefings);
      if (u.includes('/copilot/settings') && init?.method === 'PUT') {
        const b = JSON.parse(init.body as string);
        if (b.briefingMonthly !== undefined) (settings.briefings as Record<string, boolean>).monthly = b.briefingMonthly;
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

describe('Copilot dashboard', () => {
  it('shows each area: tasks, expiring, actions, household, savings, portfolio health and goals', async () => {
    wrap(<CopilotDashboard />);
    expect(await screen.findByTestId('dash-headline')).toHaveTextContent('1 thing to do today');
    expect(screen.getByText(/Confidence Medium \(72%\)/)).toBeInTheDocument();
    expect(within(screen.getByTestId('dash-today')).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByTestId('dash-expiring')).toHaveTextContent('Hyatt free night expires in 20 days');
    expect(screen.getByTestId('dash-actions')).toHaveTextContent('Hilton $100 ends tomorrow');
    const house = screen.getByTestId('dash-household');
    expect(house).toHaveTextContent('Riley');
    expect(house).toHaveTextContent('6/24');
    expect(house).toHaveTextContent('Best next card: Sapphire Preferred for Riley');
    expect(screen.getByTestId('dash-travel')).toHaveTextContent('No transfer bonuses');
    expect(screen.getByTestId('dash-savings')).toHaveTextContent('$339');
    const pf = screen.getByTestId('dash-portfolio');
    expect(pf).toHaveTextContent('62/100');
    expect(pf).toHaveTextContent('1 of 2');
    const goal = screen.getByTestId('dash-goals');
    expect(goal).toHaveTextContent('Behind');
    expect(within(goal).getByRole('progressbar', { name: 'Progress: No annual fees' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByTestId('dash-briefing')).toHaveTextContent('Latest daily briefing: 1 thing to do today');
  });

  it('lists alerts worth a look with links, offers reminders, and says how many items are put aside', async () => {
    wrap(<CopilotDashboard />);
    const alerts = await screen.findByTestId('dash-alerts');
    expect(within(alerts).getByRole('link', { name: 'You can save about $324 using available offers' })).toHaveAttribute('href', '/offers/inventory');
    expect(screen.getByRole('button', { name: /Remind me on 2026-11-27/ })).toBeInTheDocument();
    expect(screen.getByText(/1 item you put aside is hidden/)).toBeInTheDocument();
  });
});

describe('Briefings panel', () => {
  it('explains the empty state and writes a briefing on request', async () => {
    wrap(<BriefingsPanel />);
    expect(await screen.findByTestId('brief-empty')).toHaveTextContent('every morning');
    fireEvent.click(screen.getByTestId('brief-make'));
    await waitFor(() => expect(screen.getByTestId('briefing-headline')).toHaveTextContent('Fresh DAILY'));
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/copilot/briefings/daily'))).toBe(true);
  });

  it('switches between daily, weekly and monthly, and says when to expect each', async () => {
    briefings = [brief('DAILY', '2026-11-26', 'Daily one')];
    wrap(<BriefingsPanel />);
    expect(await screen.findByTestId('briefing-headline')).toHaveTextContent('Daily one');
    expect(screen.getByTestId('brief-tab-daily')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('brief-tab-weekly'));
    expect(screen.getByTestId('brief-empty')).toHaveTextContent('every Monday');
    fireEvent.click(screen.getByTestId('brief-tab-monthly'));
    expect(screen.getByTestId('brief-empty')).toHaveTextContent('on the 1st of the month');
  });

  it('shows sections with tone for screen readers, links, values, empty sections and assumptions', async () => {
    briefings = [brief('DAILY', '2026-11-26', 'Daily one')];
    wrap(<BriefingsPanel />);
    const today = await screen.findByTestId('brief-today');
    expect(within(today).getByRole('link', { name: 'Hilton $100 ends tomorrow' })).toHaveAttribute('href', '/offers/expirations');
    expect(today).toHaveTextContent('Urgent:');
    expect(today).toHaveTextContent('$100');
    expect(screen.getByTestId('brief-new')).toHaveTextContent('No new offers.');
    expect(screen.getByText('Assumes you would buy anyway.')).toBeInTheDocument();
  });

  it('says who worded it, can show earlier ones, and can write a fresh one', async () => {
    briefings = [
      brief('DAILY', '2026-11-26', 'Daily new', { narration: { text: 'Start with Hilton.', model: 'Fake', provider: 'P', local: false } }),
      brief('DAILY', '2026-11-25', 'Daily old'),
    ];
    wrap(<BriefingsPanel />);
    expect(await screen.findByTestId('briefing-body')).toHaveTextContent('Start with Hilton.');
    expect(screen.getByTestId('briefing-body')).toHaveTextContent('a cloud model that saw only a redacted summary');
    fireEvent.click(within(screen.getByTestId('brief-history')).getByRole('button', { name: '2026-11-25' }));
    expect(screen.getByTestId('briefing-headline')).toHaveTextContent('Daily old');
    fireEvent.click(screen.getByTestId('brief-refresh'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/copilot/briefings/daily?fresh=true'))).toBe(true));
  });
});

describe('Briefing settings', () => {
  it('shows each switch as it is saved and saves a change', async () => {
    wrap(<CopilotSettingsSection />);
    const box = await screen.findByTestId('copilot-briefingMonthly');
    expect(screen.getByTestId('copilot-briefingDaily')).toBeChecked();
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body!)).toEqual({ briefingMonthly: true });
    expect(screen.getByText(/a model only words them if you allowed it/)).toBeInTheDocument();
  });
});
