import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, parseRoute } from '../App';
import { stubApi, summary } from './fakeApi';
import { FakeServer } from './syncServer';

beforeEach(() => {
  window.location.hash = '';
});
afterEach(() => vi.unstubAllGlobals());

const alice = { id: 'user-alice', name: 'Alice Anderson', email: 'alice@example.test' };
const bob = { id: 'user-bob', name: 'Bob Brown', email: 'bob@example.test' };
const carol = { id: 'user-carol', name: 'Carol Clark', email: 'carol@example.test' };
const users = [alice, bob, carol];

const health = () => ({ json: { status: 'ok', sqliteVersion: '3.53.4' } });
const signedIn = (user = alice) => ({ 'GET /api/session': () => ({ json: { user, users } }) });
const noDocs = () => ({ json: { documents: [], shared: [] } });

describe('App shell: routing', () => {
  it('[FR-1.4] parseRoute maps hashes to the list or a document id', () => {
    expect(parseRoute('')).toEqual({ page: 'list' });
    expect(parseRoute('#/')).toEqual({ page: 'list' });
    expect(parseRoute('#/docs/abc-123')).toEqual({ page: 'doc', id: 'abc-123' });
    expect(parseRoute('#/docs/')).toEqual({ page: 'list' });
    expect(parseRoute('#/docs/a/b')).toEqual({ page: 'list' });
  });

  it('[FR-1.6] a signed-in user sees the document list', async () => {
    stubApi({
      'GET /api/health': health,
      ...signedIn(),
      'GET /api/documents': () => ({ json: { documents: [{ ...summary({ title: 'Listed' }), shareCount: 0 }], shared: [] } }),
    });
    render(<App />);
    expect(await screen.findByText('Listed')).toBeInTheDocument();
  });

  it('[FR-1.4] opens the editor when the hash points at a document, and says who owns it', async () => {
    window.location.hash = '#/docs/d1';
    stubApi({
      'GET /api/health': health,
      ...signedIn(bob),
      'GET /api/documents/d1': () => ({
        json: { document: { ...summary({ id: 'd1', title: 'Opened' }), ownerName: 'Alice Anderson', access: 'editor', content: { type: 'doc' } } },
      }),
      'POST /api/documents/d1/sync': (body) => ({ json: new FakeServer('Body text').respond(body as never) }),
    });
    render(<App />);
    expect(await screen.findByLabelText('Document title')).toHaveValue('Opened');
    expect(await screen.findByLabelText('Document content')).toHaveTextContent('Body text');
    expect(screen.getByTestId('access-note')).toHaveTextContent('Shared by Alice Anderson');
  });
});

describe('Simulated sign-in (UI)', () => {
  it('[FR-3.2] without a session it asks you to choose a seeded user, says it is simulated, and loads no documents', async () => {
    const api = stubApi({ 'GET /api/health': health, ...signedIn(null as never) });
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Choose a user' })).toBeInTheDocument();
    for (const u of users) expect(screen.getByRole('button', { name: `Continue as ${u.name}` })).toBeInTheDocument();
    expect(screen.getByText(/not real authentication/i)).toBeInTheDocument();
    expect(api.mock.calls.some(([url]) => String(url).startsWith('/api/documents'))).toBe(false);
    expect(screen.queryByLabelText('Switch user')).not.toBeInTheDocument();
  });

  it('[FR-3.2] choosing a user signs in as that user, shows their documents and the switcher', async () => {
    const api = stubApi({
      'GET /api/health': health,
      ...signedIn(null as never),
      'POST /api/session': () => ({ json: { user: bob } }),
      'GET /api/documents': () => ({ json: { documents: [{ ...summary({ title: 'Bob doc' }), ownerId: bob.id, shareCount: 0 }], shared: [] } }),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue as Bob Brown' }));
    expect(await screen.findByText('Bob doc')).toBeInTheDocument();
    expect(screen.getByLabelText('Switch user')).toHaveValue('user-bob');
    const post = api.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({ userId: 'user-bob' });
  });

  it('[FR-3.2] switching users signs in as the other user and reloads the list for them', async () => {
    let current = alice;
    const api = stubApi({
      'GET /api/health': health,
      'GET /api/session': () => ({ json: { user: current, users } }),
      'POST /api/session': (body) => {
        current = users.find((u) => u.id === (body as { userId: string }).userId)!;
        return { json: { user: current } };
      },
      'GET /api/documents': () => ({
        json: current === alice
          ? { documents: [{ ...summary({ title: 'Alice doc' }), shareCount: 0 }], shared: [] }
          : { documents: [], shared: [{ ...summary({ title: 'From Alice' }), ownerName: 'Alice Anderson', role: 'editor' }] },
      }),
    });
    render(<App />);
    expect(await screen.findByText('Alice doc')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Switch user'), { target: { value: 'user-bob' } });
    expect(await screen.findByText('From Alice')).toBeInTheDocument();
    expect(screen.queryByText('Alice doc')).not.toBeInTheDocument();
    expect(api.mock.calls.filter(([url]) => url === '/api/documents')).toHaveLength(2);
  });

  it('[FR-3.2] switching users while a document is open returns to that user\'s own list', async () => {
    window.location.hash = '#/docs/d1';
    stubApi({
      'GET /api/health': health,
      ...signedIn(),
      'GET /api/documents/d1': () => ({
        json: { document: { ...summary({ id: 'd1', title: 'Open doc' }), ownerName: 'Alice Anderson', access: 'owner', content: { type: 'doc' } } },
      }),
      'POST /api/documents/d1/sync': (body) => ({ json: new FakeServer('x').respond(body as never) }),
      'GET /api/documents/d1/shares': () => ({ json: { shares: [] } }),
      'POST /api/session': () => ({ json: { user: carol } }),
      'GET /api/documents': noDocs,
    });
    render(<App />);
    await screen.findByLabelText('Document title');
    fireEvent.change(screen.getByLabelText('Switch user'), { target: { value: 'user-carol' } });
    expect(await screen.findByRole('heading', { name: 'Your documents' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/');
    expect(screen.queryByLabelText('Document title')).not.toBeInTheDocument();
  });

  it('[FR-3.2] signing out returns to the choose-a-user screen and hides all documents', async () => {
    stubApi({ 'GET /api/health': health, ...signedIn(), 'GET /api/documents': noDocs, 'DELETE /api/session': () => ({ status: 204 }) });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Choose a user' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your documents' })).not.toBeInTheDocument();
  });

  it('[NFR-ERR] a failed sign-in shows the server message and stays on the choose-a-user screen', async () => {
    stubApi({
      'GET /api/health': health,
      ...signedIn(null as never),
      'POST /api/session': () => ({ status: 401, json: { error: 'UNAUTHENTICATED', message: 'Unknown user' } }),
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Continue as Alice Anderson' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unknown user');
    expect(screen.getByRole('heading', { name: 'Choose a user' })).toBeInTheDocument();
  });

  it('[NFR-ERR] if the session cannot be loaded it says so instead of showing an empty app', async () => {
    stubApi({ 'GET /api/health': health, 'GET /api/session': () => ({ status: 500, json: { error: 'INTERNAL_ERROR', message: 'Unexpected server error' } }) });
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Unexpected server error');
    await waitFor(() => expect(screen.queryByText('Loading…')).not.toBeInTheDocument());
  });
});
