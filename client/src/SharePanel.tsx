import { useCallback, useEffect, useState } from 'react';
import { listShares, shareDocument, unshareDocument, type ShareRecord } from './api';
import { Avatar } from './Avatar';
import { useSession } from './session';

/**
 * Owner-only sharing controls. Showing this panel only to the owner is a convenience;
 * the server refuses sharing requests from anyone else.
 */
export function SharePanel({ docId }: { docId: string }) {
  const { user, users } = useSession();
  const [shares, setShares] = useState<ShareRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [choice, setChoice] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listShares(docId).then(
      (s) => !cancelled && setShares(s),
      (e: Error) => !cancelled && setError(e.message),
    );
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const candidates = users.filter((u) => u.id !== user.id && !(shares ?? []).some((s) => s.userId === u.id));

  const run = useCallback(async (action: () => Promise<ShareRecord[]>, done: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setShares(await action());
      setNotice(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <section className="share-panel" aria-labelledby="share-title">
      <h2 id="share-title">Sharing</h2>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="muted" data-testid="share-notice">
          {notice}
        </p>
      )}
      {shares === null && !error && <p>Loading sharing settings…</p>}
      {shares?.length === 0 && <p className="muted">Only you can open this document.</p>}
      {shares && shares.length > 0 && (
        <ul aria-label="People with access" className="share-list">
          {shares.map((s) => (
            <li key={s.userId}>
              <Avatar id={s.userId} name={s.name} size={28} />
              <span className="share-person">
                {s.name} <span className="muted">({s.email}) · can edit</span>
              </span>
              <button
                type="button"
                disabled={busy}
                aria-label={`Remove ${s.name}`}
                onClick={() => run(() => unshareDocument(docId, s.userId), `Access removed for ${s.name}.`)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <select aria-label="Share with" value={choice} onChange={(e) => setChoice(e.target.value)} disabled={candidates.length === 0}>
          <option value="">{candidates.length ? 'Choose a person…' : 'Everyone already has access'}</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="primary"
          disabled={busy || !choice}
          onClick={async () => {
            const target = users.find((u) => u.id === choice);
            await run(() => shareDocument(docId, choice), `Shared with ${target?.name ?? 'user'} (can edit).`);
            setChoice('');
          }}
        >
          Share
        </button>
      </div>
    </section>
  );
}
