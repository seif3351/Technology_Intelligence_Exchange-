import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test.describe('buyer and supplier workflows', () => {
  test('buyer sees private requirement with confidential terms and evidence-based matches', async ({
    page,
  }) => {
    await signIn(page, 'buyer@aurelia-motors.example');
    await page.getByRole('link', { name: 'Requirements' }).click();
    await page.getByRole('link', { name: /ADAS integration test automation/ }).click();
    await expect(page.getByText('Confidential terms (only visible to your organization)')).toBeVisible();
    await expect(page.getByText('VP-2031', { exact: true })).toBeVisible();
    await expect(page.getByTestId('match-card').first()).toContainText(
      'Northstar AI Integration Test Platform',
    );
  });

  test('demo request requires reviewing exactly what is shared, then reaches the supplier inbox', async ({
    page,
    browser,
  }) => {
    await signIn(page, 'buyer@aurelia-motors.example');
    await page.goto(
      `/search?q=${encodeURIComponent('AI-based integration test automation for ADAS on QNX')}`,
    );
    await page
      .getByTestId('match-card')
      .filter({ hasText: 'Northstar AI Integration Test Platform' })
      .getByRole('link', { name: 'Northstar AI Integration Test Platform' })
      .click();
    await page.getByRole('link', { name: 'Request demo / workshop' }).click();
    const message = `Please show the integration test platform on QNX benches (${Date.now()}).`;
    await page.getByLabel('Message to the supplier').fill(message);
    await page.getByLabel('Contact email').fill('buyer@aurelia-motors.example');
    await page.getByRole('button', { name: 'Review before sending' }).click();

    const preview = page.getByTestId('request-preview');
    await expect(preview).toContainText('Not sent yet');
    await expect(preview).toContainText('Will NOT be shared');
    await expect(preview).toContainText('confidential terms');
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Tick the approval box').or(preview)).toBeVisible();
    await page.getByLabel('I approve sending exactly this information to the supplier.').check();
    await page.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Request sent to the supplier.')).toBeVisible();

    const supplierPage = await (await browser.newContext()).newPage();
    await signIn(supplierPage, 'owner@northstar-ai.example');
    await supplierPage.goto('/workspace');
    await expect(supplierPage.getByTestId('incoming-request').filter({ hasText: message })).toBeVisible();
  });

  test('supplier reviews an AI-drafted claim before it is published', async ({ page }) => {
    await signIn(page, 'owner@northstar-ai.example');
    await page.goto('/workspace');
    const draft = page.getByTestId('draft-claim').filter({ hasText: 'NVIDIA DRIVE Orin' });
    await expect(draft).toContainText('AI-inferred');
    await draft.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByTestId('draft-claim').filter({ hasText: 'NVIDIA DRIVE Orin' })).toHaveCount(0);
  });

  test('a supplier cannot open a buyer requirement', async ({ page }) => {
    await signIn(page, 'owner@vectorforge.example');
    const response = await page.goto(
      '/buyer/requirements/00000000-0000-4000-8000-000000000000?org=00000000-0000-4000-8000-000000000001',
    );
    expect(response?.status()).toBe(404);
  });

  test('admin sees the audit log', async ({ page }) => {
    await signIn(page, 'admin@atx.example');
    await page.getByRole('link', { name: 'Admin' }).click();
    await expect(page.getByRole('heading', { name: 'Audit log (latest 40)' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'requirement.read' }).first()).toBeVisible();
  });
});
