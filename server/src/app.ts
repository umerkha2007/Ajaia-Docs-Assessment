import Fastify, { type FastifyInstance } from 'fastify';
import type { Db } from './db/connection.js';
import { createAuth } from './auth.js';
import { AppError } from './errors.js';
import { IMPORT_MAX_BYTES } from './import/file.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerSessionRoutes } from './routes/session.js';
import { createDocumentService } from './services/documents.js';

export interface AppDeps {
  db: Db;
  logger?: boolean;
  /** Injectable clock, for deterministic ordering in tests. */
  now?: () => Date;
}

/** Build the HTTP app. Takes its dependencies so tests can inject an isolated DB. */
export function buildApp({ db, logger = false, now }: AppDeps): FastifyInstance {
  const app = Fastify({ logger, bodyLimit: 2 * 1024 * 1024 });
  const auth = createAuth(db);
  const documents = createDocumentService(db, now);

  app.get('/api/health', async () => {
    const row = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
    return { status: 'ok', sqliteVersion: row.v };
  });

  registerSessionRoutes(app, auth);
  registerDocumentRoutes(app, { auth, documents });

  app.setNotFoundHandler((_req, reply) => {
    reply.code(404).send({ error: 'NOT_FOUND', message: 'Route not found' });
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      if (err.status >= 500) req.log.error(err);
      return reply.code(err.status).send({ error: err.code, message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 413 && req.url.startsWith('/api/documents/import')) {
      return reply.code(413).send({ error: 'FILE_TOO_LARGE', message: `File is too large. The limit is ${IMPORT_MAX_BYTES / 1024} KB.` });
    }
    if (status && status >= 400 && status < 500) {
      // Framework-level client errors: malformed JSON, oversize body, etc.
      return reply.code(status).send({ error: 'BAD_REQUEST', message: (err as Error).message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'INTERNAL_ERROR', message: 'Unexpected server error' });
  });

  return app;
}
