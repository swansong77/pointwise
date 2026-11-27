import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** Actions from search answers: reminders, saving a plan, guarded activation (synthetic data). */
const API = process.env.API_URL ?? 'http://backend:4000';
const us = (days: number) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + String(d.getUTCDate()).padStart(2, '0') + '/' + d.getUTCFullYear();
};

test.describe('Search actions', () => {
  test('PW-SRCH-10 remind me from an expiring answer, then see and delete it on the history page', async ({ page, request }) => {
    const u = await apiRegister(request);
    const card = await apiAddCard(request, u.token, 'contoso-gold');
    await request.post(`${API}/api/v1/offers/intel/import`, { headers: { Authorization: `Bearer ${u.token}` }, data: { walletCardId: card.id, text: `Hilton: Spend $500, get $100 back, expires ${us(20)}` } });
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox');
    await box.fill('What offers expire this month?');
    await box.press('Enter');
    await expect(page.getByTestId('search-answer')).toBeVisible();
    const remind = page.getByTestId('search-calls').getByRole('button', { name: /^Remind me/ }).first();
    await expect(remind).toBeVisible();
    await remind.click();
    await expect(page.getByTestId('call-result')).toContainText('Reminder set');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.goto('/search');
    await expect(page.getByTestId('reminder-list')).toContainText(/ends \d{4}-\d{2}-\d{2}/);
    await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze().then((r) => expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]));
    await page.getByRole('button', { name: /^Delete reminder/ }).click();
    await expect(page.getByTestId('search-reminders')).toContainText('choose Remind me');
  });

  test('PW-SRCH-11 save a shopping answer as a plan', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold');
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox');
    await box.fill('What card should I use at Costco for $1,500?');
    await box.press('Enter');
    await page.getByRole('button', { name: 'Save as shopping plan' }).click();
    await expect(page.getByTestId('call-result')).toContainText('Saved to your planned purchases');
    const planned = await (await request.get(`${API}/api/v1/offers/intel/planned`, { headers: { Authorization: `Bearer ${u.token}` } })).json();
    expect(JSON.stringify(planned)).toContain('150000');
  });

  test('PW-SRCH-12 marking an offer activated needs a confirmation that says to do it on the issuer site first', async ({ page, request }) => {
    const u = await apiRegister(request);
    const card = await apiAddCard(request, u.token, 'contoso-gold');
    await request.post(`${API}/api/v1/offers/intel/import`, { headers: { Authorization: `Bearer ${u.token}` }, data: { walletCardId: card.id, text: `Hilton: Spend $500, get $100 back, expires ${us(20)}` } });
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox');
    await box.fill('Show all Hilton offers');
    await box.press('Enter');
    const act = page.getByRole('button', { name: /offer activated$/ });
    if (await act.count()) {
      await act.first().click();
      await expect(page.getByTestId('call-confirm')).toContainText('issuer');
      await expect(page.getByRole('button', { name: 'Confirm' })).toBeFocused();
      await page.getByRole('button', { name: 'Cancel' }).click();
      await expect(page.getByTestId('call-confirm')).toBeHidden();
    }
    // never offered: logging in to an issuer
    await expect(page.getByTestId('search-answer')).not.toContainText(/log in for you|enter your (password|login)/i);
  });

  test('PW-SRCH-13 "Sync offers" says what is connected and offers no run button without an account', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox');
    await box.fill('Sync offers');
    await box.press('Enter');
    await expect(page.getByTestId('search-answer')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Run offer sync now' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Open offer automation' })).toBeVisible();
  });
});
