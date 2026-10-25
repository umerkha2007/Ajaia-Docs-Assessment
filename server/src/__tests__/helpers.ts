import { signSession } from '../auth.js';
import { openDatabase, type Db } from '../db/connection.js';
import { migrate } from '../db/migrate.js';
import { seedUsers } from '../db/seed.js';

export const ALICE = 'user-alice';
export const BOB = 'user-bob';
export const CAROL = 'user-carol';

/** Fixed signing secret for tests, stored in the test database exactly where the app looks for it. */
export const TEST_SECRET = 'test-session-secret';

/** Fresh, migrated, seeded database. Defaults to in-memory so nothing touches data/app.db. */
export function freshDb(path = ':memory:'): Db {
  const db = openDatabase(path);
  migrate(db);
  seedUsers(db);
  db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('session_secret', ?)").run(TEST_SECRET);
  return db;
}

/** The Cookie header value of a signed-in session for `userId` (any id, including unknown ones). */
export const sessionCookie = (userId: string): string => `session=${signSession(TEST_SECRET, userId)}`;

/** Deterministic clock that advances one second per call. */
export function steppingClock(start = Date.UTC(2026, 0, 1, 0, 0, 0)) {
  let t = start;
  return () => {
    const d = new Date(t);
    t += 1000;
    return d;
  };
}

export const paragraphDoc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
