import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionContext } from '../session';
import { SharePanel } from '../SharePanel';
import { stubApi } from './fakeApi';

afterEach(() => vi.unstubAllGlobals());

const alice = { id: 'user-alice', name: 'Alice Anderson', email: 'alice@example.test' };
const bob = { id: 'user-bob', name: 'Bob Brown', email: 'bob@example.test' };
const carol = { id: 'user-carol', name: 'Carol Clark', email: 'carol@example.test' };
const share = (u: typeof bob) => ({ userId: u.id, name: u.name, email: u.email, role: 'editor', createdAt: '2026-01-01T00:00:00.000Z' });

const renderPanel = () =>
  render(
    <SessionContext.Provider value={{ user: alice, users: [alice, bob, carol] }}>
      <SharePanel docId="d1" />
    </SessionContext.Provider>,
  );
const options = () => within(screen.getByLabelText('Share with')).getAllByRole('option').map((o) => o.textContent);
const call = (api: ReturnType<typeof stubApi>, method: string) => api.mock.calls.find(([, init]) => init?.method === method);

describe('Ownership and Sharing (UI): share panel', () => {
  it('[FR-3.3] says only the owner can open the document when it is not shared, and offers the other users but not yourself', async () => {
    stubApi({ 'GET /api/documents/d1/shares': () => ({ json: { shares: [] } }) });
    renderPanel();
    expect(await screen.findByText('Only you can open this document.')).toBeInTheDocument();
    expect(options()).toEqual(['Choose a person…', 'Bob Brown', 'Carol Clark']);
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled();
  });

  it('[FR-3.3] lists the people who already have access and leaves them out of the picker', async () => {
    stubApi({ 'GET /api/documents/d1/shares': () => ({ json: { shares: [share(bob)] } }) });
    renderPanel();
    const list = await screen.findByRole('list', { name: 'People with access' });
    expect(within(list).getByText(/Bob Brown/)).toBeInTheDocument();
    expect(within(list).getByText(/can edit/)).toBeInTheDocument();
    expect(options()).toEqual(['Choose a person…', 'Carol Clark']);
  });

  it('[FR-3.3] choosing a person and pressing Share grants access, confirms it, and updates the list and picker', async () => {
    const api = stubApi({
      'GET /api/documents/d1/shares': () => ({ json: { shares: [] } }),
      'POST /api/documents/d1/shares': () => ({ json: { shares: [share(carol)] } }),
    });
    renderPanel();
    await screen.findByText('Only you can open this document.');
    fireEvent.change(screen.getByLabelText('Share with'), { target: { value: 'user-carol' } });
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByTestId('share-notice')).toHaveTextContent('Shared with Carol Clark (can edit).');
    expect(JSON.parse(call(api, 'POST')![1]!.body as string)).toEqual({ userId: 'user-carol' });
    expect(within(screen.getByRole('list', { name: 'People with access' })).getByText(/Carol Clark/)).toBeInTheDocument();
    expect(options()).toEqual(['Choose a person…', 'Bob Brown']);
    expect(screen.getByLabelText('Share with')).toHaveValue('');
  });

  it('[FR-3.6] Remove revokes that person, confirms it, and makes them selectable again', async () => {
    let shares = [share(bob), share(carol)];
    const api = stubApi({
      'GET /api/documents/d1/shares': () => ({ json: { shares } }),
      'DELETE /api/documents/d1/shares/user-bob': () => {
        shares = [share(carol)];
        return { json: { shares } };
      },
    });
    renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Bob Brown' }));
    expect(await screen.findByTestId('share-notice')).toHaveTextContent('Access removed for Bob Brown.');
    expect(call(api, 'DELETE')![0]).toBe('/api/documents/d1/shares/user-bob');
    const list = screen.getByRole('list', { name: 'People with access' });
    expect(within(list).queryByText(/Bob Brown/)).not.toBeInTheDocument();
    expect(within(list).getByText(/Carol Clark/)).toBeInTheDocument();
    expect(options()).toContain('Bob Brown');
  });

  it('[FR-3.3] says everyone already has access when there is nobody left to share with', async () => {
    stubApi({ 'GET /api/documents/d1/shares': () => ({ json: { shares: [share(bob), share(carol)] } }) });
    renderPanel();
    await screen.findByRole('list', { name: 'People with access' });
    expect(options()).toEqual(['Everyone already has access']);
    expect(screen.getByLabelText('Share with')).toBeDisabled();
  });

  it('[NFR-ERR] a refused share shows the server message and leaves the list unchanged', async () => {
    stubApi({
      'GET /api/documents/d1/shares': () => ({ json: { shares: [] } }),
      'POST /api/documents/d1/shares': () => ({ status: 403, json: { error: 'FORBIDDEN', message: 'You do not have permission to perform this action on this document' } }),
    });
    renderPanel();
    await screen.findByText('Only you can open this document.');
    fireEvent.change(screen.getByLabelText('Share with'), { target: { value: 'user-bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
    expect(screen.getByText('Only you can open this document.')).toBeInTheDocument();
    expect(screen.queryByTestId('share-notice')).not.toBeInTheDocument();
  });

  it('[NFR-ERR] if the sharing settings cannot be loaded the error is shown and nothing is claimed about access', async () => {
    stubApi({ 'GET /api/documents/d1/shares': () => ({ status: 403, json: { error: 'FORBIDDEN', message: 'You do not have permission to perform this action on this document' } }) });
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission');
    expect(screen.queryByText('Only you can open this document.')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Loading sharing settings…')).not.toBeInTheDocument());
  });
});
