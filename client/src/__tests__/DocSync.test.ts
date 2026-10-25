import * as Y from 'yjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocSync, type SyncStatus } from '../sync/DocSync';
import { FakeServer } from './syncServer';

const textOf = (sync: DocSync) => ((sync.ydoc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText);
const typeInto = (sync: DocSync, s: string, at = 0) => textOf(sync).insert(at, s);
const error = (message: string, status?: number) => Object.assign(new Error(message), { status });

let server: FakeServer;
let statuses: SyncStatus[];
const make = (opts: Partial<ConstructorParameters<typeof DocSync>[1]> = {}) =>
  new DocSync(server.transport, { pollMs: 2000, debounceMs: 800, onStatus: (s) => statuses.push(s), ...opts });

beforeEach(() => {
  vi.useFakeTimers();
  server = new FakeServer();
  statuses = [];
});
afterEach(() => vi.useRealTimers());

describe('Autosave and Sync (client): loading', () => {
  it('[FR-5.1] the first sync loads the document, marks it ready and reports the title', async () => {
    const onMeta = vi.fn();
    const sync = make({ onMeta });
    expect(sync.currentStatus).toEqual({ kind: 'connecting' });
    expect(sync.isReady).toBe(false);
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.isReady).toBe(true);
    expect(textOf(sync).toString()).toBe('hello');
    expect(sync.currentStatus).toEqual({ kind: 'saved' });
    expect(onMeta).toHaveBeenCalledWith({ title: 'Doc', updatedAt: '2026-01-01T00:00:00.000Z' });
    expect(server.calls[0]!.update).toBeUndefined(); // nothing to send yet
    sync.stop();
  });

  it('[FR-5.1] loading the document does not make it look unsaved', async () => {
    const sync = make();
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.hasUnsavedChanges).toBe(false);
    expect(statuses.map((s) => s.kind)).not.toContain('dirty');
    sync.stop();
  });
});

describe('Autosave and Sync (client): saving your own changes', () => {
  it('[FR-5.2] typing shows "dirty" immediately, saves after the debounce, then shows "saved"', async () => {
    const sync = make({ pollMs: 0 });
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    typeInto(sync, 'A: ');
    expect(sync.currentStatus).toEqual({ kind: 'dirty' });
    expect(sync.hasUnsavedChanges).toBe(true);
    await vi.advanceTimersByTimeAsync(799);
    expect(server.text()).toBe('hello'); // not yet
    await vi.advanceTimersByTimeAsync(2);
    expect(server.text()).toBe('A: hello');
    expect(sync.currentStatus).toEqual({ kind: 'saved' });
    expect(sync.hasUnsavedChanges).toBe(false);
    expect(statuses.map((s) => s.kind)).toEqual(['saved', 'dirty', 'saving', 'saved']);
    sync.stop();
  });

  it('[FR-5.2] each new keystroke restarts the debounce, so a burst of typing is one save', async () => {
    const sync = make({ pollMs: 0 });
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    for (const ch of 'abc') {
      typeInto(sync, ch);
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(server.calls.filter((c) => c.update)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(400);
    expect(server.calls.filter((c) => c.update)).toHaveLength(1);
    expect(server.text()).toBe('cbahello');
    sync.stop();
  });

  it('[FR-5.2] continuous typing is still saved at least every poll interval', async () => {
    const sync = make({ pollMs: 2000, debounceMs: 800 });
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < 20; i++) {
      typeInto(sync, 'x'); // a keystroke every 300 ms: the debounce never gets a quiet moment
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(server.text().startsWith('x'.repeat(10))).toBe(true); // most of it saved while still typing
    expect(server.calls.filter((c) => c.update).length).toBeGreaterThanOrEqual(2);
    sync.stop();
  });

  it('[FR-5.2] a poll with nothing to save sends no update, just the state vector', async () => {
    const sync = make();
    sync.start();
    await vi.advanceTimersByTimeAsync(6000);
    expect(server.calls.length).toBeGreaterThanOrEqual(3);
    expect(server.calls.every((c) => c.update === undefined)).toBe(true);
    sync.stop();
  });

  it('[FR-5.2] the Save button (syncNow) saves immediately without waiting for the debounce', async () => {
    const sync = make({ pollMs: 0 });
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    typeInto(sync, 'now ');
    await sync.syncNow();
    expect(server.text()).toBe('now hello');
    expect(sync.currentStatus).toEqual({ kind: 'saved' });
    sync.stop();
  });

  it('[FR-5.2] typing while a save is in flight is not lost: it is saved right after', async () => {
    const sync = make({ pollMs: 0 });
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    let release!: () => void;
    server.hold = new Promise<void>((r) => (release = r));
    typeInto(sync, 'one ');
    await vi.advanceTimersByTimeAsync(800); // save starts and waits on the held response
    typeInto(sync, 'two ');
    server.hold = null;
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.hasUnsavedChanges).toBe(true);
    expect(sync.currentStatus).toEqual({ kind: 'dirty' });
    await vi.advanceTimersByTimeAsync(900);
    expect(server.text()).toBe('two one hello');
    expect(sync.hasUnsavedChanges).toBe(false);
    sync.stop();
  });

  it('[FR-5.2] overlapping syncNow calls share one round trip instead of piling up', async () => {
    const sync = make({ pollMs: 0 });
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    const before = server.calls.length;
    typeInto(sync, 'x');
    await Promise.all([sync.syncNow(), sync.syncNow(), sync.syncNow()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(server.calls.length - before).toBeLessThanOrEqual(2);
    expect(server.text()).toBe('xhello');
    sync.stop();
  });
});

describe('Autosave and Sync (client): receiving other people\'s changes', () => {
  it('[FR-5.3] a poll picks up a change made elsewhere and applies it to the live document without calling it unsaved', async () => {
    const sync = make();
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    server.editElsewhere((t) => t.insert(5, ' world'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(textOf(sync).toString()).toBe('hello world');
    expect(sync.hasUnsavedChanges).toBe(false);
    expect(sync.currentStatus).toEqual({ kind: 'saved' });
    expect(server.calls.every((c) => c.update === undefined)).toBe(true); // a remote change is never echoed back
    sync.stop();
  });

  it('[FR-5.3] a remote title change is reported', async () => {
    const onMeta = vi.fn();
    const sync = make({ onMeta });
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    server.title = 'Renamed elsewhere';
    await vi.advanceTimersByTimeAsync(2000);
    expect(onMeta).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Renamed elsewhere' }));
    sync.stop();
  });

  it('[FR-5.3] two browsers typing at the same time converge on a document with both people\'s text', async () => {
    const a = make({ onStatus: undefined });
    const b = make({ onStatus: undefined });
    a.start();
    b.start();
    await vi.advanceTimersByTimeAsync(0);
    typeInto(a, 'Alice: ');
    typeInto(b, ' (Bob)', textOf(b).length);
    await vi.advanceTimersByTimeAsync(4000);
    expect(server.text()).toBe('Alice: hello (Bob)');
    expect(textOf(a).toString()).toBe('Alice: hello (Bob)');
    expect(textOf(b).toString()).toBe('Alice: hello (Bob)');
    a.stop();
    b.stop();
  });
});

describe('Autosave and Sync (client): failures', () => {
  it('[NFR-ERR] a failed save reports the error, keeps the change as unsaved, retries on the next tick, and loses nothing', async () => {
    const sync = make();
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    server.failWith = error('Cannot reach the server');
    typeInto(sync, 'precious ');
    await vi.advanceTimersByTimeAsync(800);
    expect(sync.currentStatus).toEqual({ kind: 'error', message: 'Cannot reach the server', fatal: false });
    expect(sync.hasUnsavedChanges).toBe(true);
    expect(textOf(sync).toString()).toBe('precious hello');

    server.failWith = null;
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.text()).toBe('precious hello');
    expect(sync.currentStatus).toEqual({ kind: 'saved' });
    expect(sync.hasUnsavedChanges).toBe(false);
    sync.stop();
  });

  it('[NFR-ERR] changes made during an outage are all sent together once the server is back', async () => {
    const sync = make();
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    server.failWith = error('Cannot reach the server');
    for (const word of ['one ', 'two ', 'three ']) {
      typeInto(sync, word);
      await vi.advanceTimersByTimeAsync(2500);
    }
    expect(server.text()).toBe('hello');
    server.failWith = null;
    await vi.advanceTimersByTimeAsync(2000);
    expect(server.text()).toBe('three two one hello');
    sync.stop();
  });

  it.each([401, 403, 404])('[FR-3.6] a %i response is fatal: polling stops, the error is shown, and the typed text stays', async (status) => {
    const sync = make();
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    server.failWith = error('You do not have permission to perform this action on this document', status);
    typeInto(sync, 'still here ');
    await vi.advanceTimersByTimeAsync(800);
    expect(sync.currentStatus).toEqual({ kind: 'error', message: 'You do not have permission to perform this action on this document', fatal: true });
    const calls = server.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(server.calls.length).toBe(calls); // no more requests
    expect(textOf(sync).toString()).toBe('still here hello');
    sync.stop();
  });

  it('[FR-3.6] after a fatal error the Save button tries once more, and polling resumes if it works', async () => {
    const sync = make();
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    server.failWith = error('Forbidden', 403);
    typeInto(sync, 'x');
    await vi.advanceTimersByTimeAsync(800);
    const calls = server.calls.length;
    await sync.syncNow();
    expect(server.calls.length).toBe(calls + 1);
    expect(sync.currentStatus).toMatchObject({ kind: 'error', fatal: true });

    server.failWith = null;
    await sync.syncNow();
    expect(sync.currentStatus).toEqual({ kind: 'saved' });
    const after = server.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(server.calls.length).toBeGreaterThan(after);
    sync.stop();
  });

  it('[NFR-ERR] a failed first load reports the error and the document stays not ready, so nothing can be typed over it', async () => {
    server.failWith = error('Cannot reach the server');
    const sync = make();
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.isReady).toBe(false);
    expect(sync.currentStatus).toMatchObject({ kind: 'error' });
    server.failWith = null;
    await vi.advanceTimersByTimeAsync(2000);
    expect(sync.isReady).toBe(true);
    expect(textOf(sync).toString()).toBe('hello');
    sync.stop();
  });
});

describe('Autosave and Sync (client): leaving the page', () => {
  it('[FR-5.2] flushAndStop saves unsaved changes before stopping', async () => {
    const sync = make();
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    typeInto(sync, 'last words ');
    await sync.flushAndStop();
    expect(server.text()).toBe('last words hello');
    const calls = server.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls.length).toBe(calls); // fully stopped
  });

  it('[FR-5.2] stop() cancels pending saves and polls', async () => {
    const sync = make();
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    typeInto(sync, 'x');
    sync.stop();
    const calls = server.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(server.calls.length).toBe(calls);
    expect(server.text()).toBe('hello');
  });

  it('[FR-5.2] restarting while a flush is still running does not stop the restarted sync', async () => {
    const sync = make();
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    typeInto(sync, 'x');
    let release!: () => void;
    server.hold = new Promise<void>((r) => (release = r));
    const flushing = sync.flushAndStop();
    sync.stop();
    sync.start(); // as React StrictMode does in development
    server.hold = null;
    release();
    await flushing;
    const calls = server.calls.length;
    await vi.advanceTimersByTimeAsync(4000);
    expect(server.calls.length).toBeGreaterThan(calls); // still polling
    sync.stop();
  });

  it('[FR-5.2] a response that arrives after stop() is ignored', async () => {
    const sync = make({ pollMs: 0 });
    let release!: () => void;
    server.hold = new Promise<void>((r) => (release = r));
    sync.start();
    sync.stop();
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(sync.ydoc.getXmlFragment('default').length).toBe(0); // the late response was not applied
    expect(sync.isReady).toBe(false);
  });
});

describe('Autosave and Sync (client): large documents', () => {
  it('[FR-5.2] a large edit is encoded and sent intact', async () => {
    const sync = make({ pollMs: 0 });
    sync.start();
    await vi.advanceTimersByTimeAsync(0);
    const big = 'lorem ipsum '.repeat(20_000);
    typeInto(sync, big);
    await sync.syncNow();
    expect(server.text()).toBe(big + 'hello');
    sync.stop();
  });
});
