/// <reference lib="dom" />
import { type Page } from '@playwright/test';
import { expect, test } from './fixtures';

const editor = (page: Page) => page.locator('.ProseMirror');

async function newDocument(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'New document' }).click();
  await expect(editor(page)).toBeVisible();
}

/**
 * Simulates pasting rich text by dispatching a paste event carrying HTML, as the
 * browser does for a copy from another app. It does not go through the OS clipboard.
 */
async function pasteHtml(page: Page, html: string): Promise<void> {
  await editor(page).click();
  await page.evaluate((h) => {
    const dt = new DataTransfer();
    dt.setData('text/html', h);
    dt.setData('text/plain', h.replace(/<[^>]+>/g, ' '));
    document.querySelector('.ProseMirror')!.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, html);
}

const GOOGLE_DOCS =
  '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1">' +
  '<p dir="ltr"><span style="font-weight:700;">Bold</span><span style="font-style:italic;"> Ital</span>' +
  '<span style="text-decoration:underline;"> Under</span></p>' +
  '<h2 dir="ltr"><span style="font-size:17pt;">Heading</span></h2>' +
  '<ul><li dir="ltr"><p dir="ltr"><span>bullet</span></p></li></ul></b>';

const SEMANTIC =
  '<h1>Head</h1><p>a <strong>bold</strong> <em>ital</em> <u>under</u></p>' +
  '<ul><li>one</li><li>two</li></ul><ol><li>first</li><li>second</li></ol>';

test.describe('End-to-End: Pasting rich text', () => {
  test('[FR-1.7][FR-1.8][FR-1.9] pasted semantic HTML keeps headings, bold/italic/underline and both list types', async ({ page }) => {
    await newDocument(page);
    await pasteHtml(page, SEMANTIC);
    await expect(editor(page).locator('h1')).toHaveText('Head');
    await expect(editor(page).locator('strong')).toHaveText('bold');
    await expect(editor(page).locator('em')).toHaveText('ital');
    await expect(editor(page).locator('u')).toHaveText('under');
    await expect(editor(page).locator('ul > li')).toHaveText(['one', 'two']);
    await expect(editor(page).locator('ol > li')).toHaveText(['first', 'second']);
  });

  test('[FR-1.7][FR-1.8][FR-1.9] content pasted in Google Docs style (styled spans) becomes real formatting', async ({ page }) => {
    await newDocument(page);
    await pasteHtml(page, GOOGLE_DOCS);
    await expect(editor(page).locator('strong')).toHaveText('Bold');
    await expect(editor(page).locator('em')).toHaveText('Ital');
    await expect(editor(page).locator('u')).toHaveText('Under');
    await expect(editor(page).locator('h2')).toHaveText('Heading');
    await expect(editor(page).locator('ul > li')).toHaveText(['bullet']);
  });

  test('[FR-1.7][FR-4.1] pasted formatting can be saved and is restored after a reload', async ({ page }) => {
    await newDocument(page);
    await pasteHtml(page, SEMANTIC);
    await expect(page.getByTestId('save-status')).toHaveText('Unsaved changes');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('save-status')).toHaveText('All changes saved');

    await page.reload();
    await expect(editor(page).locator('h1')).toHaveText('Head');
    await expect(editor(page).locator('strong')).toHaveText('bold');
    await expect(editor(page).locator('ol > li')).toHaveText(['first', 'second']);
  });

  test('[NFR-VAL] unsupported formatting is dropped but its text is kept, and the result can be saved', async ({ page }) => {
    await newDocument(page);
    await pasteHtml(
      page,
      '<p>link <a href="https://x.test">here</a> <s>strike</s> <code>code</code></p>' +
        '<table><tr><td>cell</td></tr></table><img src="x.png" onerror="window.__pwned=1"><blockquote>quote</blockquote>' +
        '<script>window.__pwned=1</script>',
    );
    const ed = editor(page);
    await expect(ed).toContainText('link here strike code');
    await expect(ed).toContainText('cell');
    await expect(ed).toContainText('quote');
    await expect(ed.locator('a, s, code, table, img, blockquote, script')).toHaveCount(0);

    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
    expect(await page.evaluate(() => (globalThis as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('[FR-1.3] pasting inserts at the caret and leaves earlier typed text intact', async ({ page }) => {
    await newDocument(page);
    await editor(page).click();
    await page.keyboard.type('keep ');
    await pasteHtml(page, '<p><strong>pasted</strong></p>');
    await expect(editor(page)).toContainText('keep');
    await expect(editor(page).locator('strong')).toHaveText('pasted');
  });
});
