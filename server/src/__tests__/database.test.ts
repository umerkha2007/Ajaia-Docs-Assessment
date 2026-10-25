import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../db/connection.js';
import { migrate, type Migration } from '../db/migrate.js';

describe('Persistence: SQLite driver (node:sqlite)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ajaia-db-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('[P1-SQLITE-1] opens an in-memory database and round-trips a row', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL)');
    db.prepare('INSERT INTO t (v) VALUES (?)').run('hello');
    const rows = db.prepare('SELECT id, v FROM t').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.v).toBe('hello');
    db.close();
  });

  it('[P1-SQLITE-2] data written to a file database survives close and reopen', () => {
    const path = join(dir, 'persist.db');
    const first = openDatabase(path);
    first.exec('CREATE TABLE t (v TEXT)');
    first.prepare('INSERT INTO t (v) VALUES (?)').run('kept');
    first.close();

    const second = openDatabase(path);
    const row = second.prepare('SELECT v FROM t').get();
    expect(row?.v).toBe('kept');
    second.close();
  });

  it('[P1-SQLITE-3] enforces foreign keys', () => {
    const db = openDatabase(':memory:');
    db.exec('CREATE TABLE p (id INTEGER PRIMARY KEY)');
    db.exec('CREATE TABLE c (pid INTEGER NOT NULL REFERENCES p(id))');
    expect(() => db.prepare('INSERT INTO c (pid) VALUES (?)').run(999)).toThrow(/FOREIGN KEY/i);
    db.close();
  });

  it('[P1-SQLITE-4] creates the parent directory for a file database path', () => {
    const db = openDatabase(join(dir, 'nested', 'deeper', 'x.db'));
    expect(db.prepare('SELECT 1 AS one').get()?.one).toBe(1);
    db.close();
  });
});

describe('Persistence: migration runner', () => {
  const m1: Migration = { version: 1, name: 'create_a', sql: 'CREATE TABLE a (id INTEGER PRIMARY KEY)' };
  const m2: Migration = { version: 2, name: 'create_b', sql: 'CREATE TABLE b (id INTEGER PRIMARY KEY)' };

  it('[P1-MIG-1] applies pending migrations in version order and records them', () => {
    const db = openDatabase(':memory:');
    expect(migrate(db, [m2, m1])).toEqual([1, 2]);
    const recorded = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
    expect(recorded.map((r) => [r.version, r.name])).toEqual([
      [1, 'create_a'],
      [2, 'create_b'],
    ]);
    db.close();
  });

  it('[P1-MIG-2] is idempotent: a second run applies nothing', () => {
    const db = openDatabase(':memory:');
    migrate(db, [m1, m2]);
    expect(migrate(db, [m1, m2])).toEqual([]);
    db.close();
  });

  it('[P1-MIG-3] rolls back a failing migration and leaves no partial state', () => {
    const db = openDatabase(':memory:');
    const bad: Migration = {
      version: 3,
      name: 'broken',
      sql: 'CREATE TABLE ok_table (id INTEGER); INSERT INTO missing_table VALUES (1);',
    };
    expect(() => migrate(db, [m1, bad])).toThrow(/Migration 3 \(broken\) failed/);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ok_table'")
      .all();
    expect(tables).toHaveLength(0);
    // Earlier, successful migration stays applied.
    const versions = db.prepare('SELECT version FROM schema_migrations').all();
    expect(versions.map((r) => r.version)).toEqual([1]);
    db.close();
  });

  it('[P1-MIG-4] rejects duplicate migration versions', () => {
    const db = openDatabase(':memory:');
    expect(() => migrate(db, [m1, { ...m1, name: 'dupe' }])).toThrow(/Duplicate migration version/);
    db.close();
  });
});
