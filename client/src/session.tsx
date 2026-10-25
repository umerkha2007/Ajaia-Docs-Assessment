import { createContext, useContext } from 'react';
import type { SessionUser } from './api';

export interface SessionValue {
  user: SessionUser;
  /** Every seeded account, for the switcher and the share picker. */
  users: SessionUser[];
}

export const SessionContext = createContext<SessionValue | null>(null);

/** The signed-in simulated user. Only available below App's sign-in gate. */
export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside a signed-in session');
  return value;
}
