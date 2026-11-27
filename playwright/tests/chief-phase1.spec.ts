import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN, apiAddCard, apiLogin, apiRegister, uiLogin } from './helpers';

/** Chief of Staff, phase 1 (synthetic data; no cloud model). */
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
async function household(request: import('@playwright/test').APIRequestContext, days = 1) {
  const u = await apiRegister(request);
  const card = await apiAddCard(request, u.token, 'contoso-gold');
  await request.post(`${API}/api/v1/offers/intel/import`, { headers: { Authorization: `Bearer ${u.token}` }, data: { walletCardId: card.id, text: `Hilton: Spend $500, get $100 back, expires ${us(days)}` } });
  return u;
}

test.describe('Chief of Staff', () => {
  test('PW-COS-01 the page ranks everything: greeting, numbers, top actions with value, time and risk, and the reasoning', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.getByRole('link', { name: 'Chief of Staff', exact: true }).click();
    await expect(page.getByTestId('chief-page')).toBeVisible();
    await expect(page.getByTestId('chief-greeting')).toContainText('Good morning');
    for (const t of ['tile-risk', 'tile-points', 'tile-certs', 'tile-offers']) await expect(page.getByTestId(t)).toBeVisible();
    const top = page.getByTestId('chief-top-list').getByTestId('exec-item');
    await expect(top.first()).toBeVisible();
    await expect(top.first()).toContainText(/Hilton/);
    await expect(top.first().getByTestId('exec-facts')).toContainText(/Time ~\d+ min/);
    await expect(top.first().getByTestId('exec-facts')).toContainText(/Risk (Low|Medium|High)/);
    await expect(top.first()).toContainText(/(Critical|High|Medium|Low|Informational) · \d+/);
    await top.first().getByText('Why, alternatives and data used').click();
    const why = top.first().getByTestId('exec-why');
    await expect(why).toContainText('Why:');
    await expect(why).toContainText('Contributing agents:');
    await expect(why).toContainText('Chief of Staff');
    await expect(why).toContainText('Data used:');
    await noSeriousA11y(page);

    // the Action Center tabs
    for (const k of ['today', 'week', 'month', 'quarter', 'annual']) await expect(page.getByTestId(`center-tab-${k}`)).toBeVisible();
    await page.getByTestId('center-tab-week').click();
    await expect(page.getByTestId('center-tab-week')).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('center-tab-annual').click();
    await expect(page.getByTestId('center-list')).toBeVisible();

    // value recovery
    await expect(page.getByTestId('recovery-headline')).toContainText(/lost so far|No value has been lost/);
    await expect(page.getByTestId('chief-recovery')).toContainText('Can still be saved');
  });

  test('PW-COS-02 put an item aside from the Chief of Staff and it stays out until you show it again', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/chief-of-staff');
    const first = page.getByTestId('chief-top-list').getByTestId('exec-item').filter({ hasText: /Hilton/ }).first();
    await expect(first).toBeVisible();
    await first.getByRole('button', { name: 'Snooze 7 days' }).click();
    await expect(first.getByTestId('decision-result')).toContainText('Snoozed for 7 days');
    await page.reload();
    await expect(page.getByTestId('chief-top').getByTestId('exec-item').filter({ hasText: /Hilton offer: \$100 back on \$500 ends/ })).toHaveCount(0);
    await expect(page.getByTestId('chief-top')).toContainText(/you put aside/);
  });

  test('PW-COS-03 Chief of Staff and Quiet Mode are in settings and are remembered', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/settings');
    const on = page.getByTestId('chief-enabled');
    const quiet = page.getByTestId('chief-quiet');
    await expect(on).not.toBeChecked();
    await expect(quiet).not.toBeChecked();
    const s1 = page.waitForResponse((r) => r.url().includes('/copilot/settings') && r.request().method() === 'PUT' && r.ok());
    await on.click();
    await s1;
    const s2 = page.waitForResponse((r) => r.url().includes('/notifications/preferences') && r.request().method() === 'PUT' && r.ok());
    await quiet.click();
    await s2;
    await page.reload();
    await expect(page.getByTestId('chief-enabled')).toBeChecked();
    await expect(page.getByTestId('chief-quiet')).toBeChecked();
    await expect(page.getByTestId('chief-settings')).toContainText('reminders still arrive at once');
    await noSeriousA11y(page);
  });

  test('PW-COS-04 Quiet Mode holds routine notifications; the executive briefing reports them and greets you', async ({ page, request }) => {
    const u = await household(request, 3);
    const auth = { Authorization: `Bearer ${u.token}` };
    expect((await request.put(`${API}/api/v1/copilot/settings`, { headers: auth, data: { aiModeEnabled: true, chiefOfStaff: true } })).ok()).toBe(true);
    expect((await request.put(`${API}/api/v1/notifications/preferences`, { headers: auth, data: { quietMode: true } })).ok()).toBe(true);
    const admin = await apiLogin(request, ADMIN.email, ADMIN.password);
    const run = async (name: string) => expect((await request.post(`${API}/api/v1/admin/jobs/${name}/run`, { headers: { Authorization: `Bearer ${admin}` }, timeout: 120_000 })).ok()).toBe(true);
    await run('scan-expiring-offers'); // an OFFER_EXPIRING notification: normal, so held
    const count = async () => (await (await request.get(`${API}/api/v1/notifications/unread-count`, { headers: auth })).json()).count as number;
    // the routine offer notice is held, not unread. (Other specs run global scheduled jobs in parallel that can give this user an unrelated
    // urgent notice, so this checks the kind rather than the total.)
    const unread = await (await request.get(`${API}/api/v1/notifications?unreadOnly=true`, { headers: auth })).json();
    expect(JSON.stringify(unread)).not.toMatch(/OFFER_EXPIRING/);
    const held = await (await request.get(`${API}/api/v1/notifications?includeDeferred=true`, { headers: auth })).json();
    expect(JSON.stringify(held)).toMatch(/OFFER_EXPIRING/);

    await run('copilot-daily');
    const latest = await (await request.get(`${API}/api/v1/copilot/briefings/latest`, { headers: auth })).json();
    expect(latest.DAILY.content.greeting).toMatch(/^Good morning/);
    expect(latest.DAILY.content.sections.map((s: { key: string }) => s.key)).toEqual(['actions', 'recovery', 'held']);
    // the briefing itself is a critical-class notification and arrives
    expect(await count()).toBeGreaterThanOrEqual(1);

    await uiLogin(page, u.email);
    await page.goto('/copilot');
    const panel = page.getByTestId('briefings-panel');
    await expect(panel.getByTestId('briefing-headline')).toContainText('Good morning');
    await expect(panel.getByTestId('brief-held')).toContainText('held for this briefing');
    await expect(panel.getByTestId('brief-actions')).toContainText('1.');
    await noSeriousA11y(page);
  });
});
