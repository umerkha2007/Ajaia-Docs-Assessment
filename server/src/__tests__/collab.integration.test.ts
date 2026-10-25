import type { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DocSync, type SyncRequest, type SyncResponse } from '../../../client/src/sync/DocSync.js';
import { buildApp } from '../app.js';
import { ALICE, BOB, CAROL, freshDb, sessionCookie, steppingClock } from './helpers.js';

// The browser's own sync engine (DocSync, with real timers) talking to the real server
// routes. Only the HTTP socket is skipped (app.inject), so this is as close to two people
// typing at once as an automated test gets.

const FAST = { pollMs: 25, debounceMs: 10 };
const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

let app: FastifyInstance;
let docId: string;
let clients: DocSync[];

const transport = (user: string, id = () => docId) => async (request: SyncRequest): Promise<SyncResponse> => {
  const res = await app.inject({ method: 'POST', url: `/api/documents/${id()}/sync`, headers: { cookie: sessionCookie(user) }, payload: request as object });
  const body = res.json();
  if (res.statusCode >= 400) throw Object.assign(new Error(body.message), { status: res.statusCode });
  return body as SyncResponse;
};
const connect = (user: string) => {
  const sync = new DocSync(transport(user), FAST);
  clients.push(sync);
  sync.start();
  return sync;
};
const text = (sync: DocSync, i = 0) => ((sync.ydoc.getXmlFragment('default').get(i) as Y.XmlElement).get(0) as Y.XmlText);
const until = async (fn: () => boolean, ms = 4000) => {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 10));
  }
};
const stored = async (user = ALICE) =>
  (await app.inject({ method: 'GET', url: `/api/documents/${docId}`, headers: { cookie: sessionCookie(user) } })).json().document;
const storedText = async (i = 0) => (await stored()).content.content[i].content?.map((t: { text: string }) => t.text).join('') ?? '';

beforeEach(async () => {
  app = buildApp({ db: freshDb(), now: steppingClock() });
  await app.ready();
  const created = await app.inject({ method: 'POST', url: '/api/documents', headers: { cookie: sessionCookie(ALICE) }, payload: { title: 'Live' } });
  docId = created.json().document.id;
  await app.inject({
    method: 'PUT', url: `/api/documents/${docId}/content`, headers: { cookie: sessionCookie(ALICE) },
    payload: { content: { type: 'doc', content: [para('The quick brown fox'), para('Second paragraph')] } },
  });
  await app.inject({ method: 'POST', url: `/api/documents/${docId}/shares`, headers: { cookie: sessionCookie(ALICE) }, payload: { userId: BOB } });
  clients = [];
});
afterEach(async () => {
  for (const c of clients) c.stop();
  await app.close();
});

describe('Collaboration (integration): the browser sync engine against the real server', () => {
  it('[FR-5.1] a client loads the document, and every client sees the same text', async () => {
    const a = connect(ALICE);
    const b = connect(BOB);
    await until(() => a.isReady && b.isReady);
    expect(text(a).toString()).toBe('The quick brown fox');
    expect(text(b).toString()).toBe('The quick brown fox');
  });

  it('[FR-5.2] typing is saved to the server automatically, with no explicit save', async () => {
    const a = connect(ALICE);
    await until(() => a.isReady);
    text(a).insert(0, 'Autosaved: ');
    await until(() => !a.hasUnsavedChanges);
    expect(await storedText()).toBe('Autosaved: The quick brown fox');
  });

  it('[FR-5.3] both people type in the same paragraph at the same moment: nothing is lost, and everyone ends up with the same text', async () => {
    const a = connect(ALICE);
    const b = connect(BOB);
    await until(() => a.isReady && b.isReady);
    text(a).insert(0, 'Alice: ');
    text(b).insert(text(b).length, ' [Bob was here]');
    const expected = 'Alice: The quick brown fox [Bob was here]';
    await until(() => text(a).toString() === expected && text(b).toString() === expected);
    await until(() => !a.hasUnsavedChanges && !b.hasUnsavedChanges);
    expect(await storedText()).toBe(expected);
  });

  it('[FR-5.3] a long burst of simultaneous typing from both people keeps every character from both', async () => {
    const a = connect(ALICE);
    const b = connect(BOB);
    await until(() => a.isReady && b.isReady);
    const typeAlot = async (sync: DocSync, i: number, ch: string) => {
      for (let n = 0; n < 40; n++) {
        text(sync, i).insert(text(sync, i).length, ch);
        await new Promise((r) => setTimeout(r, 5));
      }
    };
    await Promise.all([typeAlot(a, 0, 'A'), typeAlot(b, 0, 'B'), typeAlot(a, 1, 'a'), typeAlot(b, 1, 'b')]);
    await until(() => !a.hasUnsavedChanges && !b.hasUnsavedChanges);
    await new Promise((r) => setTimeout(r, 200)); // let the last polls deliver everything
    const first = await storedText(0);
    const second = await storedText(1);
    expect(first.split('A').length - 1).toBe(40);
    expect(first.split('B').length - 1).toBe(40);
    expect(second.split('a').length - 1).toBe(40 + 'Second paragraph'.split('a').length - 1);
    expect(second.split('b').length - 1).toBe(40);
    expect(text(a, 0).toString()).toBe(first);
    expect(text(b, 0).toString()).toBe(first);
  });

  it('[FR-3.6] when the owner removes a shared editor, that editor\'s next save is refused, the owner\'s document is unchanged, and their text stays on their screen', async () => {
    const a = connect(ALICE);
    const b = connect(BOB);
    await until(() => a.isReady && b.isReady);
    await app.inject({ method: 'DELETE', url: `/api/documents/${docId}/shares/${BOB}`, headers: { cookie: sessionCookie(ALICE) } });
    text(b).insert(0, 'after removal ');
    await until(() => b.currentStatus.kind === 'error');
    expect(b.currentStatus).toMatchObject({ kind: 'error', fatal: true });
    expect(text(b).toString()).toBe('after removal The quick brown fox');
    expect(await storedText()).toBe('The quick brown fox');
    a.stop();
  });

  it('[FR-5.5] a client that connects later sees everything the earlier clients saved', async () => {
    const a = connect(ALICE);
    await until(() => a.isReady);
    text(a).insert(0, 'Earlier work. ');
    await until(() => !a.hasUnsavedChanges);
    a.stop();
    const b = connect(BOB);
    await until(() => b.isReady);
    expect(text(b).toString()).toBe('Earlier work. The quick brown fox');
  });

  it('[SEC-1] a user who was never given access cannot load the document and sees the permission error', async () => {
    const c = new DocSync(transport(CAROL), FAST);
    clients.push(c);
    c.start();
    await until(() => c.currentStatus.kind === 'error');
    expect(c.currentStatus).toMatchObject({ kind: 'error', fatal: true });
    expect(c.isReady).toBe(false);
    expect(c.ydoc.getXmlFragment('default').length).toBe(0);
  });
});
