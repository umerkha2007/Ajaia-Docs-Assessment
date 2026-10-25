import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocJson } from '../api';
import { DocumentEditor } from '../DocumentEditor';
import { SessionContext } from '../session';
import { stubApi, summary, textDoc } from './fakeApi';

// DocumentEditor is tested here for its own behaviour (loading, dirty/saved/failed
// states, what it sends on save, rename). jsdom cannot drive real typing in
// ProseMirror, so a stand-in editor replaces it. The real Tiptap editor is tested in
// RichTextEditor.test.tsx and editorContract.test.ts, and in the browser by e2e.
vi.mock('../editor/RichTextEditor', () => ({
  RichTextEditor: ({ content, onChange, onEditor }: { content: DocJson; onChange: (j: DocJson) => void; onEditor: (e: unknown) => void }) => {
    const lines = (content.content as { content?: { text: string }[] }[]).map((n) => n.content?.[0]?.text ?? '');
    const [text, setText] = useState(lines.join('\n'));
    useEffect(() => {
      onEditor({ getJSON: () => textDoc(...text.split('\n')) });
    }, [text, onEditor]);
    return (
      <textarea
        aria-label="Document content"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(textDoc(...e.target.value.split('\n')) as DocJson);
        }}
      />
    );
  },
}));

afterEach(() => vi.unstubAllGlobals());

const docResponse = (over = {}, content = textDoc('Hello')) => ({
  json: { document: { ...summary({ id: 'd1', title: 'My Doc' }), ownerName: 'Alice Anderson', access: 'editor', content, ...over } },
});

describe('Document CRUD (UI): reopen and edit', () => {
  it('[FR-1.4] loads the saved title and content into the editor', async () => {
    stubApi({ 'GET /api/documents/d1': () => docResponse({}, textDoc('First', '', 'Third')) });
    render(<DocumentEditor id="d1" />);
    expect(await screen.findByLabelText('Document title')).toHaveValue('My Doc');
    expect(screen.getByLabelText('Document content')).toHaveValue('First\n\nThird');
    expect(screen.getByTestId('save-status')).toHaveTextContent('All changes saved');
  });

  it('[FR-1.3] typing marks the document unsaved; Save sends the content and reports saved', async () => {
    const api = stubApi({
      'GET /api/documents/d1': () => docResponse(),
      'PUT /api/documents/d1/content': () => docResponse(),
    });
    render(<DocumentEditor id="d1" />);
    const box = await screen.findByLabelText('Document content');
    fireEvent.change(box, { target: { value: 'Edited\nbody' } });
    expect(screen.getByTestId('save-status')).toHaveTextContent('Unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent('All changes saved'));
    const put = api.mock.calls.find(([, init]) => init?.method === 'PUT')!;
    expect(JSON.parse(put[1]!.body as string)).toEqual({ content: textDoc('Edited', 'body') });
  });

  it('[NFR-ERR] a failed save shows the error and keeps the typed text in the editor', async () => {
    stubApi({
      'GET /api/documents/d1': () => docResponse(),
      'PUT /api/documents/d1/content': () => ({ status: 500, json: { error: 'INTERNAL_ERROR', message: 'Unexpected server error' } }),
    });
    render(<DocumentEditor id="d1" />);
    const box = await screen.findByLabelText('Document content');
    fireEvent.change(box, { target: { value: 'precious words' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent('Save failed: Unexpected server error'));
    expect(screen.getByLabelText('Document content')).toHaveValue('precious words');
  });
});

describe('Document CRUD (UI): rename', () => {
  it('[FR-1.2] leaving the title field sends the new title and shows the server value', async () => {
    const api = stubApi({
      'GET /api/documents/d1': () => docResponse(),
      'PATCH /api/documents/d1': (body) => docResponse({ title: (body as { title: string }).title.trim() }),
    });
    render(<DocumentEditor id="d1" />);
    const input = await screen.findByLabelText('Document title');
    fireEvent.change(input, { target: { value: '  Renamed  ' } });
    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByLabelText('Document title')).toHaveValue('Renamed'));
    const patch = api.mock.calls.find(([, init]) => init?.method === 'PATCH')!;
    expect(JSON.parse(patch[1]!.body as string)).toEqual({ title: '  Renamed  ' });
  });

  it('[FR-1.2] does not call the API when the title is unchanged', async () => {
    const api = stubApi({ 'GET /api/documents/d1': () => docResponse() });
    render(<DocumentEditor id="d1" />);
    fireEvent.blur(await screen.findByLabelText('Document title'));
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('[NFR-VAL] an invalid title shows the server validation message', async () => {
    stubApi({
      'GET /api/documents/d1': () => docResponse(),
      'PATCH /api/documents/d1': () => ({ status: 400, json: { error: 'VALIDATION_ERROR', message: 'Title must not be empty' } }),
    });
    render(<DocumentEditor id="d1" />);
    const input = await screen.findByLabelText('Document title');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.blur(input);
    expect(await screen.findByRole('alert')).toHaveTextContent('Title must not be empty');
  });
});

describe('Validation and Error Handling (UI): opening documents', () => {
  it.each([
    ['missing', 404, 'NOT_FOUND', 'Document not found'],
    ['not permitted', 403, 'FORBIDDEN', 'You do not have permission to perform this action on this document'],
  ])('[NFR-ERR] shows a clear message and a way back when the document is %s', async (_l, status, error, message) => {
    stubApi({ 'GET /api/documents/d1': () => ({ status, json: { error, message } }) });
    render(<DocumentEditor id="d1" />);
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.getByRole('link', { name: 'Back to documents' })).toHaveAttribute('href', '#/');
    expect(screen.queryByLabelText('Document content')).not.toBeInTheDocument();
  });
});

describe('Ownership and Sharing (UI): what the editor page shows', () => {
  const alice = { id: 'user-alice', name: 'Alice Anderson', email: 'alice@example.test' };
  const bob = { id: 'user-bob', name: 'Bob Brown', email: 'bob@example.test' };
  const inSession = (user: typeof alice) => (
    <SessionContext.Provider value={{ user, users: [alice, bob] }}>
      <DocumentEditor id="d1" />
    </SessionContext.Provider>
  );

  it('[FR-3.5] the owner is told they own the document and gets the sharing panel', async () => {
    stubApi({
      'GET /api/documents/d1': () => docResponse({ access: 'owner' }),
      'GET /api/documents/d1/shares': () => ({ json: { shares: [] } }),
    });
    render(inSession(alice));
    expect(await screen.findByTestId('access-note')).toHaveTextContent('You own this document.');
    expect(await screen.findByRole('heading', { name: 'Sharing' })).toBeInTheDocument();
  });

  it('[FR-3.4][FR-3.5] a shared editor is told who owns the document, can edit it, and sees no sharing panel and makes no sharing requests', async () => {
    const api = stubApi({ 'GET /api/documents/d1': () => docResponse({ access: 'editor', ownerName: 'Alice Anderson' }) });
    render(inSession(bob));
    expect(await screen.findByTestId('access-note')).toHaveTextContent('Shared by Alice Anderson. You can edit this document.');
    expect(screen.getByLabelText('Document title')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    expect(screen.queryByRole('heading', { name: 'Sharing' })).not.toBeInTheDocument();
    expect(api.mock.calls.some(([url]) => String(url).includes('/shares'))).toBe(false);
  });

  it('[FR-3.6] when access has been revoked, opening the document shows the permission error and no editor', async () => {
    stubApi({
      'GET /api/documents/d1': () => ({ status: 403, json: { error: 'FORBIDDEN', message: 'You do not have permission to perform this action on this document' } }),
    });
    render(inSession(bob));
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
    expect(screen.queryByLabelText('Document content')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Sharing' })).not.toBeInTheDocument();
  });

  it('[FR-3.6] if the owner revokes access while a shared editor has the document open, their next save shows the permission error and keeps their text', async () => {
    stubApi({
      'GET /api/documents/d1': () => docResponse({ access: 'editor' }),
      'PUT /api/documents/d1/content': () => ({ status: 403, json: { error: 'FORBIDDEN', message: 'You do not have permission to perform this action on this document' } }),
    });
    render(inSession(bob));
    const box = await screen.findByLabelText('Document content');
    fireEvent.change(box, { target: { value: 'my unsaved work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByTestId('save-status')).toHaveTextContent('Save failed: You do not have permission'));
    expect(screen.getByLabelText('Document content')).toHaveValue('my unsaved work');
  });
});
