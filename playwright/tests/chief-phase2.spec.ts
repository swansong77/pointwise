import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN, apiAddCard, apiLogin, apiRegister, uiLogin } from './helpers';

/** Chief of Staff, phase 2: command center, fee review board, board report (synthetic data). */
const API = process.env.API_URL ?? 'http://backend:4000';
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '))).toEqual([]);
};
async function household(request: import('@playwright/test').APIRequestContext) {
  const u = await apiRegister(request);
  const card = await apiAddCard(request, u.token, 'contoso-gold', new Date(Date.now() - 335 * 86_400_000).toISOString().slice(0, 10));
  await request.post(`${API}/api/v1/offers/intel/import`, { headers: { Authorization: `Bearer ${u.token}` }, data: { walletCardId: card.id, text: `Hilton: Spend $500, get $100 back, expires ${us(3)}` } });
  return u;
}

test.describe('Chief of Staff: command center, fees, board', () => {
  test('PW-COS-05 the command center shows value, five scores with reasons, the year’s outlook, risks and opportunities', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/chief-of-staff');
    await expect(page.getByTestId('chief-jump')).toContainText('Fee review');
    const cmd = page.getByTestId('chief-command');
    await expect(cmd).toBeVisible();
    for (const k of ['totalHouseholdCents', 'pointsCents', 'benefitsCents', 'certificatesCents', 'travelCreditsCents', 'offersAvailableCents', 'expiringAssetsCents', 'recentSavingsCents', 'projectedSavingsCents']) await expect(page.getByTestId(`val-${k}`)).toBeVisible();
    await expect(page.getByTestId('val-opportunities')).toBeVisible();
    for (const s of ['household', 'loyalty', 'portfolio', 'offers', 'travel']) {
      const card = page.getByTestId(`score-${s}`);
      await expect(card).toBeVisible();
      await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', /\d+/);
      await expect(card.locator('li').first()).toBeVisible();
    }
    await expect(page.getByTestId('cmd-outlook')).toContainText('expected this year');
    await expect(page.getByTestId('cmd-outlook')).toContainText('Likely range');
    await page.getByTestId('cmd-outlook').getByText('What this assumes').click();
    await expect(page.getByTestId('cmd-outlook')).toContainText('estimate');
    await expect(page.getByTestId('risk-list')).toContainText('Hilton');
    await noSeriousA11y(page);
  });

  test('PW-COS-06 the fee review board gives every card a recommendation with the reason in dollars', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/chief-of-staff');
    const board = page.getByTestId('chief-fees');
    await expect(board).toBeVisible();
    const row = board.getByTestId('fee-verdict').first();
    await expect(row).toContainText('Contoso Gold');
    await expect(row).toContainText(/Keep|Retention call|Product change|Downgrade|Replace|Cancel|Review/);
    await expect(row).toContainText('$');
    await expect(board.getByTestId('fees-summary')).toContainText('over 12 months');
    await noSeriousA11y(page);
  });

  test('PW-COS-07 write the board report, read it, and the monthly job announces it once', async ({ page, request }) => {
    const u = await household(request);
    const auth = { Authorization: `Bearer ${u.token}` };
    await uiLogin(page, u.email);
    await page.goto('/chief-of-staff');
    const panel = page.getByTestId('chief-board');
    await expect(panel.getByTestId('board-empty')).toContainText('1st of each month');
    await panel.getByTestId('board-make').click();
    await expect(panel.getByTestId('board-headline')).toContainText('Board report for');
    for (const k of ['savings', 'value', 'missed', 'status', 'net', 'fees', 'household']) await expect(panel.getByTestId(`board-${k}`)).toBeVisible();
    await expect(panel.getByTestId('board-household')).toContainText('Household health');
    await expect(panel.getByTestId('board-body')).not.toContainText(/automatically (apply|cancel|transfer|book)/i);
    await noSeriousA11y(page);

    expect((await request.put(`${API}/api/v1/copilot/settings`, { headers: auth, data: { aiModeEnabled: true, chiefOfStaff: true } })).ok()).toBe(true);
    const admin = await apiLogin(request, ADMIN.email, ADMIN.password);
    const run = async (name: string) => expect((await request.post(`${API}/api/v1/admin/jobs/${name}/run`, { headers: { Authorization: `Bearer ${admin}` }, timeout: 120_000 })).ok()).toBe(true);
    await request.post(`${API}/api/v1/chief/board?fresh=true`, { headers: auth, data: {} });
    // the manual report above already exists for this month, so the job writes none and announces none
    await run('cos-board');
    const notes = JSON.stringify(await (await request.get(`${API}/api/v1/notifications`, { headers: auth })).json());
    expect(notes).not.toContain('Your monthly board report');
    // a member without a report this month gets it announced exactly once
    const v = await household(request);
    const vAuth = { Authorization: `Bearer ${v.token}` };
    await request.put(`${API}/api/v1/copilot/settings`, { headers: vAuth, data: { aiModeEnabled: true, chiefOfStaff: true } });
    await run('cos-board');
    await run('cos-board');
    const vNotes = await (await request.get(`${API}/api/v1/notifications`, { headers: vAuth })).json();
    const list = Array.isArray(vNotes) ? vNotes : (vNotes.items ?? []);
    expect(list.filter((n: { title: string }) => n.title === 'Your monthly board report')).toHaveLength(1);
  });
});
