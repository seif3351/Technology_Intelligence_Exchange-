import { expect, test } from '@playwright/test';
import { firstLink, latestMail } from './helpers';

test.describe('account recovery', () => {
  test('forgot password: reset link by email, old password stops working', async ({ page }) => {
    const email = 'owner@drivemesh.example';
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot your password?' }).click();
    // The login page has an Email field too: wait for the navigation before typing.
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible();
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('status')).toContainText('If an account exists');

    await page.goto(firstLink(await latestMail(email)));
    await page.getByLabel(/New password/).fill('drivemesh-new-password-2026');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('Your password was changed')).toBeVisible();

    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill('demo-password-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    // Wait for this specific error: Next's route announcer also has role=alert.
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid email or password' })).toBeVisible();
    // The email stays filled in after a failed attempt.
    await expect(page.getByLabel('Email')).toHaveValue(email);

    await page.getByLabel('Password').fill('drivemesh-new-password-2026');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  });
});
