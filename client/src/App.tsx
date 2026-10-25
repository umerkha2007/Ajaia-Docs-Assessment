import { useCallback, useEffect, useState } from 'react';
import { getSession, signIn, signOut, type SessionUser } from './api';
import { BackendStatus } from './BackendStatus';
import { DocumentEditor } from './DocumentEditor';
import { DocumentList } from './DocumentList';
import { SessionContext } from './session';
import { SignInScreen, UserSwitcher } from './UserSwitcher';

/** Minimal hash router: `#/` is the list, `#/docs/<id>` is the editor. */
export function parseRoute(hash: string): { page: 'list' } | { page: 'doc'; id: string } {
  const m = /^#\/docs\/([^/]+)$/.exec(hash);
  return m ? { page: 'doc', id: decodeURIComponent(m[1]!) } : { page: 'list' };
}

type Session =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; user: SessionUser | null; users: SessionUser[] };

export function App() {
  const [hash, setHash] = useState(window.location.hash);
  const [session, setSession] = useState<Session>({ kind: 'loading' });
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getSession().then(
      ({ user, users }) => !cancelled && setSession({ kind: 'ready', user, users }),
      (e: Error) => !cancelled && setSession({ kind: 'error', message: e.message }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  /** Sign in (or switch) as a seeded user and go back to that user's document list. */
  const pick = useCallback(async (userId: string) => {
    try {
      const user = await signIn(userId);
      setActionError(null);
      window.location.hash = '#/';
      setHash('#/');
      setSession((s) => (s.kind === 'ready' ? { ...s, user } : s));
    } catch (e) {
      setActionError((e as Error).message);
    }
  }, []);

  const leave = useCallback(async () => {
    try {
      await signOut();
      setActionError(null);
      window.location.hash = '#/';
      setHash('#/');
      setSession((s) => (s.kind === 'ready' ? { ...s, user: null } : s));
    } catch (e) {
      setActionError((e as Error).message);
    }
  }, []);

  const route = parseRoute(hash);
  const user = session.kind === 'ready' ? session.user : null;

  return (
    <main>
      <header className="row">
        <h1>
          <a href="#/">Ajaia Docs</a>
        </h1>
        {session.kind === 'ready' && user && (
          <UserSwitcher user={user} users={session.users} onSwitch={pick} onSignOut={leave} />
        )}
      </header>
      {actionError && (
        <p role="alert" className="error">
          {actionError}
        </p>
      )}
      {session.kind === 'loading' && <p>Loading…</p>}
      {session.kind === 'error' && (
        <p role="alert" className="error">
          {session.message}
        </p>
      )}
      {session.kind === 'ready' && !user && <SignInScreen users={session.users} onPick={pick} />}
      {session.kind === 'ready' && user && (
        <SessionContext.Provider value={{ user, users: session.users }}>
          {/* Keyed by user so nothing from the previous user's view survives a switch. */}
          {route.page === 'list' ? (
            <DocumentList key={user.id} />
          ) : (
            <DocumentEditor key={`${user.id}:${route.id}`} id={route.id} />
          )}
        </SessionContext.Provider>
      )}
      <BackendStatus />
    </main>
  );
}
