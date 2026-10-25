import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

// The E2E database is shared by every test in a run, so tests use unique titles
// and never assume the list is empty.
const unique = (label: string) => `${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

async function createDocument(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New document' }).click();
  await expect(page.getByLabel('Document title')).toBeVisible();
}

/** Type paragraphs into the rich-text editor with real keystrokes. */
async function typeInEditor(page: Page, ...paragraphs: string[]): Promise<void> {
  await page.locator('.ProseMirror').click();
  for (const [i, text] of paragraphs.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(text);
  }
}

async function rename(page: Page, title: string): Promise<void> {
  const input = page.getByLabel('Document title');
  await input.fill(title);
  await input.press('Enter');
  // Wait for the rename to be persisted before moving on.
  await expect.poll(async () => (await page.request.get('/api/documents')).json().then((j) => j.documents.some((d: { title: string }) => d.title === title))).toBe(true);
}

test.describe('End-to-End: Document CRUD and persistence', () => {
  test('[FR-1.1][FR-1.2][FR-1.3][FR-1.4] create, rename, edit, save, then reopen after a full page reload', async ({ page }) => {
    const title = unique('Quarterly plan');
    await createDocument(page);
    await rename(page, title);

    await typeInEditor(page, 'First line', 'Second line');
    // Autosave: the change is saved by itself, without pressing Save.
    await expect(page.getByTestId('save-status')).toHaveText('All changes saved', { timeout: 10_000 });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('save-status')).toHaveText('All changes saved');

    await page.reload();
    await expect(page.getByLabel('Document title')).toHaveValue(title);
    await expect(page.locator('.ProseMirror p')).toHaveText(['First line', 'Second line']);

    await page.getByRole('link', { name: '← All documents' }).click();
    await expect(page.getByRole('link', { name: title })).toBeVisible();
    await page.getByRole('link', { name: title }).click();
    await expect(page.locator('.ProseMirror p')).toHaveText(['First line', 'Second line']);
  });

  test('[FR-1.6] the most recently edited document is listed first', async ({ page }) => {
    const older = unique('Older');
    const newer = unique('Newer');
    await createDocument(page);
    await rename(page, older);
    await createDocument(page);
    await rename(page, newer);

    await page.goto('/');
    const titles = await page.locator('.doc-list li a').allTextContents();
    expect(titles.indexOf(newer)).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf(newer)).toBeLessThan(titles.indexOf(older));

    // Editing the older document moves it to the top.
    await page.getByRole('link', { name: older }).click();
    await typeInEditor(page, 'bump');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
    await page.goto('/');
    const after = await page.locator('.doc-list li a').allTextContents();
    expect(after.indexOf(older)).toBeLessThan(after.indexOf(newer));
  });

  test('[FR-1.5] deleting a document removes it from the list and it can no longer be opened', async ({ page }) => {
    const title = unique('Disposable');
    await createDocument(page);
    await rename(page, title);
    const url = page.url();

    await page.goto('/');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: `Delete ${title}` }).click();
    await expect(page.getByRole('link', { name: title })).toHaveCount(0);

    await page.goto(url);
    await page.reload();
    await expect(page.getByRole('alert')).toHaveText('Document not found');
  });

  test('[NFR-VAL] an empty title is rejected with a message and the old title survives a reload', async ({ page }) => {
    const title = unique('Keep this title');
    await createDocument(page);
    await rename(page, title);

    const input = page.getByLabel('Document title');
    await input.fill('   ');
    await input.press('Enter');
    await expect(page.getByRole('alert')).toHaveText('Title must not be empty');

    await page.reload();
    await expect(page.getByLabel('Document title')).toHaveValue(title);
  });

  test('[SEC-1] another seeded user is refused by the API for a document they do not own', async ({ page, asUser }) => {
    await createDocument(page);
    const id = page.url().split('/docs/')[1]!;
    const bob = await asUser('user-bob');
    const res = await bob.request.get(`/api/documents/${id}`);
    expect(res.status()).toBe(403);
    expect(await res.json()).toMatchObject({ error: 'FORBIDDEN' });
  });
});
