import { type Page, expect } from '@playwright/test';

export const DEMO_PASSWORD = 'demo-password-2026';

export const signIn = async (page: Page, email: string) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(DEMO_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
};

/** Newest message for `to` in the API's development inbox (MAIL_DRIVER=file). */
export const latestMail = async (to: string): Promise<string> => {
  const { readdir, readFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const dir = path.resolve(import.meta.dirname, '../../../.var/e2e-mail');
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.includes(to)).sort();
    const newest = files.at(-1);
    if (newest) return readFile(path.join(dir, newest), 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`no mail for ${to}`);
};

export const firstLink = (mail: string): string => {
  const link = /https?:\/\/\S+/.exec(mail)?.[0];
  if (!link) throw new Error('no link in mail');
  const url = new URL(link);
  return url.pathname + url.search;
};
