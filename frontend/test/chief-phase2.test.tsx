import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChiefBoard } from '../src/components/chief-board';
import { ChiefCommand } from '../src/components/chief-command';
import { ChiefFees } from '../src/components/chief-fees';
import type { CommandCenterData, ExecItem, FeeReview, StoredBoard } from '../src/lib/chief';
import type { Briefing } from '../src/lib/copilot';

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'USER' } } }) }));

const item = (id: string, over: Record<string, unknown> = {}): ExecItem =>
  ({
    id,
    lens: 'OFFER',
    title: 'Hilton $100 ends tomorrow',
    recommendation: 'Spend $500',
    reason: 'r',
    evidence: [],
    assumptions: [],
    expectedValueCents: 10000,
    confidence: 90,
    href: '/x',
    calls: [],
    score: 82,
    band: 'CRITICAL',
    timeMinutes: 10,
    risk: { level: 'LOW', note: 'Low risk.' },
    impact: { cls: 'PRESERVED', atRiskCents: 10000, preservedCents: 10000, createdCents: 0, lostCents: 0, futureCents: 0 },
    deadline: null,
    daysLeft: 1,
    alternatives: [],
    sources: [],
    agents: [{ key: 'chief-of-staff', label: 'Chief of Staff' }],
    center: 'TODAY',
    ...over,
  }) as ExecItem;

const CMD: CommandCenterData = {
  generatedAt: '2026-11-26T15:00:00Z',
  values: {
    totalHouseholdCents: 612000,
    pointsCents: 240000,
    benefitsCents: 62000,
    certificatesCents: 25000,
    travelCreditsCents: 7000,
    offersAvailableCents: 32400,
    expiringAssetsCents: 84200,
    recentSavingsCents: 35000,
    savingsThisYearCents: 210000,
    opportunitiesCount: 4,
    opportunitiesCents: 52000,
    projectedSavingsCents: 80000,
  },
  scores: [
    {
      key: 'HOUSEHOLD',
      label: 'Household health',
      score: 71,
      grade: 'GOOD',
      reasons: ['The average of your other scores is 70.', '1 critical action waiting.'],
      href: '/household',
    },
    { key: 'LOYALTY', label: 'Loyalty health', score: 84, grade: 'STRONG', reasons: ['Loyalty health is 84/100.'], href: '/loyalty' },
    {
      key: 'PORTFOLIO',
      label: 'Card portfolio',
      score: 33,
      grade: 'WEAK',
      reasons: ['Your cards returned $500 against $1,000 in fees (50% covered).'],
      href: '/chief-of-staff#fees',
    },
    { key: 'OFFERS', label: 'Offer health', score: 55, grade: 'FAIR', reasons: ['$40 expired unused.'], href: '/offers/inventory' },
    { key: 'TRAVEL', label: 'Travel readiness', score: 66, grade: 'GOOD', reasons: ['1 certificate ready to use.'], href: '/travel' },
  ],
  outlook: {
    realizedYtdCents: 210000,
    projectedAdditionalCents: 80000,
    feesRemainingCents: 40000,
    netCents: 250000,
    lowCents: 230000,
    highCents: 270000,
    confidence: 70,
    assumptions: ['This is an estimate, shown as a range.'],
  },
  risks: [item('r1')],
  opportunities: [item('o1', { title: 'Activate the Marriott offer', band: 'MEDIUM', score: 40 })],
  today: [],
  top: [],
  confidence: 80,
};
const FEES: FeeReview = {
  generatedAt: '2026-11-26T15:00:00Z',
  verdicts: [
    {
      card: 'Platinum',
      member: 'Alex',
      verdict: 'RETENTION_CALL',
      netCents: -19500,
      justification: 'It returned $200 against a $395 fee, $195 short. 8 members who reported one accepted a retention offer. Call before it renews.',
      alternatives: ['Cancel if you no longer use its benefits.'],
      impactCents: 19500,
      daysToRenewal: 40,
      confidence: 70,
      evidence: ['Retention reports: 8 of 12 accepted an offer'],
    },
    {
      card: 'Venture X',
      member: 'Riley',
      verdict: 'KEEP',
      netCents: 43000,
      justification: 'Benefits and rewards exceed the annual fee by $430.',
      alternatives: [],
      impactCents: 0,
      daysToRenewal: 200,
      confidence: 85,
      evidence: [],
    },
  ],
  totals: {
    cards: 2,
    feesCents: 79000,
    valueCents: 102500,
    impactCents: 19500,
    counts: { KEEP: 1, RETENTION_CALL: 1, PRODUCT_CHANGE: 0, DOWNGRADE: 0, REPLACE: 0, CANCEL: 0, REVIEW: 0 },
  },
};
const board = (key: string, headline: string): StoredBoard => ({
  id: key,
  periodKey: key,
  createdAt: '2026-11-01T13:55:00Z',
  content: {
    kind: 'MONTHLY',
    periodKey: key,
    generatedAt: '2026-11-01T13:55:00Z',
    headline,
    summary: '1 card to decide on. Outlook for the year: about $2,500.',
    sections: [
      { key: 'savings', title: 'Savings realized', lines: [{ text: '$350 saved this month', tone: 'good', valueCents: 35000, href: '/offers/inventory' }], empty: '' },
      { key: 'missed', title: 'Missed opportunities', lines: [], empty: 'Nothing slipped away this month.' },
    ],
    stats: {},
    confidence: 70,
    assumptions: ['Savings count offers and credits recorded as received.'],
  } as Briefing,
});

let calls: Array<{ url: string; method?: string }> = [];
let boards: StoredBoard[] = [];
const ok = (data: unknown, status = 200) => ({ ok: true, status, statusText: 'OK', text: async () => JSON.stringify(data) }) as Response;
beforeEach(() => {
  calls = [];
  boards = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method });
      if (u.endsWith('/chief/command-center')) return ok(CMD);
      if (u.endsWith('/chief/fee-review')) return ok(FEES);
      if (u.includes('/chief/board') && init?.method === 'POST') {
        const b = board('2026-11', 'Board report for November 2026: $350 saved, $4,250 net portfolio value');
        boards = [b, ...boards];
        return ok({ board: b, created: true }, 201);
      }
      if (u.endsWith('/chief/board')) return ok(boards);
      return ok({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('Command center', () => {
  it('shows the household’s value in its parts', async () => {
    wrap(<ChiefCommand />);
    expect(await screen.findByTestId('cmd-values')).toBeInTheDocument();
    expect(screen.getByTestId('val-totalHouseholdCents')).toHaveTextContent('$6,120');
    expect(screen.getByTestId('val-pointsCents')).toHaveTextContent('$2,400');
    expect(screen.getByTestId('val-certificatesCents')).toHaveTextContent('$250');
    expect(screen.getByTestId('val-offersAvailableCents')).toHaveTextContent('$324');
    expect(screen.getByTestId('val-expiringAssetsCents')).toHaveTextContent('$842');
    expect(screen.getByTestId('val-opportunities')).toHaveTextContent('4');
  });
  it('shows five scores with a bar, a grade and the reasons behind each', async () => {
    wrap(<ChiefCommand />);
    const s = await screen.findByTestId('score-portfolio');
    expect(s).toHaveTextContent('33');
    expect(s).toHaveTextContent('Needs work');
    expect(s).toHaveTextContent('50% covered');
    expect(within(s).getByRole('progressbar', { name: 'Card portfolio score' })).toHaveAttribute('aria-valuenow', '33');
    expect(screen.getByTestId('score-loyalty')).toHaveTextContent('Strong');
    expect(within(screen.getByTestId('cmd-scores')).getAllByRole('listitem').length).toBeGreaterThanOrEqual(5);
  });
  it('shows the year as an estimate with a range and what it assumes, and the top risks and opportunities', async () => {
    wrap(<ChiefCommand />);
    expect(await screen.findByTestId('outlook-net')).toHaveTextContent('$2,500');
    expect(screen.getByTestId('cmd-outlook')).toHaveTextContent('Likely range $2,300 to $2,700');
    expect(screen.getByTestId('cmd-outlook')).toHaveTextContent('Confidence 70%');
    expect(screen.getByText('This is an estimate, shown as a range.')).toBeInTheDocument();
    expect(screen.getByTestId('risk-list')).toHaveTextContent('Hilton $100 ends tomorrow');
    expect(screen.getByTestId('opportunity-list')).toHaveTextContent('Activate the Marriott offer');
  });
});

describe('Annual fee review board', () => {
  it('lists each card with the recommendation, the reason in dollars and what it is worth', async () => {
    wrap(<ChiefFees />);
    expect(await screen.findByTestId('fees-summary')).toHaveTextContent('2 cards paid $790 in fees and returned $1,025 over 12 months');
    expect(screen.getByTestId('fees-summary')).toHaveTextContent('worth about $195 a year');
    const rows = screen.getAllByTestId('fee-verdict');
    expect(rows[0]).toHaveTextContent('Platinum');
    expect(rows[0]).toHaveTextContent('Retention call');
    expect(rows[0]).toHaveTextContent('Call before it renews');
    expect(rows[0]).toHaveTextContent('Renews in 40 days');
    expect(rows[0]).toHaveTextContent('Worth acting on $195 a year');
    expect(rows[1]).toHaveTextContent('Keep');
    expect(rows[1]).toHaveTextContent('Benefits and rewards exceed the annual fee by $430.');
    fireEvent.click(within(rows[0]).getByText('Alternatives and evidence'));
    expect(rows[0]).toHaveTextContent('Cancel if you no longer use its benefits.');
    expect(rows[0]).toHaveTextContent('Retention reports: 8 of 12');
  });
});

describe('Board report', () => {
  it('invites you to write one, then shows it section by section', async () => {
    wrap(<ChiefBoard />);
    expect(await screen.findByTestId('board-empty')).toHaveTextContent('written on the 1st of each month');
    fireEvent.click(screen.getByTestId('board-make'));
    await waitFor(() => expect(screen.getByTestId('board-headline')).toHaveTextContent('Board report for November 2026'));
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/chief/board'))).toBe(true);
    expect(screen.getByTestId('board-savings')).toHaveTextContent('$350 saved this month');
    expect(within(screen.getByTestId('board-savings')).getByRole('link', { name: '$350 saved this month' })).toHaveAttribute('href', '/offers/inventory');
    expect(screen.getByTestId('board-missed')).toHaveTextContent('Nothing slipped away this month.');
    expect(screen.getByText('Savings count offers and credits recorded as received.')).toBeInTheDocument();
  });
  it('shows earlier reports and can write a fresh one', async () => {
    boards = [board('2026-11', 'November'), board('2026-10', 'October')];
    wrap(<ChiefBoard />);
    expect(await screen.findByTestId('board-headline')).toHaveTextContent('November');
    fireEvent.click(within(screen.getByTestId('board-history')).getByRole('button', { name: '2026-10' }));
    expect(screen.getByTestId('board-headline')).toHaveTextContent('October');
    fireEvent.click(screen.getByTestId('board-refresh'));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/chief/board?fresh=true'))).toBe(true));
  });
});
