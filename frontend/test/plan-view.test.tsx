import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandBar } from '../src/components/command-bar';
import { PlanView } from '../src/components/plan-view';
import type { CopilotResponse } from '../src/lib/copilot';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'USER' } } }) }));

const item = (over: Record<string, unknown> = {}) => ({
  id: 'offer-exp:o1',
  lens: 'OFFER',
  horizon: 'TODAY',
  title: 'Hilton: $100 back ends tomorrow',
  recommendation: 'Spend $500 with Hilton',
  reason: '$100 is lost if it lapses unused.',
  evidence: ['Expiring offers: ends 2026-11-27'],
  expectedValueCents: 10000,
  assumptions: ['You would buy anyway.'],
  risks: ['Very little time left.'],
  confidence: 90,
  factors: [{ label: 'Time left', effect: 'UP', detail: '1 day left' }],
  href: '/offers/expirations',
  calls: [
    {
      type: 'CALL',
      id: 'r1',
      kind: 'REMINDER',
      label: 'Remind me soon: Hilton',
      method: 'POST',
      path: '/reminders',
      body: { title: 'x', dueAt: '2026-11-27T00:00:00Z' },
      confirm: null,
      success: 'Reminder set.',
    },
  ],
  ...over,
});
const RESPONSE = (over: Partial<CopilotResponse> = {}): CopilotResponse =>
  ({
    runId: 'run1',
    mode: 'QUICK',
    plan: {
      mode: 'QUICK',
      kind: 'AGENDA',
      question: 'What should I do today?',
      headline: '1 thing to do today, 1 more this week.',
      summary: '1 thing to do today. About $100 is at stake. Start with: Hilton: $100 back ends tomorrow.',
      items: [item(), item({ id: 'cert:c1', horizon: 'WEEK', title: 'Hyatt free night expires in 5 days', calls: [], confidence: 50 })],
      lenses: [{ lens: 'OFFER', label: 'Merchant Offers', engines: ['get_expiring_offers'], ok: true, found: 1, note: '1 item found' }],
      assumptions: ['You would buy anyway.'],
      risks: [],
      confidence: 72,
      evidence: [],
      counts: { TODAY: 1, WEEK: 1, MONTH: 0, LATER: 0 },
      valueAtStakeCents: 10000,
    },
    narration: null,
    narrationSkipped: 'The built-in planner wrote this.',
    sessionId: null,
    tookMs: 5,
    ...over,
  }) as unknown as CopilotResponse;

afterEach(() => cleanup());

describe('PlanView', () => {
  const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

  it('shows the headline, confidence, the plan by when, and why / evidence / risks for each item', () => {
    wrap(<PlanView r={RESPONSE()} />);
    expect(screen.getByTestId('plan-headline')).toHaveTextContent('1 thing to do today');
    expect(screen.getByText(/Confidence Medium \(72%\)/)).toBeInTheDocument();
    expect(screen.getByTestId('plan-today')).toHaveTextContent('Hilton: $100 back ends tomorrow');
    expect(screen.getByTestId('plan-week')).toHaveTextContent('Hyatt free night');
    expect(screen.getAllByText(/\$100 is lost if it lapses/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Expiring offers: ends 2026-11-27/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Very little time left/).length).toBeGreaterThan(0);
    expect(screen.getByTestId('plan-specialists')).toHaveTextContent('Merchant Offers');
    expect(screen.getByTestId('plan-skipped')).toHaveTextContent('built-in planner');
    expect(screen.getByRole('button', { name: /Remind me soon/ })).toBeInTheDocument();
  });

  it('says who worded it, and whether a cloud model saw anything', () => {
    wrap(<PlanView r={RESPONSE({ narration: { text: 'Start with Hilton today.', model: 'Fake', provider: 'P', local: false, disclosureId: 'd1' }, narrationSkipped: null })} />);
    expect(screen.getByTestId('plan-narration')).toHaveTextContent('Start with Hilton today.');
    expect(screen.getByTestId('plan-narration')).toHaveTextContent('a cloud model that saw only a redacted summary');
    expect(screen.getByRole('link', { name: 'See what was sent' })).toHaveAttribute('href', '/settings#copilot');
    expect(screen.queryByTestId('plan-summary')).toBeNull();
  });

  it('says so when nothing needs attention', () => {
    const r = RESPONSE();
    r.plan.items = [];
    r.plan.headline = 'Nothing needs your attention right now.';
    wrap(<PlanView r={r} />);
    expect(screen.getByText(/You are on track/)).toBeInTheDocument();
  });
});

describe('Command bar in AI Mode', () => {
  let calls: Array<{ url: string; body?: string; method?: string }> = [];
  let aiMode = false;
  beforeEach(() => {
    calls = [];
    aiMode = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url);
        calls.push({ url: u, body: init?.body as string | undefined, method: init?.method });
        const ok = (data: unknown) => ({ ok: true, status: 200, statusText: 'OK', text: async () => JSON.stringify(data) }) as Response;
        if (u.includes('/copilot/settings')) {
          if (init?.method === 'PUT') aiMode = JSON.parse(init.body as string).aiModeEnabled;
          return ok({ aiModeEnabled: aiMode, mode: 'QUICK', modes: [], styles: [], providers: [], cloudShare: { consented: false, providers: [] } });
        }
        if (u.includes('/copilot/ask')) return ok(RESPONSE());
        if (u.includes('/search/ask'))
          return ok({
            sessionId: 's',
            answer: {
              unanswered: true,
              summary: 'x',
              related: [],
              actions: [],
              followUps: [],
              reasoning: [],
              evidence: [],
              warnings: [],
              sections: [],
              understood: [],
              confidence: 0,
              intent: 'UNKNOWN',
              kind: 'Q',
              title: 't',
            },
            slots: {},
            usedFollowUp: false,
            cached: false,
            tookMs: 1,
          });
        return ok({ q: '', understood: null, tookMs: 1, suggestions: [] });
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  const setup = () =>
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <CommandBar open onClose={vi.fn()} isAdmin={false} />
      </QueryClientProvider>,
    );

  it('the toggle switches modes and is announced as a switch', async () => {
    setup();
    const sw = await screen.findByRole('switch', { name: 'AI Mode' });
    await waitFor(() => expect(sw).toBeEnabled());
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'AI Mode' })).toHaveAttribute('aria-checked', 'true'));
    expect(JSON.parse(calls.find((c) => c.url.includes('/copilot/settings') && c.method === 'PUT')!.body!)).toEqual({ aiModeEnabled: true });
    expect(screen.getByTestId('ai-quick')).toBeInTheDocument();
  });

  it('with AI Mode on, a question goes to the Copilot and shows the plan', async () => {
    aiMode = true;
    setup();
    await screen.findByTestId('ai-quick');
    fireEvent.click(screen.getByRole('button', { name: 'What should I do today?' }));
    expect(await screen.findByTestId('plan-view')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/copilot/ask'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/search/ask'))).toBe(false);
    expect(JSON.parse(calls.find((c) => c.url.includes('/copilot/ask'))!.body!)).toEqual({ q: 'What should I do today?' });
  });

  it('with AI Mode off, the standard search engines answer', async () => {
    setup();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'purple monkey' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(calls.some((c) => c.url.includes('/search/ask'))).toBe(true));
    expect(calls.some((c) => c.url.includes('/copilot/ask'))).toBe(false);
  });
});
