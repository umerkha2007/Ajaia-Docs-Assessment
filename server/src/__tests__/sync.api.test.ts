import type { FastifyInstance } from 'fastify';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import { fromB64, toB64 } from './collabClient.js';
import { ALICE, BOB, CAROL, freshDb, paragraphDoc, sessionCookie, steppingClock } from './helpers.js';

const as = (user: string) => ({ cookie: sessionCookie(user) });

describe('Collaboration: sync API', () => {
  let app: FastifyInstance;
  let id: string;
  beforeEach(async () => {
    app = buildApp({ db: freshDb(), now: steppingClock() });
    await app.ready();
    id = (await app.inject({ method: 'POST', url: '/api/documents', headers: as(ALICE), payload: { title: 'Synced' } })).json().document.id;
    await app.inject({ method: 'PUT', url: `/api/documents/${id}/content`, headers: as(ALICE), payload: { content: paragraphDoc('hello') } });
    await app.inject({ method: 'POST', url: `/api/documents/${id}/shares`, headers: as(ALICE), payload: { userId: BOB } });
  });
  afterEach(() => app.close());

  const sync = (user: string | null, payload: unknown, docId = id) =>
    app.inject({ method: 'POST', url: `/api/documents/${docId}/sync`, headers: user ? as(user) : {}, payload: payload as object });

  it('[FR-5.1] returns the missing state, the server state vector, the title and the update time as text', async () => {
    const res = await sync(ALICE, {});
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['stateVector', 'title', 'update', 'updatedAt']);
    expect(body.title).toBe('Synced');
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromB64(body.update));
    expect(doc.getXmlFragment('default').toString()).toContain('hello');
  });

  it('[FR-5.2] a posted update is stored: the normal document endpoint shows it, for the owner and the shared user', async () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromB64((await sync(ALICE, {})).json().update));
    const text = (doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText;
    text.insert(0, 'Typed: ');
    const res = await sync(ALICE, { stateVector: toB64(Y.encodeStateVector(doc)), update: toB64(Y.encodeStateAsUpdate(doc)) });
    expect(res.statusCode).toBe(200);
    for (const user of [ALICE, BOB]) {
      const opened = await app.inject({ method: 'GET', url: `/api/documents/${id}`, headers: as(user) });
      expect(opened.json().document.content).toEqual(paragraphDoc('Typed: hello'));
    }
  });

  it('[FR-5.3] two users posting changes to the same paragraph from the same starting point both keep their text', async () => {
    const start = (await sync(ALICE, {})).json();
    const make = () => {
      const d = new Y.Doc();
      Y.applyUpdate(d, fromB64(start.update));
      return d;
    };
    const [a, b] = [make(), make()] as [Y.Doc, Y.Doc];
    const t = (d: Y.Doc) => (d.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText;
    t(a).insert(0, 'Alice ');
    t(b).insert(t(b).length, ' Bob');
    const post = (user: string, d: Y.Doc) => sync(user, { stateVector: toB64(Y.encodeStateVector(d)), update: toB64(Y.encodeStateAsUpdate(d)) });
    expect((await post(ALICE, a)).statusCode).toBe(200);
    expect((await post(BOB, b)).statusCode).toBe(200);
    const opened = await app.inject({ method: 'GET', url: `/api/documents/${id}`, headers: as(ALICE) });
    expect(opened.json().document.content).toEqual(paragraphDoc('Alice hello Bob'));
  });

  it('[SEC-3] sync without a session is refused with 401', async () => {
    expect((await sync(null, {})).statusCode).toBe(401);
  });

  it('[SEC-1] a user with no access is refused with 403 whether reading or writing, and an editor who is removed is refused next time', async () => {
    expect((await sync(CAROL, {})).statusCode).toBe(403);
    expect((await sync(CAROL, { update: toB64(Y.encodeStateAsUpdate(new Y.Doc())) })).statusCode).toBe(403);
    expect((await sync(BOB, {})).statusCode).toBe(200);
    await app.inject({ method: 'DELETE', url: `/api/documents/${id}/shares/${BOB}`, headers: as(ALICE) });
    const after = await sync(BOB, {});
    expect(after.statusCode).toBe(403);
    expect(after.json().error).toBe('FORBIDDEN');
  });

  it('[NFR-VAL] malformed input is refused with 400 and a structured error', async () => {
    for (const payload of [{ update: 5 }, { update: '***' }, { stateVector: {} }, { update: toB64(new Uint8Array([1, 2, 3, 4, 5, 6, 7])) }]) {
      const res = await sync(ALICE, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json().error).toBe('VALIDATION_ERROR');
    }
    const notObject = await app.inject({ method: 'POST', url: `/api/documents/${id}/sync`, headers: { ...as(ALICE), 'content-type': 'application/json' }, payload: '[1]' });
    expect(notObject.statusCode).toBe(400);
  });

  it('[NFR-VAL] an update that adds a disallowed element is refused with 400 and the document is unchanged', async () => {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, fromB64((await sync(ALICE, {})).json().update));
    doc.getXmlFragment('default').insert(0, [new Y.XmlElement('codeBlock')]);
    const res = await sync(ALICE, { stateVector: toB64(Y.encodeStateVector(doc)), update: toB64(Y.encodeStateAsUpdate(doc)) });
    expect(res.statusCode).toBe(400);
    const opened = await app.inject({ method: 'GET', url: `/api/documents/${id}`, headers: as(ALICE) });
    expect(opened.json().document.content).toEqual(paragraphDoc('hello'));
  });

  it('[NFR-ERR] a missing document is 404 and a malformed id is 400', async () => {
    expect((await sync(ALICE, {}, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await sync(ALICE, {}, 'not-a-uuid')).statusCode).toBe(400);
  });

  it('[FR-3.7] deleting the document removes its shared state; later syncs are 404', async () => {
    await sync(ALICE, {});
    await app.inject({ method: 'DELETE', url: `/api/documents/${id}`, headers: as(ALICE) });
    expect((await sync(ALICE, {})).statusCode).toBe(404);
  });
});
