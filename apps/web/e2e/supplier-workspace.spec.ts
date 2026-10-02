import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/** The supplier maintains the catalog entirely on the website (expert review U1/X4). */
test.describe('supplier workspace', () => {
  test('create an offering, add and publish a claim, back it with evidence, edit and withdraw it', async ({
    page,
  }) => {
    await signIn(page, 'owner@vectorforge.example');
    await page.goto('/workspace');

    // A new offering needs no URL slug; the editor opens next.
    await page.getByLabel('Name').fill('E2E Zonal Gateway');
    await page.getByLabel('Maturity').selectOption('prototype');
    await page
      .getByLabel('One-sentence technical summary')
      .fill('Gateway software for zonal controllers in E2E tests.');
    await page.getByRole('button', { name: 'Create draft offering' }).click();
    await expect(page.getByRole('heading', { name: 'E2E Zonal Gateway' })).toBeVisible();
    await expect(page.getByText('Draft offering created')).toBeVisible();

    // Add a claim with the technology picker and plain claim-strength wording.
    await page
      .getByLabel('Technology, standard or capability')
      .selectOption({ label: 'Zonal E/E architecture' });
    await page.getByLabel('What exactly can you state?').selectOption('SUPPORTS');
    await page.getByLabel('Release / version (optional)').fill('2.1');
    await page
      .getByLabel('Statement, exactly as your documentation can back it')
      .fill('Runs on zonal controllers with two Ethernet backbones.');
    await page.getByRole('button', { name: 'Add draft claim' }).click();
    const claim = page.getByTestId('workspace-claim').filter({ hasText: 'Zonal E/E architecture' });
    await expect(claim).toContainText('release 2.1');
    await expect(claim).toContainText('No evidence linked.');
    await claim.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByRole('heading', { name: /Published — visible to buyers/ })).toBeVisible();

    // Evidence, then link it to the claim by editing it.
    await page.locator('summary', { hasText: 'Add evidence' }).click();
    await page.getByLabel('Kind').selectOption('public_url');
    await page.getByLabel('Title', { exact: true }).fill('E2E zonal datasheet');
    await page.getByLabel('Link (https://, optional for references)').fill('https://example.com/e2e-zonal');
    await page.getByRole('button', { name: 'Add evidence' }).click();
    await expect(page.getByRole('link', { name: 'E2E zonal datasheet' })).toBeVisible();

    const published = page.getByTestId('workspace-claim').filter({ hasText: 'Zonal E/E architecture' });
    await published.getByText('Edit or withdraw').click();
    await expect(published.getByText('changes what buyers see immediately')).toBeVisible();
    await published.getByRole('checkbox', { name: /E2E zonal datasheet/ }).check();
    await published.getByRole('button', { name: 'Save claim' }).click();
    await expect(
      page.getByTestId('workspace-claim').filter({ hasText: 'Zonal E/E architecture' }),
    ).toContainText('1 evidence item(s) linked.');

    // Withdrawing a published claim needs an explicit confirmation.
    const toWithdraw = page.getByTestId('workspace-claim').filter({ hasText: 'Zonal E/E architecture' });
    const confirm = toWithdraw.getByRole('checkbox', { name: 'Buyers will no longer see this claim' });
    // The panel stays open after saving (the user sees the confirmation); open it only if needed.
    if (!(await confirm.isVisible())) await toWithdraw.getByText('Edit or withdraw').click();
    await confirm.check();
    await toWithdraw.getByRole('button', { name: 'Withdraw claim' }).click();
    await expect(page.getByText(/Retracted \(1\)/)).toBeVisible();
  });

  test('the organization profile is edited on the website and shown publicly', async ({ page }) => {
    await signIn(page, 'owner@vectorforge.example');
    await page.goto('/workspace');
    await page.getByRole('link', { name: 'Organization profile & claims' }).click();
    await page
      .getByLabel('One-sentence summary')
      .fill('Middleware for automotive central compute (edited in E2E).');
    await page.getByRole('button', { name: 'Save profile' }).click();
    await expect(page.getByText('Organization profile saved.')).toBeVisible();
    await page.goto('/suppliers/vectorforge-systems');
    await expect(page.getByText('Middleware for automotive central compute (edited in E2E).')).toBeVisible();
  });
});
