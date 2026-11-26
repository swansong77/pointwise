import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { ADMIN, apiAddCard, apiRegister, PASSWORD, uiLogin } from './helpers';

/** Member data export and import, and the administrator's backup and migration pages (synthetic data). */
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
};
const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

test.describe('Your data', () => {
  test('PW-DT-01 download everything, then bring it into another account: preview first, then import', async ({ page, request }) => {
    const a = await apiRegister(request);
    await apiAddCard(request, a.token, 'contoso-gold', undefined, '4242');
    await apiAddCard(request, a.token, 'northwind-voyager');
    await uiLogin(page, a.email);
    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Your Data' })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByTestId('data-export').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/\.pointwise-data\.json$/);
    const path = await file.path();
    const fs = await import('fs');
    const text = fs.readFileSync(path!, 'utf8');
    expect(JSON.parse(text).models.WalletCard).toHaveLength(2);
    expect(text).not.toContain(a.email);
    expect(text).not.toMatch(/passwordHash|accessTokenEnc|credentialEnc/);
    await noSeriousA11y(page);

    // another account: preview, then import
    const b = await apiRegister(request);
    await page.context().clearCookies();
    await uiLogin(page, b.email);
    await page.goto('/settings');
    await page.locator('#data-file').setInputFiles(path!);
    await page.getByTestId('data-preview').click();
    const report = page.getByTestId('import-report');
    await expect(report).toContainText('Preview: would add');
    await expect(report.getByTestId('import-row').filter({ hasText: 'Cards' })).toContainText('2');
    expect((await (await request.get('/api/v1/wallet/cards', { headers: auth(b.token) })).json()).length).toBe(0);
    await page.getByTestId('data-import').click();
    await expect(report).toContainText('Done. Reconnect your bank links');
    await expect.poll(async () => (await (await request.get('/api/v1/wallet/cards', { headers: auth(b.token) })).json()).length).toBe(2);
    // importing the same file again adds nothing
    await page.locator('#data-file').setInputFiles(path!);
    await page.getByTestId('data-preview').click();
    await expect(page.getByTestId('import-summary')).toContainText('already exist');
    await expect(page.getByTestId('import-summary')).toContainText('would add 0 item(s)');
  });

  test('PW-DT-02 replacing your data needs a preview, a copy of your data and a typed confirmation', async ({ page, request }) => {
    const a = await apiRegister(request);
    await apiAddCard(request, a.token, 'contoso-gold');
    const exp = await request.get('/api/v1/me/data-export', { headers: auth(a.token) });
    const body = await exp.body();
    const b = await apiRegister(request);
    await apiAddCard(request, b.token, 'northwind-voyager');
    await uiLogin(page, b.email);
    await page.goto('/settings');
    await page.locator('#data-file').setInputFiles({ name: 'mine.pointwise-data.json', mimeType: 'application/json', buffer: body });
    await page.getByTestId('mode-replace').check();
    await expect(page.getByTestId('data-import')).toHaveCount(0);
    await page.getByTestId('data-preview').click();
    const importBtn = page.getByTestId('data-import');
    await expect(importBtn).toBeDisabled();
    await page.getByTestId('replace-ack').check();
    await expect(importBtn).toBeDisabled();
    await page.getByTestId('replace-typed').fill('REPLACE');
    await expect(importBtn).toBeEnabled();
    await importBtn.click();
    await expect(page.getByTestId('import-report')).toContainText('Done.');
    const cards = (await (await request.get('/api/v1/wallet/cards', { headers: auth(b.token) })).json()) as Array<{ card: { slug: string } }>;
    expect(cards.map((c) => c.card.slug)).toEqual(['contoso-gold']);
  });

  test('PW-DT-03 a file that is not a PointWise export is refused with a clear message', async ({ page, request }) => {
    const a = await apiRegister(request);
    await uiLogin(page, a.email);
    await page.goto('/settings');
    await page.locator('#data-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
    await page.getByTestId('data-preview').click();
    await expect(page.locator('p[role=alert]')).toContainText('not a PointWise data file');
  });
});

test.describe('Backup and migration (administrator)', () => {
  test('PW-DT-04 create an encrypted backup, verify it, and see the migration checklist and checks', async ({ page, request }) => {
    const m = await apiRegister(request);
    await uiLogin(page, m.email);
    await page.goto('/admin/backup');
    await expect(page).not.toHaveURL(/\/admin\/backup/);
    await page.context().clearCookies();
    await uiLogin(page, ADMIN.email, ADMIN.password);
    await page.goto('/admin/backup');
    await expect(page.getByRole('heading', { name: 'Backup & Migration', level: 1 })).toBeVisible();
    await expect(page.getByTestId('nightly-status')).toContainText('Nightly backup');
    await page.getByTestId('bk-pass').fill('short');
    await expect(page.getByTestId('bk-create')).toBeDisabled();
    await page.getByTestId('bk-pass').fill('an-e2e-backup-passphrase');
    await page.getByTestId('bk-create').click();
    await expect(page.getByTestId('bk-message')).toContainText('written', { timeout: 60_000 });
    const row = page.getByTestId('bk-file').first();
    await expect(row).toContainText('.pwbackup');
    await row.getByTestId('bk-verify').click();
    await expect(row.getByTestId('bk-verify-result')).toContainText('Verified: the file is intact');
    await page.getByTestId('bk-pass').fill('a-wrong-passphrase-entirely');
    await row.getByTestId('bk-verify').click();
    await expect(row.getByTestId('bk-verify-result')).toContainText('passphrase is wrong');
    await row.getByTestId('bk-restore-open').click();
    await expect(page.getByTestId('bk-restore')).toBeDisabled();
    await page.getByTestId('bk-restore-typed').fill('RESTORE');
    await expect(page.getByTestId('bk-restore')).toBeEnabled();
    await noSeriousA11y(page);

    await page.getByRole('button', { name: 'Migration' }).click();
    await expect(page.getByTestId('migration-steps').locator('li')).toHaveCount(8);
    await expect(page.getByTestId('preflight-check').filter({ hasText: 'Database reachable' })).toContainText('OK');
    await expect(page.getByTestId('env-table')).toContainText('JWT_ACCESS_SECRET');
    await expect(page.getByTestId('env-table')).not.toContainText(process.env.TOKEN_ENC_KEY ?? 'x-never-present-x');
    await page.getByTestId('run-verify').click();
    await expect(page.getByTestId('verify-outcome')).toHaveText('Verified.');
    await noSeriousA11y(page);
    void PASSWORD;
  });
});
