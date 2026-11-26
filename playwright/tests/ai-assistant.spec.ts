import AxeBuilder from '@axe-core/playwright';
import { APIRequestContext, expect, test } from '@playwright/test';
import { ADMIN, apiAddCard, apiLogin, apiRegister, uiLogin } from './helpers';

/** AI platform: consent gate, grounded answers (offline demo model), confirmations, tokens, admin. */
const FAMILY = { email: 'family@pointwise.local', password: 'Family12345!' };

/** Deterministic precondition: consent via the API (the consent UI itself is covered by PW-AI-01). */
async function familyConsent(request: APIRequestContext) {
  const token = await apiLogin(request, FAMILY.email, FAMILY.password);
  const res = await request.put('/api/v1/ai/settings', { headers: { Authorization: `Bearer ${token}` }, data: { consent: true } });
  expect(res.ok()).toBeTruthy();
}

test.describe('AI assistant', () => {
  test('PW-AI-01 consent is required before the assistant sends any data', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/assistant');
    await expect(page.getByTestId('ai-consent')).toContainText('never leave PointWise');
    await expect(page.getByLabel('Your question')).toHaveCount(0);
    await page.getByTestId('ai-consent-accept').click();
    await expect(page.getByLabel('Your question')).toBeVisible();
  });

  test('PW-AI-02 answers the 5/24 question from household data and shows the data used', async ({ page, request }) => {
    await familyConsent(request);
    await uiLogin(page, FAMILY.email, FAMILY.password);
    await page.goto('/assistant');
    await page.getByRole('button', { name: 'What is my current 5/24 status?' }).click();
    const answer = page.getByTestId('ai-answer').last();
    await expect(answer).toContainText('Jordan: 5/24');
    await expect(answer).toContainText('Riley: 3/24');
    await expect(answer).toContainText('Demo model (no AI)');
    await expect(answer).toContainText('your data was not shared with the AI');
    await answer.getByText(/Data used/).click();
    await expect(answer.getByTestId('ai-trace')).toContainText('5/24 status');
    // follow-up in the same conversation
    await page.getByLabel('Your question').fill('Which card should I use at Costco?');
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.getByTestId('ai-answer').last()).toContainText('Best for');
  });

  test('PW-AI-03 a write request becomes a pending action that only runs after confirmation', async ({ page, request }) => {
    const u = await apiRegister(request);
    await request.post('/api/v1/subscription/checkout', { headers: { Authorization: `Bearer ${u.token}` }, data: { interval: 'month' } });
    await apiAddCard(request, u.token, 'northwind-voyager-reserve', new Date(Date.now() - 100 * 86_400_000).toISOString().slice(0, 10));
    await request.put('/api/v1/ai/settings', { headers: { Authorization: `Bearer ${u.token}` }, data: { consent: true } });
    await uiLogin(page, u.email);
    await page.goto('/assistant');
    await page.getByLabel('Assistant').selectOption('benefit-utilization');
    await page.getByLabel('Your question').fill('Log $5 of my Dining credit');
    await page.getByRole('button', { name: 'Ask' }).click();
    await expect(page.getByTestId('ai-answer').last()).toContainText('nothing was changed yet');
    const actions = page.getByTestId('ai-actions');
    await expect(actions).toContainText('Log $5 used on "Dining credit"');
    await actions.getByRole('button', { name: 'Confirm' }).click();
    await expect(actions).toContainText('Logged $5 on Dining credit');
    // verify through the API: which benefits tab the monthly credit sits in depends on the day of the month
    const benefits = await (await request.get('/api/v1/benefits', { headers: { Authorization: `Bearer ${u.token}` } })).json();
    expect(benefits.find((b: { name: string }) => b.name === 'Dining credit').currentPeriod.usedCents).toBe(500);
  });

  test('PW-AI-04 settings: AI consent toggle and MCP access tokens', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/settings');
    await page.getByTestId('ai-consent-toggle').click();
    await expect(page.getByTestId('ai-consent-toggle')).toBeChecked();
    const tokens = page.getByTestId('mcp-tokens');
    await tokens.getByLabel('Token name').fill('Claude desktop');
    await tokens.getByRole('button', { name: 'Create token' }).click();
    await expect(page.getByTestId('pat-created')).toContainText('pw_pat_');
    await expect(tokens).toContainText('mcp:read');
    await tokens.getByRole('button', { name: 'Revoke' }).click();
    await expect(tokens.getByRole('button', { name: 'Revoke' })).toHaveCount(0);
  });

  test('PW-AI-05 admin AI & MCP page: providers (keys never shown), usage, MCP guidance; non-admins blocked', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.goto('/admin/ai');
    await expect(page).not.toHaveURL(/\/admin\/ai$/);
    await page.context().clearCookies();
    await uiLogin(page, ADMIN.email, ADMIN.password);
    await page.goto('/admin/ai');
    await expect(page.getByTestId('ai-providers')).toContainText('Anthropic');
    await expect(page.getByTestId('ai-providers')).toContainText('PointWise demo (offline)');
    await page.getByRole('button', { name: 'Usage & cost' }).click();
    await expect(page.getByTestId('ai-usage')).toContainText('Requests');
    await page.getByRole('button', { name: 'MCP servers' }).click();
    await expect(page.getByTestId('mcp-register')).toContainText('MCP_ALLOWED_HOSTS');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });

  test('PW-AI-A11Y assistant page passes axe with an answer on screen', async ({ page, request }) => {
    await familyConsent(request);
    await uiLogin(page, FAMILY.email, FAMILY.password);
    await page.goto('/assistant');
    await page.getByRole('button', { name: 'What benefits expire in the next 30 days?' }).click();
    await expect(page.getByTestId('ai-answer').last()).toContainText('Benefits:');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${v.id}(${v.nodes.length})`)).toEqual([]);
  });
});
