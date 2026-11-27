import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoalsPanel } from '../src/components/goals-panel';
import { MemoryPanel } from '../src/components/memory-panel';
import { PlanView } from '../src/components/plan-view';
import type { CopilotResponse, Goal, WhatIfOutcome } from '../src/lib/copilot';

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'USER' } } }) }));

const OUTCOME: WhatIfOutcome = {
  scenario: 'CANCEL',
  title: 'What if you cancel Venture X?',
  summary: 'Cancelling Venture X would cost about $25 a year.',
  verdict: 'MIXED',
  recommendation: 'It is close to break-even, so the choice comes down to whether you will use its benefits.',
  deltas: [
    { dimension: 'FINANCIAL', label: 'Annual fee', before: '$395', after: '$0', change: '+$395 saved', direction: 'BETTER' },
    { dimension: 'BENEFITS', label: 'Credits used (12 months)', before: '$300', after: '$0', change: '-$300', direction: 'WORSE' },
    { dimension: 'FIVE24', label: '5/24', before: 'counts', after: 'still counts', change: 'closing does not remove it for 24 months', direction: 'SAME' },
  ],
  netCents: -2500,
  assumptions: ['Another card earns the spend instead.'],
  risks: ['Closing can lower your available credit.'],
  alternatives: ['Ask for a retention offer before cancelling.'],
  evidence: ['Wallet calculator'],
  confidence: 70,
};
const WHATIF = {
  runId: 'r1',
  mode: 'QUICK',
  plan: {
    mode: 'QUICK',
    kind: 'WHATIF',
    question: 'What if I cancel Venture X?',
    headline: OUTCOME.title,
    summary: OUTCOME.summary,
    items: [
      {
        id: 'whatif:cancel',
        lens: 'CARD_STRATEGY',
        horizon: 'TODAY',
        title: OUTCOME.title,
        recommendation: OUTCOME.recommendation,
        reason: OUTCOME.summary,
        evidence: ['Wallet calculator'],
        expectedValueCents: -2500,
        assumptions: [],
        risks: [],
        confidence: 70,
        factors: [],
        href: '/copilot',
        calls: [],
      },
    ],
    lenses: [{ lens: 'CARD_STRATEGY', label: 'Card Strategy', engines: ['what-if'], ok: true, found: 1, note: 'Compared' }],
    assumptions: OUTCOME.assumptions,
    risks: OUTCOME.risks,
    confidence: 70,
    evidence: [],
    counts: { TODAY: 1, WEEK: 0, MONTH: 0, LATER: 0 },
    valueAtStakeCents: 0,
    memory: { hidden: [], boosted: 0 },
    whatIf: OUTCOME,
  },
  narration: null,
  narrationSkipped: null,
  sessionId: null,
  tookMs: 4,
} as unknown as CopilotResponse;

let calls: Array<{ url: string; method?: string; body?: string }> = [];
let goals: Goal[] = [];
let memory: unknown[] = [];
const ok = (data: unknown, status = 200) => ({ ok: true, status, statusText: 'OK', text: async () => (data === undefined ? '' : JSON.stringify(data)) }) as Response;
beforeEach(() => {
  calls = [];
  goals = [];
  memory = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body as string | undefined });
      if (u.includes('/copilot/goals') && init?.method === 'POST') {
        const b = JSON.parse(init.body as string);
        goals = [
          {
            id: 'g1',
            kind: b.kind,
            title: b.title,
            status: 'ACTIVE',
            dueAt: null,
            manualProgress: null,
            progress: { pct: 40, current: '20 of 30', target: 'Hyatt Globalist', state: 'AT_RISK', detail: 'Needs 10 more nights.', next: ['10 more to qualify.'], confidence: 80 },
          },
        ];
        return ok(goals[0], 201);
      }
      if (u.includes('/copilot/goals')) return ok(goals);
      if (u.includes('/copilot/memory/preferences')) return ok({ airlines: ['Delta'], hotels: [], destinations: [], merchants: [], priorities: ['TRAVEL'] });
      if (u.includes('/copilot/memory/decisions')) return ok({ itemId: 'x', action: 'SNOOZE' }, 201);
      if (u.includes('/copilot/memory')) return init?.method === 'DELETE' ? ok(undefined, 204) : ok(memory);
      return ok({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('what-if view', () => {
  it('shows the verdict, the recommendation and a labelled before/after table', () => {
    wrap(<PlanView r={WHATIF} />);
    expect(screen.getByText('Mixed')).toBeInTheDocument();
    expect(screen.getByText(/-\$25 a year|\$-25 a year|-\$25/)).toBeInTheDocument();
    const t = screen.getByRole('table');
    expect(
      within(t)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['What', 'Now', 'If', 'Change']);
    expect(within(t).getByRole('row', { name: /Annual fee/ })).toHaveTextContent('$395');
    expect(within(t).getByRole('row', { name: /Credits used/ })).toHaveTextContent('worse');
    expect(screen.getByText(/closing does not remove it/)).toBeInTheDocument();
    expect(screen.getByText(/Ask for a retention offer/)).toBeInTheDocument();
    // a single comparison is not repeated as a "Today" card
    expect(screen.queryByTestId('plan-today')).toBeNull();
    expect(screen.queryByTestId('decide')).toBeNull();
  });
});

describe('putting plan items aside', () => {
  const agenda = (): CopilotResponse => {
    const r = JSON.parse(JSON.stringify(WHATIF)) as CopilotResponse;
    r.plan.kind = 'AGENDA';
    r.plan.whatIf = undefined;
    r.plan.items[0].id = 'offer-exp:o1';
    r.plan.memory = { hidden: [{ id: 'x', title: 'Hidden one', action: 'SNOOZE', until: '2026-12-01T00:00:00Z' }], boosted: 0 };
    return r;
  };
  it('snooze sends the decision and confirms', async () => {
    wrap(<PlanView r={agenda()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Snooze 7 days' }));
    expect(await screen.findByTestId('decision-result')).toHaveTextContent('Snoozed for 7 days');
    const sent = calls.find((c) => c.url.includes('/copilot/memory/decisions'))!;
    expect(JSON.parse(sent.body!)).toEqual({ itemId: 'offer-exp:o1', action: 'SNOOZE', days: 7 });
  });
  it('done and not interested', async () => {
    wrap(<PlanView r={agenda()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Not interested' }));
    expect(await screen.findByTestId('decision-result')).toHaveTextContent('Dismissed');
    expect(JSON.parse(calls.find((c) => c.url.includes('decisions'))!.body!)).toEqual({ itemId: 'offer-exp:o1', action: 'DISMISS' });
  });
  it('says how many items are hidden and links to where to manage them', () => {
    wrap(<PlanView r={agenda()} />);
    expect(screen.getByTestId('plan-hidden')).toHaveTextContent('1 item you put aside is hidden');
    expect(screen.getByRole('link', { name: 'Manage what Copilot remembers' })).toHaveAttribute('href', '/copilot#memory');
  });
});

describe('goals panel', () => {
  it('explains an empty list and adds a goal with the right target fields', async () => {
    wrap(<GoalsPanel />);
    expect(await screen.findByTestId('goals-empty')).toHaveTextContent('No goals yet');
    fireEvent.change(screen.getByLabelText('Name it'), { target: { value: 'Hyatt Globalist' } });
    fireEvent.change(screen.getByLabelText(/^Program/), { target: { value: 'Hyatt' } });
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'Globalist' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add goal' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/copilot/goals'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toEqual({ kind: 'STATUS', title: 'Hyatt Globalist', target: { program: 'Hyatt', level: 'Globalist' } });
    const row = await screen.findByTestId('goal');
    expect(row).toHaveTextContent('At risk');
    expect(row).toHaveTextContent('40%');
    expect(within(row).getByRole('progressbar', { name: 'Progress: Hyatt Globalist' })).toHaveAttribute('aria-valuenow', '40');
    expect(row).toHaveTextContent('Next: 10 more to qualify.');
  });
  it('dollar fields are sent as cents and the form changes with the type', async () => {
    wrap(<GoalsPanel />);
    await screen.findByTestId('goals-empty');
    fireEvent.change(screen.getByLabelText('Goal type'), { target: { value: 'FEES' } });
    fireEvent.change(screen.getByLabelText('Annual fees at most ($)'), { target: { value: '250' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add goal' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toMatchObject({ kind: 'FEES', title: 'Keep annual fees down', target: { maxCents: 25000 } });
  });
});

describe('memory panel', () => {
  it('saves preferences as lists and priorities as they are ticked', async () => {
    wrap(<MemoryPanel />);
    const air = await screen.findByLabelText('Airlines you prefer');
    await waitFor(() => expect(air).toHaveValue('Delta'));
    fireEvent.change(air, { target: { value: 'Delta, United ,' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'PUT')).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'PUT')!.body!)).toMatchObject({ airlines: ['Delta', 'United'], hotels: [] });
    expect(screen.getByTestId('priority-TRAVEL')).toBeChecked();
    fireEvent.click(screen.getByTestId('priority-CASHBACK'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2));
    expect(JSON.parse(calls.filter((c) => c.method === 'PUT')[1].body!)).toEqual({ priorities: ['TRAVEL', 'CASHBACK'] });
  });
  it('does not overwrite text you have typed when a priority is ticked', async () => {
    wrap(<MemoryPanel />);
    const air = await screen.findByLabelText('Airlines you prefer');
    await waitFor(() => expect(air).toHaveValue('Delta'));
    fireEvent.change(air, { target: { value: 'Delta, JetBlue' } });
    fireEvent.click(screen.getByTestId('priority-CASHBACK'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByLabelText('Airlines you prefer')).toHaveValue('Delta, JetBlue');
  });
  it('lists what is put aside and can show it again or forget everything', async () => {
    memory = [
      {
        id: 'm1',
        kind: 'DECISION',
        key: 'offer-exp:o1',
        value: { action: 'SNOOZE', until: new Date(Date.now() + 5 * 86_400_000).toISOString() },
        updatedAt: new Date().toISOString(),
      },
    ];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    wrap(<MemoryPanel />);
    const list = await screen.findByTestId('memory-decisions');
    expect(list).toHaveTextContent('offer-exp:o1');
    fireEvent.click(within(list).getByRole('button', { name: 'Show again: offer-exp:o1' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/copilot/memory/m1'))).toBe(true));
    fireEvent.click(screen.getByTestId('forget-all'));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.url.endsWith('/copilot/memory'))).toBe(true));
  });
});
