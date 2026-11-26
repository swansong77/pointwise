import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** Offer market, smart pick, step-by-step workflow and mailbox panel (fictional demo catalog). */
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
};

test.describe('Offer intelligence', () => {
  test('PW-INT-01 offer market shows history position, advice and your values; sorts; accessible', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold');
    await uiLogin(page, u.email);
    await page.goto('/offers/market');
    const market = page.getByTestId('offer-market');
    await expect(market.getByTestId('market-offer').first()).toBeVisible();
    const gold = market.getByTestId('market-offer').filter({ hasText: 'Contoso Gold' });
    await expect(gold).toContainText('Best ever'); // fictional 40K → 50K → 60K history, current is the highest
    await expect(gold).toContainText('best ever');
    await expect(gold.getByTestId('you')).toContainText('first year');
    await gold.getByText('Why this difficulty').click();
    await expect(gold).toContainText(/No limit reached|No known velocity rule|community-reported/);
    await page.getByTestId('market-sort').selectOption('value');
    await expect(market.getByTestId('market-offer').first()).toBeVisible();
    await noSeriousA11y(page);
  });

  test('PW-INT-02 goals change the smart pick and the step-by-step answer lists every step with its privacy class', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold');
    await uiLogin(page, u.email);
    await page.goto('/next-card');
    const smart = page.getByTestId('smart-pick');
    await expect(smart.getByTestId('smart-recommended')).toBeVisible();
    await expect(smart.getByTestId('smart-recommended')).toContainText('(estimate)');
    await smart.getByTestId('goal-TRAVEL').check();
    await expect(smart.getByTestId('goal-TRAVEL')).toBeChecked();
    await smart.getByText('Why this recommendation').first().click();
    await expect(smart.getByTestId('smart-recommended')).toContainText(/goals/i);

    await page.getByTestId('run-workflow').click();
    const steps = page.getByTestId('workflow-step');
    await expect(steps).toHaveCount(5);
    await expect(page.getByTestId('workflow-steps')).toContainText('Offer agent');
    await expect(page.getByTestId('workflow-steps')).toContainText('never sent to an AI provider');
    await expect(page.getByTestId('workflow-answer')).toContainText('5/24');
    await expect(page.getByTestId('workflow-answer')).toContainText('not financial or credit advice');
    await noSeriousA11y(page);
  });

  test('PW-INT-03 the mailbox panel explains read-only access and reports a bad server clearly', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/spending');
    const panel = page.getByTestId('mailbox-panel');
    await expect(panel).toContainText('read-only');
    await expect(panel).toContainText('No mailbox connected');
    // Gmail / Outlook sign-in need the owner's own app registration: disabled here, with the redirect address to register
    await expect(panel.getByTestId('connect-gmail')).toBeDisabled();
    await expect(panel.getByTestId('connect-outlook')).toBeDisabled();
    await expect(panel.getByTestId('mailbox-oauth')).toContainText('/api/v1/mailboxes/oauth/callback');
    await panel.getByLabel('IMAP server').fill('127.0.0.1');
    await panel.getByLabel('Email address').fill('me@example.com');
    await panel.getByLabel('App password').fill('not-a-real-password');
    await panel.getByTestId('mailbox-connect').click();
    await expect(panel.getByRole('alert')).toContainText(/private network|Could not sign in|could not be resolved/);
    await expect(panel).toContainText('No mailbox connected');
    await noSeriousA11y(page);
  });
});
