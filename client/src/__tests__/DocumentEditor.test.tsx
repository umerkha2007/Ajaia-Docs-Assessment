import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useReducer } from 'react';
import * as Y from 'yjs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DocumentEditor } from '../DocumentEditor';
import { SessionContext } from '../session';
import { stubApi, summary } from './fakeApi';
import { FakeServer } from './syncServer';

// DocumentEditor is tested here for its own behaviour: loading, autosave and its status text,
// receiving other people's changes, renaming, and what it shows for each kind of access.
// jsdom cannot drive real typing in ProseMirror, so a stand-in editor (a text box wired to the
// shared document) replaces it. The real Tiptap editor is tested in RichTextEditor.test.tsx and
// editorContract.test.ts, and in the browser by the end-to-end tests.
vi.mock('../editor/RichTextEditor', () => ({
  RichTextEditor: ({ ydoc, editable }: { ydoc: Y.Doc; editable: boolean }) => {
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      ydoc.on('update', rerender);
      return () => ydoc.off('update', rerender);
    }, [ydoc]);
    const fragment = ydoc.getXmlFragment('default');
    const paragraph = fragment.get(0) as Y.XmlElement | undefined;
    const text = (paragraph?.get(0) as Y.XmlText | undefined)?.toString() ?? '';
    return (
      <textarea
        aria-label="Document content"
        disabled={!editable}
        value={text}
        onChange={(e) =>
          ydoc.transact(() => {
            let p = fragment.get(0) as Y.XmlElement | undefined;
            if (!p) {
              p = new Y.XmlElement('paragraph');
              fragment.insert(0, [p]);
            }
            if (!p.get(0)) p.insert(0, [new Y.XmlText('')]);
            const t = p.get(0) as Y.XmlText;
            t.delete(0, t.length);
            t.insert(0, e.target.value);
          })
        }
      />
    );
  },
}));

afterEach(() => vi.unstubAllGlobals());

const FAST = { pollMs: 0, debounceMs: 20 };
const metaResponse = (over = {}) => ({
  json: { document: { ...summary({ id: 'd1', title: 'My Doc' }), ownerName: 'Alice Anderson', access: 'editor', content: { type: 'doc' }, ...over } },
});

/** Stub the document, the sync endpoint (backed by a FakeServer), and anything else the test adds. */
function setup(server = new FakeServer(), extra: Parameters<typeof stubApi>[0] = {}, meta = {}) {
  const api = stubApi({
    'GET /api/documents/d1': () => metaResponse(meta),
    'POST /api/documents/d1/sync': (body) => {
      try {
        return { json: server.respond(body as never) };
      } catch (e) {
        const err = e as Error & { status?: number };
        return { status: err.status ?? 500, json: { error: 'X', message: err.message } };
      }
    },
    ...extra,
  });
  return { server, api };
}
const syncCalls = (api: ReturnType<typeof stubApi>) => api.mock.calls.filter(([url]) => String(url).endsWith('/sync'));
const status = () => screen.getByTestId('save-status');

describe('Autosave and Sync (UI): loading the document', () => {
  it('[FR-5.1] shows the loaded title and the shared text, and only becomes editable once the first sync has finished', async () => {
    let release!: () => void;
    const server = new FakeServer('First line');
    const gate = new Promise<void>((r) => (release = r));
    const { api } = setup(server);
    // Hold the first sync response until released.
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/sync')) await gate;
      return original(url, init);
    });
    render(<DocumentEditor id="d1" syncOptions={FAST} />);
    expect(await screen.findByLabelText('Document title')).toHaveValue('My Doc');
    expect(status()).toHaveTextContent('Loading document…');
    expect(screen.getByLabelText('Document content')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    release();
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    expect(screen.getByLabelText('Document content')).toBeEnabled();
    expect(screen.getByLabelText('Document content')).toHaveValue('First line');
  });

  it.each([
    ['missing', 404, 'NOT_FOUND', 'Document not found'],
    ['not permitted', 403, 'FORBIDDEN', 'You do not have permission to perform this action on this document'],
  ])('[NFR-ERR] shows a clear message and a way back when the document is %s, and never starts syncing', async (_l, statusCode, error, message) => {
    const api = stubApi({ 'GET /api/documents/d1': () => ({ status: statusCode, json: { error, message } }) });
    render(<DocumentEditor id="d1" syncOptions={FAST} />);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('link', { name: 'Back to documents' })).toHaveAttribute('href', '#/');
    expect(screen.queryByLabelText('Document content')).not.toBeInTheDocument();
    expect(syncCalls(api)).toHaveLength(0);
  });
});

describe('Autosave and Sync (UI): saving automatically', () => {
  it('[FR-5.2] typing shows "Unsaved changes", then saves by itself and shows "All changes saved", with no button press', async () => {
    const { server, api } = setup(new FakeServer('start'));
    render(<DocumentEditor id="d1" syncOptions={{ pollMs: 0, debounceMs: 300 }} />);
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'start, and more' } });
    expect(status()).toHaveTextContent('Unsaved changes');
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    expect(server.text()).toBe('start, and more');
    expect(syncCalls(api).some(([, init]) => JSON.parse(init!.body as string).update)).toBe(true);
  });

  it('[FR-5.2] the Save button saves immediately instead of waiting for the delay', async () => {
    const { server } = setup(new FakeServer('start'));
    render(<DocumentEditor id="d1" syncOptions={{ pollMs: 0, debounceMs: 60_000 }} />);
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'saved now' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(server.text()).toBe('saved now'));
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
  });

  it('[NFR-ERR] a failed autosave says so, keeps the typed text, and saves it by itself once the server is back', async () => {
    const { server } = setup(new FakeServer('start'));
    render(<DocumentEditor id="d1" syncOptions={{ pollMs: 40, debounceMs: 10 }} />);
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    server.failWith = Object.assign(new Error('Unexpected server error'), { status: 500 });
    fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'precious words' } });
    await waitFor(() => expect(status()).toHaveTextContent('Save failed: Unexpected server error. Your changes are kept in the editor and will be retried.'));
    expect(screen.getByLabelText('Document content')).toHaveValue('precious words');
    server.failWith = null;
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    expect(server.text()).toBe('precious words');
  });

  it('[FR-3.6] if access is removed while editing, the next save says so, the text stays visible but can no longer be edited, and nothing more is sent', async () => {
    const { server, api } = setup(new FakeServer('start'));
    render(<DocumentEditor id="d1" syncOptions={{ pollMs: 30, debounceMs: 10 }} />);
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    server.failWith = Object.assign(new Error('You do not have permission to perform this action on this document'), { status: 403 });
    fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'my last edit' } });
    await waitFor(() => expect(status()).toHaveTextContent('Save failed: You do not have permission'));
    expect(status()).toHaveTextContent('can no longer be saved here');
    expect(screen.getByLabelText('Document content')).toHaveValue('my last edit');
    expect(screen.getByLabelText('Document content')).toBeDisabled();
    const calls = syncCalls(api).length;
    await new Promise((r) => setTimeout(r, 200));
    expect(syncCalls(api).length).toBe(calls);
  });

  it('[FR-5.2] typing right before leaving the screen is saved, not dropped', async () => {
    const { server } = setup(new FakeServer('start'));
    const view = render(<DocumentEditor id="d1" syncOptions={{ pollMs: 0, debounceMs: 60_000 }} />);
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'typed just before leaving' } });
    view.unmount();
    await waitFor(() => expect(server.text()).toBe('typed just before leaving'));
  });

  it('[FR-5.2] closing or reloading the tab with unsaved changes asks for confirmation; with everything saved it does not', async () => {
    setup(new FakeServer('start'));
    render(<DocumentEditor id="d1" syncOptions={{ pollMs: 0, debounceMs: 60_000 }} />);
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    const saved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);

    fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'unsaved' } });
    const unsaved = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(unsaved);
    expect(unsaved.defaultPrevented).toBe(true);
  });
});

describe('Autosave and Sync (UI): other people\'s changes', () => {
  it('[FR-5.3] a change made by someone else appears on its own within a poll, without touching Save', async () => {
    const { server } = setup(new FakeServer('shared text'));
    render(<DocumentEditor id="d1" syncOptions={{ pollMs: 40, debounceMs: 10 }} />);
    await waitFor(() => expect(screen.getByLabelText('Document content')).toHaveValue('shared text'));
    server.editElsewhere((t) => t.insert(0, 'Bob wrote: '));
    await waitFor(() => expect(screen.getByLabelText('Document content')).toHaveValue('Bob wrote: shared text'));
    expect(status()).toHaveTextContent('All changes saved'); // receiving is not "unsaved"
  });

  it('[FR-5.3] your own unsaved typing and someone else\'s change end up in the same document', async () => {
    const { server } = setup(new FakeServer('base'));
    render(<DocumentEditor id="d1" syncOptions={{ pollMs: 40, debounceMs: 10 }} />);
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    server.editElsewhere((t) => t.insert(t.length, ' + Bob'));
    fireEvent.change(screen.getByLabelText('Document content'), { target: { value: 'Alice: base' } });
    await waitFor(() => expect(server.text()).toContain('Alice'));
    await waitFor(() => expect(server.text()).toContain('+ Bob'));
    await waitFor(() => expect(screen.getByLabelText('Document content')).toHaveValue(server.text()));
  });

  it('[FR-5.3] a rename by someone else updates the title field, unless you are typing in it', async () => {
    const { server } = setup(new FakeServer('x'));
    render(<DocumentEditor id="d1" syncOptions={{ pollMs: 40, debounceMs: 10 }} />);
    await waitFor(() => expect(status()).toHaveTextContent('All changes saved'));
    server.title = 'Renamed by Bob';
    await waitFor(() => expect(screen.getByLabelText('Document title')).toHaveValue('Renamed by Bob'));

    const input = screen.getByLabelText('Document title');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'My half-typed title' } });
    server.title = 'Renamed again';
    await new Promise((r) => setTimeout(r, 150));
    expect(input).toHaveValue('My half-typed title'); // not overwritten while focused
  });
});

describe('Document CRUD (UI): rename', () => {
  it('[FR-1.2] leaving the title field sends the new title and shows the server value', async () => {
    const { api } = setup(new FakeServer(), {
      'PATCH /api/documents/d1': (body) => metaResponse({ title: (body as { title: string }).title.trim() }),
    });
    render(<DocumentEditor id="d1" syncOptions={FAST} />);
    const input = await screen.findByLabelText('Document title');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '  Renamed  ' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByLabelText('Document title')).toHaveValue('Renamed'));
    const patch = api.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ title: '  Renamed  ' });
  });

  it('[FR-1.2] does not call the API when the title is unchanged', async () => {
    const { api } = setup();
    render(<DocumentEditor id="d1" syncOptions={FAST} />);
    fireEvent.blur(await screen.findByLabelText('Document title'));
    expect(api.mock.calls.some(([, init]) => init?.method === 'PATCH')).toBe(false);
  });

  it('[NFR-VAL] an invalid title shows the server validation message', async () => {
    setup(new FakeServer(), {
      'PATCH /api/documents/d1': () => ({ status: 400, json: { error: 'VALIDATION_ERROR', message: 'Title must not be empty' } }),
    });
    render(<DocumentEditor id="d1" syncOptions={FAST} />);
    const input = await screen.findByLabelText('Document title');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(await screen.findByRole('alert')).toHaveTextContent('Title must not be empty');
  });
});

describe('Ownership and Sharing (UI): what the editor page shows', () => {
  const alice = { id: 'user-alice', name: 'Alice Anderson', email: 'alice@example.test' };
  const bob = { id: 'user-bob', name: 'Bob Brown', email: 'bob@example.test' };
  const inSession = (user: typeof alice) => (
    <SessionContext.Provider value={{ user, users: [alice, bob] }}>
      <DocumentEditor id="d1" syncOptions={FAST} />
    </SessionContext.Provider>
  );

  it('[FR-3.5] the owner is told they own the document and gets the sharing panel', async () => {
    setup(new FakeServer(), { 'GET /api/documents/d1/shares': () => ({ json: { shares: [] } }) }, { access: 'owner' });
    render(inSession(alice));
    expect(await screen.findByTestId('access-note')).toHaveTextContent('You own this document.');
    expect(await screen.findByRole('heading', { name: 'Sharing' })).toBeInTheDocument();
  });

  it('[FR-3.4][FR-3.5] a shared editor is told who owns the document, can edit it, and sees no sharing panel and makes no sharing requests', async () => {
    const { api } = setup(new FakeServer(), {}, { access: 'editor', ownerName: 'Alice Anderson' });
    render(inSession(bob));
    expect(await screen.findByTestId('access-note')).toHaveTextContent('Shared by Alice Anderson. You can edit this document.');
    await waitFor(() => expect(screen.getByLabelText('Document content')).toBeEnabled());
    expect(screen.getByLabelText('Document title')).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Sharing' })).not.toBeInTheDocument();
    expect(api.mock.calls.some(([url]) => String(url).includes('/shares'))).toBe(false);
  });
});
