import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { ALICE, freshDb, steppingClock, sessionCookie } from './helpers.js';

const as = { cookie: sessionCookie(ALICE) };
const text = (t: string, marks?: string[]) => ({
  type: 'text',
  text: t,
  ...(marks ? { marks: marks.map((type) => ({ type })) } : {}),
});

/** One document using every required formatting feature. */
const formatted = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1 }, content: [text('Title')] },
    { type: 'heading', attrs: { level: 2 }, content: [text('Section')] },
    { type: 'heading', attrs: { level: 3 }, content: [text('Sub')] },
    { type: 'paragraph', content: [text('plain '), text('bold', ['bold']), text(' '), text('italic', ['italic']), text(' '), text('under', ['underline']), text(' all', ['bold', 'italic', 'underline'])] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('bullet one')] }] }, { type: 'listItem', content: [{ type: 'paragraph', content: [text('bullet two')] }] }] },
    { type: 'orderedList', attrs: { start: 1, type: null }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('step one')] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [text('nested')] }] }] }] }] },
  ],
};

describe('Rich-Text Formatting: persistence over HTTP', () => {
  let app: FastifyInstance;
  let id: string;
  beforeEach(async () => {
    app = buildApp({ db: freshDb(), now: steppingClock() });
    id = (await app.inject({ method: 'POST', url: '/api/documents', headers: as, payload: {} })).json().document.id;
  });
  afterEach(() => app.close());

  const save = (content: unknown) =>
    app.inject({ method: 'PUT', url: `/api/documents/${id}/content`, headers: as, payload: { content } });
  const open = async () =>
    (await app.inject({ method: 'GET', url: `/api/documents/${id}`, headers: as })).json().document.content;

  it('[FR-1.7][FR-1.8][FR-1.9] a document with every formatting feature is stored and returned identically', async () => {
    expect((await save(formatted)).statusCode).toBe(200);
    expect(await open()).toEqual(formatted);
  });

  it('[NFR-VAL] content with a disallowed node is rejected with 400 and the saved formatting is untouched', async () => {
    await save(formatted);
    const evil = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] };
    const res = await save(evil);
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(await open()).toEqual(formatted);
  });

  it('[NFR-VAL] markup typed as text is stored as inert text, not interpreted', async () => {
    const payload = '<img src=x onerror=alert(1)><script>alert(1)</script>';
    const doc = { type: 'doc', content: [{ type: 'paragraph', content: [text(payload)] }] };
    expect((await save(doc)).statusCode).toBe(200);
    expect(await open()).toEqual(doc);
  });

  it('[NFR-ERR] a hostile, extremely deeply nested body is refused without a 500', async () => {
    const depth = 200_000;
    const body = `{"content":${'['.repeat(depth)}${']'.repeat(depth)}}`;
    const res = await app.inject({
      method: 'PUT', url: `/api/documents/${id}/content`,
      headers: { ...as, 'content-type': 'application/json' }, payload: body,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(await open()).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
  });
});

describe('Rich-Text Formatting: persistence across restart', () => {
  it('[FR-4.1][FR-1.7] formatted content survives closing and reopening the database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ajaia-fmt-'));
    try {
      const path = join(dir, 'app.db');
      const db1 = freshDb(path);
      const app1 = buildApp({ db: db1 });
      const id = (await app1.inject({ method: 'POST', url: '/api/documents', headers: as, payload: {} })).json().document.id;
      await app1.inject({ method: 'PUT', url: `/api/documents/${id}/content`, headers: as, payload: { content: formatted } });
      await app1.close();
      db1.close();

      const db2 = freshDb(path);
      const app2 = buildApp({ db: db2 });
      const reopened = (await app2.inject({ method: 'GET', url: `/api/documents/${id}`, headers: as })).json().document;
      expect(reopened.content).toEqual(formatted);
      await app2.close();
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
