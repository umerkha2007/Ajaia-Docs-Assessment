import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

const unique = (label: string) => `${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const editor = (page: Page) => page.locator('.ProseMirror');

async function newDocument(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New document' }).click();
  await expect(editor(page)).toBeVisible();
  return page.url();
}

async function saveAndWait(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
}

test.describe('End-to-End: Rich-text formatting', () => {
  test('[FR-1.7][FR-1.8][FR-1.9] bold, italic, underline, headings and both list types are rendered, saved, and restored after reload', async ({ page }) => {
    await newDocument(page);
    await editor(page).click();
    const kb = page.keyboard;

    await page.getByRole('button', { name: 'Heading 1' }).click();
    await kb.type('Big title');
    await kb.press('Enter'); // a heading ends with a normal paragraph

    await kb.press('Control+b');
    await kb.type('boldword');
    await kb.press('Control+b');
    await kb.type(' ');
    await page.getByRole('button', { name: 'Italic' }).click();
    await kb.type('italword');
    await page.getByRole('button', { name: 'Italic' }).click();
    await kb.type(' ');
    await kb.press('Control+u');
    await kb.type('underword');
    await kb.press('Control+u');
    await kb.press('Enter');

    await page.getByRole('button', { name: 'Bulleted list' }).click();
    await kb.type('bullet one');
    await kb.press('Enter');
    await kb.type('bullet two');
    await kb.press('Enter');
    await kb.press('Enter'); // leave the list
    await page.getByRole('button', { name: 'Numbered list' }).click();
    await kb.type('step one');
    await kb.press('Enter');
    await kb.type('step two');

    await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes');
    await saveAndWait(page);

    // Stored JSON (as the server holds it) contains every feature.
    const id = page.url().split('/docs/')[1]!;
    const stored = JSON.stringify((await (await page.request.get(`/api/documents/${id}`)).json()).document.content);
    for (const needle of ['"heading"', '"level":1', '"bold"', '"italic"', '"underline"', '"bulletList"', '"orderedList"']) {
      expect(stored, needle).toContain(needle);
    }

    // After a full reload the structure is rendered again.
    await page.reload();
    await expect(editor(page).locator('h1')).toHaveText('Big title');
    await expect(editor(page).locator('strong')).toHaveText('boldword');
    await expect(editor(page).locator('em')).toHaveText('italword');
    await expect(editor(page).locator('u')).toHaveText('underword');
    await expect(editor(page).locator('ul > li')).toHaveText(['bullet one', 'bullet two']);
    await expect(editor(page).locator('ol > li')).toHaveText(['step one', 'step two']);
    await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
  });

  test('[FR-1.8] heading levels 1, 2 and 3 render as different heading elements and survive reload', async ({ page }) => {
    await newDocument(page);
    await editor(page).click();
    for (const level of [1, 2, 3]) {
      await page.getByRole('button', { name: `Heading ${level}` }).click();
      await page.keyboard.type(`Level ${level}`);
      await page.keyboard.press('Enter');
    }
    await saveAndWait(page);
    await page.reload();
    for (const level of [1, 2, 3]) {
      await expect(editor(page).locator(`h${level}`)).toHaveText(`Level ${level}`);
    }
  });

  test('[FR-1.7] toolbar buttons reflect the formatting at the caret', async ({ page }) => {
    await newDocument(page);
    await editor(page).click();
    const bold = page.getByRole('button', { name: 'Bold' });
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('x');
    await bold.click();
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
  });

  test('[FR-1.4] formatted content reopens from the document list, not only after a reload', async ({ page }) => {
    const title = unique('Formatted');
    await newDocument(page);
    const input = page.getByLabel('Document title');
    await input.fill(title);
    await input.press('Enter');
    await expect.poll(async () => (await (await page.request.get('/api/documents')).json()).documents.some((d: { title: string }) => d.title === title)).toBe(true);

    await editor(page).click();
    await page.getByRole('button', { name: 'Bulleted list' }).click();
    await page.keyboard.type('kept item');
    await saveAndWait(page);

    await page.goto('/');
    await page.getByRole('link', { name: title }).click();
    await expect(editor(page).locator('ul > li')).toHaveText(['kept item']);
  });

  test('[NFR-VAL] markup typed into the editor is shown as text and never executed or turned into elements', async ({ page }) => {
    await newDocument(page);
    await editor(page).click();
    const payload = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    await page.keyboard.type(payload);
    await saveAndWait(page);
    await page.reload();

    await expect(editor(page)).toContainText(payload);
    await expect(editor(page).locator('img, script')).toHaveCount(0);
    expect(await page.evaluate(() => (globalThis as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('[NFR-VAL] the server refuses content outside the editor schema and keeps the saved document', async ({ page }) => {
    await newDocument(page);
    await editor(page).click();
    await page.keyboard.type('safe text');
    await saveAndWait(page);
    const id = page.url().split('/docs/')[1]!;

    const res = await page.request.put(`/api/documents/${id}/content`, {
      data: { content: { type: 'doc', content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }] } },
    });
    expect(res.status()).toBe(400);

    await page.reload();
    await expect(editor(page)).toContainText('safe text');
  });
});
