import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';
import { makePdf } from './make-pdf';

/** Phase H: statement import → automatic benefit tracking. */
const now = new Date();
const d = (day: number) => {
  const x = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), Math.min(day, now.getUTCDate())));
  return `${String(x.getUTCMonth() + 1).padStart(2, '0')}/${String(x.getUTCDate()).padStart(2, '0')}/${x.getUTCFullYear()}`;
};
const STATEMENT = [
  'Transaction Date,Post Date,Description,Category,Type,Amount,Memo',
  `${d(1)},${d(1)},UBER   *TRIP HELP.UBER.COM CA,Travel,Sale,-23.45,`,
  `${d(2)},${d(2)},SQ *BEAN STREET COFFEE,Food & Drink,Sale,-6.50,`,
  `${d(3)},${d(3)},UBER CASH CREDIT,,Adjustment,10.00,`,
  `${d(3)},${d(3)},Payment Thank You-Mobile,,Payment,500.00,`,
].join('\n');

test.describe('Spending & automatic benefit tracking', () => {
  test('PW-SP-01 statement preview → import updates benefits; rules can be edited; pages are accessible', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold', new Date(now.getTime() - 40 * 86_400_000).toISOString());
    await uiLogin(page, u.email);
    await page.goto('/spending');
    const imp = page.getByTestId('statement-import');
    await imp.getByLabel('Card').selectOption({ label: 'Contoso Gold' });
    await imp.getByLabel('Statement file (PDF or CSV)').setInputFiles({ name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(STATEMENT) });
    await imp.getByRole('button', { name: 'Preview' }).click();
    const preview = page.getByTestId('statement-preview');
    await expect(preview.getByRole('status')).toContainText('4 transactions (4 new');
    await expect(preview).toContainText('Rideshare credit (exact: uber');
    await expect(preview).toContainText('Dining credit (alias: category:dining');
    let results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
    await preview.getByRole('button', { name: 'Import 4 new transactions' }).click();
    const done = page.getByTestId('import-result');
    await expect(done).toContainText('Imported 4 transactions');
    await expect(done).toContainText('Rideshare credit (Contoso Gold): $10 credit posted');
    await expect(page.getByTestId('transaction').filter({ hasText: 'UBER CASH CREDIT' })).toContainText('Rideshare credit: $10 credit posted');
    await expect(page.getByTestId('spend-totals')).toContainText('$29.95');

    await page.goto('/benefits');
    await page.getByRole('button', { name: /^Completed/ }).click();
    const ride = page.getByTestId('benefit-row').filter({ hasText: 'Rideshare credit' });
    await expect(ride.getByTestId('auto-tracking')).toContainText('uber, lyft (suggested)');
    await expect(ride.getByTestId('auto-tracking')).toContainText('auto · credit posted');
    await page.getByRole('button', { name: /^Expiring/ }).click(); // a partly used monthly credit is always within 30 days of its reset
    const dining = page.getByTestId('benefit-row').filter({ hasText: 'Dining credit' });
    await expect(dining.getByTestId('auto-tracking')).toContainText('auto · credit expected');
    await dining.getByRole('button', { name: 'Edit rules' }).click();
    await dining.getByLabel('Merchant words').fill('bean street');
    await dining.getByRole('button', { name: 'Save rules' }).click();
    await expect(dining.getByTestId('auto-tracking')).toContainText('bean street');
    await expect(dining.getByTestId('auto-tracking')).not.toContainText('(suggested)');
    await dining.getByRole('button', { name: /^Not Dining credit/ }).click();
    await expect(dining.getByTestId('auto-tracking')).not.toContainText('auto · credit expected');
    results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });

  test('PW-SP-02 a PDF statement is read, previewed and imported', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold', new Date(now.getTime() - 40 * 86_400_000).toISOString());
    await uiLogin(page, u.email);
    const md = (day: number) => d(day).slice(0, 5);
    const closing = `${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}/${String(now.getUTCFullYear()).slice(2)}`; // statement closes today
    const pdf = makePdf([
      ['Fixture Bank Rewards Visa', `Opening/Closing Date ${closing} - ${closing}`, 'PAYMENTS AND OTHER CREDITS', `${md(3)} UBER CASH CREDIT 10.00`],
      ['PURCHASE', `${md(1)} UBER *TRIP HELP.UBER.COM CA 23.45`],
    ]);
    await page.goto('/spending');
    const imp = page.getByTestId('statement-import');
    await imp.getByLabel('Card').selectOption({ label: 'Contoso Gold' });
    await imp.getByLabel('Statement file (PDF or CSV)').setInputFiles({ name: 'statement.pdf', mimeType: 'application/pdf', buffer: pdf });
    await imp.getByRole('button', { name: 'Preview' }).click();
    const preview = page.getByTestId('statement-preview');
    await expect(preview.getByRole('status')).toContainText('PDF statement (closing');
    await expect(preview.getByRole('status')).toContainText('2 transactions (2 new');
    await preview.getByRole('button', { name: 'Import 2 new transactions' }).click();
    await expect(page.getByTestId('import-result')).toContainText('Rideshare credit (Contoso Gold): $10 credit posted');
    await expect(page.getByTestId('transaction').filter({ hasText: 'UBER *TRIP' })).toContainText('pdf');
  });

  test('PW-SP-03 all statements at once: matched by account number, the rest by choice', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold', undefined, '4321');
    await apiAddCard(request, u.token, 'northwind-voyager', undefined, '9876');
    await uiLogin(page, u.email);
    const md = (day: number) => d(day).slice(0, 5);
    const closing = `${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}/${String(now.getUTCFullYear()).slice(2)}`;
    const pdf = makePdf([['Fixture Bank Rewards Visa', 'Account Number: XXXX XXXX XXXX 4321', `Opening/Closing Date ${closing} - ${closing}`, 'PURCHASE', `${md(1)} SQ *BEAN STREET COFFEE 6.50`]]);
    const csvB = Buffer.from(['Transaction Date,Description,Amount', `${d(2)},FIXTURE GROCER #12,-54.10`, `${d(2)},FIXTURE FUEL 88,-30.00`].join('\n'));
    const csvX = Buffer.from(['Transaction Date,Description,Amount', `${d(1)},FIXTURE BOOKSHOP,-12.00`].join('\n'));
    await page.goto('/spending');
    const bulk = page.getByTestId('bulk-statements');
    await bulk.locator('#bulk-files').setInputFiles([
      { name: 'october.pdf', mimeType: 'application/pdf', buffer: pdf },
      { name: 'Card9876_Activity.csv', mimeType: 'text/csv', buffer: csvB },
      { name: 'activity.csv', mimeType: 'text/csv', buffer: csvX },
    ]);
    await expect(bulk).toContainText('3 files ready');
    await bulk.getByRole('button', { name: 'Import 3 statements' }).click();
    const result = page.getByTestId('bulk-result');
    await expect(result.getByRole('status')).toContainText('2 imported · 3 new transactions · 1 need a card');
    await expect(result.getByTestId('bulk-file').filter({ hasText: 'october.pdf' })).toContainText('Contoso Gold (matched by account number)');
    await result.getByLabel('Card for activity.csv').selectOption({ label: 'Northwind Voyager ··9876' });
    await result.getByRole('button', { name: 'Import 1 with the chosen card' }).click();
    await expect(result.getByRole('status')).toContainText('3 imported · 4 new transactions');
    await expect(page.getByTestId('capture-card').filter({ hasText: 'Contoso Gold' })).toContainText('statements through');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });

  test('PW-SP-04 each transaction and card choice says whose card it is and its last digits; the list can be narrowed to a household member', async ({ page, request }) => {
    const u = await apiRegister(request);
    const auth = { Authorization: `Bearer ${u.token}` };
    expect((await request.post('/api/v1/subscription/checkout', { headers: auth, data: { interval: 'month' } })).ok()).toBe(true); // household members are a paid feature
    const member = async (nickname: string, relationship: string) =>
      (await (await request.post('/api/v1/household/members', { headers: auth, data: { nickname, relationship } })).json()).id as string;
    const riley = await member('Riley', 'SPOUSE');
    const sam = await member('Sam', 'PARENT');
    const gold = await (await request.get('/api/v1/cards/contoso-gold')).json();
    const addFor = async (profileId: string, lastFour: string) =>
      (await (await request.post('/api/v1/wallet/cards', { headers: auth, data: { cardId: gold.id, profileId, lastFour, approvedAt: new Date(now.getTime() - 40 * 86_400_000).toISOString() } })).json()).id as string;
    const cardRiley = await addFor(riley, '1111');
    const cardSam = await addFor(sam, '2222');
    const statement = (desc: string) => ['Transaction Date,Post Date,Description,Category,Type,Amount,Memo', `${d(1)},${d(1)},${desc},Shopping,Sale,-12.00,`].join('\n');
    for (const [card, desc] of [[cardRiley, 'RILEY FIXTURE STORE'], [cardSam, 'SAM FIXTURE STORE']]) {
      const res = await request.post('/api/v1/spending/statements', {
        headers: auth,
        multipart: { walletCardId: card, file: { name: 'statement.csv', mimeType: 'text/csv', buffer: Buffer.from(statement(desc)) } },
      });
      expect(res.ok(), await res.text()).toBe(true);
    }
    await uiLogin(page, u.email);
    await page.goto('/spending');
    const tx = page.getByTestId('transactions');
    await expect(tx.getByTestId('transaction')).toHaveCount(2);
    await expect(tx.getByTestId('transaction').filter({ hasText: 'RILEY FIXTURE STORE' })).toContainText('Contoso Gold · Riley ··1111');
    await expect(tx.getByTestId('transaction').filter({ hasText: 'SAM FIXTURE STORE' })).toContainText('Contoso Gold · Sam ··2222');
    await expect(tx.getByLabel('Card', { exact: true })).toContainText('Contoso Gold · Riley ··1111');

    // narrow to one member: their rows only, and the card list holds only their cards
    await tx.getByLabel('Household member').selectOption({ label: 'Sam' });
    await expect(tx.getByTestId('transaction')).toHaveCount(1);
    await expect(tx.getByTestId('transaction')).toContainText('SAM FIXTURE STORE');
    await expect(tx.getByLabel('Card', { exact: true }).locator('option')).toHaveText(['All cards', 'Contoso Gold · Sam ··2222']);
    await tx.getByLabel('Household member').selectOption({ label: 'All members' });
    await expect(tx.getByTestId('transaction')).toHaveCount(2);

    // the statement import's card choice carries the same label
    await expect(page.getByTestId('statement-import').getByLabel('Card')).toContainText('Contoso Gold · Riley ··1111');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  });
});
