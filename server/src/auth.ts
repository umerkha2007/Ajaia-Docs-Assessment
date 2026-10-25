import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from './db/connection.js';
import { AppError } from './errors.js';

/**
 * SIMULATED authentication.
 *
 * The "signed-in" user is one of the seeded accounts, remembered in an HttpOnly
 * cookie whose value is `base64url(userId).HMAC-SHA256(secret, base64url(userId))`.
 * The server verifies the signature on every request, so a browser cannot name
 * itself a different user by editing the cookie. There are no passwords: anyone
 * who can reach the app can choose any seeded user. That is the point of the
 * simulation, and it is NOT production authentication. Not implemented: passwords,
 * expiry, rotation, CSRF tokens (SameSite=Lax is the only cross-site protection),
 * the Secure flag (the app runs over plain http on localhost).
 */

export const SESSION_COOKIE = 'session';

const sign = (secret: string, payload: string): string => createHmac('sha256', secret).update(payload).digest('base64url');

/** The cookie value for `userId`. */
export function signSession(secret: string, userId: string): string {
  const payload = Buffer.from(userId, 'utf8').toString('base64url');
  return `${payload}.${sign(secret, payload)}`;
}

/** The user id inside a cookie value, or null if the value is malformed or not signed with `secret`. */
export function verifySession(secret: string, value: string): string | null {
  const parts = value.split('.');
  if (parts.length !== 2) return null;
  const [payload, signature] = parts as [string, string];
  if (!payload || !signature) return null;
  const given = Buffer.from(signature);
  const expected = Buffer.from(sign(secret, payload));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return Buffer.from(payload, 'base64url').toString('utf8') || null;
}

/** The value of the first cookie called `name`. Only the first counts, so later duplicates cannot override it. */
function cookieValue(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export function createAuth(db: Db) {
  let secret: string | undefined;
  /** Created on first use and stored in the database so sessions survive restarts. */
  const getSecret = (): string => {
    if (secret) return secret;
    db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('session_secret', ?)").run(randomBytes(32).toString('hex'));
    secret = (db.prepare("SELECT value FROM app_settings WHERE key = 'session_secret'").get() as { value: string }).value;
    return secret;
  };

  const findUser = (id: string): SessionUser | undefined =>
    db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(id) as SessionUser | undefined;

  return {
    listUsers: (): SessionUser[] => db.prepare('SELECT id, name, email FROM users ORDER BY name').all() as unknown as SessionUser[],
    findUser,

    /** The signed-in user for this request, or null. Never throws. */
    currentUser(req: FastifyRequest): SessionUser | null {
      const raw = cookieValue(req.headers.cookie, SESSION_COOKIE);
      if (!raw) return null;
      const id = verifySession(getSecret(), raw);
      return (id && findUser(id)) || null;
    },

    /** The signed-in user's id, or a 401. This is the only way routes learn who is acting. */
    requireActor(req: FastifyRequest): string {
      const user = this.currentUser(req);
      if (user) return user.id;
      throw new AppError('UNAUTHENTICATED', cookieValue(req.headers.cookie, SESSION_COOKIE) ? 'Invalid session' : 'No user selected');
    },

    signIn(reply: FastifyReply, userId: string): void {
      reply.header('set-cookie', `${SESSION_COOKIE}=${signSession(getSecret(), userId)}; Path=/; HttpOnly; SameSite=Lax`);
    },

    signOut(reply: FastifyReply): void {
      reply.header('set-cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    },
  };
}

export type Auth = ReturnType<typeof createAuth>;
