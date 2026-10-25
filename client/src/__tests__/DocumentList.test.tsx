import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentList } from '../DocumentList';
import { stubApi, summary } from './fakeApi';

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Document CRUD (UI): list', () => {
  it('[FR-1.6] shows documents in the order the server returned them, each linking to its editor', async () => {
    stubApi({
      'GET /api/documents': () => ({
        json: { shared: [], documents: [summary({ id: 'b', title: 'Newer' }), summary({ id: 'a', title: 'Older' })] },
      }),
    });
    render(<DocumentList />);
    const links = await screen.findAllByRole('link');
    expect(links.map((l) => l.textContent)).toEqual(['Newer', 'Older']);
    expect(links[0]).toHaveAttribute('href', '#/docs/b');
  });

  it('[FR-1.6] shows an empty state when there are no documents', async () => {
    stubApi({ 'GET /api/documents': () => ({ json: { shared: [], documents: [] } }) });
    render(<DocumentList />);
    expect(await screen.findByText(/No documents yet/)).toBeInTheDocument();
  });

  it('[NFR-ERR] shows the server error message when the list cannot be loaded', async () => {
    stubApi({ 'GET /api/documents': () => ({ status: 401, json: { error: 'UNAUTHENTICATED', message: 'No user selected' } }) });
    render(<DocumentList />);
    expect(await screen.findByRole('alert')).toHaveTextContent('No user selected');
  });
});

describe('Document CRUD (UI): create and delete', () => {
  it('[FR-1.1] New document creates via the API and opens the new document', async () => {
    const api = stubApi({
      'GET /api/documents': () => ({ json: { shared: [], documents: [] } }),
      'POST /api/documents': () => ({ status: 201, json: { document: { ...summary({ id: 'new-1' }), content: { type: 'doc' } } } }),
    });
    render(<DocumentList />);
    fireEvent.click(await screen.findByRole('button', { name: 'New document' }));
    await waitFor(() => expect(window.location.hash).toBe('#/docs/new-1'));
    expect(api).toHaveBeenCalledWith('/api/documents', expect.objectContaining({ method: 'POST' }));
  });

  it('[FR-1.5] Delete asks for confirmation, calls the API, and refreshes the list', async () => {
    let docs = [summary({ id: 'a', title: 'Doomed' })];
    stubApi({
      'GET /api/documents': () => ({ json: { shared: [], documents: docs } }),
      'DELETE /api/documents/a': () => {
        docs = [];
        return { status: 204 };
      },
    });
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DocumentList />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Doomed' }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Doomed'));
    expect(await screen.findByText(/No documents yet/)).toBeInTheDocument();
  });

  it('[FR-1.5] declining the confirmation deletes nothing', async () => {
    const api = stubApi({ 'GET /api/documents': () => ({ json: { shared: [], documents: [summary({ title: 'Safe' })] } }) });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<DocumentList />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Safe' }));
    expect(api.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(screen.getByText('Safe')).toBeInTheDocument();
  });

  it('[NFR-ERR] a failed delete shows an error and keeps the document listed', async () => {
    stubApi({
      'GET /api/documents': () => ({ json: { shared: [], documents: [summary({ id: 'a', title: 'Stuck' })] } }),
      'DELETE /api/documents/a': () => ({ status: 403, json: { error: 'FORBIDDEN', message: 'You do not have permission' } }),
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<DocumentList />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete Stuck' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
    expect(screen.getByText('Stuck')).toBeInTheDocument();
  });
});

describe('Ownership and Sharing (UI): owned and shared documents', () => {
  const owned = (over = {}) => ({ ...summary({ id: 'o1', title: 'My own doc' }), shareCount: 0, ...over });
  const sharedDoc = (over = {}) => ({ ...summary({ id: 's1', title: 'Theirs' }), ownerId: 'user-alice', ownerName: 'Alice Anderson', role: 'editor', ...over });

  it('[FR-3.5] shows owned documents and documents shared with you in two separate, labelled sections', async () => {
    stubApi({ 'GET /api/documents': () => ({ json: { documents: [owned()], shared: [sharedDoc()] } }) });
    render(<DocumentList />);
    const mine = await screen.findByRole('region', { name: 'Your documents' });
    const theirs = screen.getByRole('region', { name: 'Shared with you' });
    expect(within(mine).getByText('My own doc')).toBeInTheDocument();
    expect(within(mine).queryByText('Theirs')).not.toBeInTheDocument();
    expect(within(theirs).getByText('Theirs')).toBeInTheDocument();
    expect(within(theirs).queryByText('My own doc')).not.toBeInTheDocument();
  });

  it('[FR-3.5] a shared document shows who owns it and that you can edit it, and links to its editor', async () => {
    stubApi({ 'GET /api/documents': () => ({ json: { documents: [], shared: [sharedDoc()] } }) });
    render(<DocumentList />);
    const theirs = await screen.findByRole('region', { name: 'Shared with you' });
    expect(within(theirs).getByText('Owner: Alice Anderson')).toBeInTheDocument();
    expect(within(theirs).getByText('Can edit')).toBeInTheDocument();
    expect(within(theirs).getByRole('link', { name: 'Theirs' })).toHaveAttribute('href', '#/docs/s1');
  });

  it('[SEC-1] shared documents have no Delete button, while owned documents do', async () => {
    stubApi({ 'GET /api/documents': () => ({ json: { documents: [owned()], shared: [sharedDoc()] } }) });
    render(<DocumentList />);
    const theirs = await screen.findByRole('region', { name: 'Shared with you' });
    expect(within(theirs).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete My own doc' })).toBeInTheDocument();
  });

  it('[FR-3.5] an owned document that is shared shows how many people it is shared with; an unshared one shows no badge', async () => {
    stubApi({ 'GET /api/documents': () => ({ json: { documents: [owned({ id: 'a', title: 'Shared one', shareCount: 2 }), owned({ id: 'b', title: 'Private one' })], shared: [] } }) });
    render(<DocumentList />);
    const mine = await screen.findByRole('region', { name: 'Your documents' });
    const rows = within(mine).getAllByRole('listitem');
    expect(within(rows[0]!).getByTestId('share-badge')).toHaveTextContent('Shared with 2');
    expect(within(rows[1]!).queryByTestId('share-badge')).not.toBeInTheDocument();
  });

  it('[FR-3.5] says nothing has been shared with you when the shared list is empty', async () => {
    stubApi({ 'GET /api/documents': () => ({ json: { documents: [], shared: [] } }) });
    render(<DocumentList />);
    expect(await screen.findByText('Nothing has been shared with you yet.')).toBeInTheDocument();
  });
});
