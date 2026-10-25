import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { IMPORT_MAX_BYTES } from '../import/file.js';
import { ALICE, BOB, freshDb, steppingClock, sessionCookie } from './helpers.js';

const as = (user: string) => ({ cookie: sessionCookie(user), 'content-type': 'application/octet-stream' });

describe('File Import: upload API', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildApp({ db: freshDb(), now: steppingClock() });
    await app.ready();
  });
  afterEach(() => app.close());

  const upload = (name: string | undefined, body: string | Buffer, user = ALICE) =>
    app.inject({
      method: 'POST',
      url: name === undefined ? '/api/documents/import' : `/api/documents/import?filename=${encodeURIComponent(name)}`,
      headers: as(user),
      payload: body,
    });
  const list = async (user = ALICE) =>
    (await app.inject({ method: 'GET', url: '/api/documents', headers: { cookie: sessionCookie(user) } })).json().documents;

  it('[FR-2.1] importing a .txt file creates a new document owned by the importer, with the file name as title', async () => {
    const res = await upload('Meeting notes.txt', 'Agenda\n\nItem one\nItem two');
    expect(res.statusCode).toBe(201);
    const { document } = res.json();
    expect(document).toMatchObject({ title: 'Meeting notes', ownerId: ALICE });
    expect(document.content.content.map((n: { content?: { text: string }[] }) => n.content?.[0]?.text ?? '')).toEqual(['Agenda', '', 'Item one', 'Item two']);
    expect((await list()).map((d: { title: string }) => d.title)).toEqual(['Meeting notes']);
  });

  it('[FR-2.2] importing a .md file keeps headings, emphasis and lists', async () => {
    const res = await upload('readme.md', '# Title\n\nSome **bold** text.\n\n- a\n- b\n\n1. x\n2. y');
    expect(res.statusCode).toBe(201);
    const types = res.json().document.content.content.map((n: { type: string }) => n.type);
    expect(types).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList']);
    expect(JSON.stringify(res.json().document.content)).toContain('"marks":[{"type":"bold"}]');
  });

  it('[FR-2.6] the imported document can be reopened and then edited and saved like any other', async () => {
    const id = (await upload('edit-me.md', '# Hello')).json().document.id;
    const opened = (await app.inject({ method: 'GET', url: `/api/documents/${id}`, headers: { cookie: sessionCookie(ALICE) } })).json().document;
    expect(opened.content.content[0].type).toBe('heading');
    const edited = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'edited' }] }] };
    const save = await app.inject({ method: 'PUT', url: `/api/documents/${id}/content`, headers: { cookie: sessionCookie(ALICE) }, payload: { content: edited } });
    expect(save.statusCode).toBe(200);
    expect(save.json().document.content).toEqual(edited);
  });

  it('[SEC-1] an imported document is private to its importer', async () => {
    const id = (await upload('mine.txt', 'secret')).json().document.id;
    const res = await app.inject({ method: 'GET', url: `/api/documents/${id}`, headers: { cookie: sessionCookie(BOB) } });
    expect(res.statusCode).toBe(403);
    expect(await list(BOB)).toEqual([]);
  });

  it('[SEC-3] importing without a valid user is refused and creates nothing', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/documents/import?filename=a.txt', headers: { 'content-type': 'application/octet-stream' }, payload: 'x' });
    expect(res.statusCode).toBe(401);
    expect(await list()).toEqual([]);
  });

  it('[NFR-VAL] markup in an imported file is stored as inert text', async () => {
    const res = await upload('xss.md', '# <img src=x onerror=alert(1)>\n\n<script>alert(1)</script>\n\n[click](javascript:alert(1))');
    expect(res.statusCode).toBe(201);
    const stored = JSON.stringify(res.json().document.content);
    expect(stored).not.toMatch(/"type":"(html|image|script|link)"|javascript:/);
    expect(stored).toContain('<script>alert(1)</script>');
  });
});

describe('File Import: upload API rejects bad files and creates nothing', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildApp({ db: freshDb(), now: steppingClock() });
    await app.ready();
  });
  afterEach(() => app.close());

  const post = (url: string, payload: string | Buffer | undefined, headers: Record<string, string> = as(ALICE)) =>
    app.inject({ method: 'POST', url, headers, payload });
  const count = async () =>
    (await app.inject({ method: 'GET', url: '/api/documents', headers: { cookie: sessionCookie(ALICE) } })).json().documents.length;

  it.each(['report.pdf', 'doc.docx', 'run.exe', 'noext', 'a.md.exe'])('[FR-2.4] %s is rejected with 415 and a clear message', async (name) => {
    const res = await post(`/api/documents/import?filename=${encodeURIComponent(name)}`, 'hello');
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({ error: 'UNSUPPORTED_FILE', message: 'Unsupported file type. Only .txt and .md files can be imported.' });
    expect(await count()).toBe(0);
  });

  it('[FR-2.5] an empty file is rejected with 400', async () => {
    const res = await post('/api/documents/import?filename=e.txt', Buffer.alloc(0));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_FILE');
    expect(await count()).toBe(0);
  });

  it('[FR-2.5] a request with no body at all is treated as an empty file', async () => {
    const res = await post('/api/documents/import?filename=e.txt', undefined);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_FILE');
  });

  it('[FR-2.5] binary content renamed to .txt is rejected with 400', async () => {
    const res = await post('/api/documents/import?filename=fake.txt', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]));
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('INVALID_FILE');
    expect(await count()).toBe(0);
  });

  it('[FR-2.5] an oversized upload is rejected with 413 and a clear message', async () => {
    const res = await post('/api/documents/import?filename=big.txt', Buffer.alloc(IMPORT_MAX_BYTES + 1024, 0x61));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: 'FILE_TOO_LARGE', message: 'File is too large. The limit is 512 KB.' });
    expect(await count()).toBe(0);
  });

  it('[NFR-VAL] a missing filename is rejected with 400', async () => {
    const res = await post('/api/documents/import', 'hello');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
  });

  it('[NFR-VAL] an unexpected content type is rejected with 415, not parsed', async () => {
    const res = await post('/api/documents/import?filename=a.txt', '{"x":1}', { cookie: sessionCookie(ALICE), 'content-type': 'application/json' });
    expect([400, 415]).toContain(res.statusCode);
    expect(await count()).toBe(0);
  });
});

describe('Persistence: imported documents survive an application restart', () => {
  it('[FR-2.6][FR-4.1] an imported document is still there, with its content, after reopening the database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ajaia-import-'));
    try {
      const path = join(dir, 'app.db');
      const db1 = freshDb(path);
      const app1 = buildApp({ db: db1 });
      const id = (await app1.inject({ method: 'POST', url: '/api/documents/import?filename=persist.md', headers: as(ALICE), payload: '# Kept\n\n- one' })).json().document.id;
      await app1.close();
      db1.close();

      const db2 = freshDb(path);
      const app2 = buildApp({ db: db2 });
      const doc = (await app2.inject({ method: 'GET', url: `/api/documents/${id}`, headers: { cookie: sessionCookie(ALICE) } })).json().document;
      expect(doc.title).toBe('persist');
      expect(doc.content.content.map((n: { type: string }) => n.type)).toEqual(['heading', 'bulletList']);
      await app2.close();
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
