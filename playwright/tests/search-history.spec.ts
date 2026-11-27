import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { apiAddCard, apiRegister, uiLogin } from './helpers';

/** Search memory: saved searches, history, the dashboard, "ask again", and travel questions (synthetic data). */
const noSeriousA11y = async (page: import('@playwright/test').Page) => {
  // a colour measured mid-fade (a button leaving its disabled state) is not what the person sees once it settles
  await page.addStyleTag({ content: '*, *::before, *::after { transition: none !important; animation: none !important; }' });
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id + ': ' + v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | '))).toEqual([]);
};

test.describe('Search history and travel', () => {
  test('PW-SRCH-07 save an answer with the star; it leads the empty bar and appears on the history page', async ({ page, request }) => {
    const u = await apiRegister(request);
    await apiAddCard(request, u.token, 'contoso-gold');
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox');
    await box.fill('What card should I use at Costco for $1,500?');
    await box.press('Enter');
    await expect(page.getByTestId('search-summary')).toContainText('Best:');
    const star = page.getByTestId('search-save');
    await expect(star).toBeEnabled();
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await star.click();
    await expect(star).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape'); // clears the answer and the question: back to the empty bar
    await expect(page.getByTestId('command-list').getByRole('option').first()).toContainText('Saved');
    await expect(page.getByTestId('command-list')).toContainText('What card should I use at Costco for $1,500?');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.goto('/search');
    await expect(page.getByTestId('search-totals')).toContainText('Saved Searches');
    await expect(page.getByTestId('saved-list')).toContainText('Costco');
    await expect(page.getByTestId('search-merchants')).toContainText('Costco');
    await expect(page.getByTestId('recent-list')).toContainText('Costco');
    await noSeriousA11y(page);

    // ask again opens the bar and runs the question
    await page.getByTestId('saved-list').getByRole('button', { name: /^Ask again/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByTestId('search-summary')).toContainText('Best:');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    // remove it
    await page.getByTestId('saved-list').getByRole('button', { name: /^Remove/ }).click();
    await expect(page.getByTestId('search-saved')).toContainText('Save an answer with the ☆');
  });

  test('PW-SRCH-08 history counts repeated questions and can be cleared; saved searches stay', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    const ask = async (q: string) => {
      await page.keyboard.press('Control+k');
      const box = page.getByRole('combobox');
      await box.fill(q);
      await box.press('Enter');
      await expect(page.getByTestId('search-answer')).toBeVisible();
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toBeHidden();
    };
    await ask('How many points do I have?');
    await ask('How many points do I have?');
    await ask('What is my current 5/24 status?');
    await page.goto('/search');
    await expect(page.getByTestId('common-list')).toContainText('How many points do I have?');
    await expect(page.getByTestId('common-list')).toContainText('2×');
    page.on('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Clear history' }).click();
    await expect(page.getByTestId('search-recent')).toContainText('No questions yet.');
  });

  test('PW-SRCH-09 a flight question runs the award planner and says what it assumed; a follow-up keeps the trip', async ({ page, request }) => {
    const u = await apiRegister(request);
    await uiLogin(page, u.email);
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox');
    await box.fill('Flight to Hawaii next month');
    await box.press('Enter');
    await expect(page.getByTestId('search-answer')).toContainText('Flight to Hawaii');
    await expect(page.getByTestId('search-warnings')).toContainText('Assumed economy');
    await expect(page.getByTestId('search-answer')).toContainText('Award options');
    await box.fill('What about business class?');
    await box.press('Enter');
    await expect(page.getByTestId('search-answer')).toContainText('Flight to Hawaii');
    await expect(page.getByTestId('search-warnings')).not.toContainText('Assumed economy');
    await box.fill('Flight to Hawaii');
    await box.press('Enter');
    await expect(page.getByTestId('search-warnings')).toContainText('dates');
  });
});
