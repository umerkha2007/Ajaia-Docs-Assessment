import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app.js';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/connection.js';

describe('Backend API: health and routing', () => {
  let app: FastifyInstance;
  beforeEach(async () => {
    app = buildApp({ db: openDatabase(':memory:') });
    await app.ready();
  });
  afterEach(async () => {
    await app.close();
  });

  it('[P1-API-1] GET /api/health reports ok and the live SQLite version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.sqliteVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('[P1-API-2] unknown routes return a structured 404 JSON error', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'NOT_FOUND', message: 'Route not found' });
  });
});

describe('Backend configuration', () => {
  it('[P1-CFG-1] uses defaults when no environment overrides are set', () => {
    const c = loadConfig({});
    expect(c.port).toBe(3001);
    expect(c.host).toBe('127.0.0.1');
    expect(c.dbPath).toMatch(/data[\\/]app\.db$/);
  });

  it('[P1-CFG-2] honours PORT and DB_PATH overrides', () => {
    const c = loadConfig({ PORT: '4000', DB_PATH: 'custom.db' });
    expect(c.port).toBe(4000);
    expect(c.dbPath).toMatch(/custom\.db$/);
  });

  it('[P1-CFG-3] rejects an invalid PORT instead of silently falling back', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Invalid PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/Invalid PORT/);
  });
});
