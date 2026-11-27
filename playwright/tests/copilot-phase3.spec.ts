import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN, apiAddCard, apiLogin, apiRegister, uiLogin } from './helpers';

/** AI Mode phase 3: dashboard, briefings, alerts and settings (synthetic data; no cloud model). */
const API = process.env.API_URL ?? 'http://backend:4000';
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  // a colour measured mid-fade (a button leaving its disabled state) is not what the person sees once it settles
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '))).toEqual([]);
};
async function household(request: import('@playwright/test').APIRequestContext) {
  const u = await apiRegister(request);
  const card = await apiAddCard(request, u.token, 'contoso-gold');
  await request.post(`${API}/api/v1/offers/intel/import`, { headers: { Authorization: `Bearer ${u.token}` }, data: { walletCardId: card.id, text: `Hilton: Spend $500, get $100 back, expires ${us(3)}` } });
  return u;
}

test.describe('AI Mode: dashboard, briefings, alerts', () => {
  test('PW-COP-08 the dashboard shows tasks, expiring assets, household, savings, portfolio health and goals', async ({ page, request }) => {
    const u = await household(request);
    await request.post(`${API}/api/v1/copilot/goals`, { headers: { Authorization: `Bearer ${u.token}` }, data: { kind: 'FEES', title: 'No annual fees', target: { maxCents: 0 } } });
    await uiLogin(page, u.email);
    await page.goto('/copilot');
    const dash = page.getByTestId('copilot-dashboard');
    await expect(dash).toBeVisible();
    await expect(page.getByTestId('dash-headline')).toContainText(/thing|Nothing/);
    await expect(page.getByTestId('dash-today')).toContainText('Hilton');
    await expect(page.getByTestId('dash-expiring')).toContainText('Hilton');
    await expect(page.getByTestId('dash-household')).toContainText('/24');
    await expect(page.getByTestId('dash-savings')).toContainText('$');
    await expect(page.getByTestId('dash-portfolio')).toContainText('Annual fees');
    await expect(page.getByTestId('dash-goals')).toContainText('No annual fees');
    await expect(page.getByTestId('dash-goals').getByRole('progressbar')).toBeVisible();
    await expect(page.getByTestId('dash-alerts')).toContainText('No annual fees'); // the goal that is behind is worth a look
    await noSeriousA11y(page);

    await page.getByTestId('dash-today').getByRole('button', { name: /^Remind me/ }).first().click();
    await expect(page.getByTestId('dash-today').getByTestId('call-result').first()).toContainText('Reminder set');
  });

  test('PW-COP-09 write a daily, weekly and monthly briefing and read each', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/copilot');
    const panel = page.getByTestId('briefings-panel');
    await expect(panel.getByTestId('brief-empty')).toContainText('every morning');
    await panel.getByTestId('brief-make').click();
    await expect(panel.getByTestId('briefing-headline')).toBeVisible();
    await expect(panel.getByTestId('brief-today')).toBeVisible();
    await expect(panel.getByTestId('brief-new')).toContainText('No new offers');
    await expect(panel.getByTestId('brief-travel')).toBeVisible();
    await noSeriousA11y(page);

    await panel.getByTestId('brief-tab-weekly').click();
    await expect(panel.getByTestId('brief-empty')).toContainText('every Monday');
    await panel.getByTestId('brief-make').click();
    await expect(panel.getByTestId('brief-changed')).toBeVisible();
    await expect(panel.getByTestId('brief-health')).toBeVisible();
    await expect(panel.getByTestId('brief-recommendations')).toBeVisible();

    await panel.getByTestId('brief-tab-monthly').click();
    await panel.getByTestId('brief-make').click();
    await expect(panel.getByTestId('brief-cards')).toContainText('Contoso Gold');
    await expect(panel.getByTestId('brief-apply')).toBeVisible();
    await expect(panel.getByTestId('brief-wait')).toBeVisible();
    await expect(panel.getByTestId('briefing-body')).not.toContainText(/automatically (apply|cancel|transfer|book)/i);

    await panel.getByTestId('brief-tab-daily').click();
    await panel.getByTestId('brief-refresh').click();
    await expect(panel.getByTestId('briefing-headline')).toBeVisible();
    await noSeriousA11y(page);
  });

  test('PW-COP-10 the scheduled job writes the briefing and tells you once; switching it off stops it', async ({ page, request }) => {
    const u = await household(request);
    const auth = { Authorization: `Bearer ${u.token}` };
    expect((await request.put(`${API}/api/v1/copilot/settings`, { headers: auth, data: { aiModeEnabled: true } })).ok()).toBe(true);
    const admin = await apiLogin(request, ADMIN.email, ADMIN.password);
    const run = async (name: string) => expect((await request.post(`${API}/api/v1/admin/jobs/${name}/run`, { headers: { Authorization: `Bearer ${admin}` }, timeout: 120_000 })).ok()).toBe(true);
    await run('copilot-daily');
    await run('copilot-daily');
    const notes = await (await request.get(`${API}/api/v1/notifications`, { headers: auth })).json();
    const list = Array.isArray(notes) ? notes : (notes.items ?? notes.data ?? []);
    expect(list.filter((n: { title: string }) => n.title === 'Your daily Copilot briefing')).toHaveLength(1);

    await uiLogin(page, u.email);
    await page.goto('/copilot');
    await expect(page.getByTestId('dash-briefing')).toContainText('Latest daily briefing');
    await expect(page.getByTestId('briefings-panel').getByTestId('briefing-headline')).toBeVisible();

    // another member who switched the daily briefing off gets none
    const v = await household(request);
    const vAuth = { Authorization: `Bearer ${v.token}` };
    await request.put(`${API}/api/v1/copilot/settings`, { headers: vAuth, data: { aiModeEnabled: true, briefingDaily: false } });
    await run('copilot-daily');
    const vNotes = await (await request.get(`${API}/api/v1/notifications`, { headers: vAuth })).json();
    expect(JSON.stringify(vNotes)).not.toContain('Copilot briefing');
  });

  test('PW-COP-11 briefing and alert switches are in settings and are remembered', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/settings');
    const box = page.getByTestId('copilot-briefingWeekly');
    await expect(box).toBeChecked();
    await expect(page.getByTestId('copilot-briefing-settings')).toContainText('built on this server');
    const saved = page.waitForResponse((r) => r.url().includes('/copilot/settings') && r.request().method() === 'PUT' && r.ok());
    await box.click();
    await saved;
    await page.reload();
    await expect(page.getByTestId('copilot-briefingWeekly')).not.toBeChecked();
    await expect(page.getByTestId('copilot-briefingDaily')).toBeChecked();
    await noSeriousA11y(page);
  });
});
