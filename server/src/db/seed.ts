import type { Db } from './connection.js';

export interface SeedUser {
  id: string;
  name: string;
  email: string;
}

/** Deterministic simulated accounts. Fixed ids so tests and docs can refer to them. */
export const SEED_USERS: readonly SeedUser[] = [
  { id: 'user-alice', name: 'Alice Anderson', email: 'alice@example.test' },
  { id: 'user-bob', name: 'Bob Brown', email: 'bob@example.test' },
  { id: 'user-carol', name: 'Carol Clark', email: 'carol@example.test' },
];

/** Idempotent: existing rows are left untouched. */
export function seedUsers(db: Db): void {
  const insert = db.prepare('INSERT OR IGNORE INTO users (id, name, email) VALUES (?, ?, ?)');
  for (const u of SEED_USERS) insert.run(u.id, u.name, u.email);
}
