import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

const editor = (page: Page) => page.locator('.ProseMirror');
const upload = (page: Page, name: string, content: string | Buffer, mimeType = 'application/octet-stream') =>
  page.getByLabel('Import a .txt or .md file').setInputFiles({ name, mimeType, buffer: Buffer.from(content) });
const unique = (label: string) => `${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test.describe('End-to-End: File import', () => {
  test('[FR-2.7] the home page states the supported file types', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('import-help')).toContainText('.txt and .md');
  });

  test('[FR-2.1][FR-2.6] a .txt file becomes a new editable document that can be saved and survives a reload', async ({ page }) => {
    const name = unique('notes');
    await page.goto('/');
    await upload(page, `${name}.txt`, 'First line\nSecond line\n\nAfter a blank line');

    await expect(page.getByLabel('Document title')).toHaveValue(name);
    await expect(editor(page).locator('p')).toHaveText(['First line', 'Second line', '', 'After a blank line']);

    // Editable like any other document.
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' (edited)');
    await page.getByRole('button', { name: 'Bold' }).click();
    await page.keyboard.type(' bold tail');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('save-status')).toHaveText('All changes saved');

    await page.reload();
    await expect(page.getByLabel('Document title')).toHaveValue(name);
    await expect(editor(page)).toContainText('After a blank line (edited) bold tail');
    await expect(editor(page).locator('strong')).toHaveText('bold tail');

    await page.goto('/');
    await expect(page.getByRole('link', { name })).toBeVisible();
  });

  test('[FR-2.2] a .md file keeps headings, bold, italic and both list types, and they persist after a reload', async ({ page }) => {
    const name = unique('readme');
    await page.goto('/');
    await upload(page, `${name}.md`, '# Big\n\n## Medium\n\n### Small\n\nSome **bold** and *italic* text.\n\n- bullet a\n- bullet b\n\n1. step one\n2. step two\n');

    await expect(editor(page).locator('h1')).toHaveText('Big');
    await expect(editor(page).locator('h2')).toHaveText('Medium');
    await expect(editor(page).locator('h3')).toHaveText('Small');
    await expect(editor(page).locator('strong')).toHaveText('bold');
    await expect(editor(page).locator('em')).toHaveText('italic');
    await expect(editor(page).locator('ul > li')).toHaveText(['bullet a', 'bullet b']);
    await expect(editor(page).locator('ol > li')).toHaveText(['step one', 'step two']);

    await page.reload();
    await expect(editor(page).locator('h1')).toHaveText('Big');
    await expect(editor(page).locator('ol > li')).toHaveText(['step one', 'step two']);
  });

  test('[NFR-VAL] markup inside an imported .md file is shown as text and never executed or turned into elements', async ({ page }) => {
    await page.goto('/');
    await upload(page, `${unique('xss')}.md`, '# <img src=x onerror="window.__pwned=1">\n\n<script>window.__pwned=1</script>\n\n[click](javascript:window.__pwned=1) ![pic](x.png)');
    await expect(editor(page).locator('h1')).toContainText('<img src=x');
    await expect(editor(page)).toContainText('<script>window.__pwned=1</script>');
    await expect(editor(page).locator('a, img, script')).toHaveCount(0);
    await page.reload();
    await expect(editor(page).locator('a, img, script')).toHaveCount(0);
    expect(await page.evaluate(() => (globalThis as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('[FR-2.4] an unsupported file type is refused with a clear message and no document is created', async ({ page }) => {
    await page.goto('/');
    const before = await page.locator('.doc-list li').count();
    await upload(page, 'report.pdf', '%PDF-1.4 fake', 'application/pdf');
    await expect(page.getByRole('alert')).toHaveText('Unsupported file type. Only .txt and .md files can be imported.');
    await expect(page).toHaveURL(/#\/$|\/$/);
    expect(await page.locator('.doc-list li').count()).toBe(before);
  });

  test('[FR-2.5] an empty file is refused with a clear message', async ({ page }) => {
    await page.goto('/');
    await upload(page, 'empty.txt', '');
    await expect(page.getByRole('alert')).toHaveText('The file is empty');
  });

  test('[FR-2.5] a whitespace-only file is refused by the server and the page stays usable', async ({ page }) => {
    await page.goto('/');
    await upload(page, 'blank.txt', '   \n\n\t \n');
    await expect(page.getByRole('alert')).toHaveText('The file contains no text to import');
    await expect(page.getByRole('button', { name: 'New document' })).toBeEnabled();
  });

  test('[FR-2.5] binary data renamed to .txt is refused by the server', async ({ page }) => {
    await page.goto('/');
    await upload(page, 'image.txt', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]));
    await expect(page.getByRole('alert')).toContainText('not a UTF-8 text file');
  });

  test('[FR-2.5] a file that is not valid UTF-8 is refused by the server', async ({ page }) => {
    await page.goto('/');
    await upload(page, 'latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0xff]));
    await expect(page.getByRole('alert')).toHaveText('The file is not valid UTF-8 text');
  });

  test('[FR-2.5] a file over the size limit is refused with a clear message', async ({ page }) => {
    await page.goto('/');
    await upload(page, 'huge.txt', Buffer.alloc(512 * 1024 + 1, 0x61));
    await expect(page.getByRole('alert')).toHaveText('File is too large. The limit is 512 KB.');
  });

  test('[SEC-1] an imported document belongs to the importer: another user is refused by the API', async ({ page, asUser }) => {
    await page.goto('/');
    await upload(page, `${unique('private')}.txt`, 'mine');
    await expect(editor(page)).toBeVisible();
    const id = page.url().split('/docs/')[1]!;
    const bob = await asUser('user-bob');
    const res = await bob.request.get(`/api/documents/${id}`);
    expect(res.status()).toBe(403);
  });
});
