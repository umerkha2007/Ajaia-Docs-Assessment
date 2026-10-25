import type { SessionUser } from './api';
import { Avatar } from './Avatar';
import { BackendStatus } from './BackendStatus';

/** The notice shown wherever the simulated sign-in appears. */
export const SIMULATION_NOTICE =
  'Simulated sign-in for this demo: pick any seeded user, no password. This is not real authentication.';

/** Full-page "choose a user" screen: brand panel on the left, the seeded accounts on the right. */
export function SignInScreen({
  users,
  onPick,
  error,
}: {
  users: SessionUser[];
  onPick: (userId: string) => void;
  error?: string | null;
}) {
  return (
    <div className="auth">
      <aside className="auth-brand">
        <h1 className="brand">
          <span className="brand-mark" aria-hidden="true">
            A
          </span>
          Ajaia Docs
        </h1>
        <div className="auth-hero">
          <p className="auth-headline">
            Write together.
            <br />
            <em>Share deliberately.</em>
          </p>
          <p className="auth-lede">
            Rich-text documents with one clear owner, explicit access for everyone else, and permissions the server enforces on every request.
          </p>
        </div>
        <ul className="auth-features">
          <li>
            <strong>Rich text</strong>
            <span>Headings, lists, bold, italic, underline</span>
          </li>
          <li>
            <strong>Live editing</strong>
            <span>Changes save automatically and sync between people</span>
          </li>
          <li>
            <strong>Import</strong>
            <span>.txt and .md files</span>
          </li>
        </ul>
      </aside>
      <section className="auth-panel" aria-labelledby="signin-title">
        <h2 id="signin-title">Choose a user</h2>
        <p className="muted">{SIMULATION_NOTICE}</p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <ul className="user-list">
          {users.map((u) => (
            <li key={u.id}>
              <button type="button" className="user-row" aria-label={`Continue as ${u.name}`} onClick={() => onPick(u.id)}>
                <Avatar id={u.id} name={u.name} size={40} />
                <span className="user-row-text">
                  <span className="user-row-name">{u.name}</span>
                  <span className="muted">{u.email}</span>
                </span>
                <span className="user-row-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
        <BackendStatus />
      </section>
    </div>
  );
}

export function UserSwitcher({
  user,
  users,
  onSwitch,
  onSignOut,
}: {
  user: SessionUser;
  users: SessionUser[];
  onSwitch: (userId: string) => void;
  onSignOut: () => void;
}) {
  return (
    <div className="user-switcher">
      <Avatar id={user.id} name={user.name} />
      <label>
        <span className="muted">Signed in as (simulated)</span>{' '}
        <select aria-label="Switch user" value={user.id} onChange={(e) => onSwitch(e.target.value)}>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}
