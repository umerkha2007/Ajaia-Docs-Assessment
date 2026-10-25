import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/connection.js';
import { AppError, type ErrorCode } from '../errors.js';
import { createDocumentService, type DocumentService } from '../services/documents.js';
import { FakeClient, fromB64, settle, toB64 } from './collabClient.js';
import { ALICE, BOB, CAROL, freshDb, steppingClock } from './helpers.js';

const para = (text: string, ...marks: string[]) => ({
  type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const doc = (...blocks: unknown[]) => ({ type: 'doc', content: blocks });
const p = (...c: unknown[]) => ({ type: 'paragraph', content: c });

const code = (fn: () => unknown): ErrorCode | 'NO_ERROR' => {
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
let id: string;
beforeEach(() => {
  db = freshDb();
  svc = createDocumentService(db, steppingClock());
  id = svc.create(ALICE, { title: 'Collab doc', content: doc(p(para('The quick brown fox')), p(para('Second paragraph')), p(para('Third paragraph'))) }).id;
  svc.share(ALICE, id, BOB);
  svc.share(ALICE, id, CAROL);
});

const client = (user: string) => new FakeClient(svc, user, id);
const stored = () => svc.get(ALICE, id).content as { content: { content?: { text: string; marks?: { type: string }[] }[] }[] };
const storedLines = () => stored().content.map((b) => (b.content ?? []).map((t) => t.text).join(''));

describe('Collaboration: first sync and loading', () => {
  it('[FR-5.1] a new client with an empty document receives the stored content', () => {
    const a = client(ALICE);
    a.sync();
    expect(a.lines()).toEqual(['The quick brown fox', 'Second paragraph', 'Third paragraph']);
  });

  it('[FR-5.1] the first sync of a document saved before collaboration existed creates its shared state exactly once', () => {
    const a = client(ALICE);
    const b = client(BOB);
    a.sync();
    b.sync();
    expect(b.lines()).toEqual(a.lines());
    settle(a, b);
    expect(a.lines()).toEqual(['The quick brown fox', 'Second paragraph', 'Third paragraph']); // not duplicated
    expect(storedLines()).toEqual(a.lines());
  });

  it('[FR-5.1] a document whose stored content is empty still gives every client one empty paragraph, not one each', () => {
    const empty = svc.create(ALICE, { title: 'Empty' }).id;
    svc.share(ALICE, empty, BOB);
    const a = new FakeClient(svc, ALICE, empty);
    const b = new FakeClient(svc, BOB, empty);
    a.sync();
    b.sync();
    settle(a, b);
    expect(a.lines()).toEqual(['']);
    expect(b.lines()).toEqual(['']);
  });

  it('[FR-5.1] a poll with nothing to send or receive changes nothing, including the document\'s update time', () => {
    const a = client(ALICE);
    a.sync();
    const before = svc.get(ALICE, id);
    a.sync({ sendUpdate: false });
    a.sync({ sendUpdate: false });
    const after = svc.get(ALICE, id);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(after.content).toEqual(before.content);
  });

  it('[FR-5.1] the sync response carries the current title', () => {
    const a = client(ALICE);
    expect(a.sync().title).toBe('Collab doc');
    svc.rename(BOB, id, 'Renamed by Bob');
    expect(a.sync({ sendUpdate: false }).title).toBe('Renamed by Bob');
  });
});

describe('Collaboration: autosave to the server', () => {
  it('[FR-5.2] one client\'s edit is stored: the server\'s content, JSON and update time change', () => {
    const a = client(ALICE);
    a.sync();
    const before = svc.get(ALICE, id).updatedAt;
    a.text(0).insert(0, 'Hello. ');
    a.sync();
    expect(storedLines()[0]).toBe('Hello. The quick brown fox');
    expect(svc.get(ALICE, id).updatedAt > before).toBe(true);
  });

  it('[FR-5.2] another user receives the edit on their next sync', () => {
    const a = client(ALICE);
    const b = client(BOB);
    a.sync();
    b.sync();
    a.text(1).insert(0, 'Edited: ');
    a.sync();
    expect(b.lines()[1]).toBe('Second paragraph');
    b.sync({ sendUpdate: false });
    expect(b.lines()[1]).toBe('Edited: Second paragraph');
  });

  it('[FR-5.2] formatting applied by one user reaches the other', () => {
    const a = client(ALICE);
    const b = client(BOB);
    a.sync();
    b.sync();
    a.text(0).format(4, 5, { bold: {} }); // "quick"
    a.sync();
    b.sync();
    const text = (stored().content[0]!.content ?? []).find((t) => t.marks?.some((m) => m.type === 'bold'));
    expect(text?.text).toBe('quick');
    expect(b.text(0).toDelta()).toContainEqual({ insert: 'quick', attributes: { bold: {} } });
  });

  it('[FR-5.2] the stored JSON is clean: marks carry only their type, and the whole document passes the content schema', () => {
    const a = client(ALICE);
    a.sync();
    a.text(0).format(0, 3, { bold: {}, italic: {} });
    a.sync();
    expect(JSON.stringify(stored())).not.toContain('"attrs":{}');
    expect(() => svc.saveContent(ALICE, id, stored())).not.toThrow(); // round-trips through the normal validator
  });

  it('[FR-5.2] deleting text and whole paragraphs syncs too', () => {
    const a = client(ALICE);
    const b = client(BOB);
    a.sync();
    b.sync();
    a.text(0).delete(0, 4); // "The "
    a.fragment.delete(2, 1); // the third paragraph
    a.sync();
    b.sync();
    expect(b.lines()).toEqual(['quick brown fox', 'Second paragraph']);
    expect(storedLines()).toEqual(['quick brown fox', 'Second paragraph']);
  });
});

describe('Collaboration: simultaneous edits are merged, not overwritten', () => {
  it('[FR-5.3] two users typing in the SAME paragraph at different places both keep their text', () => {
    const a = client(ALICE);
    const b = client(BOB);
    a.sync();
    b.sync();
    a.text(0).insert(0, 'Alice: ');
    b.text(0).insert(b.text(0).length, ' (Bob was here)');
    a.sync(); // first to reach the server
    b.sync(); // second: previously this would have replaced Alice's change
    a.sync();
    const expected = 'Alice: The quick brown fox (Bob was here)';
    expect(a.lines()[0]).toBe(expected);
    expect(b.lines()[0]).toBe(expected);
    expect(storedLines()[0]).toBe(expected);
  });

  it('[FR-5.3] two users editing DIFFERENT paragraphs both keep their changes', () => {
    const a = client(ALICE);
    const b = client(BOB);
    a.sync();
    b.sync();
    a.text(0).insert(0, 'A> ');
    b.text(2).insert(0, 'B> ');
    b.sync();
    a.sync();
    b.sync();
    expect(storedLines()).toEqual(['A> The quick brown fox', 'Second paragraph', 'B> Third paragraph']);
    expect(a.lines()).toEqual(storedLines());
    expect(b.lines()).toEqual(storedLines());
  });

  it('[FR-5.3] three users typing at once all converge on the same document containing everything', () => {
    const [a, b, c] = [client(ALICE), client(BOB), client(CAROL)] as [FakeClient, FakeClient, FakeClient];
    settle(a, b, c);
    a.text(0).insert(0, 'a');
    b.text(1).insert(0, 'b');
    c.text(2).insert(0, 'c');
    c.text(0).insert(c.text(0).length, '!');
    settle(a, b, c);
    const lines = storedLines();
    expect(lines).toEqual(['aThe quick brown fox!', 'bSecond paragraph', 'cThird paragraph']);
    expect(a.lines()).toEqual(lines);
    expect(b.lines()).toEqual(lines);
    expect(c.lines()).toEqual(lines);
  });

  it('[FR-5.3] two users inserting at the exact same position keep both insertions, and every client agrees on their order', () => {
    const a = client(ALICE);
    const b = client(BOB);
    a.sync();
    b.sync();
    a.text(0).insert(0, 'AAA');
    b.text(0).insert(0, 'BBB');
    settle(a, b);
    const line = storedLines()[0]!;
    expect(line.replace('AAA', '').replace('BBB', '')).toBe('The quick brown fox');
    expect(line).toContain('AAA');
    expect(line).toContain('BBB');
    expect(a.lines()[0]).toBe(line);
    expect(b.lines()[0]).toBe(line);
  });

  it('[FR-5.3] one user formatting a word while another types elsewhere in the same paragraph keeps both', () => {
    const a = client(ALICE);
    const b = client(BOB);
    a.sync();
    b.sync();
    a.text(0).format(4, 5, { bold: {} });
    b.text(0).insert(b.text(0).length, ' jumps');
    settle(a, b);
    expect(storedLines()[0]).toBe('The quick brown fox jumps');
    expect(JSON.stringify(stored().content[0])).toContain('"marks":[{"type":"bold"}]');
  });

  it('[FR-5.3] one user deleting a paragraph while another edits a different one loses neither intent', () => {
    const a = client(ALICE);
    const b = client(BOB);
    a.sync();
    b.sync();
    a.fragment.delete(1, 1); // delete "Second paragraph"
    b.text(2).insert(0, 'Edited: ');
    settle(a, b);
    expect(storedLines()).toEqual(['The quick brown fox', 'Edited: Third paragraph']);
  });

  it('[FR-5.3] a client that was offline for several rounds of other people\'s edits merges its own work when it reconnects', () => {
    const a = client(ALICE);
    const b = client(BOB);
    a.sync();
    b.sync();
    b.text(1).insert(0, 'offline edit; '); // Bob types but does not sync
    for (const word of ['one', 'two', 'three']) {
      a.text(0).insert(0, `${word} `);
      a.sync();
    }
    b.sync();
    a.sync();
    expect(storedLines()).toEqual(['three two one The quick brown fox', 'offline edit; Second paragraph', 'Third paragraph']);
  });

  it('[FR-5.3] applying the same update twice, or out of order, does not change the result', () => {
    const a = client(ALICE);
    a.sync();
    a.text(0).insert(0, 'X');
    const body = { stateVector: toB64(Y.encodeStateVector(a.doc)), update: toB64(Y.encodeStateAsUpdate(a.doc)) };
    svc.sync(ALICE, id, body);
    const once = storedLines();
    svc.sync(ALICE, id, body);
    svc.sync(ALICE, id, body);
    expect(storedLines()).toEqual(once);
  });
});

describe('Ownership and Sharing: access control on sync', () => {
  it('[SEC-1] a user with no access cannot read or send anything through sync', () => {
    const stranger = svc.create(ALICE, { title: 'Private' }).id;
    const x = new FakeClient(svc, BOB, stranger);
    expect(code(() => x.sync({ sendUpdate: false }))).toBe('FORBIDDEN');
    expect(code(() => x.sync())).toBe('FORBIDDEN');
  });

  it('[FR-3.6] after revocation an editor\'s sync is refused, their pending work is not applied, and the document is unchanged', () => {
    const b = client(BOB);
    b.sync();
    b.text(0).insert(0, 'late edit ');
    svc.unshare(ALICE, id, BOB);
    expect(code(() => b.sync())).toBe('FORBIDDEN');
    expect(storedLines()[0]).toBe('The quick brown fox');
    expect(b.lines()[0]).toBe('late edit The quick brown fox'); // their local text is still in their editor
  });

  it('[SEC-1] sync of a missing document is NOT_FOUND and of a malformed id is a validation error', () => {
    expect(code(() => svc.sync(ALICE, '00000000-0000-4000-8000-000000000000', {}))).toBe('NOT_FOUND');
    expect(code(() => svc.sync(ALICE, 'nope', {}))).toBe('VALIDATION_ERROR');
  });

  it('[SEC-1] a shared editor\'s changes made through sync are attributed to the same document and owner', () => {
    const b = client(BOB);
    b.sync();
    b.text(0).insert(0, 'Bob: ');
    b.sync();
    expect(svc.get(ALICE, id)).toMatchObject({ ownerId: ALICE, access: 'owner' });
    expect(storedLines()[0]).toBe('Bob: The quick brown fox');
  });
});

describe('Validation and Error Handling: sync input', () => {
  const bodyFor = (a: FakeClient, mutate: (d: Y.Doc) => void) => {
    a.sync();
    mutate(a.doc);
    return { stateVector: toB64(Y.encodeStateVector(a.doc)), update: toB64(Y.encodeStateAsUpdate(a.doc)) };
  };

  it.each([
    ['a number', { update: 5 }],
    ['an object', { update: {} }],
    ['not base64 text', { update: '%%% not base64 %%%' }],
    ['random bytes', { update: toB64(new Uint8Array([9, 9, 9, 9, 9, 200, 3, 4])) }],
    ['a bad state vector', { stateVector: toB64(new Uint8Array([255, 255, 255, 255, 255, 255])) }],
    ['a state vector that is not a string', { stateVector: 7 }],
  ])('[NFR-VAL] %s is rejected with a validation error and nothing changes', (_l, input) => {
    const before = svc.get(ALICE, id);
    expect(code(() => svc.sync(ALICE, id, input as never))).toBe('VALIDATION_ERROR');
    expect(svc.get(ALICE, id)).toEqual(before);
  });

  it('[NFR-VAL] an update that would put a disallowed element in the document is refused and the stored document is untouched', () => {
    const a = client(ALICE);
    const evil = bodyFor(a, (d) => {
      const el = new Y.XmlElement('codeBlock');
      el.insert(0, [new Y.XmlText('rm -rf /')]);
      d.getXmlFragment('default').insert(0, [el]);
    });
    const before = svc.get(ALICE, id);
    expect(code(() => svc.sync(ALICE, id, evil))).toBe('VALIDATION_ERROR');
    expect(svc.get(ALICE, id).content).toEqual(before.content);
    expect(svc.get(ALICE, id).updatedAt).toBe(before.updatedAt);
  });

  it('[NFR-VAL] a disallowed mark, such as a link, is refused and does not reach other users', () => {
    const a = client(ALICE);
    const b = client(BOB);
    const evil = bodyFor(a, (d) => (d.getXmlFragment('default').get(0) as Y.XmlElement).get(0) instanceof Y.XmlText &&
      ((d.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText).format(0, 3, { link: { href: 'javascript:alert(1)' } }));
    expect(code(() => svc.sync(ALICE, id, evil))).toBe('VALIDATION_ERROR');
    b.sync();
    expect(JSON.stringify(svc.get(BOB, id).content)).not.toContain('link');
  });

  it('[NFR-VAL] an update that breaks the document structure (a heading with an invalid level) is refused', () => {
    const a = client(ALICE);
    const bad = bodyFor(a, (d) => {
      const h = new Y.XmlElement('heading');
      h.setAttribute('level', 9 as never);
      h.insert(0, [new Y.XmlText('x')]);
      d.getXmlFragment('default').insert(0, [h]);
    });
    expect(code(() => svc.sync(ALICE, id, bad))).toBe('VALIDATION_ERROR');
    expect(storedLines()[0]).toBe('The quick brown fox');
  });

  it('[NFR-VAL] an update that makes the document larger than the size limit is refused', () => {
    const a = client(ALICE);
    const huge = bodyFor(a, (d) => (d.getXmlFragment('default').get(0) as Y.XmlElement).get(0) instanceof Y.XmlText &&
      ((d.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'x'.repeat(1_100_000)));
    expect(code(() => svc.sync(ALICE, id, huge))).toBe('VALIDATION_ERROR');
    expect(storedLines()[0]).toBe('The quick brown fox');
  });

  it('[NFR-ERR] a refused update does not poison later syncs: a valid edit afterwards is accepted', () => {
    const a = client(ALICE);
    const evil = bodyFor(a, (d) => d.getXmlFragment('default').insert(0, [new Y.XmlElement('script')]));
    expect(code(() => svc.sync(ALICE, id, evil))).toBe('VALIDATION_ERROR');
    const b = client(BOB);
    b.sync();
    b.text(0).insert(0, 'fine ');
    b.sync();
    expect(storedLines()[0]).toBe('fine The quick brown fox');
  });
});

describe('Collaboration: other ways of changing a document stay consistent', () => {
  it('[FR-5.4] saving content through the normal API replaces the shared document, and connected clients converge on it', () => {
    const a = client(ALICE);
    const b = client(BOB);
    a.sync();
    b.sync();
    svc.saveContent(CAROL, id, doc(p(para('Replaced by the API'))));
    a.sync({ sendUpdate: false });
    b.sync({ sendUpdate: false });
    expect(a.lines()).toEqual(['Replaced by the API']);
    expect(b.lines()).toEqual(['Replaced by the API']);
    expect(storedLines()).toEqual(['Replaced by the API']);
  });

  it('[FR-5.4] after content is replaced through the API, collaborative edits continue to merge on top of it', () => {
    const a = client(ALICE);
    a.sync();
    svc.saveContent(ALICE, id, doc(p(para('fresh start'))));
    a.sync();
    const b = client(BOB);
    b.sync();
    a.text(0).insert(0, 'A ');
    b.text(0).insert(b.text(0).length, ' B');
    settle(a, b);
    expect(storedLines()).toEqual(['A fresh start B']);
  });

  it('[FR-5.4] content saved through the API before anyone has synced is what the first client receives', () => {
    svc.saveContent(ALICE, id, doc(p(para('api first'))));
    const a = client(BOB);
    a.sync();
    expect(a.lines()).toEqual(['api first']);
  });

  it('[FR-5.4] invalid content through the API is still refused and leaves the shared document alone', () => {
    const a = client(ALICE);
    a.sync();
    expect(code(() => svc.saveContent(ALICE, id, { type: 'doc', content: [{ type: 'script' }] }))).toBe('VALIDATION_ERROR');
    a.sync({ sendUpdate: false });
    expect(a.lines()[0]).toBe('The quick brown fox');
  });

  it('[FR-5.4] an imported document starts collaborating like any other', () => {
    const imported = svc.importFile(ALICE, 'notes.md', Buffer.from('# Heading\n\nbody text'));
    svc.share(ALICE, imported.id, BOB);
    const a = new FakeClient(svc, ALICE, imported.id);
    const b = new FakeClient(svc, BOB, imported.id);
    settle(a, b);
    expect(a.lines()).toEqual(['Heading', 'body text']);
    a.text(1).insert(0, 'A:');
    b.text(0).insert(0, 'B:');
    settle(a, b);
    expect(svc.get(ALICE, imported.id).content).toMatchObject({ content: [{ type: 'heading', attrs: { level: 1 } }, { type: 'paragraph' }] });
    expect(a.lines()).toEqual(['B:Heading', 'A:body text']);
  });
});

describe('Persistence: collaborative state survives a restart', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ajaia-collab-'));
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('[FR-5.5][FR-4.1] after the database is closed and reopened, a returning client merges its old edits with the stored state', () => {
    // Uses an on-disk database so close/reopen is real.
    const dbFile = join(tmpDir, 'collab.db');
    const db1 = freshDb(dbFile);
    const s1 = createDocumentService(db1, steppingClock());
    const docId = s1.create(ALICE, { title: 'Persist', content: doc(p(para('base text'))) }).id;
    s1.share(ALICE, docId, BOB);
    const a = new FakeClient(s1, ALICE, docId);
    const b = new FakeClient(s1, BOB, docId);
    settle(a, b);
    a.text(0).insert(0, 'A:');
    a.sync();
    b.text(0).insert(b.text(0).length, ':B'); // Bob's edit is pending when the server restarts
    db1.close();

    const db2 = freshDb(dbFile);
    const s2 = createDocumentService(db2, steppingClock());
    const a2 = new FakeClient(s2, ALICE, docId);
    const bAfter = new FakeClient(s2, BOB, docId);
    Y.applyUpdate(bAfter.doc, Y.encodeStateAsUpdate(b.doc)); // Bob's browser still holds its state
    settle(a2, bAfter);
    expect(a2.lines()).toEqual(['A:base text:B']);
    expect(s2.get(ALICE, docId).content).toMatchObject({ content: [{ content: [{ text: 'A:base text:B' }] }] });
    db2.close();
  });

  it('[FR-5.5] the shared state is stored in the database, and a corrupt blob is reported rather than silently replaced', () => {
    const a = client(ALICE);
    a.sync();
    a.text(0).insert(0, 'x');
    a.sync();
    const row = db.prepare('SELECT ydoc FROM documents WHERE id = ?').get(id) as { ydoc: Uint8Array };
    expect(row.ydoc.length).toBeGreaterThan(10);
    expect(() => Y.applyUpdate(new Y.Doc(), fromB64(toB64(row.ydoc)))).not.toThrow();

    db.prepare('UPDATE documents SET ydoc = ? WHERE id = ?').run(new Uint8Array([1, 2, 3]), id);
    expect(code(() => a.sync())).toBe('INTERNAL_ERROR');
    expect(storedLines()[0]).toBe('xThe quick brown fox'); // the readable JSON copy is not lost
  });
});
