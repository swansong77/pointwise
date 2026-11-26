import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { freshUserWithCards } from './helpers';

/** Critical-path smoke + accessibility checks (also run on a mobile viewport). */
test.describe('Smoke & accessibility', () => {
  test('PW-SMK-01 public pages render and have no serious a11y violations', async ({ page }) => {
    for (const path of ['/', '/login', '/signup', '/forgot-password']) {
      await page.goto(path);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious, `${path}: ${serious.map((v) => v.id).join(', ')}`).toEqual([]);
    }
  });

  test('PW-SMK-02 every authenticated page loads without errors and passes axe', async ({ page, request }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await freshUserWithCards(page, request);
    for (const path of ['/dashboard', '/wallet', '/offers', '/nearby', '/merchants', '/merchants/freshcart', '/categories/dining', '/calculator', '/notifications', '/settings', '/portfolio', '/benefits', '/five24', '/household', '/import', '/next-card', '/travel', '/spending']) {
      await page.goto(path);
      await expect(page.locator('main h1')).toBeVisible();
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      expect(serious, `${path}: ${serious.map((v) => `${v.id}(${v.nodes.length})`).join(', ')}`).toEqual([]);
    }
    expect(errors).toEqual([]);
  });

  test('PW-SMK-03 security headers present', async ({ request }) => {
    const res = await request.get('/login');
    const h = res.headers();
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(h['x-powered-by']).toBeUndefined();
  });

  test('PW-SMK-04 internal OAuth exchange is not reachable through the public proxy', async ({ request }) => {
    const res = await request.post('/api/v1/auth/oauth', { data: { provider: 'google', providerAccountId: 'x', email: 'x@e2e.test' } });
    expect(res.status()).toBe(404);
  });
});
