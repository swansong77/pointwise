import { expect, test } from '@playwright/test';
import { ADMIN, PASSWORD, apiRegister, shot, uiLogin, uniqueEmail } from './helpers';

test.describe('Authentication', () => {
  test('PW-AUTH-01 sign up → lands in wallet, session persists across reload', async ({ page }) => {
    const email = uniqueEmail('signup');
    await page.goto('/signup');
    await shot(page, '01-signup');
    await page.getByLabel('Name').fill('Nora');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByTestId('signup-submit').click();
    await expect(page).toHaveURL(/\/wallet/);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Wallet' })).toBeVisible();
  });

  test('PW-AUTH-02 sign up rejects weak password client-side', async ({ page }) => {
    await page.goto('/signup');
    await page.getByLabel('Email').fill(uniqueEmail());
    await page.getByLabel('Password').fill('short');
    await page.getByTestId('signup-submit').click();
    await expect(page.getByRole('alert').filter({ hasText: 'at least 10' })).toBeVisible();
    await expect(page).toHaveURL(/\/signup/);
  });

  test('PW-AUTH-03 duplicate email shows conflict message', async ({ page, request }) => {
    const { email } = await apiRegister(request);
    await page.goto('/signup');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByTestId('signup-submit').click();
    await expect(page.getByRole('alert').filter({ hasText: 'already exists' })).toBeVisible();
  });

  test('PW-AUTH-04 login with wrong password shows generic error', async ({ page, request }) => {
    const { email } = await apiRegister(request);
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('wrong-password-9');
    await page.getByTestId('login-submit').click();
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toHaveText('Invalid email or password');
  });

  test('PW-AUTH-05 login → dashboard → sign out → protected page redirects to login', async ({ page, request }) => {
    const { email } = await apiRegister(request);
    await uiLogin(page, email);
    await shot(page, '02-dashboard-empty');
    await page.getByTestId('sign-out').click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto('/wallet');
    await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  });

  test('PW-AUTH-06 callbackUrl returns user to the requested page; external callbacks are ignored', async ({ page, request }) => {
    const { email } = await apiRegister(request);
    await page.goto('/offers');
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/offers/);

    await page.context().clearCookies();
    await page.goto('/login?callbackUrl=https://evil.example/');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL(/\/dashboard/);
  });

  test('PW-AUTH-07 forgot password always confirms (no account enumeration)', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.getByLabel('Email').fill('nobody-here@e2e.test');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText('If an account exists');
  });

  test('PW-AUTH-08 non-admin cannot open /admin; admin can', async ({ page, request }) => {
    const { email } = await apiRegister(request);
    await uiLogin(page, email);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
    await page.context().clearCookies();
    await uiLogin(page, ADMIN.email, ADMIN.password);
    await page.goto('/admin');
    await expect(page.getByTestId('admin-stats')).toBeVisible();
  });
});
