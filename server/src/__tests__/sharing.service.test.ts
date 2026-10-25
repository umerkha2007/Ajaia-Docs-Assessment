import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection.js';
import { AppError } from '../errors.js';
import { createDocumentService, type DocumentService } from '../services/documents.js';
import { ALICE, BOB, CAROL, freshDb, paragraphDoc, steppingClock } from './helpers.js';

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return (e as AppError).code;
  }
  return 'NO_ERROR';
};

let db: Db;
let svc: DocumentService;
let docId: string;
beforeEach(() => {
  db = freshDb();
  svc = createDocumentService(db, steppingClock());
  docId = svc.create(ALICE, { title: 'Shared plan' }).id;
  svc.saveContent(ALICE, docId, paragraphDoc('original'));
});

describe('Ownership and Sharing: granting access', () => {
  it('[FR-3.3] the owner can share a document with another seeded user', () => {
    const shares = svc.share(ALICE, docId, BOB);
    expect(shares).toHaveLength(1);
    expect(shares[0]).toMatchObject({ userId: BOB, name: 'Bob Brown', email: 'bob@example.test', role: 'editor' });
    expect(shares[0]!.createdAt).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('[FR-3.4] the recipient can open the shared document and is told they are an editor, not the owner', () => {
    svc.share(ALICE, docId, BOB);
    const doc = svc.get(BOB, docId);
    expect(doc).toMatchObject({ id: docId, ownerId: ALICE, ownerName: 'Alice Anderson', access: 'editor', content: paragraphDoc('original') });
    expect(svc.get(ALICE, docId).access).toBe('owner');
  });

  it('[FR-3.5] shared documents appear in the recipient\'s "shared with you" list with their owner, not in their owned list', () => {
    svc.share(ALICE, docId, BOB);
    expect(svc.list(BOB)).toEqual([]);
    const shared = svc.listShared(BOB);
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ id: docId, title: 'Shared plan', ownerId: ALICE, ownerName: 'Alice Anderson', role: 'editor' });
    expect(shared[0]).not.toHaveProperty('content');
  });

  it('[FR-3.5] the owner still sees the document as owned and with the number of people it is shared with', () => {
    expect(svc.list(ALICE)[0]!.shareCount).toBe(0);
    svc.share(ALICE, docId, BOB);
    svc.share(ALICE, docId, CAROL);
    expect(svc.list(ALICE)[0]!.shareCount).toBe(2);
    expect(svc.listShared(ALICE)).toEqual([]);
  });

  it('[FR-3.3] sharing the same document with the same user twice is harmless and keeps one grant', () => {
    const first = svc.share(ALICE, docId, BOB);
    const second = svc.share(ALICE, docId, BOB);
    expect(second).toHaveLength(1);
    expect(second[0]!.createdAt).toBe(first[0]!.createdAt);
  });

  it('[FR-3.3] sharing does not change the document, its owner, or its position in the owner\'s list', () => {
    const other = svc.create(ALICE, { title: 'Newer' });
    const before = svc.get(ALICE, docId);
    svc.share(ALICE, docId, BOB);
    const after = svc.get(ALICE, docId);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.ownerId).toBe(ALICE);
    expect(svc.list(ALICE).map((d) => d.id)).toEqual([other.id, docId]);
  });

  it('[FR-3.3] listShares shows everyone with access, sorted by name, to the owner only', () => {
    svc.share(ALICE, docId, CAROL);
    svc.share(ALICE, docId, BOB);
    expect(svc.listShares(ALICE, docId).map((s) => s.name)).toEqual(['Bob Brown', 'Carol Clark']);
  });

  it('[FR-3.5] shared documents are listed newest-updated first', () => {
    const second = svc.create(ALICE, { title: 'Second' }).id;
    svc.share(ALICE, docId, BOB);
    svc.share(ALICE, second, BOB);
    expect(svc.listShared(BOB).map((d) => d.id)).toEqual([second, docId]);
    svc.saveContent(ALICE, docId, paragraphDoc('touched'));
    expect(svc.listShared(BOB).map((d) => d.id)).toEqual([docId, second]);
  });
});

describe('Ownership and Sharing: what a shared user can and cannot do', () => {
  beforeEach(() => {
    svc.share(ALICE, docId, BOB);
  });

  it('[FR-3.4] an editor can change the content and the owner sees the change', () => {
    svc.saveContent(BOB, docId, paragraphDoc('bob was here'));
    expect(svc.get(ALICE, docId).content).toEqual(paragraphDoc('bob was here'));
  });

  it('[FR-3.4] an editor can rename the document', () => {
    expect(svc.rename(BOB, docId, 'Renamed by Bob').title).toBe('Renamed by Bob');
  });

  it('[SEC-1] editing never changes who owns the document', () => {
    expect(svc.saveContent(BOB, docId, paragraphDoc('x')).ownerId).toBe(ALICE);
    expect(svc.rename(BOB, docId, 'y').ownerId).toBe(ALICE);
  });

  it('[SEC-1] an editor cannot delete the document, and it is left intact', () => {
    expect(code(() => svc.delete(BOB, docId))).toBe('FORBIDDEN');
    expect(svc.get(ALICE, docId).title).toBe('Shared plan');
  });

  it('[SEC-1] an editor cannot share it onward, view who has access, or revoke anyone', () => {
    expect(code(() => svc.share(BOB, docId, CAROL))).toBe('FORBIDDEN');
    expect(code(() => svc.listShares(BOB, docId))).toBe('FORBIDDEN');
    expect(code(() => svc.unshare(BOB, docId, BOB))).toBe('FORBIDDEN');
    expect(code(() => svc.unshare(BOB, docId, ALICE))).toBe('FORBIDDEN');
    expect(code(() => svc.get(CAROL, docId))).toBe('FORBIDDEN');
    expect(svc.listShares(ALICE, docId).map((s) => s.userId)).toEqual([BOB]);
  });

  it('[SEC-1] an editor\'s invalid save is rejected and the shared content is untouched', () => {
    expect(code(() => svc.saveContent(BOB, docId, { type: 'nope' }))).toBe('VALIDATION_ERROR');
    expect(svc.get(ALICE, docId).content).toEqual(paragraphDoc('original'));
  });
});

describe('Ownership and Sharing: users without access', () => {
  it('[SEC-1] a user the document was never shared with cannot read, edit, rename, delete or manage sharing', () => {
    svc.share(ALICE, docId, BOB);
    expect(code(() => svc.get(CAROL, docId))).toBe('FORBIDDEN');
    expect(code(() => svc.saveContent(CAROL, docId, paragraphDoc('x')))).toBe('FORBIDDEN');
    expect(code(() => svc.rename(CAROL, docId, 'x'))).toBe('FORBIDDEN');
    expect(code(() => svc.delete(CAROL, docId))).toBe('FORBIDDEN');
    expect(code(() => svc.share(CAROL, docId, CAROL))).toBe('FORBIDDEN');
    expect(code(() => svc.listShares(CAROL, docId))).toBe('FORBIDDEN');
    expect(svc.list(CAROL)).toEqual([]);
    expect(svc.listShared(CAROL)).toEqual([]);
  });

  it('[SEC-1] sharing with Bob gives Carol nothing, and sharing one document does not expose the owner\'s others', () => {
    const other = svc.create(ALICE, { title: 'Private' }).id;
    svc.share(ALICE, docId, BOB);
    expect(code(() => svc.get(BOB, other))).toBe('FORBIDDEN');
    expect(svc.listShared(BOB).map((d) => d.id)).toEqual([docId]);
  });
});

describe('Ownership and Sharing: revoking access', () => {
  beforeEach(() => {
    svc.share(ALICE, docId, BOB);
    svc.share(ALICE, docId, CAROL);
  });

  it('[FR-3.6] after revocation the former editor can no longer read or write, and the document leaves their shared list', () => {
    expect(svc.get(BOB, docId)).toBeTruthy();
    expect(svc.unshare(ALICE, docId, BOB).map((s) => s.userId)).toEqual([CAROL]);
    expect(code(() => svc.get(BOB, docId))).toBe('FORBIDDEN');
    expect(code(() => svc.saveContent(BOB, docId, paragraphDoc('late edit')))).toBe('FORBIDDEN');
    expect(code(() => svc.rename(BOB, docId, 'late'))).toBe('FORBIDDEN');
    expect(svc.listShared(BOB)).toEqual([]);
    expect(svc.get(ALICE, docId).content).toEqual(paragraphDoc('original'));
  });

  it('[FR-3.6] revoking one user leaves the other user\'s access intact', () => {
    svc.unshare(ALICE, docId, BOB);
    expect(svc.get(CAROL, docId).access).toBe('editor');
  });

  it('[FR-3.6] work the editor saved before revocation is kept', () => {
    svc.saveContent(BOB, docId, paragraphDoc('saved before revoke'));
    svc.unshare(ALICE, docId, BOB);
    expect(svc.get(ALICE, docId).content).toEqual(paragraphDoc('saved before revoke'));
  });

  it('[FR-3.6] access can be granted again after being revoked', () => {
    svc.unshare(ALICE, docId, BOB);
    svc.share(ALICE, docId, BOB);
    expect(svc.get(BOB, docId).access).toBe('editor');
  });

  it('[FR-3.6] revoking someone who has no access is NOT_FOUND, not a silent success', () => {
    svc.unshare(ALICE, docId, BOB);
    expect(code(() => svc.unshare(ALICE, docId, BOB))).toBe('NOT_FOUND');
  });
});

describe('Validation and Error Handling: sharing', () => {
  it('[NFR-VAL] the owner cannot share a document with themselves', () => {
    expect(code(() => svc.share(ALICE, docId, ALICE))).toBe('VALIDATION_ERROR');
    expect(svc.listShares(ALICE, docId)).toEqual([]);
  });

  it('[NFR-VAL] sharing with a user that does not exist is rejected', () => {
    expect(code(() => svc.share(ALICE, docId, 'user-ghost'))).toBe('VALIDATION_ERROR');
    expect(svc.listShares(ALICE, docId)).toEqual([]);
  });

  it.each([undefined, null, 5, '', {}, ['user-bob']])('[NFR-VAL] a malformed user id %j is rejected', (bad) => {
    expect(code(() => svc.share(ALICE, docId, bad))).toBe('VALIDATION_ERROR');
    expect(code(() => svc.unshare(ALICE, docId, bad))).toBe('VALIDATION_ERROR');
  });

  it('[NFR-ERR] sharing, listing and revoking on a missing document are NOT_FOUND, and a malformed id is a validation error', () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    expect(code(() => svc.share(ALICE, missing, BOB))).toBe('NOT_FOUND');
    expect(code(() => svc.listShares(ALICE, missing))).toBe('NOT_FOUND');
    expect(code(() => svc.unshare(ALICE, missing, BOB))).toBe('NOT_FOUND');
    expect(code(() => svc.share(ALICE, 'not-a-uuid', BOB))).toBe('VALIDATION_ERROR');
  });
});

describe('Persistence: sharing data', () => {
  it('[FR-3.7] deleting a document removes its share records, and the former recipient no longer lists it', () => {
    svc.share(ALICE, docId, BOB);
    svc.delete(ALICE, docId);
    expect(db.prepare('SELECT COUNT(*) AS n FROM document_shares').get()?.n).toBe(0);
    expect(svc.listShared(BOB)).toEqual([]);
  });

  it('[FR-3.7] the database refuses a share that points at a missing document or user, and a duplicate grant', () => {
    const insert = (d: string, u: string) =>
      db.prepare("INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES (?, ?, 'editor', 'x')").run(d, u);
    expect(() => insert('missing-doc', BOB)).toThrow(/FOREIGN KEY/i);
    expect(() => insert(docId, 'user-ghost')).toThrow(/FOREIGN KEY/i);
    insert(docId, BOB);
    expect(() => insert(docId, BOB)).toThrow(/UNIQUE|PRIMARY KEY/i);
  });

  it('[FR-3.7] the database only accepts known roles', () => {
    expect(() =>
      db.prepare("INSERT INTO document_shares (document_id, user_id, role, created_at) VALUES (?, ?, 'owner', 'x')").run(docId, BOB),
    ).toThrow(/CHECK/i);
  });
});
