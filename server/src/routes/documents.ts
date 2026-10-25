import type { FastifyInstance } from 'fastify';
import type { Auth } from '../auth.js';
import { AppError } from '../errors.js';
import type { DocumentService } from '../services/documents.js';
import { IMPORT_MAX_BYTES } from '../import/file.js';
import { isPlainObject } from '../validation.js';

interface Deps {
  auth: Auth;
  documents: DocumentService;
}

function bodyOf(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null) return {};
  if (!isPlainObject(body)) throw new AppError('VALIDATION_ERROR', 'Request body must be a JSON object');
  return body;
}

/** Thin HTTP layer: resolve the actor, delegate to the service, shape the response. */
export function registerDocumentRoutes(app: FastifyInstance, { auth, documents }: Deps): void {
  const requireActor = auth.requireActor.bind(auth);
  // Uploads arrive as raw bytes (the file is the body, the name is a query parameter), so no
  // multipart dependency is needed and the server sees exactly the bytes to validate.
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: IMPORT_MAX_BYTES }, (_req, body, done) => {
    done(null, body);
  });

  app.post<{ Querystring: { filename?: unknown } }>('/api/documents/import', async (req, reply) => {
    const actor = requireActor(req);
    const bytes = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return reply.code(201).send({ document: documents.importFile(actor, req.query.filename, bytes) });
  });

  app.get('/api/documents', async (req) => {
    const actor = requireActor(req);
    return { documents: documents.list(actor), shared: documents.listShared(actor) };
  });

  app.post('/api/documents', async (req, reply) => {
    const actor = requireActor(req);
    // Only `title` is read; any ownerId/owner_id the client sends is ignored.
    const doc = documents.create(actor, { title: bodyOf(req.body).title });
    return reply.code(201).send({ document: doc });
  });

  app.get<{ Params: { id: string } }>('/api/documents/:id', async (req) => ({
    document: documents.get(requireActor(req), req.params.id),
  }));

  app.patch<{ Params: { id: string } }>('/api/documents/:id', async (req) => ({
    document: documents.rename(requireActor(req), req.params.id, bodyOf(req.body).title),
  }));

  app.put<{ Params: { id: string } }>('/api/documents/:id/content', async (req) => ({
    document: documents.saveContent(requireActor(req), req.params.id, bodyOf(req.body).content),
  }));

  app.delete<{ Params: { id: string } }>('/api/documents/:id', async (req, reply) => {
    documents.delete(requireActor(req), req.params.id);
    return reply.code(204).send();
  });

  // Collaborative editing: send local changes, receive other people's. The service explains the protocol.
  app.post<{ Params: { id: string } }>('/api/documents/:id/sync', async (req) =>
    documents.sync(requireActor(req), req.params.id, bodyOf(req.body)),
  );

  // Sharing. Only the owner may use these; the service enforces it, not this layer.
  app.get<{ Params: { id: string } }>('/api/documents/:id/shares', async (req) => ({
    shares: documents.listShares(requireActor(req), req.params.id),
  }));

  // Only `userId` is read. Any role or owner the client sends is ignored: grants are always "editor".
  app.post<{ Params: { id: string } }>('/api/documents/:id/shares', async (req) => ({
    shares: documents.share(requireActor(req), req.params.id, bodyOf(req.body).userId),
  }));

  app.delete<{ Params: { id: string; userId: string } }>('/api/documents/:id/shares/:userId', async (req) => ({
    shares: documents.unshare(requireActor(req), req.params.id, req.params.userId),
  }));
}
