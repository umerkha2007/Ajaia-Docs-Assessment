import { useCallback, useEffect, useRef, useState } from 'react';
import { getDocument, renameDocument, syncDocument, type DocumentRecord } from './api';
import { RichTextEditor } from './editor/RichTextEditor';
import { SharePanel } from './SharePanel';
import { DocSync, type SyncOptions, type SyncStatus } from './sync/DocSync';

type Load = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ready'; doc: DocumentRecord };

function describe(status: SyncStatus): string {
  switch (status.kind) {
    case 'connecting': return 'Loading document…';
    case 'saved': return 'All changes saved';
    case 'dirty': return 'Unsaved changes';
    case 'saving': return 'Saving…';
    case 'error':
      return status.fatal
        ? `Save failed: ${status.message}. Your text is still on this page but can no longer be saved here.`
        : `Save failed: ${status.message}. Your changes are kept in the editor and will be retried.`;
  }
}

/**
 * The text of a document, edited live with other people. Changes are saved automatically a
 * moment after you stop typing, and other people's changes appear within a couple of seconds.
 */
function EditorPane({
  id,
  syncOptions,
  onMeta,
}: {
  id: string;
  syncOptions?: Partial<SyncOptions>;
  onMeta: (meta: { title: string }) => void;
}) {
  const [status, setStatus] = useState<SyncStatus>({ kind: 'connecting' });
  // `onMeta` is a stable callback from the parent, so it can be handed over once.
  const [sync] = useState(
    () => new DocSync((request) => syncDocument(id, request), { ...syncOptions, onStatus: setStatus, onMeta }),
  );

  useEffect(() => {
    sync.start();
    return () => {
      void sync.flushAndStop(); // do not drop the last keystrokes when leaving the page
    };
  }, [sync]);

  useEffect(() => {
    // Last line of defence for closing the tab or reloading with changes the server has not confirmed.
    const warn = (e: BeforeUnloadEvent) => {
      if (sync.hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [sync]);

  const lostAccess = status.kind === 'error' && status.fatal;
  const editable = sync.isReady && !lostAccess;
  const save = useCallback(() => void sync.syncNow(), [sync]);

  return (
    <>
      <RichTextEditor ydoc={sync.ydoc} editable={editable} />
      <div className="row save-row">
        <button type="button" onClick={save} disabled={!sync.isReady || status.kind === 'saving'}>
          Save
        </button>
        <span role="status" data-testid="save-status" className={`save-status ${status.kind}`}>
          {describe(status)}
        </span>
      </div>
    </>
  );
}

export function DocumentEditor({ id, syncOptions }: { id: string; syncOptions?: Partial<SyncOptions> }) {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [title, setTitle] = useState('');
  const [serverTitle, setServerTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const titleFocused = useRef(false);

  useEffect(() => {
    let cancelled = false;
    getDocument(id).then(
      (doc) => {
        if (cancelled) return;
        setLoad({ kind: 'ready', doc });
        setTitle(doc.title);
        setServerTitle(doc.title);
      },
      (e: Error) => !cancelled && setLoad({ kind: 'error', message: e.message }),
    );
    return () => {
      cancelled = true;
    };
  }, [id]);

  /** Someone else renamed the document: show it, unless you are in the middle of typing a new title. */
  const onMeta = useCallback(({ title: remote }: { title: string }) => {
    setServerTitle(remote);
    if (!titleFocused.current) setTitle(remote);
  }, []);

  if (load.kind === 'loading') return <p>Loading document…</p>;
  if (load.kind === 'error') {
    return (
      <section>
        <p role="alert" className="error">
          {load.message}
        </p>
        <a href="#/">Back to documents</a>
      </section>
    );
  }

  const current = load.doc;

  async function onRename() {
    titleFocused.current = false;
    const next = title.trim();
    if (next === serverTitle) return;
    try {
      const doc = await renameDocument(id, title);
      setServerTitle(doc.title);
      setTitle(doc.title);
      setTitleError(null);
    } catch (e) {
      setTitleError((e as Error).message);
    }
  }

  return (
    <section className="doc-page">
      <p>
        <a href="#/" className="back-link">← All documents</a>
      </p>
      <div className="row title-row">
        <input
          aria-label="Document title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => (titleFocused.current = true)}
          onBlur={onRename}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
      </div>
      <p className="muted" data-testid="access-note">
        {current.access === 'owner' ? 'You own this document.' : `Shared by ${current.ownerName}. You can edit this document.`}
      </p>
      {titleError && (
        <p role="alert" className="error">
          {titleError}
        </p>
      )}
      <EditorPane id={id} syncOptions={syncOptions} onMeta={onMeta} />
      {current.access === 'owner' && <SharePanel docId={id} />}
    </section>
  );
}
