import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createDocument, deleteDocument, importDocument, listDocuments, type OwnedSummary, type SharedSummary } from './api';
import { checkImportFile, IMPORT_ACCEPT, IMPORT_HELP } from './importRules';

export function DocumentList() {
  const [docs, setDocs] = useState<OwnedSummary[] | null>(null);
  const [shared, setShared] = useState<SharedSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const result = await listDocuments();
      setDocs(result.documents);
      setShared(result.shared);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial data load
    void load();
  }, [load]);

  async function onCreate() {
    setBusy(true);
    try {
      const doc = await createDocument();
      window.location.hash = `#/docs/${doc.id}`;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function onImport(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again after an error
    if (!file) return;
    const problem = checkImportFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const doc = await importDocument(file);
      window.location.hash = `#/docs/${doc.id}`;
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  async function onDelete(doc: OwnedSummary) {
    if (!window.confirm(`Delete "${doc.title}"? This cannot be undone.`)) return;
    try {
      await deleteDocument(doc.id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
    <section aria-labelledby="your-docs">
      <div className="row">
        <h2 id="your-docs">Your documents</h2>
        <button type="button" onClick={onCreate} disabled={busy}>
          New document
        </button>
        <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
          Import file
        </button>
        <input
          ref={fileInput}
          type="file"
          className="visually-hidden"
          aria-label="Import a .txt or .md file"
          accept={IMPORT_ACCEPT}
          onChange={onImport}
        />
      </div>
      <p className="muted" data-testid="import-help">
        {IMPORT_HELP}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {docs === null && !error && <p>Loading documents…</p>}
      {docs?.length === 0 && <p>No documents yet. Create one to get started.</p>}
      {docs && docs.length > 0 && (
        <ul className="doc-list">
          {docs.map((d) => (
            <li key={d.id}>
              <a href={`#/docs/${d.id}`}>{d.title}</a>
              {d.shareCount > 0 && (
                <span className="badge" data-testid="share-badge">
                  Shared with {d.shareCount}
                </span>
              )}
              <span className="muted">Updated {new Date(d.updatedAt).toLocaleString()}</span>
              <button type="button" onClick={() => onDelete(d)} aria-label={`Delete ${d.title}`}>
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
    <section aria-labelledby="shared-docs">
      <h2 id="shared-docs">Shared with you</h2>
      {shared !== null && shared.length === 0 && <p className="muted">Nothing has been shared with you yet.</p>}
      {shared && shared.length > 0 && (
        <ul className="doc-list" aria-label="Documents shared with you">
          {shared.map((d) => (
            <li key={d.id}>
              <a href={`#/docs/${d.id}`}>{d.title}</a>
              <span className="muted">Owner: {d.ownerName}</span>
              <span className="badge">Can edit</span>
              <span className="muted">Updated {new Date(d.updatedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
    </>
  );
}