import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { ALICE, BOB, CAROL, freshDb, paragraphDoc, sessionCookie, steppingClock } from './helpers.js';

const as = (user: string) => ({ cookie: sessionCookie(user) });

describe('Ownership and Sharing: API across seeded users', () => {
  let app: FastifyInstance;
  let id: string;
  beforeEach(async () => {
    app = buildApp({ db: freshDb(), now: steppingClock() });
    await app.ready();
    id = (await app.inject({ method: 'POST', url: '/api/documents', headers: as(ALICE), payload: { title: 'Team notes' } })).json().document.id;
    await app.inject({ method: 'PUT', url: `/api/documents/${id}/content`, headers: as(ALICE), payload: { content: paragraphDoc('hello') } });
  });
  afterEach(() => app.close());

  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, user: string | null, payload?: unknown) =>
    app.inject({ method, url, headers: user ? as(user) : {}, payload: payload as object });
  const share = (user: string, userId: unknown, extra: object = {}) =>
    call('POST', `/api/documents/${id}/shares`, user, { userId, ...extra });

  it('[FR-3.3] the owner shares with Bob and gets back the people who now have access', async () => {
    const res = await share(ALICE, BOB);
    expect(res.statusCode).toBe(200);
    expect(res.json().shares).toEqual([expect.objectContaining({ userId: BOB, name: 'Bob Brown', role: 'editor' })]);
    const list = await call('GET', `/api/documents/${id}/shares`, ALICE);
    expect(list.json().shares.map((s: { userId: string }) => s.userId)).toEqual([BOB]);
  });

  it('[FR-3.4] Bob can then open and edit the document, and Alice sees his edit', async () => {
    await share(ALICE, BOB);
    const open = await call('GET', `/api/documents/${id}`, BOB);
    expect(open.statusCode).toBe(200);
    expect(open.json().document).toMatchObject({ ownerId: ALICE, ownerName: 'Alice Anderson', access: 'editor', title: 'Team notes' });
    const save = await call('PUT', `/api/documents/${id}/content`, BOB, { content: paragraphDoc('edited by bob') });
    expect(save.statusCode).toBe(200);
    expect(save.json().document.ownerId).toBe(ALICE);
    expect((await call('GET', `/api/documents/${id}`, ALICE)).json().document.content).toEqual(paragraphDoc('edited by bob'));
  });

  it('[FR-3.5] the list endpoint separates owned documents from documents shared with the user', async () => {
    await share(ALICE, BOB);
    const bobOwn = (await call('POST', '/api/documents', BOB, { title: 'Bob own' })).json().document;
    const bob = (await call('GET', '/api/documents', BOB)).json();
    expect(bob.documents.map((d: { id: string }) => d.id)).toEqual([bobOwn.id]);
    expect(bob.shared).toEqual([expect.objectContaining({ id, title: 'Team notes', ownerId: ALICE, ownerName: 'Alice Anderson', role: 'editor' })]);
    const alice = (await call('GET', '/api/documents', ALICE)).json();
    expect(alice.documents).toEqual([expect.objectContaining({ id, shareCount: 1 })]);
    expect(alice.shared).toEqual([]);
  });

  it('[SEC-1] Carol, who has no share, is refused on every document route', async () => {
    await share(ALICE, BOB);
    const attempts: [string, string, unknown?][] = [
      ['GET', `/api/documents/${id}`],
      ['PATCH', `/api/documents/${id}`, { title: 'x' }],
      ['PUT', `/api/documents/${id}/content`, { content: paragraphDoc('x') }],
      ['DELETE', `/api/documents/${id}`],
      ['GET', `/api/documents/${id}/shares`],
      ['POST', `/api/documents/${id}/shares`, { userId: CAROL }],
      ['DELETE', `/api/documents/${id}/shares/${BOB}`],
    ];
    for (const [method, url, payload] of attempts) {
      const res = await call(method as 'GET', url, CAROL, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error).toBe('FORBIDDEN');
    }
    expect((await call('GET', '/api/documents', CAROL)).json()).toEqual({ documents: [], shared: [] });
    expect((await call('GET', `/api/documents/${id}`, ALICE)).json().document.title).toBe('Team notes');
  });

  it('[SEC-1] Bob, an editor, can read and write but is refused on delete and on every sharing route', async () => {
    await share(ALICE, BOB);
    for (const [method, url, payload] of [
      ['DELETE', `/api/documents/${id}`],
      ['GET', `/api/documents/${id}/shares`],
      ['POST', `/api/documents/${id}/shares`, { userId: CAROL }],
      ['DELETE', `/api/documents/${id}/shares/${BOB}`],
    ] as [string, string, unknown?][]) {
      const res = await call(method as 'GET', url, BOB, payload);
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect((await call('GET', `/api/documents/${id}`, ALICE)).statusCode).toBe(200);
    expect((await call('GET', `/api/documents/${id}/shares`, ALICE)).json().shares).toHaveLength(1);
  });

  it('[FR-3.6] after Alice revokes, Bob is refused immediately and the document leaves his shared list', async () => {
    await share(ALICE, BOB);
    expect((await call('GET', `/api/documents/${id}`, BOB)).statusCode).toBe(200);
    const revoke = await call('DELETE', `/api/documents/${id}/shares/${BOB}`, ALICE);
    expect(revoke.statusCode).toBe(200);
    expect(revoke.json().shares).toEqual([]);
    expect((await call('GET', `/api/documents/${id}`, BOB)).statusCode).toBe(403);
    expect((await call('PUT', `/api/documents/${id}/content`, BOB, { content: paragraphDoc('late') })).statusCode).toBe(403);
    expect((await call('GET', '/api/documents', BOB)).json().shared).toEqual([]);
  });

  it('[FR-3.6] revoking someone who does not have access returns 404', async () => {
    const res = await call('DELETE', `/api/documents/${id}/shares/${BOB}`, ALICE);
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('NOT_FOUND');
  });

  it('[SEC-2] a role or owner sent by the client is ignored: the grant is always an editor grant and ownership never moves', async () => {
    const res = await share(ALICE, BOB, { role: 'owner', ownerId: BOB, owner_id: BOB });
    expect(res.json().shares[0].role).toBe('editor');
    expect((await call('GET', `/api/documents/${id}`, ALICE)).json().document).toMatchObject({ ownerId: ALICE, access: 'owner' });
    expect((await call('DELETE', `/api/documents/${id}`, BOB)).statusCode).toBe(403);
  });

  it('[NFR-VAL] sharing with yourself, an unknown user, or a malformed body is refused with 400', async () => {
    for (const body of [{ userId: ALICE }, { userId: 'user-ghost' }, {}, { userId: 5 }, { userId: '' }]) {
      const res = await call('POST', `/api/documents/${id}/shares`, ALICE, body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
    }
    expect((await call('GET', `/api/documents/${id}/shares`, ALICE)).json().shares).toEqual([]);
  });

  it('[NFR-ERR] sharing routes on a missing document return 404 and on a malformed id return 400', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await call('GET', `/api/documents/${missing}/shares`, ALICE)).statusCode).toBe(404);
    expect((await call('POST', `/api/documents/${missing}/shares`, ALICE, { userId: BOB })).statusCode).toBe(404);
    expect((await call('GET', '/api/documents/not-a-uuid/shares', ALICE)).statusCode).toBe(400);
  });

  it('[SEC-3] sharing routes without a session return 401 and change nothing', async () => {
    expect((await call('GET', `/api/documents/${id}/shares`, null)).statusCode).toBe(401);
    expect((await call('POST', `/api/documents/${id}/shares`, null, { userId: BOB })).statusCode).toBe(401);
    expect((await call('DELETE', `/api/documents/${id}/shares/${BOB}`, null)).statusCode).toBe(401);
    expect((await call('GET', `/api/documents/${id}/shares`, ALICE)).json().shares).toEqual([]);
  });

  it('[FR-3.7] deleting a shared document removes it from the recipient\'s list and the share is gone for good', async () => {
    await share(ALICE, BOB);
    expect((await call('DELETE', `/api/documents/${id}`, ALICE)).statusCode).toBe(204);
    expect((await call('GET', '/api/documents', BOB)).json().shared).toEqual([]);
    expect((await call('GET', `/api/documents/${id}`, BOB)).statusCode).toBe(404);
  });

  it('[FR-3.4] an imported document can be shared like any other', async () => {
    const imported = (await app.inject({
      method: 'POST', url: '/api/documents/import?filename=notes.md',
      headers: { ...as(ALICE), 'content-type': 'application/octet-stream' }, payload: '# Hi',
    })).json().document;
    await call('POST', `/api/documents/${imported.id}/shares`, ALICE, { userId: BOB });
    expect((await call('GET', `/api/documents/${imported.id}`, BOB)).json().document.content.content[0].type).toBe('heading');
  });
});

describe('Persistence: sharing survives an application restart', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ajaia-share-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('[FR-3.7][FR-4.1] grants and revocations are still in force after closing and reopening the database', async () => {
    const path = join(dir, 'app.db');
    const db1 = freshDb(path);
    const app1 = buildApp({ db: db1 });
    const keep = (await app1.inject({ method: 'POST', url: '/api/documents', headers: as(ALICE), payload: { title: 'Kept' } })).json().document.id;
    const gone = (await app1.inject({ method: 'POST', url: '/api/documents', headers: as(ALICE), payload: { title: 'Revoked' } })).json().document.id;
    for (const doc of [keep, gone]) {
      await app1.inject({ method: 'POST', url: `/api/documents/${doc}/shares`, headers: as(ALICE), payload: { userId: BOB } });
    }
    await app1.inject({ method: 'DELETE', url: `/api/documents/${gone}/shares/${BOB}`, headers: as(ALICE) });
    await app1.close();
    db1.close();

    const db2 = freshDb(path);
    const app2 = buildApp({ db: db2 });
    const bob = (await app2.inject({ method: 'GET', url: '/api/documents', headers: as(BOB) })).json();
    expect(bob.shared.map((d: { id: string }) => d.id)).toEqual([keep]);
    expect((await app2.inject({ method: 'GET', url: `/api/documents/${keep}`, headers: as(BOB) })).statusCode).toBe(200);
    expect((await app2.inject({ method: 'GET', url: `/api/documents/${gone}`, headers: as(BOB) })).statusCode).toBe(403);
    expect((await app2.inject({ method: 'GET', url: `/api/documents/${keep}`, headers: as(CAROL) })).statusCode).toBe(403);
    await app2.close();
    db2.close();
  });
});
