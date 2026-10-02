import { type Page, expect, test } from '@playwright/test';
import { signIn } from './helpers';

/**
 * No page may scroll horizontally on a phone (expert review X1). Wide content
 * such as tables scrolls inside its own region instead.
 */
const SEARCH = `/search?q=${encodeURIComponent(
  'We need AI-based integration test automation for an ADAS platform using AUTOSAR Adaptive, QNX and Ethernet with ISO 26262 experience.',
)}`;

const expectNoHorizontalScroll = async (page: Page, path: string) => {
  await page.goto(path);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${path} is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(0);
};

test.use({ viewport: { width: 390, height: 844 } });

test.describe('phone layout', () => {
  test('public pages', async ({ page }) => {
    for (const path of ['/', SEARCH, '/technologies', '/login', '/signup', '/docs/mcp', '/terms']) {
      await expectNoHorizontalScroll(page, path);
    }
  });

  test('buyer pages', async ({ page }) => {
    await signIn(page, 'buyer@aurelia-motors.example');
    for (const path of ['/buyer/requirements', '/buyer/requests', '/account', SEARCH]) {
      await expectNoHorizontalScroll(page, path);
    }
  });

  test('supplier and admin pages', async ({ page }) => {
    await signIn(page, 'owner@vectorforge.example');
    for (const path of ['/workspace', '/members', '/docs/mcp']) await expectNoHorizontalScroll(page, path);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await signIn(page, 'admin@atx.example');
    await expectNoHorizontalScroll(page, '/admin');
  });
});
