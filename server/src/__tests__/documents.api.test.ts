import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { ALICE, BOB, freshDb, paragraphDoc, steppingClock, sessionCookie } from './helpers.js';

const as = (user: string) => ({ cookie: sessionCookie(user) });

describe('Document API: CRUD over HTTP', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildApp({ db: freshDb(), now: steppingClock() });
    await app.ready();
  });
  afterEach(() => app.close());

  const create = async (user: string, payload?: unknown) =>
    app.inject({ method: 'POST', url: '/api/documents', headers: as(user), payload: payload as object });

  it('[FR-1.1] POST creates a document and returns 201 with the owner set from the session', async () => {
    const res = await create(ALICE, { title: 'Roadmap' });
    expect(res.statusCode).toBe(201);
    const { document } = res.json();
    expect(document).toMatchObject({ title: 'Roadmap', ownerId: ALICE });
  });

  it('[FR-1.1] POST without a body still creates an untitled document', async () => {
    const res = await create(ALICE);
    expect(res.statusCode).toBe(201);
    expect(res.json().document.title).toBe('Untitled document');
  });

  it('[SEC-2] a client-supplied ownerId is ignored; the acting user owns the document', async () => {
    const res = await create(ALICE, { title: 'Mine', ownerId: BOB, owner_id: BOB });
    expect(res.json().document.ownerId).toBe(ALICE);
    const bobList = await app.inject({ method: 'GET', url: '/api/documents', headers: as(BOB) });
    expect(bobList.json().documents).toEqual([]);
  });

  it('[FR-1.2][FR-1.3][FR-1.4] rename, save and reopen return the saved title and content', async () => {
    const { document } = (await create(ALICE, { title: 'Draft' })).json();
    const body = paragraphDoc('Persisted text');
    const rename = await app.inject({
      method: 'PATCH', url: `/api/documents/${document.id}`, headers: as(ALICE), payload: { title: 'Final' },
    });
    expect(rename.statusCode).toBe(200);
    const save = await app.inject({
      method: 'PUT', url: `/api/documents/${document.id}/content`, headers: as(ALICE), payload: { content: body },
    });
    expect(save.statusCode).toBe(200);
    const reopened = await app.inject({ method: 'GET', url: `/api/documents/${document.id}`, headers: as(ALICE) });
    expect(reopened.json().document).toMatchObject({ title: 'Final', content: body, ownerId: ALICE });
  });

  it('[FR-1.5] DELETE returns 204 and the document is then 404', async () => {
    const { document } = (await create(ALICE, { title: 'Gone' })).json();
    const del = await app.inject({ method: 'DELETE', url: `/api/documents/${document.id}`, headers: as(ALICE) });
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe('');
    const get = await app.inject({ method: 'GET', url: `/api/documents/${document.id}`, headers: as(ALICE) });
    expect(get.statusCode).toBe(404);
    expect(get.json().error).toBe('NOT_FOUND');
  });

  it('[FR-1.6] GET /api/documents lists newest-updated first', async () => {
    await create(ALICE, { title: 'First' });
    await create(ALICE, { title: 'Second' });
    const res = await app.inject({ method: 'GET', url: '/api/documents', headers: as(ALICE) });
    expect(res.json().documents.map((d: { title: string }) => d.title)).toEqual(['Second', 'First']);
  });
});

describe('Validation and Error Handling: Document API', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildApp({ db: freshDb(), now: steppingClock() });
    await app.ready();
  });
  afterEach(() => app.close());

  it('[SEC-3] requests without a user are rejected with 401 and no data', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/documents' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'UNAUTHENTICATED', message: 'No user selected' });
  });

  it('[SEC-3] an unknown user id is rejected with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/documents', headers: as('user-ghost') });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('UNAUTHENTICATED');
  });

  it('[SEC-1] another user gets 403 for read, rename, save and delete', async () => {
    const { document } = (
      await app.inject({ method: 'POST', url: '/api/documents', headers: as(ALICE), payload: { title: 'Private' } })
    ).json();
    const attempts = [
      { method: 'GET', url: `/api/documents/${document.id}` },
      { method: 'PATCH', url: `/api/documents/${document.id}`, payload: { title: 'x' } },
      { method: 'PUT', url: `/api/documents/${document.id}/content`, payload: { content: paragraphDoc('x') } },
      { method: 'DELETE', url: `/api/documents/${document.id}` },
    ] as const;
    for (const a of attempts) {
      const res = await app.inject({ ...a, headers: as(BOB) });
      expect(res.statusCode, `${a.method} ${a.url}`).toBe(403);
      expect(res.json().error).toBe('FORBIDDEN');
    }
    const still = await app.inject({ method: 'GET', url: `/api/documents/${document.id}`, headers: as(ALICE) });
    expect(still.json().document.title).toBe('Private');
  });

  it('[NFR-VAL] an invalid title returns 400 VALIDATION_ERROR', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/documents', headers: as(ALICE), payload: { title: '  ' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'VALIDATION_ERROR', message: 'Title must not be empty' });
  });

  it('[NFR-VAL] a malformed id returns 400 and an unknown id returns 404', async () => {
    const bad = await app.inject({ method: 'GET', url: '/api/documents/not-a-uuid', headers: as(ALICE) });
    expect(bad.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'GET', url: '/api/documents/00000000-0000-4000-8000-000000000000', headers: as(ALICE),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('[NFR-VAL] invalid content returns 400 and does not overwrite saved content', async () => {
    const { document } = (
      await app.inject({ method: 'POST', url: '/api/documents', headers: as(ALICE), payload: {} })
    ).json();
    await app.inject({
      method: 'PUT', url: `/api/documents/${document.id}/content`, headers: as(ALICE),
      payload: { content: paragraphDoc('safe') },
    });
    const bad = await app.inject({
      method: 'PUT', url: `/api/documents/${document.id}/content`, headers: as(ALICE), payload: { content: 'oops' },
    });
    expect(bad.statusCode).toBe(400);
    const after = await app.inject({ method: 'GET', url: `/api/documents/${document.id}`, headers: as(ALICE) });
    expect(after.json().document.content).toEqual(paragraphDoc('safe'));
  });

  it('[NFR-ERR] malformed JSON returns a structured 400 instead of a crash', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/documents', headers: { ...as(ALICE), 'content-type': 'application/json' },
      payload: '{"title": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('BAD_REQUEST');
  });

  it('[NFR-ERR] a non-object JSON body returns 400', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/documents', headers: { ...as(ALICE), 'content-type': 'application/json' },
      payload: '[1,2]',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('[NFR-ERR] an unexpected failure returns a generic 500 without leaking internals', async () => {
    const db = freshDb();
    const broken = buildApp({ db });
    db.exec('DROP TABLE documents');
    const res = await broken.inject({ method: 'GET', url: '/api/documents', headers: as(ALICE) });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'INTERNAL_ERROR', message: 'Unexpected server error' });
    await broken.close();
  });
});

describe('Persistence: documents survive an application restart', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ajaia-persist-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('[FR-4.1] title, content, owner and ordering are intact after closing and reopening the database', async () => {
    const path = join(dir, 'app.db');
    const body = paragraphDoc('Still here after restart');

    const db1 = freshDb(path);
    const app1 = buildApp({ db: db1, now: steppingClock() });
    const a = (await app1.inject({ method: 'POST', url: '/api/documents', headers: as(ALICE), payload: { title: 'Older' } })).json().document;
    const b = (await app1.inject({ method: 'POST', url: '/api/documents', headers: as(ALICE), payload: { title: 'Newer' } })).json().document;
    await app1.inject({ method: 'PUT', url: `/api/documents/${a.id}/content`, headers: as(ALICE), payload: { content: body } });
    await app1.close();
    db1.close();

    // "Restart": a brand-new connection and app over the same file. Migrate/seed must not disturb data.
    const db2 = freshDb(path);
    const app2 = buildApp({ db: db2 });
    const list = (await app2.inject({ method: 'GET', url: '/api/documents', headers: as(ALICE) })).json().documents;
    expect(list.map((d: { id: string }) => d.id)).toEqual([a.id, b.id]);
    const reopened = (await app2.inject({ method: 'GET', url: `/api/documents/${a.id}`, headers: as(ALICE) })).json().document;
    expect(reopened).toMatchObject({ title: 'Older', ownerId: ALICE, content: body });
    await app2.close();
    db2.close();
  });
});
