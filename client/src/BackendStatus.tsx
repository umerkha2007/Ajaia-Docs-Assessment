import { useEffect, useState } from 'react';
import { fetchHealth, type Health } from './api';

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; health: Health }
  | { kind: 'error'; message: string };

export function BackendStatus() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchHealth().then(
      (health) => !cancelled && setState({ kind: 'ok', health }),
      (err: Error) => !cancelled && setState({ kind: 'error', message: err.message }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <p className="backend-status" data-testid="backend-status" role="status">
      {state.kind === 'loading' && 'Checking backend…'}
      {state.kind === 'ok' && `Backend: ${state.health.status} (SQLite ${state.health.sqliteVersion})`}
      {state.kind === 'error' && `Backend unavailable: ${state.message}`}
    </p>
  );
}
