import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection.js';
import { AppError } from '../errors.js';
import { createDocumentService, EMPTY_DOC, type DocumentService } from '../services/documents.js';
import { DEFAULT_TITLE, TITLE_MAX } from '../validation.js';
import { ALICE, BOB, freshDb, paragraphDoc, steppingClock } from './helpers.js';

const expectAppError = (fn: () => unknown, code: AppError['code']) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected AppError ${code}, but nothing was thrown`);
};

let db: Db;
let svc: DocumentService;
beforeEach(() => {
  db = freshDb();
  svc = createDocumentService(db, steppingClock());
});

describe('Document CRUD: create', () => {
  it('[FR-1.1] creates a document owned by the acting user with an empty body', () => {
    const doc = svc.create(ALICE, { title: 'Plan' });
    expect(doc.title).toBe('Plan');
    expect(doc.ownerId).toBe(ALICE);
    expect(doc.content).toEqual(EMPTY_DOC);
    expect(doc.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(doc.createdAt).toBe(doc.updatedAt);
  });

  it('[FR-1.1] uses a default title when none is given', () => {
    expect(svc.create(ALICE, {}).title).toBe(DEFAULT_TITLE);
  });

  it('[FR-1.1] trims whitespace from the title', () => {
    expect(svc.create(ALICE, { title: '  Spaced  ' }).title).toBe('Spaced');
  });

  it('[FR-3.1] cannot create a document for a user that does not exist (foreign key)', () => {
    expect(() => svc.create('user-ghost', { title: 'x' })).toThrow(/FOREIGN KEY/i);
  });
});

describe('Document CRUD: rename, edit, reopen', () => {
  it('[FR-1.2] renames a document and bumps updatedAt', () => {
    const doc = svc.create(ALICE, { title: 'Old' });
    const renamed = svc.rename(ALICE, doc.id, 'New');
    expect(renamed.title).toBe('New');
    expect(renamed.updatedAt > doc.updatedAt).toBe(true);
    expect(svc.get(ALICE, doc.id).title).toBe('New');
  });

  it('[FR-1.3] saves content and returns exactly what was saved when reopened', () => {
    const doc = svc.create(ALICE, { title: 'Draft' });
    const body = paragraphDoc('Hello, world');
    svc.saveContent(ALICE, doc.id, body);
    expect(svc.get(ALICE, doc.id).content).toEqual(body);
  });

  it('[FR-1.3] a second save fully replaces the first', () => {
    const doc = svc.create(ALICE, {});
    svc.saveContent(ALICE, doc.id, paragraphDoc('first'));
    svc.saveContent(ALICE, doc.id, paragraphDoc('second'));
    expect(svc.get(ALICE, doc.id).content).toEqual(paragraphDoc('second'));
  });

  it('[FR-1.3] saving content does not change the title or owner', () => {
    const doc = svc.create(ALICE, { title: 'Keep' });
    const saved = svc.saveContent(ALICE, doc.id, paragraphDoc('x'));
    expect(saved.title).toBe('Keep');
    expect(saved.ownerId).toBe(ALICE);
  });
});

describe('Document CRUD: delete', () => {
  it('[FR-1.5] deletes a document so it can no longer be opened or listed', () => {
    const doc = svc.create(ALICE, { title: 'Temp' });
    svc.delete(ALICE, doc.id);
    expectAppError(() => svc.get(ALICE, doc.id), 'NOT_FOUND');
    expect(svc.list(ALICE)).toEqual([]);
  });

  it('[FR-1.5] deleting one document leaves the others intact', () => {
    const a = svc.create(ALICE, { title: 'A' });
    const b = svc.create(ALICE, { title: 'B' });
    svc.delete(ALICE, a.id);
    expect(svc.list(ALICE).map((d) => d.id)).toEqual([b.id]);
  });
});

describe('Document CRUD: listing and ordering', () => {
  it('[FR-1.6] lists most recently updated first', () => {
    const a = svc.create(ALICE, { title: 'A' });
    const b = svc.create(ALICE, { title: 'B' });
    const c = svc.create(ALICE, { title: 'C' });
    expect(svc.list(ALICE).map((d) => d.title)).toEqual(['C', 'B', 'A']);
    svc.saveContent(ALICE, a.id, paragraphDoc('edited')); // A becomes most recent
    expect(svc.list(ALICE).map((d) => d.id)).toEqual([a.id, c.id, b.id]);
    svc.rename(ALICE, b.id, 'B2'); // renaming also counts as an update
    expect(svc.list(ALICE).map((d) => d.id)).toEqual([b.id, a.id, c.id]);
  });

  it('[FR-1.6] list summaries do not include document content', () => {
    svc.create(ALICE, {});
    expect(Object.keys(svc.list(ALICE)[0]!).sort()).toEqual(['createdAt', 'id', 'ownerId', 'shareCount', 'title', 'updatedAt']);
  });

  it('[SEC-1] a user only lists their own documents', () => {
    svc.create(ALICE, { title: 'alice-doc' });
    svc.create(BOB, { title: 'bob-doc' });
    expect(svc.list(ALICE).map((d) => d.title)).toEqual(['alice-doc']);
    expect(svc.list(BOB).map((d) => d.title)).toEqual(['bob-doc']);
  });
});

describe('Ownership and access control (owner-only in Phase 2)', () => {
  it('[SEC-1] another user cannot read a document they do not own', () => {
    const doc = svc.create(ALICE, { title: 'secret' });
    expectAppError(() => svc.get(BOB, doc.id), 'FORBIDDEN');
  });

  it('[SEC-1] another user cannot rename, edit or delete it, and nothing changes', () => {
    const doc = svc.create(ALICE, { title: 'secret' });
    svc.saveContent(ALICE, doc.id, paragraphDoc('original'));
    expectAppError(() => svc.rename(BOB, doc.id, 'hacked'), 'FORBIDDEN');
    expectAppError(() => svc.saveContent(BOB, doc.id, paragraphDoc('hacked')), 'FORBIDDEN');
    expectAppError(() => svc.delete(BOB, doc.id), 'FORBIDDEN');
    const after = svc.get(ALICE, doc.id);
    expect(after.title).toBe('secret');
    expect(after.content).toEqual(paragraphDoc('original'));
  });
});

describe('Validation and Error Handling: documents', () => {
  it.each([
    ['empty', ''],
    ['whitespace only', '   '],
    ['too long', 'x'.repeat(TITLE_MAX + 1)],
    ['control character', 'bad\u0000title'],
    ['newline', 'two\nlines'],
    ['non-string', 42],
    ['null', null],
  ])('[NFR-VAL] rejects an invalid title on create: %s', (_label, title) => {
    expectAppError(() => svc.create(ALICE, { title }), 'VALIDATION_ERROR');
    expect(svc.list(ALICE)).toEqual([]);
  });

  it('[NFR-VAL] accepts a title of exactly the maximum length', () => {
    expect(svc.create(ALICE, { title: 'x'.repeat(TITLE_MAX) }).title).toHaveLength(TITLE_MAX);
  });

  it('[NFR-VAL] rejects an invalid rename and keeps the old title', () => {
    const doc = svc.create(ALICE, { title: 'Keep me' });
    expectAppError(() => svc.rename(ALICE, doc.id, '   '), 'VALIDATION_ERROR');
    expectAppError(() => svc.rename(ALICE, doc.id, undefined), 'VALIDATION_ERROR');
    expect(svc.get(ALICE, doc.id).title).toBe('Keep me');
  });

  it.each([
    ['null', null],
    ['string', 'hello'],
    ['array', []],
    ['wrong type', { type: 'paragraph' }],
    ['content not an array', { type: 'doc', content: 'nope' }],
  ])('[NFR-VAL] rejects invalid content on save: %s, and keeps the previous content', (_label, bad) => {
    const doc = svc.create(ALICE, {});
    svc.saveContent(ALICE, doc.id, paragraphDoc('safe'));
    expectAppError(() => svc.saveContent(ALICE, doc.id, bad), 'VALIDATION_ERROR');
    expect(svc.get(ALICE, doc.id).content).toEqual(paragraphDoc('safe'));
  });

  it('[NFR-VAL] rejects content larger than the size limit', () => {
    const doc = svc.create(ALICE, {});
    const huge = paragraphDoc('x'.repeat(1_100_000));
    expectAppError(() => svc.saveContent(ALICE, doc.id, huge), 'VALIDATION_ERROR');
  });

  it.each(['not-a-uuid', '', '../etc/passwd', "1' OR '1'='1", 123, undefined])(
    '[NFR-VAL] rejects a malformed document id: %s',
    (id) => {
      expectAppError(() => svc.get(ALICE, id), 'VALIDATION_ERROR');
    },
  );

  it('[NFR-ERR] a well-formed but unknown id is NOT_FOUND for every operation', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    expectAppError(() => svc.get(ALICE, id), 'NOT_FOUND');
    expectAppError(() => svc.rename(ALICE, id, 'x'), 'NOT_FOUND');
    expectAppError(() => svc.saveContent(ALICE, id, paragraphDoc('x')), 'NOT_FOUND');
    expectAppError(() => svc.delete(ALICE, id), 'NOT_FOUND');
  });

  it('[NFR-ERR] reports corrupt stored content as an error instead of returning empty content', () => {
    const doc = svc.create(ALICE, {});
    db.prepare('UPDATE documents SET content = ? WHERE id = ?').run('{not json', doc.id);
    expectAppError(() => svc.get(ALICE, doc.id), 'INTERNAL_ERROR');
  });
});
