import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminCashbackPage from '../src/app/(app)/admin/cashback/page';
import CashbackPage from '../src/app/(app)/cashback/page';
import { CashbackCard } from '../src/components/cashback-card';
import type { CashbackRec, RankedSite } from '../src/lib/cashback';

vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { accessToken: 't', user: { role: 'ADMIN' } } }) }));

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const wrap = (ui: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const calls: Array<{ url: string; method?: string; body?: string }> = [];
const sent = (method: string, part: string) => calls.find((c) => c.method === method && c.url.includes(part));

const site = (over: Partial<RankedSite>): RankedSite => ({
  site: 'rakuten', name: 'Rakuten', kind: 'CASHBACK', label: '2% cash back', percent: 2, upTo: false, expectedPercent: 2, expectedCents: 1000, reliability: 60,
  freshness: 'FRESH', health: 'UP', healthNote: 'Answered today.', usable: true, hasAccount: true, holders: ['Riley'], conditions: null, observedAt: '2026-12-01T00:00:00Z', method: 'MANUAL', url: 'https://www.rakuten.com', warnings: [], ...over,
});
const REC: CashbackRec = {
  haveAccounts: true,
  pick: site({}),
  consider: { ...site({ site: 'topcashback', name: 'TopCashback', label: 'up to 9% cash back', upTo: true, expectedCents: 2700, hasAccount: false, holders: [] }), extraCents: 1700 },
  ranked: [site({}), site({ site: 'topcashback', name: 'TopCashback', label: 'up to 9% cash back', expectedCents: 2700, hasAccount: false, holders: [] }), site({ site: 'befrugal', name: 'BeFrugal', label: '3% cash back', health: 'DOWN', healthNote: 'Did not answer the last 3 checks.', usable: false, hasAccount: false, holders: [], freshness: 'STALE' })],
  steps: ['Sign in to Rakuten (Riley has the account) and open Target from there.', 'Pay with Gold Card in the same session.'],
  warnings: ['One of the sites is not answering.'],
  monitorUrl: 'https://www.cashbackmonitor.com/cashback-store/target/',
  benchmark: { source: 'Cashback Monitor', bestPercent: 5, observedAt: '2026-12-01T00:00:00Z', url: 'https://www.cashbackmonitor.com/cashback-store/target/' },
};

beforeEach(() => {
  calls.length = 0;
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

describe('TC-CB-UI: the recommendation card', () => {
  it('names the site to use, the steps, a better one to join, and every site with its status', () => {
    wrap(<CashbackCard rec={REC} merchant="Target" />);
    expect(within(screen.getByTestId('cashback-pick')).getByText(/Use Rakuten: 2% cash back, about \$10/)).toBeTruthy();
    expect(screen.getByTestId('cashback-steps').textContent).toContain('Riley has the account');
    expect(screen.getByTestId('cashback-consider').textContent).toContain('TopCashback');
    expect(screen.getByTestId('cashback-consider').textContent).toContain('$17 more');
    expect(screen.getByTestId('cashback-warnings').textContent).toContain('not answering');
    const rows = screen.getAllByTestId('cashback-row');
    expect(rows).toHaveLength(3);
    expect(rows[2].textContent).toContain('Not answering');
    expect(rows[2].textContent).toContain('not counted');
    expect(rows[2].textContent).toContain('out of date');
    expect(rows[1].textContent).toContain('nobody has joined');
    const link = screen.getByTestId('cashback-monitor-link') as HTMLAnchorElement;
    expect(link.href).toBe('https://www.cashbackmonitor.com/cashback-store/target/');
    expect(link.textContent).toBe('Compare every site for Target on Cashback Monitor');
    expect(link.rel).toContain('noreferrer');
    expect(screen.getByTestId('cashback-benchmark').textContent).toContain('Cashback Monitor lists a best rate of 5% for Target across all sites');
  });

  it('says plainly when there is nothing to recommend, and never claims it signs in anywhere', () => {
    wrap(<CashbackCard rec={{ haveAccounts: false, pick: null, consider: null, ranked: [], steps: [], warnings: ['No cash-back rate is on file for Target.'] }} merchant="Target" />);
    expect(screen.getByTestId('cashback-none')).toBeTruthy();
    expect(screen.queryByTestId('cashback-pick')).toBeNull();
    expect(screen.getByTestId('cashback-card').textContent).toContain('never signs in to a cash-back site');
  });
});

describe('TC-CB-UI: the household page', () => {
  const SITES = [
    { code: 'rakuten', name: 'Rakuten', kind: 'CASHBACK', homeUrl: 'https://www.rakuten.com', notes: null, health: 'UP', healthNote: 'Answered today.', lastCheckedAt: '2026-12-01T00:00:00Z', autoRead: false, lastReadAt: null, rates: 4, ratesSeenAt: '2026-11-30T00:00:00Z', accounts: [{ profileId: 'p2', member: 'Riley' }] },
    { code: 'swagbucks', name: 'Swagbucks', kind: 'POINTS', homeUrl: 'https://www.swagbucks.com', notes: null, health: 'UNKNOWN', healthNote: 'Not checked yet.', lastCheckedAt: null, autoRead: false, lastReadAt: null, rates: 0, ratesSeenAt: null, accounts: [] },
  ];
  const handler = (u: string) =>
    u.endsWith('/cashback/sites') ? ok(SITES) : u.endsWith('/household') ? ok({ members: [{ id: 'p1', nickname: 'Jo' }, { id: 'p2', nickname: 'Riley' }] }) : u.includes('/cashback/recommend') ? ok({ ...REC, merchant: { id: 'm', name: 'Target' } }) : null;

  it('shows each site with its status and who has an account, and records a change per member', async () => {
    stub(handler);
    wrap(<CashbackPage />);
    const rakuten = await screen.findByText('Rakuten');
    const row = rakuten.closest('[data-testid="cashback-site"]') as HTMLElement;
    expect(within(row).getByText('Answering')).toBeTruthy();
    expect((within(row).getByLabelText('Riley has an account on Rakuten') as HTMLInputElement).checked).toBe(true);
    expect((within(row).getByLabelText('Jo has an account on Rakuten') as HTMLInputElement).checked).toBe(false);
    fireEvent.click(within(row).getByLabelText('Jo has an account on Rakuten'));
    await waitFor(() => expect(sent('PUT', '/cashback/accounts/rakuten')).toBeTruthy());
    expect(JSON.parse(sent('PUT', '/cashback/accounts/rakuten')!.body as string)).toEqual({ has: true, profileId: 'p1' });
    const sw = screen.getByText('Swagbucks').closest('[data-testid="cashback-site"]') as HTMLElement;
    expect(sw.textContent).toContain('Points');
    expect(sw.textContent).toContain('0 rates on file');
    expect(screen.getByText(/never asks for or stores a username or password/)).toBeTruthy();
  });

  it('looks up the best site for a store and amount', async () => {
    stub(handler);
    wrap(<CashbackPage />);
    await screen.findByText('Rakuten');
    fireEvent.change(screen.getByLabelText('Store'), { target: { value: 'Target' } });
    fireEvent.change(screen.getByLabelText('Amount ($)'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Find the best site' }));
    expect(await screen.findByTestId('cashback-pick')).toBeTruthy();
    expect(calls.find((c) => c.url.includes('/cashback/recommend'))!.url).toContain('merchant=Target&amount=30000');
  });
});

describe('TC-CB-UI: the administrator page', () => {
  const ADMIN_SITES = [
    { id: 's1', code: 'rakuten', name: 'Rakuten', kind: 'CASHBACK', homeUrl: 'https://www.rakuten.com', notes: null, isActive: true, autoRead: false, reachable: true, httpStatus: 200, lastCheckedAt: '2026-12-01T00:00:00Z', lastError: null, failures: 0 },
    { id: 's2', code: 'topcashback', name: 'TopCashback', kind: 'CASHBACK', homeUrl: 'https://www.topcashback.com', notes: null, isActive: true, autoRead: false, reachable: false, httpStatus: 503, lastCheckedAt: '2026-12-01T00:00:00Z', lastError: 'The site answered with an error (503).', failures: 2 },
    { id: 's3', code: 'befrugal', name: 'BeFrugal', kind: 'CASHBACK', homeUrl: 'https://www.befrugal.com', notes: null, isActive: true, autoRead: false, reachable: null, httpStatus: null, lastCheckedAt: null, lastError: null, failures: 0 },
  ];
  const RATES = [{ id: 'r1', site: 'rakuten', merchant: 'Target', merchantSlug: 'target', ratePercent: 2, pointsPerDollar: null, upTo: false, expiresAt: null, observedAt: '2026-12-01T00:00:00Z', method: 'MANUAL', source: 'x', conditions: null, expired: false }];
  const base = (u: string) => (u.endsWith('/admin/cashback/sites') ? ok(ADMIN_SITES) : u.endsWith('/admin/cashback/rates') ? ok(RATES) : null);

  it('shows each site as answering, not answering (after two failures) or not checked, and checks on request', async () => {
    stub((u) => base(u));
    wrap(<AdminCashbackPage />);
    const rows = await screen.findAllByTestId('admin-site');
    expect(within(rows[0]).getByText('Answering')).toBeTruthy();
    expect(within(rows[1]).getByText('Not answering')).toBeTruthy();
    expect(rows[1].textContent).toContain('HTTP 503');
    expect(within(rows[2]).getByText('Not checked lately')).toBeTruthy();
    fireEvent.click(within(rows[1]).getByRole('button', { name: 'Check TopCashback now' }));
    await waitFor(() => expect(sent('POST', '/admin/cashback/status')).toBeTruthy());
    expect(JSON.parse(sent('POST', '/admin/cashback/status')!.body as string)).toEqual({ site: 'topcashback' });
  });

  it('adds, lists and deletes a rate', async () => {
    stub((u) => base(u));
    wrap(<AdminCashbackPage />);
    await screen.findAllByTestId('admin-site');
    expect(screen.getByTestId('admin-rates').textContent).toContain('Target');
    const add = within(screen.getByTestId('admin-add-rate'));
    fireEvent.change(add.getByLabelText('Site'), { target: { value: 'topcashback' } });
    fireEvent.change(add.getByLabelText('Store'), { target: { value: 'Walmart' } });
    fireEvent.change(add.getByLabelText('Cash back (%)'), { target: { value: '9' } });
    fireEvent.click(add.getByLabelText(/It says/));
    fireEvent.click(screen.getByTestId('admin-add-rate-submit'));
    await waitFor(() => expect(sent('POST', '/admin/cashback/rates')).toBeTruthy());
    expect(JSON.parse(sent('POST', '/admin/cashback/rates')!.body as string)).toEqual({ site: 'topcashback', merchant: 'Walmart', ratePercent: 9, upTo: true });
    fireEvent.click(screen.getByRole('button', { name: 'Delete the rakuten rate for Target' }));
    await waitFor(() => expect(sent('DELETE', '/admin/cashback/rates/r1')).toBeTruthy());
  });

  it('imports a CSV and reports good and bad rows by line', async () => {
    stub((u) => (u.endsWith('/rates/import') ? ok({ created: 2, updated: 1, errors: [{ line: 4, message: 'Unknown merchant "x".' }] }) : base(u)));
    wrap(<AdminCashbackPage />);
    await screen.findAllByTestId('admin-site');
    fireEvent.change(screen.getByLabelText('CSV rows'), { target: { value: 'site,merchant,rate\nrakuten,target,2%' } });
    fireEvent.click(screen.getByTestId('admin-import-go'));
    expect((await screen.findByTestId('admin-import-result')).textContent).toBe('2 added, 1 updated, 1 problem');
    expect(screen.getByTestId('admin-import-errors').textContent).toContain('Line 4: Unknown merchant');
  });

  it('shows what was read from pasted text first, and saves only when asked', async () => {
    stub((u, init) => {
      if (u.endsWith('/rates/paste')) {
        const save = JSON.parse(init?.body as string).save;
        return ok({ saved: save, ratePercent: 9, pointsPerDollar: null, upTo: true, evidence: 'up to 9%', alsoSeen: ['2% Cash Back'] });
      }
      return base(u);
    });
    wrap(<AdminCashbackPage />);
    await screen.findAllByTestId('admin-site');
    const panel = screen.getByTestId('admin-paste');
    fireEvent.change(within(panel).getByLabelText('Site'), { target: { value: 'topcashback' } });
    fireEvent.change(within(panel).getByLabelText('Store'), { target: { value: 'Walmart' } });
    fireEvent.change(within(panel).getByLabelText('Page text'), { target: { value: 'Get up to 9% of the price back. 2% Cash Back on electronics' } });
    fireEvent.click(screen.getByTestId('admin-paste-read'));
    expect((await screen.findByTestId('admin-paste-result')).textContent).toContain('Found: up to 9%');
    expect(screen.getByTestId('admin-paste-result').textContent).toContain('Also on the page, not used: 2% Cash Back');
    expect(JSON.parse(sent('POST', '/rates/paste')!.body as string).save).toBe(false);
    fireEvent.click(screen.getByTestId('admin-paste-save'));
    await waitFor(() => expect(screen.getByTestId('admin-paste-result').textContent).toContain('Saved: up to 9%'));
  });

  it('reads a comparison page for one store, shows every site it found, and saves the ones in the list', async () => {
    const found = { saved: false, merchant: 'Target', monitorUrl: 'x', rates: [{ site: 'shopback', siteName: 'ShopBack', ratePercent: 5, pointsPerDollar: null, upTo: false, note: null, inList: true }, { site: 'rakuten', siteName: 'Rakuten', ratePercent: 1, pointsPerDollar: null, upTo: true, note: 'special', inList: true }, { site: 'retailmenot', siteName: 'RetailMeNot', ratePercent: 3, pointsPerDollar: null, upTo: false, note: null, inList: false }], unknown: ['Some New Portal'] };
    stub((u, init) => (u.endsWith('/rates/compare') ? ok(JSON.parse(init?.body as string).save ? { ...found, saved: true, created: 2, updated: 0, skipped: ['RetailMeNot'] } : found) : base(u)));
    wrap(<AdminCashbackPage />);
    await screen.findAllByTestId('admin-site');
    const panel = within(screen.getByTestId('admin-compare'));
    fireEvent.change(panel.getByLabelText('Store'), { target: { value: "Macy's" } });
    expect((panel.getByText('Open the store on Cashback Monitor') as HTMLAnchorElement).href).toBe('https://www.cashbackmonitor.com/cashback-store/macy-s/');
    fireEvent.change(panel.getByLabelText('Comparison table text'), { target: { value: 'ShopBack 5%\nRakuten 1%*' } });
    fireEvent.click(screen.getByTestId('admin-compare-read'));
    const result = await screen.findByTestId('admin-compare-result');
    expect(result.textContent).toContain('Found 3 sites for Target');
    expect(result.textContent).toContain('Rakuten: up to 1%');
    expect(result.textContent).toContain('RetailMeNot: 3% (not in your list: not saved)');
    expect(result.textContent).toContain('Some New Portal');
    expect(JSON.parse(sent('POST', '/rates/compare')!.body as string).save).toBe(false);
    fireEvent.click(screen.getByTestId('admin-compare-save'));
    await waitFor(() => expect(screen.getByTestId('admin-compare-result').textContent).toContain('Saved 2 new and 0 updated for Target'));
  });

  describe('automatic reading', () => {
    const withTemplate = ADMIN_SITES.map((x) => (x.code === 'rakuten' ? { ...x, storeUrlTemplate: 'https://www.rakuten.com/{host}', autoRead: false } : { ...x, storeUrlTemplate: null }));
    const handler = (u: string) => (u.endsWith('/admin/cashback/sites') ? ok(withTemplate) : u.endsWith('/admin/cashback/rates') ? ok(RATES) : u.endsWith('/admin/cashback/settings') ? ok({ benchmark: false }) : null);

    it('is off by default, needs an address pattern before it can be allowed, and asks before allowing', async () => {
      stub(handler);
      wrap(<AdminCashbackPage />);
      await screen.findAllByTestId('admin-site');
      const rakuten = within(document.querySelector('[data-testid="admin-site"][data-site="rakuten"]') as HTMLElement);
      const box = rakuten.getByLabelText("Read Rakuten's public store pages automatically") as HTMLInputElement;
      expect(box.checked).toBe(false);
      expect((screen.getByLabelText("Read TopCashback's public store pages automatically") as HTMLInputElement).disabled).toBe(true);
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false);
      fireEvent.click(box);
      expect(confirm.mock.calls[0][0]).toContain('Many sites');
      expect(confirm.mock.calls[0][0]).toContain('robots.txt');
      expect(sent('PUT', '/admin/cashback/sites/rakuten')).toBeUndefined();
      confirm.mockReturnValueOnce(true);
      fireEvent.click(box);
      await waitFor(() => expect(sent('PUT', '/admin/cashback/sites/rakuten')).toBeTruthy());
      expect(JSON.parse(sent('PUT', '/admin/cashback/sites/rakuten')!.body as string)).toEqual({ autoRead: true });
    });

    it('saves the store page address, and shows how the last read went', async () => {
      stub((u) => (u.endsWith('/admin/cashback/sites') ? ok(withTemplate.map((x) => (x.code === 'rakuten' ? { ...x, autoRead: true, lastReadAt: '2026-12-01T00:00:00Z', lastReadNote: '3 stores tried: 2 rates saved, 1 not found on the page' } : x))) : handler(u)));
      wrap(<AdminCashbackPage />);
      await screen.findAllByTestId('admin-site');
      expect(screen.getByTestId('admin-read-note').textContent).toContain('2 rates saved');
      const field = screen.getByLabelText(/Store page address/, { selector: '#tpl-rakuten' });
      fireEvent.change(field, { target: { value: 'https://www.rakuten.com/{slug}/' } });
      fireEvent.click(within(document.querySelector('[data-testid="admin-autoread"][data-site="rakuten"]') as HTMLElement).getByRole('button', { name: 'Save address' }));
      await waitFor(() => expect(sent('PUT', '/admin/cashback/sites/rakuten')).toBeTruthy());
      expect(JSON.parse(sent('PUT', '/admin/cashback/sites/rakuten')!.body as string)).toEqual({ storeUrlTemplate: 'https://www.rakuten.com/{slug}/' });
    });

    it('turns the comparison cross-check on, and reads one store now from a site that is allowed', async () => {
      stub((u, init) => {
        if (u.endsWith('/admin/cashback/sites')) return ok(withTemplate.map((x) => (x.code === 'rakuten' ? { ...x, autoRead: true } : x)));
        if (u.endsWith('/admin/cashback/read')) return ok({ url: 'https://www.rakuten.com/target.com', saved: true, read: { ratePercent: 1, pointsPerDollar: null, upTo: false, where: 'title', evidence: '1% Cash Back' }, reason: null });
        return handler(u);
      });
      wrap(<AdminCashbackPage />);
      await screen.findAllByTestId('admin-site');
      const panel = within(screen.getByTestId('admin-reading'));
      fireEvent.click(panel.getByTestId('admin-benchmark'));
      await waitFor(() => expect(sent('PUT', '/admin/cashback/settings')).toBeTruthy());
      expect(JSON.parse(sent('PUT', '/admin/cashback/settings')!.body as string)).toEqual({ benchmark: true });
      const select = panel.getByLabelText('Read one store now: site') as HTMLSelectElement;
      expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose…', 'Rakuten']);
      fireEvent.change(select, { target: { value: 'rakuten' } });
      fireEvent.change(panel.getByLabelText('Store'), { target: { value: 'Target' } });
      fireEvent.click(panel.getByTestId('admin-read-now'));
      expect((await screen.findByTestId('admin-read-result')).textContent).toContain('Saved 1% (from the page title: “1% Cash Back”)');
      expect(JSON.parse(sent('POST', '/admin/cashback/read')!.body as string)).toEqual({ site: 'rakuten', merchant: 'Target' });
    });
  });
});
