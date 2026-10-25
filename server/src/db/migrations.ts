import type { Migration } from './migrate.js';

/** Ordered, append-only schema history. Never edit an applied migration; add a new one. */
export const migrations: Migration[] = [
  {
    version: 1,
    name: 'users_and_documents',
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE
      );
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_documents_owner_updated ON documents (owner_id, updated_at DESC);
    `,
  },
  {
    version: 2,
    name: 'document_shares_and_settings',
    sql: `
      CREATE TABLE document_shares (
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id),
        role TEXT NOT NULL CHECK (role IN ('editor')),
        created_at TEXT NOT NULL,
        PRIMARY KEY (document_id, user_id)
      );
      CREATE INDEX idx_document_shares_user ON document_shares (user_id);
      CREATE TABLE app_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 3,
    name: 'document_collaboration_state',
    // Yjs state of the document: the merge history that lets simultaneous edits combine.
    // NULL until the document is first opened for editing. `content` (JSON) stays the readable copy.
    sql: `ALTER TABLE documents ADD COLUMN ydoc BLOB;`,
  },
];
