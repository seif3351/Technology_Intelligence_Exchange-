import { expect, test } from '@playwright/test';
import { firstLink, latestMail, signIn } from './helpers';

test.describe('organization members', () => {
  test('an owner invites a colleague by email, who joins with the chosen role', async ({ browser }) => {
    const email = `colleague-${Date.now()}@northstar-ai.example`;
    const ownerPage = await (await browser.newContext()).newPage();
    await signIn(ownerPage, 'owner@northstar-ai.example');
    await ownerPage.goto('/account');
    await ownerPage.getByRole('link', { name: 'members' }).first().click();
    await expect(ownerPage.getByRole('heading', { name: /Members — / })).toBeVisible();
    await ownerPage.getByLabel("Colleague's email").fill(email);
    await ownerPage.getByLabel('Role', { exact: true }).selectOption('viewer');
    await ownerPage.getByRole('button', { name: 'Invite' }).click();
    await expect(ownerPage.getByRole('status')).toContainText(`Invitation emailed to ${email}`);

    const colleague = await (await browser.newContext()).newPage();
    await colleague.goto(firstLink(await latestMail(email)));
    await expect(colleague.getByText('You were invited to join')).toBeVisible();
    await colleague.getByLabel('Your name').fill('New Colleague');
    await colleague.getByLabel(/Password/).fill('a-colleague-password-2026');
    await colleague.getByRole('checkbox').check();
    await colleague.getByRole('button', { name: 'Create account' }).click();
    await expect(colleague.getByText('You are a member of:')).toBeVisible();
    await expect(colleague.getByText(/Northstar/)).toBeVisible();

    await ownerPage.reload();
    const memberRow = ownerPage.getByRole('row').filter({ hasText: 'New Colleague' });
    await expect(memberRow).toContainText(email);
    await expect(memberRow.getByRole('combobox')).toHaveValue('viewer');
  });
});
