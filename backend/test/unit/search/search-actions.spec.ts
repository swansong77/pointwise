import { composeAnswer, StepResult } from '../../../src/domain/answer-compose';
import { Dictionaries, understand } from '../../../src/domain/query-understanding';
import { checkReminder, reminderDue, safeLink } from '../../../src/domain/reminders';
import { actionsFor, isSafeCall } from '../../../src/domain/search-actions';
import { routeFor } from '../../../src/domain/search-router';
import { MERCHANT_IDENTITIES } from '../../../src/seed/merchant-identities';

const NOW = new Date('2026-11-26T15:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();
const merchants = MERCHANT_IDENTITIES.map((i, n) => ({ id: `m${n}`, slug: i.slug, name: i.name, hosts: i.hosts, aliases: i.aliases, mcc: i.mcc, parentCompany: i.parent }));
const dict: Dictionaries = { merchants, cards: [], members: [{ id: 'p1', nickname: 'Alex', relationship: 'SELF' }], programs: [] };
const UUID = '11111111-1111-4111-8111-111111111111';

const run = (q: string, data: Record<string, unknown>) => {
  const u = understand(q, dict, NOW);
  const route = routeFor(u);
  const results: StepResult[] = route.steps.map((s) => ({ tool: s.tool, label: s.label, ok: true, summary: 'x', data: data[s.tool] ?? {} }));
  return { u, route, results, calls: actionsFor(u, route, results, NOW), answer: composeAnswer(u, route, results, NOW) };
};

describe('TC-REMIND: reminder rules', () => {
  it('links stay inside the app', () => {
    expect(safeLink('/offers/expirations')).toBe('/offers/expirations');
    for (const bad of ['https://evil.test', '//evil.test', 'javascript:alert(1)', '/\\evil', 'offers', '', null, 5, '/a\nb']) expect(safeLink(bad as never)).toBeNull();
  });
  it('due date is 3 days before at 14:00 UTC, else in an hour, never after the end', () => {
    expect(reminderDue(new Date('2026-12-20T03:00:00Z'), NOW, 3)?.toISOString()).toBe('2026-12-17T14:00:00.000Z');
    expect(reminderDue(new Date('2026-11-28T03:00:00Z'), NOW, 3)?.toISOString()).toBe('2026-11-26T16:00:00.000Z');
    expect(reminderDue(new Date('2026-11-26T15:30:00Z'), NOW, 3)).toBeNull();
    expect(reminderDue(new Date('2026-11-25T15:30:00Z'), NOW, 3)).toBeNull();
  });
  it('validates title, date and link', () => {
    expect(checkReminder({ title: '  Use   credit ', dueAt: day(3), link: '/loyalty' }, NOW)).toMatchObject({ ok: true, title: 'Use credit', link: '/loyalty' });
    expect(checkReminder({ title: '', dueAt: day(3) }, NOW)).toMatchObject({ ok: false });
    expect(checkReminder({ title: 'x'.repeat(121), dueAt: day(3) }, NOW)).toMatchObject({ ok: false });
    expect(checkReminder({ title: 'a', dueAt: day(-2) }, NOW)).toMatchObject({ ok: false, error: 'That date has already passed' });
    expect(checkReminder({ title: 'a', dueAt: day(900) }, NOW)).toMatchObject({ ok: false });
    expect(checkReminder({ title: 'a', dueAt: 'nope' }, NOW)).toMatchObject({ ok: false });
    expect(checkReminder({ title: 'a', dueAt: day(3), link: 'https://x.test' }, NOW)).toMatchObject({ ok: false });
  });
});

describe('TC-ACT: actions offered with an answer', () => {
  it('only allow-listed POST paths pass', () => {
    expect(isSafeCall({ method: 'POST', path: '/reminders' })).toBe(true);
    expect(isSafeCall({ method: 'POST', path: `/offer-automation/items/${UUID}/mark-enrolled` })).toBe(true);
    expect(isSafeCall({ method: 'POST', path: '/auth/logout' })).toBe(false);
    expect(isSafeCall({ method: 'POST', path: '/offers/intel/activation/../../admin' })).toBe(false);
    expect(isSafeCall({ method: 'DELETE' as never, path: '/reminders' })).toBe(false);
  });

  it('a purchase plan can be saved and gets a reminder for the expiring offer', () => {
    const { calls, answer } = run('What card should I use at Costco for $1,500?', {
      plan_purchase: { amountCents: 150000, plans: [{ best: {} }], expiryImpact: [{ label: 'Costco $20 credit', endsAt: day(20) }] },
    });
    expect(calls.map((c) => c.kind)).toEqual(['SAVE_PLAN', 'REMINDER']);
    expect(calls[0]).toMatchObject({ path: '/offers/intel/plan', body: expect.objectContaining({ amountCents: 150000, save: true }), confirm: null });
    expect(calls[1].body).toMatchObject({ link: '/offers/plan' });
    expect(answer.calls).toHaveLength(2);
  });

  it('a flight question offers to save the trip', () => {
    const { calls } = run('Flight to Hawaii next month', { plan_award_trip: { options: [] } });
    expect(calls.find((c) => c.kind === 'SAVE_TRIP')).toMatchObject({ path: '/loyalty/award-trips', body: expect.objectContaining({ save: true }) });
  });

  it('"Sync offers" asks for confirmation and only when an account is connected', () => {
    const connected = run('Sync offers', { get_offer_sync_status: { accounts: [{ id: 'a' }] } });
    expect(connected.u.intent).toBe('SYNC_OFFERS');
    expect(connected.calls).toHaveLength(1);
    expect(connected.calls[0]).toMatchObject({ kind: 'SYNC', path: '/offer-automation/sync' });
    expect(connected.calls[0].confirm).toMatch(/opt-in/);
    expect(run('Sync offers', { get_offer_sync_status: { accounts: [] } }).calls).toHaveLength(0);
  });

  it('marking an offer added or activated is assisted: confirmation says to do it on the issuer site first', () => {
    const { calls } = run('Show all Hilton offers', {
      search_offer_inventory: {
        items: [
          { id: UUID, state: 'AVAILABLE', origin: 'SYNC', merchant: { name: 'Hilton' } },
          { id: UUID.replace(/1/g, '2'), state: 'ADDED', origin: 'USER_OFFER', enrollmentRequired: true, merchant: { name: 'Hilton' } },
        ],
      },
    });
    const kinds = calls.map((c) => c.kind);
    expect(kinds).toEqual(expect.arrayContaining(['ACTIVATE', 'MARK_ADDED']));
    for (const c of calls) expect(c.confirm).toMatch(/issuer/);
  });

  it('ignores rows whose id is not a uuid and unsafe paths never leak out', () => {
    const { calls } = run('Show all Hilton offers', { search_offer_inventory: { items: [{ id: '../../x', state: 'AVAILABLE', origin: 'SYNC', merchant: { name: 'Hilton' } }] } });
    expect(calls).toHaveLength(0);
  });

  it('certificate reminders for the soonest expiry', () => {
    const { calls } = run('Which free night certificates expire next?', { get_certificates: { certificates: [{ name: 'Hyatt FNA', expiresAt: day(40) }, { name: 'Hilton FNC', expiresAt: day(25) }] } });
    expect(calls).toHaveLength(1);
    expect(calls[0].body.title).toMatch(/Hilton FNC/);
  });

  it('no actions when the question is unanswered', () => {
    expect(run('purple monkey', {}).answer.calls).toEqual([]);
  });
});
