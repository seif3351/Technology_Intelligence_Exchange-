import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

/**
 * Pilot onboarding: an administrator invites a person, who registers with the
 * invitation link, accepts the terms, creates a supplier organization and
 * requests verification; content stays unlisted until the admin verifies.
 */
test.describe('pilot onboarding', () => {
  test('invite-only sign-up, organization setup and verification gate', async ({ browser }) => {
    const email = `pilot-${Date.now()}@kestrel-sensors.example`;

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();
    await signIn(admin, 'admin@atx.example');
    await admin.goto('/admin');
    await admin.getByLabel('Invite a person to register').fill(email);
    await admin.getByRole('button', { name: 'Create invitation' }).click();
    const link = await admin.getByLabel('Invitation link').inputValue();
    expect(link).toContain('/signup?invite=');

    const visitor = await (await browser.newContext()).newPage();
    // Without an invitation the pilot is closed.
    await visitor.goto('/signup');
    await expect(visitor.getByText('accounts are created by invitation')).toBeVisible();

    await visitor.goto(new URL(link).pathname + new URL(link).search);
    await expect(visitor.getByLabel('Work email')).toHaveValue(email);
    await visitor.getByLabel('Your name').fill('Kim Pilot');
    await visitor.getByLabel(/Password/).fill('a-long-pilot-password-2026');
    await visitor.getByRole('button', { name: 'Create account' }).click();
    // The browser blocks submission until the terms are accepted.
    await expect(visitor).toHaveURL(/\/signup/);
    await visitor.getByRole('checkbox').check();
    await visitor.getByRole('button', { name: 'Create account' }).click();

    await expect(visitor.getByRole('heading', { name: 'Set up your organization' })).toBeVisible();
    await visitor.getByLabel('Organization name').fill(`Kestrel Sensors ${Date.now()}`);
    await visitor.getByLabel('One-sentence summary').fill('Radar sensor fusion software for ADAS.');
    await visitor.getByRole('button', { name: 'Create organization' }).click();

    await expect(visitor).toHaveURL(/\/workspace/);
    await expect(visitor.getByText('unverified', { exact: false }).first()).toBeVisible();

    // The used invitation cannot be reused.
    const again = await (await browser.newContext()).newPage();
    await again.goto(new URL(link).pathname + new URL(link).search);
    await expect(again.getByRole('heading', { name: 'Invitation not valid' })).toBeVisible();

    await admin.reload();
    await expect(admin.getByRole('row', { name: new RegExp(email) })).toContainText('accepted');
    await adminContext.close();
  });
});
