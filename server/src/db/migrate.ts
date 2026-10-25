import type { Db } from './connection.js';
import { migrations } from './migrations.js';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** Apply any migrations not yet recorded. Each runs in its own transaction. */
export function migrate(db: Db, list: Migration[] = migrations): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  )`);
  const versions = list.map((m) => m.version);
  if (new Set(versions).size !== versions.length) {
    throw new Error('Duplicate migration version');
  }
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map((r) => Number(r.version)),
  );
  const ran: number[] = [];
  for (const m of [...list].sort((a, b) => a.version - b.version)) {
    if (applied.has(m.version)) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(m.version, m.name);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${m.version} (${m.name}) failed: ${(err as Error).message}`, {
        cause: err,
      });
    }
    ran.push(m.version);
  }
  return ran;
}
