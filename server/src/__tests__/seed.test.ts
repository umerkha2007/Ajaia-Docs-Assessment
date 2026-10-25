import { describe, expect, it } from 'vitest';
import { migrate } from '../db/migrate.js';
import { openDatabase } from '../db/connection.js';
import { SEED_USERS, seedUsers } from '../db/seed.js';

describe('Seeded users', () => {
  it('[FR-3.0] seeds the deterministic accounts', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    seedUsers(db);
    const ids = db.prepare('SELECT id FROM users ORDER BY id').all().map((r) => r.id);
    expect(ids).toEqual(SEED_USERS.map((u) => u.id).sort());
    expect(ids).toContain('user-alice');
    expect(ids).toContain('user-bob');
  });

  it('[FR-3.0] seeding twice neither duplicates nor overwrites users', () => {
    const db = openDatabase(':memory:');
    migrate(db);
    seedUsers(db);
    db.prepare("UPDATE users SET name = 'Renamed' WHERE id = 'user-alice'").run();
    seedUsers(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n).toBe(SEED_USERS.length);
    expect(db.prepare("SELECT name FROM users WHERE id = 'user-alice'").get()?.name).toBe('Renamed');
  });
});
