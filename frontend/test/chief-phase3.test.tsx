import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChiefGovernance } from '../src/components/chief-governance';
import { ChiefHousehold } from '../src/components/chief-household';
import { ChiefLife } from '../src/components/chief-life';
import { ChiefRoadmap, RoadmapView } from '../src/components/chief-roadmap';
import { PlanView } from '../src/components/plan-view';
import type { Governance, HouseholdChiefData, LifeEvent, RoadmapData } from '../src/lib/chief';
import type { CopilotResponse } from '../src/lib/copilot';

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'USER' } } }) }));

const ROAD: RoadmapData = {
  span: 90,
  headline: '3 things on the calendar for the next 90 days, worth about $450; $250 of it is lost if nothing is done.',
  phases: [
    {
      label: 'Next 30 days',
      from: '2026-11-26',
      to: '2026-12-25',
      events: [{ date: '2026-12-01', title: 'Hilton $100 ends', area: 'OFFERS', valueCents: 25000, atRisk: true, href: '/offers/expirations' }],
      valueCents: 25000,
      atRiskCents: 25000,
    },
    { label: 'Days 31–60', from: '2026-12-26', to: '2027-01-24', events: [], valueCents: 0, atRiskCents: 0 },
    {
      label: 'Days 61–90',
      from: '2027-01-25',
      to: '2027-02-23',
      events: [{ date: '2027-02-01', title: 'Riley: a 5/24 slot opens', area: 'APPLICATIONS', valueCents: 0, atRisk: false, href: '/chief-of-staff#governance' }],
      valueCents: 0,
      atRiskCents: 0,
    },
  ],
  focus: [
    { area: 'OFFERS', label: 'Offers and credits', advice: 'Use or activate what is about to lapse.', events: 1, valueCents: 25000 },
    { area: 'APPLICATIONS', label: 'Applications and 5/24', advice: 'Plan applications around 5/24 slot dates.', events: 1, valueCents: 0 },
  ],
  totalValueCents: 45000,
  atRiskCents: 25000,
  eventCount: 3,
};
const GOV: Governance = {
  headline: '1 member at the 5/24 limit; a good next card is ready for someone who is not',
  members: [
    { member: 'Alex', label: '2/24', state: 'OPEN', slots: 3, nextSlotAt: null, recentApprovals: [{ card: 'Gold', approvedAt: '2026-10-01' }], upcomingDrops: ['2026-12-26'] },
    { member: 'Riley', label: '6/24', state: 'AT_LIMIT', slots: 0, nextSlotAt: '2027-02-24', recentApprovals: [], upcomingDrops: [] },
  ],
  advice: [
    { kind: 'WAIT', text: 'Riley: wait until 2027-02-24 for Chase eligibility', detail: 'Riley is at 6/24.', member: 'Riley', valueCents: null, date: '2027-02-24' },
    {
      kind: 'APPLY',
      text: 'Apply for Sapphire Preferred next (Alex)',
      detail: 'About $900 in the first year. This is a suggestion; whether and when to apply is yours to decide.',
      member: 'Alex',
      valueCents: 90000,
      date: null,
    },
  ],
};
const HOUSE: HouseholdChiefData = {
  headline: '1 of 3 members has something to do, and 1 thing belongs to the household',
  members: [
    {
      member: 'Alex',
      relationship: 'SELF',
      isPrimary: true,
      five24: '2/24',
      cardsHeld: 3,
      actions: [{ id: 'a', title: 'Hilton $100 ends tomorrow', recommendation: 'x', band: 'CRITICAL', score: 82, valueCents: 10000, href: '/offers/expirations' }],
    },
    { member: 'Sam', relationship: 'CHILD', isPrimary: false, five24: null, cardsHeld: 0, actions: [] },
  ],
  shared: [{ id: 'c', title: 'Update the Delta balance', recommendation: 'x', band: 'LOW', score: 15, valueCents: null, href: '/loyalty' }],
  authorizedUsers: [{ member: 'Sam', card: 'Gold', holder: 'Alex', text: "Sam could be added as an authorized user on Alex's Gold, which charges nothing for one." }],
  bestCardByCategory: [
    { category: 'Dining', card: 'Gold', holder: 'Riley', centsPerDollar: 4, annualSpendCents: 480000, text: "Dining: Gold (Riley's) earns 4¢ per dollar on about $4,800 a year" },
  ],
};
const EVENT: LifeEvent = {
  id: 'e1',
  kind: 'FAMILY_VACATION',
  title: 'Disney week',
  destination: 'Orlando',
  startsOn: '2027-01-10T12:00:00Z',
  endsOn: '2027-01-17T12:00:00Z',
  travelers: 4,
  budgetCents: 400000,
  status: 'PLANNING',
  estimate: null,
  estimatedAt: null,
};
const ESTIMATE = {
  assumed: ['No budget, so it assumes $2,400 for flights.'],
  bestCards: [{ use: 'Flights', card: 'Contoso Gold', member: 'Alex', expectedCents: 4800, netCostCents: 0, why: '' }],
  offers: ['Activate the Delta offer first'],
  pointsUse: { program: 'SkyHigh', pointsNeeded: 60000, covered: 45000, shortfall: 15000, summary: 's' },
  travelCredits: { cents: 20000, items: [] },
  certificates: [{ name: 'Hyatt free night', cents: 25000, expiresOn: '2027-06-01', usable: true }],
  transferBonuses: ['MR to Hilton: 30% bonus'],
  expectedValueCents: 49800,
  assumptions: ['Points are shown separately and are not added to the total.'],
  risks: ['Award space changes.'],
  confidence: 62,
};

let calls: Array<{ url: string; method?: string; body?: string }> = [];
let events: LifeEvent[] = [];
const ok = (data: unknown, status = 200) => ({ ok: true, status, statusText: 'OK', text: async () => (data === undefined ? '' : JSON.stringify(data)) }) as Response;
beforeEach(() => {
  calls = [];
  events = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method, body: init?.body as string | undefined });
      if (u.includes('/chief/roadmap')) return ok(u.endsWith('365') ? { ...ROAD, span: 365, headline: 'A year of things', phases: ROAD.phases.slice(0, 1) } : ROAD);
      if (u.endsWith('/chief/governance')) return ok(GOV);
      if (u.endsWith('/chief/household')) return ok(HOUSE);
      if (u.endsWith('/chief/life-events') && init?.method === 'POST') {
        events = [{ ...EVENT, ...JSON.parse(init.body as string), id: 'e1', estimate: null }];
        return ok(events[0], 201);
      }
      if (u.endsWith('/chief/life-events/e1/estimate')) {
        events = [{ ...events[0], estimate: ESTIMATE as never }];
        return ok({ event: events[0], estimate: ESTIMATE }, 201);
      }
      if (u.endsWith('/chief/life-events/e1') && init?.method === 'DELETE') {
        events = [];
        return ok(undefined, 204);
      }
      if (u.endsWith('/chief/life-events')) return ok(events);
      return ok({});
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('Roadmap', () => {
  it('shows the headline, where to focus, and each phase with its dated events', () => {
    wrap(<RoadmapView r={ROAD} />);
    expect(screen.getByTestId('roadmap-headline')).toHaveTextContent('3 things on the calendar for the next 90 days');
    expect(screen.getByTestId('roadmap-focus')).toHaveTextContent('1. Offers and credits');
    expect(screen.getByTestId('roadmap-focus')).toHaveTextContent('Plan applications around 5/24 slot dates.');
    const phases = screen.getAllByTestId('roadmap-phase');
    expect(phases).toHaveLength(3);
    expect(phases[0]).toHaveTextContent('Next 30 days');
    expect(phases[0]).toHaveTextContent('$250 at risk');
    expect(within(phases[0]).getByRole('link', { name: 'Hilton $100 ends' })).toHaveAttribute('href', '/offers/expirations');
    expect(phases[0]).toHaveTextContent('lost if missed');
    expect(phases[1]).toHaveTextContent('Nothing scheduled.');
  });
  it('switches between the next 90 days and the year', async () => {
    wrap(<ChiefRoadmap />);
    expect(await screen.findByTestId('roadmap-headline')).toHaveTextContent('next 90 days');
    expect(screen.getByTestId('roadmap-90')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('roadmap-365'));
    await waitFor(() => expect(screen.getByTestId('roadmap-headline')).toHaveTextContent('A year of things'));
    expect(calls.some((c) => c.url.endsWith('/chief/roadmap?days=365'))).toBe(true);
  });
  it('is shown for a strategic question asked in AI Mode', () => {
    const r = {
      runId: 'r',
      mode: 'PLANNING',
      plan: {
        mode: 'PLANNING',
        kind: 'ROADMAP',
        question: 'q',
        headline: 'Your next 90 days',
        summary: ROAD.headline,
        items: [],
        lenses: [],
        assumptions: [],
        risks: [],
        confidence: 70,
        evidence: [],
        counts: { TODAY: 0, WEEK: 0, MONTH: 0, LATER: 0 },
        valueAtStakeCents: 0,
        roadmap: ROAD,
      },
      narration: null,
      narrationSkipped: null,
      sessionId: null,
      tookMs: 1,
    } as unknown as CopilotResponse;
    wrap(<PlanView r={r} />);
    expect(screen.getByTestId('roadmap-view')).toBeInTheDocument();
    expect(screen.getAllByTestId('roadmap-phase')).toHaveLength(3);
  });
});

describe('Application governance', () => {
  it('shows each member’s 5/24, the next slot, and the advice as suggestions', async () => {
    wrap(<ChiefGovernance />);
    expect(await screen.findByTestId('gov-headline')).toHaveTextContent('1 member at the 5/24 limit');
    const [alex, riley] = screen.getAllByTestId('gov-member');
    expect(alex).toHaveTextContent('2/24');
    expect(alex).toHaveTextContent('Open');
    expect(alex).toHaveTextContent('3 slots open');
    expect(alex).toHaveTextContent('Opened in the last 90 days: Gold');
    expect(riley).toHaveTextContent('6/24');
    expect(riley).toHaveTextContent('At the limit');
    expect(riley).toHaveTextContent('Next slot opens');
    const advice = screen.getByTestId('gov-advice');
    expect(advice).toHaveTextContent('Wait');
    expect(advice).toHaveTextContent('Apply next');
    expect(advice).toHaveTextContent('whether and when to apply is yours to decide');
  });
});

describe('Life events', () => {
  it('explains the empty state and adds an event, asking for a destination only for travel', async () => {
    wrap(<ChiefLife />);
    expect(await screen.findByTestId('life-empty')).toHaveTextContent('best cards, credits and points');
    const add = screen.getByRole('button', { name: 'Add event' });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Name it'), { target: { value: 'Disney week' } });
    expect(add).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Where to'), { target: { value: 'Orlando' } });
    fireEvent.change(screen.getByLabelText('Travelers'), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText('Budget in dollars (optional)'), { target: { value: '4000' } });
    expect(add).toBeEnabled();
    fireEvent.click(add);
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/chief/life-events'))).toBe(true));
    expect(JSON.parse(calls.find((c) => c.method === 'POST')!.body!)).toMatchObject({
      kind: 'FAMILY_VACATION',
      title: 'Disney week',
      destination: 'Orlando',
      travelers: 4,
      budgetCents: 400000,
    });
    expect(await screen.findByTestId('life-event')).toHaveTextContent('Disney week');
    fireEvent.change(screen.getByLabelText('What is it?'), { target: { value: 'MOVING' } });
    expect(screen.queryByLabelText('Where to')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add event' })).toBeDisabled();
  });

  it('works out the value of an event and shows the parts, the assumptions and the risks', async () => {
    events = [EVENT];
    wrap(<ChiefLife />);
    fireEvent.click(await screen.findByRole('button', { name: 'Estimate Disney week' }));
    const est = await screen.findByTestId('life-estimate');
    expect(est).toHaveTextContent('Expected value about $498');
    expect(est).toHaveTextContent('confidence 62%');
    expect(est).toHaveTextContent('Flights: Contoso Gold (Alex), expected return $48');
    expect(est).toHaveTextContent('Activate the Delta offer first');
    expect(est).toHaveTextContent('Hyatt free night ($250)');
    expect(est).toHaveTextContent('Travel credits you could use: $200');
    expect(est).toHaveTextContent('SkyHigh, 60,000 needed, 15,000 short');
    expect(est).toHaveTextContent('MR to Hilton: 30% bonus');
    expect(est).toHaveTextContent('Points are shown separately');
    expect(screen.getByRole('button', { name: 'Refresh the estimate for Disney week' })).toBeInTheDocument();
  });

  it('removes an event after asking', async () => {
    events = [EVENT];
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    wrap(<ChiefLife />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Disney week' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));
  });
});

describe('Household chief', () => {
  it('gives each member their actions, the rest to the household, authorized-user ideas and the best card per category', async () => {
    wrap(<ChiefHousehold />);
    expect(await screen.findByTestId('house-headline')).toHaveTextContent('1 of 3 members has something to do');
    const [alex, sam] = screen.getAllByTestId('house-member');
    expect(alex).toHaveTextContent('2/24');
    expect(alex).toHaveTextContent('3 cards');
    expect(within(alex).getByRole('link', { name: 'Hilton $100 ends tomorrow' })).toHaveAttribute('href', '/offers/expirations');
    expect(alex).toHaveTextContent('Critical');
    expect(sam).toHaveTextContent('child');
    expect(sam).toHaveTextContent('Nothing for them right now.');
    expect(screen.getByTestId('house-shared')).toHaveTextContent('Update the Delta balance');
    expect(screen.getByTestId('house-au')).toHaveTextContent('Sam could be added as an authorized user');
    expect(screen.getByTestId('house-best')).toHaveTextContent("Dining: Gold (Riley's) earns 4¢ per dollar");
  });
});
