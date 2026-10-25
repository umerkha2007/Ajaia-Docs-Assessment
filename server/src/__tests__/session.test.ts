import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signSession, verifySession } from '../auth.js';
import { buildApp } from '../app.js';
import { openDatabase } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { seedUsers } from '../db/seed.js';
import { ALICE, BOB, TEST_SECRET, freshDb, sessionCookie } from './helpers.js';

describe('Simulated Session: signed cookie values', () => {
  it('[FR-3.2] a signed value verifies back to the user id', () => {
    expect(verifySession('s3cret', signSession('s3cret', ALICE))).toBe(ALICE);
  });

  it('[SEC-4] a value signed with a different secret is rejected', () => {
    expect(verifySession('other-secret', signSession('s3cret', ALICE))).toBeNull();
  });

  it('[SEC-4] changing the user id in a signed value invalidates it (no impersonation by editing the cookie)', () => {
    const [payload, sig] = signSession('s3cret', ALICE).split('.');
    const forgedPayload = Buffer.from(BOB, 'utf8').toString('base64url');
    expect(payload).not.toBe(forgedPayload);
    expect(verifySession('s3cret', `${forgedPayload}.${sig}`)).toBeNull();
  });

  it('[SEC-4] a tampered signature is rejected', () => {
    const value = signSession('s3cret', ALICE);
    const flipped = value.slice(0, -1) + (value.endsWith('A') ? 'B' : 'A');
    expect(verifySession('s3cret', flipped)).toBeNull();
  });

  it.each(['', '.', 'abc', 'abc.', '.abc', 'a.b.c', '!!!.???', 'dXNlci1hbGljZQ', 'dXNlci1hbGljZQ.', 'x'.repeat(5000)])(
    '[SEC-4] malformed value %j is rejected without throwing',
    (value) => {
      expect(verifySession('s3cret', value)).toBeNull();
    },
  );

  it('[SEC-4] an unsigned bare user id is not accepted', () => {
    expect(verifySession('s3cret', ALICE)).toBeNull();
    expect(verifySession('s3cret', Buffer.from(ALICE).toString('base64url'))).toBeNull();
  });
});

describe('Simulated Session: API', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildApp({ db: freshDb() });
    await app.ready();
  });
  afterEach(() => app.close());

  it('[FR-3.2] with no session, GET /api/session reports no user and lists the seeded accounts for the switcher', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/session' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.user).toBeNull();
    expect(body.users.map((u: { id: string }) => u.id).sort()).toEqual([ALICE, BOB, 'user-carol']);
    expect(Object.keys(body.users[0]).sort()).toEqual(['email', 'id', 'name']);
  });

  it('[FR-3.2] choosing a user sets an HttpOnly, SameSite=Lax cookie that signs that user in', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/session', payload: { userId: BOB } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ id: BOB, name: 'Bob Brown' });
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toMatch(/^session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    const value = /^session=([^;]+)/.exec(setCookie)![1]!;
    expect(verifySession(TEST_SECRET, value)).toBe(BOB);

    const me = await app.inject({ method: 'GET', url: '/api/session', headers: { cookie: `session=${value}` } });
    expect(me.json().user).toMatchObject({ id: BOB });
  });

  it('[FR-3.2] switching users replaces the identity used for later requests', async () => {
    const asAlice = await app.inject({ method: 'POST', url: '/api/documents', headers: { cookie: sessionCookie(ALICE) }, payload: { title: 'A' } });
    const asBob = await app.inject({ method: 'GET', url: '/api/documents', headers: { cookie: sessionCookie(BOB) } });
    expect(asAlice.json().document.ownerId).toBe(ALICE);
    expect(asBob.json().documents).toEqual([]);
  });

  it('[SEC-4] choosing an unknown user is refused with 401 and no cookie is set', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/session', payload: { userId: 'user-ghost' } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it.each([{}, { userId: 5 }, { userId: '' }, { userId: null }])('[NFR-VAL] a missing or invalid userId %j is refused with 400', async (payload) => {
    const res = await app.inject({ method: 'POST', url: '/api/session', payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('VALIDATION_ERROR');
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('[FR-3.2] signing out clears the cookie, after which documents are inaccessible', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie: sessionCookie(ALICE) } });
    expect(res.statusCode).toBe(204);
    expect(String(res.headers['set-cookie'])).toMatch(/Max-Age=0/);
    const after = await app.inject({ method: 'GET', url: '/api/documents' });
    expect(after.statusCode).toBe(401);
  });

  it('[SEC-3] document routes without a session are refused with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/documents' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'UNAUTHENTICATED', message: 'No user selected' });
  });

  it('[SEC-4] the old x-user-id header no longer identifies anyone', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/documents', headers: { 'x-user-id': ALICE } });
    expect(res.statusCode).toBe(401);
  });

  it('[SEC-4] a forged cookie signed with another secret is refused with 401', async () => {
    const forged = `session=${signSession('attacker-secret', ALICE)}`;
    const res = await app.inject({ method: 'GET', url: '/api/documents', headers: { cookie: forged } });
    expect(res.statusCode).toBe(401);
  });

  it('[SEC-4] an unsigned cookie holding a bare user id is refused with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/documents', headers: { cookie: `session=${ALICE}` } });
    expect(res.statusCode).toBe(401);
  });

  it('[SEC-4] a correctly signed cookie for a user that does not exist is refused with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/documents', headers: { cookie: sessionCookie('user-ghost') } });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('UNAUTHENTICATED');
  });

  it('[FR-3.2] the session cookie is found among other cookies', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/documents',
      headers: { cookie: `theme=dark; ${sessionCookie(ALICE)}; other=1` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('[SEC-4] a cookie value with extra junk or repeated session cookies cannot smuggle a different user', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/documents',
      headers: { cookie: `session=garbage; ${sessionCookie(ALICE)}` },
    });
    // The first (invalid) session cookie is the one that counts: no fallback to a later one.
    expect(res.statusCode).toBe(401);
  });
});

describe('Simulated Session: signing secret persistence', () => {
  it('[FR-3.2][FR-4.1] a secret is created on first use and kept in the database, so a restarted app accepts earlier cookies', async () => {
    const db = openDatabase(':memory:');
    migrate(db);
    seedUsers(db);

    const app1 = buildApp({ db });
    const login = await app1.inject({ method: 'POST', url: '/api/session', payload: { userId: ALICE } });
    const cookie = /^(session=[^;]+)/.exec(String(login.headers['set-cookie']))![1]!;
    await app1.close();

    const app2 = buildApp({ db }); // same database = same secret
    const res = await app2.inject({ method: 'GET', url: '/api/documents', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    await app2.close();

    const stored = db.prepare("SELECT value FROM app_settings WHERE key = 'session_secret'").get()?.value as string;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it('[SEC-4] a cookie from one database is not accepted by another (different secret)', async () => {
    const mk = () => {
      const db = openDatabase(':memory:');
      migrate(db);
      seedUsers(db);
      return buildApp({ db });
    };
    const a = mk();
    const b = mk();
    const login = await a.inject({ method: 'POST', url: '/api/session', payload: { userId: ALICE } });
    const cookie = /^(session=[^;]+)/.exec(String(login.headers['set-cookie']))![1]!;
    expect((await b.inject({ method: 'GET', url: '/api/documents', headers: { cookie } })).statusCode).toBe(401);
    await a.close();
    await b.close();
  });
});
