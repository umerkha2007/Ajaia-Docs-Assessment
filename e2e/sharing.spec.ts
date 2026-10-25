import { test as plain, type Page } from '@playwright/test';
import { ALICE, BOB, CAROL, expect, test } from './fixtures';

const unique = (label: string) => `${label} ${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const editor = (page: Page) => page.locator('.ProseMirror');
const mine = (page: Page) => page.getByRole('region', { name: 'Your documents' });
const sharedWithMe = (page: Page) => page.getByRole('region', { name: 'Shared with you' });

/** Alice creates a titled document containing `text`, saved. Returns its title and id. */
async function createSavedDocument(page: Page, text: string): Promise<{ title: string; id: string }> {
  const title = unique('Shared doc');
  await page.goto('/');
  await page.getByRole('button', { name: 'New document' }).click();
  const input = page.getByLabel('Document title');
  await input.fill(title);
  await input.press('Enter');
  await expect.poll(async () => (await (await page.request.get('/api/documents')).json()).documents.some((d: { title: string }) => d.title === title)).toBe(true);
  await editor(page).click();
  await page.keyboard.type(text);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('save-status')).toHaveText('All changes saved');
  return { title, id: page.url().split('/docs/')[1]! };
}

async function shareWith(page: Page, name: string): Promise<void> {
  await page.getByLabel('Share with').selectOption({ label: name });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByTestId('share-notice')).toContainText(`Shared with ${name}`);
}

plain.describe('End-to-End: simulated sign-in', () => {
  plain('[FR-3.2] with no session the app asks you to choose a seeded user and says it is simulated', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Choose a user' })).toBeVisible();
    await expect(page.getByText(/not real authentication/i)).toBeVisible();
    for (const name of ['Alice Anderson', 'Bob Brown', 'Carol Clark']) {
      await expect(page.getByRole('button', { name: `Continue as ${name}` })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Your documents' })).toHaveCount(0);
  });

  plain('[FR-3.2] choosing a user signs in; the choice survives a reload; signing out forgets it', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue as Bob Brown' }).click();
    await expect(page.getByRole('heading', { name: 'Your documents' })).toBeVisible();
    await expect(page.getByLabel('Switch user')).toHaveValue(BOB);
    await page.reload();
    await expect(page.getByLabel('Switch user')).toHaveValue(BOB);
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { name: 'Choose a user' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Choose a user' })).toBeVisible();
  });

  plain('[SEC-4] the session cookie is HttpOnly (page scripts cannot read it) and an unsigned or edited cookie does not sign anyone in', async ({ page, context }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue as Alice Anderson' }).click();
    await expect(page.getByLabel('Switch user')).toHaveValue(ALICE);
    expect(await page.evaluate(() => document.cookie)).not.toContain('session');
    const [cookie] = (await context.cookies()).filter((c) => c.name === 'session');
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax' });

    // Replace the signed cookie with a bare user id, then with a re-targeted signed value.
    for (const forged of [BOB, `${Buffer.from(BOB).toString('base64url')}.${cookie!.value.split('.')[1]}`]) {
      await context.clearCookies();
      await context.addCookies([{ name: 'session', value: forged, url: page.url() }]);
      await page.reload();
      await expect(page.getByRole('heading', { name: 'Choose a user' })).toBeVisible();
      const res = await page.request.get('/api/documents');
      expect(res.status()).toBe(401);
    }
  });
});

test.describe('End-to-End: ownership and sharing between seeded users', () => {
  test('[FR-3.3][FR-3.4][FR-3.5] Alice shares a document; Bob finds it under "Shared with you", sees who owns it, edits it, and Alice sees his edit', async ({ page, asUser }) => {
    const { title, id } = await createSavedDocument(page, 'Written by Alice.');
    await expect(page.getByTestId('access-note')).toHaveText('You own this document.');
    await shareWith(page, 'Bob Brown');
    await expect(page.getByRole('list', { name: 'People with access' })).toContainText('Bob Brown');

    const bob = await asUser(BOB);
    await bob.goto('/');
    await expect(mine(bob).getByRole('link', { name: title })).toHaveCount(0);
    const row = sharedWithMe(bob).getByRole('listitem').filter({ hasText: title });
    await expect(row).toContainText('Owner: Alice Anderson');
    await expect(row).toContainText('Can edit');
    await expect(row.getByRole('button')).toHaveCount(0); // no Delete on shared documents

    await row.getByRole('link', { name: title }).click();
    await expect(bob.getByTestId('access-note')).toHaveText('Shared by Alice Anderson. You can edit this document.');
    await expect(bob.getByRole('heading', { name: 'Sharing' })).toHaveCount(0);
    await expect(editor(bob)).toContainText('Written by Alice.');

    await editor(bob).click();
    await bob.keyboard.press('Control+End');
    await bob.keyboard.type(' Bob added this.');
    await bob.getByRole('button', { name: 'Save' }).click();
    await expect(bob.getByTestId('save-status')).toHaveText('All changes saved');

    await page.reload();
    await expect(editor(page)).toContainText('Written by Alice. Bob added this.');
    await page.goto('/');
    const owned = mine(page).getByRole('listitem').filter({ hasText: title });
    await expect(owned.getByTestId('share-badge')).toHaveText('Shared with 1');
    expect((await (await page.request.get(`/api/documents/${id}`)).json()).document.ownerId).toBe(ALICE);
  });

  test('[FR-3.7] the share is still in force after reloading both users\' pages', async ({ page, asUser }) => {
    const { title } = await createSavedDocument(page, 'persist me');
    await shareWith(page, 'Bob Brown');
    await page.reload();
    await expect(page.getByRole('list', { name: 'People with access' })).toContainText('Bob Brown');

    const bob = await asUser(BOB);
    await bob.goto('/');
    await bob.reload();
    await expect(sharedWithMe(bob).getByRole('link', { name: title })).toBeVisible();
  });

  test('[FR-3.6] when Alice revokes access, the unsaved work on Bob screen is refused but kept, his editor locks, and the document leaves his list', async ({ page, asUser }) => {
    const { title, id } = await createSavedDocument(page, 'before revoke');
    await shareWith(page, 'Bob Brown');

    const bob = await asUser(BOB);
    await bob.goto(`/#/docs/${id}`);
    await expect(editor(bob)).toContainText('before revoke');
    await expect(bob.getByTestId('save-status')).toHaveText('All changes saved');

    // Cut Bob's connection so what he types stays unsaved while Alice removes his access.
    await bob.route('**/api/documents/*/sync', (route) => route.abort());
    await editor(bob).click();
    await bob.keyboard.type(' bob typing');
    await expect(bob.getByTestId('save-status')).toContainText('Save failed');

    await page.getByRole('button', { name: 'Remove Bob Brown' }).click();
    await expect(page.getByTestId('share-notice')).toContainText('Access removed for Bob Brown.');
    await expect(page.getByText('Only you can open this document.')).toBeVisible();

    await bob.unroute('**/api/documents/*/sync'); // connection is back; his next save is refused
    await expect(bob.getByTestId('save-status')).toContainText('Save failed: You do not have permission', { timeout: 10_000 });
    await expect(editor(bob)).toContainText('bob typing'); // his text is not silently discarded
    await expect(editor(bob)).toHaveAttribute('contenteditable', 'false');
    await expect(bob.getByRole('button', { name: 'Bold' })).toBeDisabled();

    await bob.goto('/');
    await expect(sharedWithMe(bob).getByRole('link', { name: title })).toHaveCount(0);
    await bob.goto(`/#/docs/${id}`);
    await bob.reload();
    await expect(bob.getByRole('alert')).toContainText('You do not have permission');

    // The refused text never reached the owner's document.
    await page.reload();
    await expect(editor(page)).toContainText('before revoke');
    await expect(editor(page)).not.toContainText('bob typing');
  });

  test('[SEC-1] Carol, who was never given access, cannot see or open the document, and the API refuses her on every route', async ({ page, asUser }) => {
    const { title, id } = await createSavedDocument(page, 'private to Alice and Bob');
    await shareWith(page, 'Bob Brown');

    const carol = await asUser(CAROL);
    await carol.goto('/');
    await expect(carol.getByRole('heading', { name: 'Your documents' })).toBeVisible();
    await expect(carol.getByRole('link', { name: title })).toHaveCount(0);
    await carol.goto(`/#/docs/${id}`);
    await expect(carol.getByRole('alert')).toContainText('You do not have permission');
    await expect(carol.getByLabel('Document content')).toHaveCount(0);

    for (const [method, url, data] of [
      ['get', `/api/documents/${id}`],
      ['patch', `/api/documents/${id}`, { title: 'x' }],
      ['put', `/api/documents/${id}/content`, { content: { type: 'doc', content: [{ type: 'paragraph' }] } }],
      ['delete', `/api/documents/${id}`],
      ['get', `/api/documents/${id}/shares`],
      ['post', `/api/documents/${id}/shares`, { userId: CAROL }],
    ] as const) {
      const res = await carol.request[method](url, data ? { data } : {});
      expect(res.status(), `${method} ${url}`).toBe(403);
    }
  });

  test('[SEC-1] Bob, an editor, cannot delete the document or change its sharing, even by calling the API directly', async ({ page, asUser }) => {
    const { id } = await createSavedDocument(page, 'owner-only controls');
    await shareWith(page, 'Bob Brown');
    const bob = await asUser(BOB);
    expect((await bob.request.delete(`/api/documents/${id}`)).status()).toBe(403);
    expect((await bob.request.post(`/api/documents/${id}/shares`, { data: { userId: CAROL } })).status()).toBe(403);
    expect((await bob.request.delete(`/api/documents/${id}/shares/${BOB}`)).status()).toBe(403);
    expect((await page.request.get(`/api/documents/${id}`)).status()).toBe(200);
    expect((await (await page.request.get(`/api/documents/${id}/shares`)).json()).shares).toHaveLength(1);
  });

  test('[SEC-2] a role or owner sent by the client does not change who owns the document or what Bob may do', async ({ page, asUser }) => {
    const { id } = await createSavedDocument(page, 'ownership stays');
    const res = await page.request.post(`/api/documents/${id}/shares`, { data: { userId: BOB, role: 'owner', ownerId: BOB } });
    expect((await res.json()).shares[0].role).toBe('editor');
    const bob = await asUser(BOB);
    expect((await bob.request.delete(`/api/documents/${id}`)).status()).toBe(403);
    expect((await (await page.request.get(`/api/documents/${id}`)).json()).document).toMatchObject({ ownerId: ALICE, access: 'owner' });
  });

  test('[FR-3.2] one browser can switch between users: each sees only their own and shared documents, and leaves a document that the new user cannot open', async ({ page }) => {
    const { title, id } = await createSavedDocument(page, 'switch test');
    await shareWith(page, 'Bob Brown');

    await page.goto('/');
    await expect(mine(page).getByRole('link', { name: title })).toBeVisible();
    await page.getByLabel('Switch user').selectOption({ label: 'Bob Brown' });
    await expect(sharedWithMe(page).getByRole('link', { name: title })).toBeVisible();
    await expect(mine(page).getByRole('link', { name: title })).toHaveCount(0);

    await page.getByLabel('Switch user').selectOption({ label: 'Carol Clark' });
    await expect(page.getByRole('heading', { name: 'Your documents' })).toBeVisible();
    await expect(page.getByRole('link', { name: title })).toHaveCount(0);

    // Opening the document as Carol is refused; switching back to Alice restores access.
    await page.goto(`/#/docs/${id}`);
    await expect(page.getByRole('alert')).toContainText('You do not have permission');
    await page.getByLabel('Switch user').selectOption({ label: 'Alice Anderson' });
    await page.goto(`/#/docs/${id}`);
    await expect(editor(page)).toContainText('switch test');
  });

  test('[FR-3.6] deleting a shared document removes it from Bob\'s list', async ({ page, asUser }) => {
    const { title } = await createSavedDocument(page, 'to be deleted');
    await shareWith(page, 'Bob Brown');
    const bob = await asUser(BOB);
    await bob.goto('/');
    await expect(sharedWithMe(bob).getByRole('link', { name: title })).toBeVisible();

    await page.goto('/');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: `Delete ${title}` }).click();
    await expect(page.getByRole('link', { name: title })).toHaveCount(0);

    await bob.reload();
    await expect(bob.getByRole('heading', { name: 'Shared with you' })).toBeVisible();
    await expect(bob.getByRole('link', { name: title })).toHaveCount(0);
  });
});
