import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** Chief of Staff, phase 3: governance, roadmaps, life events, household (synthetic data; no cloud model). */
const API = process.env.API_URL ?? 'http://backend:4000';
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '))).toEqual([]);
};
async function household(request: import('@playwright/test').APIRequestContext) {
  const u = await apiRegister(request);
  const auth = { Authorization: 'Bearer ' + u.token };
  await request.post(API + '/api/v1/subscription/checkout', { headers: auth, data: { interval: 'month' } });
  const card = await apiAddCard(request, u.token, 'contoso-gold');
  await request.post(API + '/api/v1/offers/intel/import', { headers: auth, data: { walletCardId: card.id, text: 'Hilton: Spend $500, get $100 back, expires ' + us(5) } });
  await request.post(API + '/api/v1/household/members', { headers: auth, data: { nickname: 'Rileyquist', relationship: 'SPOUSE' } });
  return u;
}

test.describe('Chief of Staff: governance, roadmap, life events, household', () => {
  test('PW-COS-08 application governance shows each member’s 5/24 and only suggests', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/chief-of-staff');
    const gov = page.getByTestId('chief-governance');
    await expect(gov).toBeVisible();
    await expect(gov.getByTestId('gov-headline')).not.toBeEmpty();
    await expect(gov.getByTestId('gov-member').first()).toContainText(/\d+\/24/);
    await expect(gov.getByTestId('gov-members')).toContainText('Rileyquist');
    await expect(gov).not.toContainText(/automatically/i);
    await noSeriousA11y(page);
  });

  test('PW-COS-09 the roadmap shows the next 90 days and the year, with phases and focus areas', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/chief-of-staff');
    const road = page.getByTestId('chief-roadmap');
    await expect(road.getByTestId('roadmap-headline')).toBeVisible();
    await expect(road.getByTestId('roadmap-phase')).toHaveCount(3);
    await expect(road.getByTestId('roadmap-phase').first()).toContainText('Next 30 days');
    await expect(road).toContainText('Hilton');
    await expect(road.getByTestId('roadmap-focus')).toBeVisible();
    await road.getByTestId('roadmap-365').click();
    await expect(road.getByTestId('roadmap-phase')).toHaveCount(4);
    await expect(road.getByTestId('roadmap-365')).toHaveAttribute('aria-pressed', 'true');
    await noSeriousA11y(page);
  });

  test('PW-COS-10 add a life event, get its estimate, and see it on the roadmap and in the actions', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/chief-of-staff');
    const life = page.getByTestId('chief-life');
    await expect(life.getByTestId('life-empty')).toBeVisible();
    await life.getByLabel('Name it').fill('Church mission trip to Honduras');
    await life.getByLabel('What is it?').selectOption('MISSION_TRIP');
    await life.getByLabel('Where to').fill('Honduras');
    await life.getByLabel('Starts (optional)').fill(day(45));
    await life.getByLabel('Ends (optional)').fill(day(52));
    await life.getByLabel('Travelers').fill('6');
    await life.getByLabel('Budget in dollars (optional)').fill('9000');
    await life.getByRole('button', { name: 'Add event' }).click();
    const ev = life.getByTestId('life-event').first();
    await expect(ev).toContainText('Church mission trip to Honduras');
    await ev.getByRole('button', { name: /^Estimate/ }).click();
    const est = ev.getByTestId('life-estimate');
    await expect(est).toBeVisible();
    await expect(est).toContainText('Expected value about');
    await expect(est).toContainText('Best cards');
    await ev.getByText('Assumptions and risks').click();
    await expect(est).toContainText('Points are shown separately');
    await noSeriousA11y(page);

    // it is something to prepare for, and on the calendar
    await page.reload();
    await expect(page.getByTestId('chief-top')).toContainText('Church mission trip to Honduras starts in');
    await page.getByTestId('chief-roadmap').getByTestId('roadmap-90').click();
    await expect(page.getByTestId('chief-roadmap')).toContainText('Church mission trip to Honduras starts');

    page.on('dialog', (d) => d.accept());
    await page.getByTestId('chief-life').getByRole('button', { name: 'Delete Church mission trip to Honduras' }).click();
    await expect(page.getByTestId('chief-life').getByTestId('life-empty')).toBeVisible();
  });

  test('PW-COS-11 the household chief gives each member their own list', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.goto('/chief-of-staff');
    const h = page.getByTestId('chief-household');
    await expect(h.getByTestId('house-headline')).toContainText(/of \d+ members? (has|have) something to do/);
    await expect(h.getByTestId('house-members')).toContainText('Rileyquist');
    await expect(h.getByTestId('house-member').first()).toContainText(/\d+ cards?/);
    await expect(h.getByTestId('house-members')).toContainText('Hilton');
    await noSeriousA11y(page);
  });

  test('PW-COS-12 strategic questions in AI Mode get a roadmap', async ({ page, request }) => {
    const u = await household(request);
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const sw = page.getByRole('switch', { name: 'AI Mode' });
    await expect(sw).toBeEnabled();
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    const box = page.getByRole('combobox');
    await box.fill('What should I do over the next 90 days?');
    await box.press('Enter');
    await expect(page.getByTestId('plan-headline')).toContainText('Your next 90 days');
    await expect(page.getByTestId('roadmap-view')).toBeVisible();
    await expect(page.getByTestId('roadmap-phase')).toHaveCount(3);
    await box.fill('What should I focus on this year?');
    await box.press('Enter');
    await expect(page.getByTestId('plan-headline')).toContainText('Your year ahead');
    await expect(page.getByTestId('roadmap-phase')).toHaveCount(4);
  });
});
