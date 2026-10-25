import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentList } from '../DocumentList';
import { stubApi, summary } from './fakeApi';

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => vi.unstubAllGlobals());

const listOnly = { 'GET /api/documents': () => ({ json: { shared: [], documents: [] } }) };
const chooseFile = async (file: File) => {
  const input = await screen.findByLabelText('Import a .txt or .md file');
  fireEvent.change(input, { target: { files: [file] } });
};
const uploads = (api: ReturnType<typeof stubApi>) => api.mock.calls.filter(([url]) => String(url).startsWith('/api/documents/import'));

describe('File Import (UI): Import button', () => {
  it('[FR-2.7] states the supported file types and the size limit on the page', async () => {
    stubApi(listOnly);
    render(<DocumentList />);
    expect(await screen.findByTestId('import-help')).toHaveTextContent('.txt and .md');
    expect(screen.getByTestId('import-help')).toHaveTextContent('512 KB');
  });

  it('[FR-2.7] the file picker only offers the supported types', async () => {
    stubApi(listOnly);
    render(<DocumentList />);
    const input = await screen.findByLabelText('Import a .txt or .md file');
    expect(input).toHaveAttribute('accept', expect.stringContaining('.txt'));
    expect(input).toHaveAttribute('accept', expect.stringContaining('.md'));
    expect(input.getAttribute('accept')).not.toMatch(/pdf|docx/);
  });

  it('[FR-2.1][FR-2.6] uploads the chosen file as raw bytes with its name, then opens the new document', async () => {
    const file = new File(['# Hi'], 'My Notes.md', { type: 'text/markdown' });
    const api = stubApi({
      ...listOnly,
      'POST /api/documents/import?filename=My%20Notes.md': () => ({
        status: 201,
        json: { document: { ...summary({ id: 'imp-1', title: 'My Notes' }), content: { type: 'doc' } } },
      }),
    });
    render(<DocumentList />);
    await chooseFile(file);
    await waitFor(() => expect(window.location.hash).toBe('#/docs/imp-1'));
    const [url, init] = uploads(api)[0]!;
    expect(url).toBe('/api/documents/import?filename=My%20Notes.md');
    expect(init!.method).toBe('POST');
    expect(init!.body).toBe(file);
    expect(init!.headers).toMatchObject({ 'content-type': 'application/octet-stream' });
  });

  it('[FR-2.4] an unsupported file is refused immediately with a clear message and is never uploaded', async () => {
    const api = stubApi(listOnly);
    render(<DocumentList />);
    await chooseFile(new File(['%PDF'], 'report.pdf', { type: 'application/pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unsupported file type. Only .txt and .md files can be imported.');
    expect(uploads(api)).toHaveLength(0);
    expect(window.location.hash).toBe('');
  });

  it('[FR-2.5] an empty file is refused with a clear message and is never uploaded', async () => {
    const api = stubApi(listOnly);
    render(<DocumentList />);
    await chooseFile(new File([], 'empty.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is empty');
    expect(uploads(api)).toHaveLength(0);
  });

  it('[FR-2.5] an oversized file is refused with a clear message and is never uploaded', async () => {
    const api = stubApi(listOnly);
    render(<DocumentList />);
    await chooseFile(new File([new Uint8Array(512 * 1024 + 1)], 'huge.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent('File is too large. The limit is 512 KB.');
    expect(uploads(api)).toHaveLength(0);
  });

  it('[FR-2.5] a rejection from the server (for example binary content) is shown and the user stays on the list', async () => {
    stubApi({
      ...listOnly,
      'POST /api/documents/import?filename=fake.txt': () => ({
        status: 400,
        json: { error: 'INVALID_FILE', message: 'The file is not a UTF-8 text file (it contains binary data)' },
      }),
    });
    render(<DocumentList />);
    await chooseFile(new File(['x'], 'fake.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent('not a UTF-8 text file');
    expect(window.location.hash).toBe('');
    expect(screen.getByRole('button', { name: 'Import file' })).toBeEnabled();
  });

  it('[NFR-ERR] a network failure during upload is reported and the buttons are usable again', async () => {
    stubApi(listOnly);
    render(<DocumentList />);
    await screen.findByText(/No documents yet/);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    await chooseFile(new File(['hello'], 'a.txt'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot reach the server');
    expect(screen.getByRole('button', { name: 'New document' })).toBeEnabled();
  });

  it('[FR-2.5] the same file can be chosen again after an error', async () => {
    stubApi(listOnly);
    render(<DocumentList />);
    const input = (await screen.findByLabelText('Import a .txt or .md file')) as HTMLInputElement;
    await chooseFile(new File(['x'], 'bad.pdf'));
    await screen.findByRole('alert');
    expect(input.value).toBe('');
  });
});
