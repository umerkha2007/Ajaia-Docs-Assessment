import type { SessionUser } from './api';

/** The notice shown wherever the simulated sign-in appears. */
export const SIMULATION_NOTICE =
  'Simulated sign-in for this demo: pick any seeded user, no password. This is not real authentication.';

export function SignInScreen({ users, onPick }: { users: SessionUser[]; onPick: (userId: string) => void }) {
  return (
    <section aria-labelledby="signin-title">
      <h2 id="signin-title">Choose a user</h2>
      <p className="muted">{SIMULATION_NOTICE}</p>
      <ul className="user-list">
        {users.map((u) => (
          <li key={u.id}>
            <button type="button" onClick={() => onPick(u.id)}>
              Continue as {u.name}
            </button>
            <span className="muted">{u.email}</span>
          </li>
        ))}
      </ul>
    </section>
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
