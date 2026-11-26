import { APIRequestContext, Page, expect } from '@playwright/test';

export const PASSWORD = 'e2e-password-1';
export const DEMO = { email: 'demo@pointwise.local', password: 'Demo12345!' };
export const ADMIN = { email: 'admin@pointwise.local', password: 'Admin12345!' };

export const uniqueEmail = (tag = 'e2e') => `${tag}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@e2e.test`;

/** Register through the API (same-origin proxy) and return the token. */
export async function apiRegister(request: APIRequestContext, email = uniqueEmail()) {
  const res = await request.post('/api/v1/auth/register', { data: { email, password: PASSWORD, name: 'E2E User' } });
  expect(res.status(), await res.text()).toBe(201);
  const body = await res.json();
  return { email, token: body.accessToken as string };
}

export async function apiLogin(request: APIRequestContext, email: string, password: string) {
  const res = await request.post('/api/v1/auth/login', { data: { email, password } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).accessToken as string;
}

export async function apiAddCard(request: APIRequestContext, token: string, slug: string, approvedAt?: string, lastFour?: string) {
  const card = await (await request.get(`/api/v1/cards/${slug}`)).json();
  const res = await request.post('/api/v1/wallet/cards', {
    headers: { Authorization: `Bearer ${token}` },
    data: { cardId: card.id, ...(approvedAt ? { approvedAt } : {}), ...(lastFour ? { lastFour } : {}) },
  });
  expect(res.status(), await res.text()).toBe(201);
  return res.json();
}

export async function uiLogin(page: Page, email: string, password = PASSWORD) {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/** Fresh user with cards, logged in via the UI. */
export async function freshUserWithCards(page: Page, request: APIRequestContext, slugs: string[] = ['contoso-gold', 'northwind-voyager', 'fabrikam-double']) {
  const u = await apiRegister(request);
  for (const s of slugs) await apiAddCard(request, u.token, s, '2026-01-10');
  await uiLogin(page, u.email);
  return u;
}

export async function shot(page: Page, name: string) {
  if (process.env.SCREENSHOTS !== 'false') await page.screenshot({ path: `screenshots/${name}.png`, fullPage: true });
}
