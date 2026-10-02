import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

const EXAMPLE =
  'I need an AUTOSAR Adaptive middleware solution for QNX and NVIDIA Orin with SOME/IP support.';
const searchUrl = `/search?q=${encodeURIComponent(EXAMPLE)}`;

test.describe('discovery UX (expert review S12)', () => {
  test('buyers refine the interpretation with plain links: demote, remove, reset', async ({ page }) => {
    await page.goto(searchUrl);
    await expect(page).toHaveTitle(/Technical matching/);
    const panel = page.getByLabel('How your requirement was interpreted');
    await expect(panel).toContainText('Supports Middleware');

    await panel.getByRole('link', { name: 'Make "Supports Middleware" a preference' }).click();
    await expect(panel).toContainText('refined by you');
    const preferences = panel.locator('.row').filter({ hasText: 'Preferences' });
    await expect(preferences).toContainText('Supports Middleware');

    await panel.getByRole('link', { name: 'Remove "Supports NVIDIA DRIVE Orin"' }).click();
    await expect(panel).not.toContainText('NVIDIA DRIVE Orin');
    // Results follow the refined constraints.
    await expect(page.getByTestId('match-card').first()).not.toContainText('NVIDIA DRIVE Orin');

    await panel.getByRole('link', { name: 'Reset to my text' }).click();
    await expect(panel).toContainText('Supports NVIDIA DRIVE Orin');
    await expect(panel).toContainText('rule-based');
  });

  test('results are compact, link the supplier and say what was left out', async ({ page }) => {
    await page.goto(searchUrl);
    await expect(page.getByTestId('omitted-note')).toContainText('not listed');
    const first = page.getByTestId('match-card').first();
    await expect(
      first.getByRole('list', { name: /How VectorForge Adaptive Middleware meets/ }),
    ).toContainText('Supports QNX');
    // The full evidence table is one click away, not on the page by default.
    await expect(first.getByRole('table')).toBeHidden();
    await first.getByText('Evidence details').click();
    await expect(first.getByRole('table')).toBeVisible();
    await first.getByRole('link', { name: 'VectorForge Systems' }).click();
    await expect(page.getByRole('heading', { name: 'VectorForge Systems' })).toBeVisible();
    await expect(page).toHaveTitle(/VectorForge Systems/);
  });

  test('compare accepts comma-separated selections and can show only differences', async ({ page }) => {
    await page.goto(searchUrl);
    const ids = await page
      .getByTestId('match-card')
      .locator('input[type=checkbox]')
      .evaluateAll((boxes) => boxes.slice(0, 2).map((box) => (box as HTMLInputElement).value));
    await page.goto(`/compare?ids=${ids.join(',')}`);
    const table = page.getByTestId('comparison');
    await expect(table.locator('thead th')).toHaveCount(3);
    // Rows are grouped by kind of technology.
    await expect(table.locator('tr.group-row').first()).toBeVisible();
    const allRows = await table.locator('tbody tr').count();
    await page.getByRole('link', { name: 'Show only differences' }).click();
    await expect(page.getByRole('link', { name: 'Show all rows' })).toBeVisible();
    expect(await page.getByTestId('comparison').locator('tbody tr').count()).toBeLessThan(allRows);
  });

  test('the technologies page lists the whole ontology, grouped by kind', async ({ page }) => {
    await page.goto('/technologies');
    await expect(page.getByRole('heading', { name: 'Operating system' })).toBeVisible();
    // Concepts late in the alphabet used to be cut off at 50 items.
    await expect(page.getByText('Zephyr RTOS', { exact: true })).toBeVisible();
    await expect(page.getByText('V2X', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: /Functional safety \(\d+\)/ }).click();
    await expect(page).toHaveURL(/#functional-safety$/);
  });

  test('offering pages group claims, format qualifiers and show freshness', async ({ page }) => {
    await page.goto(searchUrl);
    await page
      .getByTestId('match-card')
      .first()
      .getByRole('link', { name: 'VectorForge Adaptive Middleware' })
      .click();
    await expect(page.getByText(/Updated \d{4}-\d{2}-\d{2}/)).toBeVisible();
    await expect(page.locator('tr.group-row', { hasText: 'Operating system' })).toBeVisible();
    const iso = page.getByTestId('claim-row').filter({ hasText: 'ISO 26262' }).first();
    await expect(iso).toContainText('ASIL B');
    await expect(iso).not.toContainText('asil=');
  });

  test('unknown pages explain themselves', async ({ page }) => {
    const response = await page.goto('/offerings/00000000-0000-0000-0000-000000000000');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { name: 'Not found' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Search technologies' })).toBeVisible();
  });

  test('a buyer saves a refined search as a private requirement', async ({ page }) => {
    await signIn(page, 'buyer@aurelia-motors.example');
    await page.goto(searchUrl);
    const panel = page.getByLabel('How your requirement was interpreted');
    await panel.getByRole('link', { name: 'Make "Supports Middleware" a preference' }).click();
    await expect(panel).toContainText('refined by you');
    await page.getByText('Save as a private requirement').click();
    await page.getByLabel('Title').fill('E2E adaptive middleware shortlist');
    await page.getByRole('button', { name: 'Save private requirement' }).click();
    await expect(page.getByRole('heading', { name: 'E2E adaptive middleware shortlist' })).toBeVisible();
    const constraints = page.locator('aside .panel').filter({ hasText: 'Constraints' });
    await expect(constraints).toContainText('Supports Middleware');
    await expect(constraints).toContainText('Supports QNX');
  });
});
