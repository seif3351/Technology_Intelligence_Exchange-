import { expect, test } from '@playwright/test';

const EXAMPLE_1 = 'I need an AUTOSAR Adaptive middleware solution for QNX and NVIDIA Orin with SOME/IP support.';

test.describe('buyer discovery (anonymous)', () => {
  test('search shows interpreted constraints, per-constraint evidence and a transparent score', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Technical requirement').fill(EXAMPLE_1);
    await page.getByRole('button', { name: 'Find matches' }).click();

    const interpretation = page.getByLabel('How your requirement was interpreted');
    await expect(interpretation).toContainText('AUTOSAR Adaptive');
    await expect(interpretation).toContainText('NVIDIA DRIVE Orin');

    const first = page.getByTestId('match-card').first();
    await expect(first).toContainText('VectorForge Adaptive Middleware');
    await expect(first).toContainText('All hard constraints met');
    await expect(first).toContainText('Platform verified');
    await expect(first).toContainText('Demo data');
    await first.getByText(/how is this calculated/).click();
    await expect(first).toContainText('not a quality rating');
  });

  test('compare two candidates side by side', async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(EXAMPLE_1)}`);
    const cards = page.getByTestId('match-card');
    await cards.nth(0).getByRole('checkbox').check();
    await cards.nth(1).getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Compare selected' }).click();
    const table = page.getByTestId('comparison');
    await expect(table).toBeVisible();
    await expect(table.locator('thead th')).toHaveCount(3);
    await expect(table).toContainText('QNX');
  });

  test('offering page distinguishes provenance and lists demo videos and evidence', async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent(EXAMPLE_1)}`);
    await page.getByTestId('match-card').first().getByRole('link', { name: 'VectorForge Adaptive Middleware' }).click();
    await expect(page.getByRole('heading', { name: 'VectorForge Adaptive Middleware' })).toBeVisible();
    const claims = page.getByTestId('claim-row');
    await expect(claims.filter({ hasText: 'holds third-party certification for' })).toContainText('Platform verified');
    await expect(claims.filter({ hasText: 'supports' }).first()).toContainText(/Supplier stated/);
    await expect(page.getByRole('link', { name: /Watch/ })).toBeVisible();
    await expect(page.getByText('Series production at a European OEM (anonymized, synthetic)')).toBeVisible();
  });

  test('"designed for" is never shown as certification', async ({ page }) => {
    await page.goto(`/search?q=${encodeURIComponent('ADAS simulation with OpenSCENARIO certified to ISO 26262')}`);
    const drivemesh = page.getByTestId('match-card').filter({ hasText: 'DriveMesh Scenario Simulation Suite' });
    await expect(drivemesh).toBeVisible();
    await expect(drivemesh).not.toContainText('All hard constraints met');
  });
});
