import { type Page } from '@playwright/test';
import { BOB, CAROL, expect, test } from './fixtures';

// Two (or three) real browsers editing the same document at the same moment. The app saves by
// itself a moment after typing stops and checks for other people's changes every couple of
// seconds, so these tests wait for that rather than pressing Save or reloading.
const SYNC = { timeout: 15_000 };

const unique = (label: string) => `${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const editor = (page: Page) => page.locator('.ProseMirror');
const status = (page: Page) => page.getByTestId('save-status');

/** Alice creates a document containing the given paragraphs, shares it, and waits until it is saved. */
async function createShared(page: Page, paragraphs: string[], shareWith: string[] = ['Bob Brown']): Promise<{ id: string; title: string }> {
  const title = unique('Live doc');
  await page.goto('/');
  await page.getByRole('button', { name: 'New document' }).click();
  const input = page.getByLabel('Document title');
  await input.fill(title);
  await input.press('Enter');
  await expect.poll(async () => (await (await page.request.get('/api/documents')).json()).documents.some((d: { title: string }) => d.title === title)).toBe(true);
  await expect(status(page)).toHaveText('All changes saved', SYNC);
  await editor(page).click();
  for (const [i, text] of paragraphs.entries()) {
    if (i > 0) await page.keyboard.press('Enter');
    await page.keyboard.type(text);
  }
  await expect(status(page)).toHaveText('All changes saved', SYNC);
  for (const name of shareWith) {
    await page.getByLabel('Share with').selectOption({ label: name });
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    await expect(page.getByTestId('share-notice')).toContainText(`Shared with ${name}`);
  }
  return { id: page.url().split('/docs/')[1]!, title };
}

async function open(page: Page, id: string, expectText: string): Promise<void> {
  await page.goto(`/#/docs/${id}`);
  await expect(editor(page)).toContainText(expectText, SYNC);
  await expect(status(page)).toHaveText('All changes saved', SYNC);
}

const paragraphs = (page: Page) => editor(page).locator('p');

test.describe('End-to-End: autosave', () => {
  test('[FR-5.2] typing is saved by itself with no Save click, and is there after a full reload', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'New document' }).click();
    await expect(status(page)).toHaveText('All changes saved', SYNC);
    await editor(page).click();
    await page.keyboard.type('Never pressed save');
    await expect(status(page)).toHaveText('All changes saved', SYNC);
    await page.reload();
    await expect(editor(page)).toContainText('Never pressed save', SYNC);
  });

  test('[FR-5.2] leaving the page right after typing does not lose the last words', async ({ page }) => {
    const { id } = await createShared(page, ['Start'], []);
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' and the very last words');
    await page.getByRole('link', { name: '← All documents' }).click(); // before the autosave delay has passed
    await expect(page.getByRole('heading', { name: 'Your documents' })).toBeVisible();
    await page.goto(`/#/docs/${id}`);
    await expect(editor(page)).toContainText('Start and the very last words', SYNC);
  });

  test('[NFR-ERR] if the connection drops, typing is kept and the page says it will retry; when it returns everything is saved', async ({ page }) => {
    const { id } = await createShared(page, ['Online'], []);
    await page.route('**/api/documents/*/sync', (route) => route.abort());
    await editor(page).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' typed while offline');
    await expect(status(page)).toContainText('Save failed', SYNC);
    await expect(status(page)).toContainText('will be retried');
    await expect(editor(page)).toContainText('typed while offline');

    await page.unroute('**/api/documents/*/sync');
    await expect(status(page)).toHaveText('All changes saved', SYNC);
    await page.goto('/');
    await open(page, id, 'Online typed while offline');
  });
});

test.describe('End-to-End: simultaneous editing by two users', () => {
  test('[FR-5.3] Alice and Bob type in the SAME paragraph at the same moment: both edits appear for both, with no refresh and nothing lost', async ({ page, asUser }) => {
    const { id } = await createShared(page, ['The quick brown fox']);
    const bob = await asUser(BOB);
    await open(bob, id, 'The quick brown fox');

    await editor(page).click();
    await editor(bob).click();
    await page.keyboard.press('Control+Home');
    await bob.keyboard.press('Control+End');
    await Promise.all([
      page.keyboard.type('Alice: ', { delay: 40 }),
      bob.keyboard.type(' [Bob here]', { delay: 40 }),
    ]);

    const merged = 'Alice: The quick brown fox [Bob here]';
    await expect(paragraphs(page).first()).toHaveText(merged, SYNC);
    await expect(paragraphs(bob).first()).toHaveText(merged, SYNC);
    await expect(status(page)).toHaveText('All changes saved', SYNC);
    await expect(status(bob)).toHaveText('All changes saved', SYNC);

    // Stored once, merged, and the same after a reload for both.
    await page.reload();
    await bob.reload();
    await expect(paragraphs(page).first()).toHaveText(merged, SYNC);
    await expect(paragraphs(bob).first()).toHaveText(merged, SYNC);
    expect((await (await page.request.get(`/api/documents/${id}`)).json()).document.content.content).toHaveLength(1);
  });

  test('[FR-5.3] two users typing into different paragraphs at once both keep their paragraph', async ({ page, asUser }) => {
    const { id } = await createShared(page, ['First paragraph', 'Second paragraph']);
    const bob = await asUser(BOB);
    await open(bob, id, 'Second paragraph');

    await paragraphs(page).nth(0).click();
    await paragraphs(bob).nth(1).click();
    await page.keyboard.press('End');
    await bob.keyboard.press('End');
    await Promise.all([
      page.keyboard.type(' (edited by Alice)', { delay: 30 }),
      bob.keyboard.type(' (edited by Bob)', { delay: 30 }),
    ]);

    for (const p of [page, bob]) {
      await expect(paragraphs(p).nth(0)).toHaveText('First paragraph (edited by Alice)', SYNC);
      await expect(paragraphs(p).nth(1)).toHaveText('Second paragraph (edited by Bob)', SYNC);
    }
  });

  test('[FR-5.3] a change one person makes appears on the other person\'s screen on its own, and does not move that person\'s cursor', async ({ page, asUser }) => {
    const { id } = await createShared(page, ['abcdef']);
    const bob = await asUser(BOB);
    await open(bob, id, 'abcdef');

    await editor(page).click();
    await page.keyboard.press('Control+End'); // Alice's cursor sits after "abcdef"
    await bob.locator('.ProseMirror').click();
    await bob.keyboard.press('Control+Home');
    await bob.keyboard.type('>>> ');
    await expect(paragraphs(page).first()).toHaveText('>>> abcdef', SYNC); // nobody touched Alice's page

    await page.keyboard.type('XYZ'); // her cursor was still at the end
    await expect(paragraphs(page).first()).toHaveText('>>> abcdefXYZ');
    await expect(paragraphs(bob).first()).toHaveText('>>> abcdefXYZ', SYNC);
  });

  test('[FR-5.3] formatting by one user and typing by another in the same paragraph are both kept', async ({ page, asUser }) => {
    const { id } = await createShared(page, ['make this word bold please']);
    const bob = await asUser(BOB);
    await open(bob, id, 'bold please');

    await editor(page).click();
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < 'make '.length; i++) await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 'this'.length; i++) await page.keyboard.press('Shift+ArrowRight'); // selects "this"
    await page.getByRole('button', { name: 'Bold' }).click();

    await editor(bob).click();
    await bob.keyboard.press('Control+End');
    await bob.keyboard.type(' thanks');

    for (const p of [page, bob]) {
      await expect(paragraphs(p).first()).toContainText('make this word bold please thanks', SYNC);
      await expect(editor(p).locator('strong')).toContainText('this', SYNC);
    }
  });

  test('[FR-5.3] three people editing at once all keep their changes', async ({ page, asUser }) => {
    const { id } = await createShared(page, ['one', 'two', 'three'], ['Bob Brown', 'Carol Clark']);
    const bob = await asUser(BOB);
    const carol = await asUser(CAROL);
    await open(bob, id, 'three');
    await open(carol, id, 'three');

    await paragraphs(page).nth(0).click();
    await paragraphs(bob).nth(1).click();
    await paragraphs(carol).nth(2).click();
    await Promise.all([
      (async () => { await page.keyboard.press('End'); await page.keyboard.type(' +A', { delay: 30 }); })(),
      (async () => { await bob.keyboard.press('End'); await bob.keyboard.type(' +B', { delay: 30 }); })(),
      (async () => { await carol.keyboard.press('End'); await carol.keyboard.type(' +C', { delay: 30 }); })(),
    ]);
    for (const p of [page, bob, carol]) {
      await expect(paragraphs(p)).toHaveText(['one +A', 'two +B', 'three +C'], SYNC);
    }
  });

  test('[FR-5.3] a rename by one user appears for the other without a refresh', async ({ page, asUser }) => {
    const { id } = await createShared(page, ['x']);
    const bob = await asUser(BOB);
    await open(bob, id, 'x');
    const renamed = unique('Renamed by Alice');
    const input = page.getByLabel('Document title');
    await input.fill(renamed);
    await input.press('Enter');
    await expect(bob.getByLabel('Document title')).toHaveValue(renamed, SYNC);
  });

  test('[FR-5.1] two people opening a document nobody has edited yet at the same time do not create duplicate paragraphs', async ({ page, asUser }) => {
    const { id } = await createShared(page, ['Only paragraph']);
    // Documents never edited before are turned into live documents the first time anyone opens them.
    const fresh = await page.request.post('/api/documents', { data: { title: unique('Fresh') } });
    const freshId = (await fresh.json()).document.id;
    await page.request.post(`/api/documents/${freshId}/shares`, { data: { userId: BOB } });
    const bob = await asUser(BOB);
    await Promise.all([page.goto(`/#/docs/${freshId}`), bob.goto(`/#/docs/${freshId}`)]);
    await expect(status(page)).toHaveText('All changes saved', SYNC);
    await expect(status(bob)).toHaveText('All changes saved', SYNC);
    await page.waitForTimeout(5000); // several sync rounds
    await expect(paragraphs(page)).toHaveCount(1);
    await expect(paragraphs(bob)).toHaveCount(1);
    await page.reload();
    await expect(paragraphs(page)).toHaveCount(1);
    expect(id).toBeTruthy();
  });
});

test.describe('End-to-End: access changes during live editing', () => {
  test('[FR-3.6] after Alice removes Bob, Bob\'s page stops saving and locks, and nothing he typed afterwards reaches Alice', async ({ page, asUser }) => {
    const { id } = await createShared(page, ['shared text']);
    const bob = await asUser(BOB);
    await open(bob, id, 'shared text');

    await page.getByRole('button', { name: 'Remove Bob Brown' }).click();
    await expect(page.getByTestId('share-notice')).toContainText('Access removed for Bob Brown.');

    await expect(status(bob)).toContainText('Save failed: You do not have permission', SYNC); // found out by his next sync
    await expect(editor(bob)).toHaveAttribute('contenteditable', 'false');
    await expect(editor(bob)).toContainText('shared text');

    await page.reload();
    await expect(editor(page)).toHaveText('shared text', SYNC);
  });

  test('[SEC-1] a user with no access gets the permission error when opening the document, and no editor', async ({ page, asUser }) => {
    const { id } = await createShared(page, ['private'], []);
    const bob = await asUser(BOB);
    await bob.goto(`/#/docs/${id}`);
    await expect(bob.getByRole('alert')).toContainText('You do not have permission');
    await expect(bob.locator('.ProseMirror')).toHaveCount(0);
  });
});
