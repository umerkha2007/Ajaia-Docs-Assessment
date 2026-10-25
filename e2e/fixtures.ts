import { test as base, expect, type Page } from '@playwright/test';

export { expect };

export const ALICE = 'user-alice';
export const BOB = 'user-bob';
export const CAROL = 'user-carol';

interface Fixtures {
  /** A page for a different seeded user, in its own browser context (own cookies), already signed in. */
  asUser: (userId: string) => Promise<Page>;
}

/**
 * `page` starts signed in as Alice (the app has no anonymous mode), through the same
 * sign-in API the UI uses. Use `asUser` for a second person.
 */
export const test = base.extend<Fixtures>({
  page: async ({ page }, use) => {
    const res = await page.request.post('/api/session', { data: { userId: ALICE } });
    expect(res.ok()).toBe(true);
    await use(page);
  },
  asUser: async ({ browser, baseURL }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async (userId) => {
      const context = await browser.newContext({ baseURL: baseURL ?? undefined });
      contexts.push(context);
      const res = await context.request.post('/api/session', { data: { userId } });
      expect(res.ok()).toBe(true);
      return context.newPage();
    });
    for (const c of contexts) await c.close();
  },
});
