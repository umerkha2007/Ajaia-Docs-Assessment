import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import { decodeBase64, encodeBase64 } from '../collab/base64.js';
import { contentOf, docFromJson, docFromState, replaceContent } from '../collab/ydoc.js';
import type { Db } from '../db/connection.js';
import { AppError } from '../errors.js';
import { importFile as convertFile } from '../import/file.js';
import { assertCan, type DocAccess, type ShareRole } from '../policy.js';
import {
  DEFAULT_TITLE,
  validateContent,
  validateDocumentId,
  validateTitle,
} from '../validation.js';

export interface DocumentSummary {
  id: string;
  ownerId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** A document the user owns, with how many people it is shared with. */
export interface OwnedSummary extends DocumentSummary {
  shareCount: number;
}

/** A document someone else owns that has been shared with the user. */
export interface SharedSummary extends DocumentSummary {
  ownerName: string;
  role: ShareRole;
}

export interface DocumentRecord extends DocumentSummary {
  content: Record<string, unknown>;
  ownerName: string;
  /** The acting user's relationship to the document. */
  access: 'owner' | ShareRole;
}

export interface ShareRecord {
  userId: string;
  name: string;
  email: string;
  role: ShareRole;
  createdAt: string;
}

/** What one sync round trip returns to the client. Binary fields are base64. */
export interface SyncResult {
  /** Everything the client was missing, as a Yjs update. */
  update: string;
  /** The server's state vector after applying the client's update. */
  stateVector: string;
  title: string;
  updatedAt: string;
}

export const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] } as const;

interface Row {
  id: string;
  owner_id: string;
  owner_name: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

const summaryOf = (r: Row): DocumentSummary => ({
  id: r.id,
  ownerId: r.owner_id,
  title: r.title,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const validateUserId = (id: unknown): string => {
  if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
    throw new AppError('VALIDATION_ERROR', 'A user id is required');
  }
  return id;
};

/**
 * Document and sharing business logic. Every function takes the acting user's id
 * and runs the policy check itself, so no caller (route, test, script) can skip it.
 * `now` is injectable so ordering tests are deterministic.
 */
export function createDocumentService(db: Db, now: () => Date = () => new Date()) {
  const getRow = (id: string): Row => {
    const row = db
      .prepare('SELECT d.id, d.owner_id, d.title, d.content, d.created_at, d.updated_at, u.name AS owner_name FROM documents d JOIN users u ON u.id = d.owner_id WHERE d.id = ?')
      .get(id) as unknown as Row | undefined;
    if (!row) throw new AppError('NOT_FOUND', 'Document not found');
    return row;
  };

  /** The actor's access to this document, read fresh from the database on every call. */
  const accessOf = (row: Row, actorId: string): DocAccess => {
    const share = db
      .prepare('SELECT role FROM document_shares WHERE document_id = ? AND user_id = ?')
      .get(row.id, actorId) as { role: ShareRole } | undefined;
    return { ownerId: row.owner_id, shareRole: share?.role };
  };

  const touch = () => now().toISOString();

  /** The stored Yjs state, or null if the document has not been opened for editing yet. */
  const loadYdoc = (id: string): Uint8Array | null =>
    (db.prepare('SELECT ydoc FROM documents WHERE id = ?').get(id) as { ydoc: Uint8Array | null }).ydoc;

  return {
    create(actorId: string, input: { title?: unknown; content?: unknown }): DocumentRecord {
      const title = input.title === undefined ? DEFAULT_TITLE : validateTitle(input.title);
      const content = input.content === undefined ? EMPTY_DOC : validateContent(input.content);
      const id = randomUUID();
      const ts = touch();
      // Owner always comes from the authenticated actor, never from the request body.
      db.prepare(
        'INSERT INTO documents (id, owner_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(id, actorId, title, JSON.stringify(content), ts, ts);
      return this.get(actorId, id);
    },

    /** Create a new document from an uploaded .txt or .md file. The actor becomes the owner. */
    importFile(actorId: string, filename: unknown, bytes: Uint8Array): DocumentRecord {
      const { title, content } = convertFile(filename, bytes);
      return this.create(actorId, { title, content });
    },

    /** Documents the actor owns, most recently updated first. */
    list(actorId: string): OwnedSummary[] {
      const rows = db
        .prepare(
          `SELECT d.id, d.owner_id, d.title, d.created_at, d.updated_at, u.name AS owner_name,
                  (SELECT COUNT(*) FROM document_shares s WHERE s.document_id = d.id) AS share_count
             FROM documents d JOIN users u ON u.id = d.owner_id
            WHERE d.owner_id = ?
            ORDER BY d.updated_at DESC, d.created_at DESC, d.id ASC`,
        )
        .all(actorId) as unknown as (Row & { share_count: number })[];
      return rows.map((r) => ({ ...summaryOf(r), shareCount: r.share_count }));
    },

    /** Documents other people own that were shared with the actor, most recently updated first. */
    listShared(actorId: string): SharedSummary[] {
      const rows = db
        .prepare(
          `SELECT d.id, d.owner_id, d.title, d.created_at, d.updated_at, u.name AS owner_name, s.role AS role
             FROM document_shares s
             JOIN documents d ON d.id = s.document_id
             JOIN users u ON u.id = d.owner_id
            WHERE s.user_id = ?
            ORDER BY d.updated_at DESC, d.created_at DESC, d.id ASC`,
        )
        .all(actorId) as unknown as (Row & { role: ShareRole })[];
      return rows.map((r) => ({ ...summaryOf(r), ownerName: r.owner_name, role: r.role }));
    },

    get(actorId: string, rawId: unknown): DocumentRecord {
      const row = getRow(validateDocumentId(rawId));
      const access = accessOf(row, actorId);
      assertCan(actorId, access, 'read');
      let content: Record<string, unknown>;
      try {
        content = JSON.parse(row.content) as Record<string, unknown>;
      } catch (cause) {
        throw new AppError('INTERNAL_ERROR', 'Stored document content is corrupt', { cause });
      }
      return {
        ...summaryOf(row),
        content,
        ownerName: row.owner_name,
        access: row.owner_id === actorId ? 'owner' : (access.shareRole as ShareRole),
      };
    },

    rename(actorId: string, rawId: unknown, rawTitle: unknown): DocumentRecord {
      const row = getRow(validateDocumentId(rawId));
      assertCan(actorId, accessOf(row, actorId), 'write');
      const title = validateTitle(rawTitle);
      db.prepare('UPDATE documents SET title = ?, updated_at = ? WHERE id = ?').run(title, touch(), row.id);
      return this.get(actorId, row.id);
    },

    saveContent(actorId: string, rawId: unknown, rawContent: unknown): DocumentRecord {
      const row = getRow(validateDocumentId(rawId));
      assertCan(actorId, accessOf(row, actorId), 'write');
      const content = validateContent(rawContent);
      const shared = loadYdoc(row.id);
      if (shared) {
        // The document has collaborators: replace the shared document so they converge on
        // it, and keep the readable JSON copy identical to it.
        const ydoc = docFromState(shared);
        replaceContent(ydoc, content);
        db.prepare('UPDATE documents SET ydoc = ?, content = ?, updated_at = ? WHERE id = ?').run(
          Y.encodeStateAsUpdate(ydoc),
          JSON.stringify(contentOf(ydoc)),
          touch(),
          row.id,
        );
      } else {
        db.prepare('UPDATE documents SET content = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(content),
          touch(),
          row.id,
        );
      }
      return this.get(actorId, row.id);
    },

    delete(actorId: string, rawId: unknown): void {
      const row = getRow(validateDocumentId(rawId));
      assertCan(actorId, accessOf(row, actorId), 'delete');
      db.prepare('DELETE FROM documents WHERE id = ?').run(row.id); // share rows cascade
    },

    /**
     * One round trip of collaborative editing. The client sends what it has done since the
     * server last heard from it (a Yjs update) and what it already knows (a state vector);
     * the server merges the update into the shared document and replies with whatever the
     * client is missing. Updates can be merged in any order and are safe to repeat, so two
     * people editing at once, even in the same paragraph, both keep their changes.
     *
     * Reading needs read access; sending an update needs write access, checked fresh on every
     * call (so a revoked editor is refused on their next sync). The merged document must still
     * pass the content schema, otherwise the update is refused and nothing is stored.
     */
    sync(actorId: string, rawId: unknown, input: { stateVector?: unknown; update?: unknown }): SyncResult {
      const row = getRow(validateDocumentId(rawId));
      const update = decodeBase64(input.update, 'update');
      assertCan(actorId, accessOf(row, actorId), update ? 'write' : 'read');
      const clientVector = decodeBase64(input.stateVector, 'stateVector') ?? new Uint8Array([0]);

      const stored = loadYdoc(row.id);
      let json: Record<string, unknown>;
      try {
        json = JSON.parse(row.content) as Record<string, unknown>;
      } catch (cause) {
        throw new AppError('INTERNAL_ERROR', 'Stored document content is corrupt', { cause });
      }
      const ydoc = stored ? docFromState(stored) : docFromJson(json);

      let changed = false;
      ydoc.on('update', () => {
        changed = true;
      });
      if (update) {
        try {
          Y.applyUpdate(ydoc, update, 'client');
        } catch (cause) {
          throw new AppError('VALIDATION_ERROR', 'The update could not be read', { cause });
        }
      }

      let updatedAt = row.updated_at;
      if (changed) {
        const content = contentOf(ydoc); // throws before anything is stored if the edit is not valid
        updatedAt = touch();
        db.prepare('UPDATE documents SET ydoc = ?, content = ?, updated_at = ? WHERE id = ?').run(
          Y.encodeStateAsUpdate(ydoc),
          JSON.stringify(content),
          updatedAt,
          row.id,
        );
      } else if (!stored) {
        // First time anyone opens this document for editing: store the shared state once, so
        // every client starts from the same history instead of each building its own copy.
        db.prepare('UPDATE documents SET ydoc = ? WHERE id = ?').run(Y.encodeStateAsUpdate(ydoc), row.id);
      }

      let missing: Uint8Array;
      try {
        missing = Y.encodeStateAsUpdate(ydoc, clientVector);
      } catch (cause) {
        throw new AppError('VALIDATION_ERROR', 'The state vector could not be read', { cause });
      }
      return {
        update: encodeBase64(missing),
        stateVector: encodeBase64(Y.encodeStateVector(ydoc)),
        title: row.title,
        updatedAt,
      };
    },

    /** Everyone the document is shared with. Owner only. */
    listShares(actorId: string, rawId: unknown): ShareRecord[] {
      const row = getRow(validateDocumentId(rawId));
      assertCan(actorId, accessOf(row, actorId), 'share');
      const rows = db
        .prepare(
          `SELECT s.user_id, u.name, u.email, s.role, s.created_at
             FROM document_shares s JOIN users u ON u.id = s.user_id
            WHERE s.document_id = ?
            ORDER BY u.name ASC, u.id ASC`,
        )
        .all(row.id) as unknown as { user_id: string; name: string; email: string; role: ShareRole; created_at: string }[];
      return rows.map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role, createdAt: r.created_at }));
    },

    /**
     * Give another seeded user editor access. Owner only. The role is always
     * "editor": callers cannot choose it, and ownership never moves. Sharing again
     * with someone who already has access changes nothing.
     */
    share(actorId: string, rawId: unknown, rawUserId: unknown): ShareRecord[] {
      const row = getRow(validateDocumentId(rawId));
      assertCan(actorId, accessOf(row, actorId), 'share');
      const userId = validateUserId(rawUserId);
      if (userId === row.owner_id) throw new AppError('VALIDATION_ERROR', 'You already own this document');
      if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(userId)) {
        throw new AppError('VALIDATION_ERROR', 'That user does not exist');
      }
      db.prepare("INSERT OR IGNORE INTO document_shares (document_id, user_id, role, created_at) VALUES (?, ?, 'editor', ?)").run(
        row.id,
        userId,
        touch(),
      );
      return this.listShares(actorId, row.id);
    },

    /** Take access away from a user. Owner only. Takes effect on that user's very next request. */
    unshare(actorId: string, rawId: unknown, rawUserId: unknown): ShareRecord[] {
      const row = getRow(validateDocumentId(rawId));
      assertCan(actorId, accessOf(row, actorId), 'share');
      const userId = validateUserId(rawUserId);
      const result = db.prepare('DELETE FROM document_shares WHERE document_id = ? AND user_id = ?').run(row.id, userId);
      if (result.changes === 0) throw new AppError('NOT_FOUND', 'This document is not shared with that user');
      return this.listShares(actorId, row.id);
    },
  };
}

export type DocumentService = ReturnType<typeof createDocumentService>;
