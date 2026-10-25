import * as Y from 'yjs';

export interface SyncRequest {
  /** What this browser already has (so the server only sends what is missing). */
  stateVector: string;
  /** What this browser has done that the server has not yet confirmed. Omitted when there is nothing. */
  update?: string;
}

export interface SyncResponse {
  update: string;
  stateVector: string;
  title: string;
  updatedAt: string;
}

export type SyncStatus =
  | { kind: 'connecting' }
  | { kind: 'saved' }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'error'; message: string; fatal: boolean };

export interface SyncOptions {
  /** How often to check the server for other people's changes (and send ours). 0 turns polling off. */
  pollMs: number;
  /** How long after the last keystroke to save. */
  debounceMs: number;
  onStatus?: (status: SyncStatus) => void;
  onMeta?: (meta: { title: string; updatedAt: string }) => void;
}

export const DEFAULT_SYNC_OPTIONS = { pollMs: 2000, debounceMs: 800 } as const;

/** Marks updates that came from the server, so they are not sent straight back. */
const REMOTE = Symbol('remote-update');

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const fromBase64 = (text: string): Uint8Array => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** HTTP statuses after which retrying cannot help: not signed in, no access, or the document is gone. */
const isFatal = (e: unknown): boolean => [401, 403, 404].includes((e as { status?: number }).status ?? 0);

/**
 * Keeps one browser's copy of a document (a Yjs document) in step with the server.
 *
 * - Every local change marks the document unsaved and schedules a save a moment later;
 *   the periodic poll also sends any unsaved changes, so continuous typing is never
 *   unsaved for longer than `pollMs`.
 * - Every poll asks the server for what this browser is missing and applies it. Remote
 *   changes are merged into the live editor by the editor binding, so the cursor stays put.
 * - What we send is always "everything the server has not confirmed", which is safe to
 *   repeat, so a failed or lost request just gets retried on the next tick: nothing is lost.
 */
export class DocSync {
  readonly ydoc = new Y.Doc();
  private status: SyncStatus = { kind: 'connecting' };
  private ready = false;
  private localGeneration = 0;
  private syncedGeneration = 0;
  private serverVector: Uint8Array | null = null;
  private inFlight: Promise<void> | null = null;
  private again = false;
  private running = false;
  private fatal = false;
  private epoch = 0;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly options: SyncOptions;

  constructor(
    private readonly transport: (request: SyncRequest) => Promise<SyncResponse>,
    options: Partial<SyncOptions> = {},
  ) {
    this.options = { ...DEFAULT_SYNC_OPTIONS, ...options };
  }

  get currentStatus(): SyncStatus {
    return this.status;
  }

  /** True once the first sync has loaded the document. Editing before that would race the initial load. */
  get isReady(): boolean {
    return this.ready;
  }

  /** True while there are changes the server has not confirmed. */
  get hasUnsavedChanges(): boolean {
    return this.localGeneration !== this.syncedGeneration;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.epoch++;
    this.ydoc.on('update', this.onLocalUpdate);
    if (this.options.pollMs > 0) this.pollTimer = setInterval(() => void this.syncNow(), this.options.pollMs);
    void this.syncNow();
  }

  stop(): void {
    this.running = false;
    this.epoch++;
    this.ydoc.off('update', this.onLocalUpdate);
    clearInterval(this.pollTimer);
    clearTimeout(this.debounceTimer);
  }

  /** Save anything unsaved, then stop. Used when leaving the page so the last keystrokes are not dropped. */
  async flushAndStop(): Promise<void> {
    const epoch = this.epoch;
    clearInterval(this.pollTimer);
    clearTimeout(this.debounceTimer);
    try {
      if (this.running && this.hasUnsavedChanges && !this.fatal) await this.syncNow();
    } finally {
      if (this.epoch === epoch) this.stop(); // not if the editor was started again meanwhile
    }
  }

  /** Sync right now (the Save button). Concurrent calls share one round trip, then run once more if needed. */
  syncNow(): Promise<void> {
    if (!this.running) return Promise.resolve();
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    this.inFlight = this.roundTrip().finally(() => {
      this.inFlight = null;
      if (this.again && this.running) {
        this.again = false;
        void this.syncNow();
      }
    });
    return this.inFlight;
  }

  private readonly onLocalUpdate = (_update: Uint8Array, origin: unknown): void => {
    if (origin === REMOTE) return;
    this.localGeneration++;
    if (this.ready) this.setStatus({ kind: 'dirty' });
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => void this.syncNow(), this.options.debounceMs);
  };

  private setStatus(status: SyncStatus): void {
    this.status = status;
    this.options.onStatus?.(status);
  }

  private async roundTrip(): Promise<void> {
    const generation = this.localGeneration;
    const sending = generation !== this.syncedGeneration;
    const request: SyncRequest = { stateVector: toBase64(Y.encodeStateVector(this.ydoc)) };
    if (sending) {
      request.update = toBase64(Y.encodeStateAsUpdate(this.ydoc, this.serverVector ?? undefined));
      this.setStatus({ kind: 'saving' });
    }
    let response: SyncResponse;
    try {
      response = await this.transport(request);
    } catch (e) {
      if (!this.running) return;
      this.fatal = isFatal(e);
      if (this.fatal) {
        clearInterval(this.pollTimer);
        clearTimeout(this.debounceTimer);
      }
      this.setStatus({ kind: 'error', message: (e as Error).message, fatal: this.fatal });
      return;
    }
    if (!this.running) return;
    if (this.fatal && this.options.pollMs > 0) {
      // Recovered after a fatal error (for example the user pressed Save again): resume polling.
      this.pollTimer = setInterval(() => void this.syncNow(), this.options.pollMs);
    }
    this.fatal = false;
    Y.applyUpdate(this.ydoc, fromBase64(response.update), REMOTE);
    this.serverVector = fromBase64(response.stateVector);
    if (sending) this.syncedGeneration = generation;
    this.ready = true;
    this.options.onMeta?.({ title: response.title, updatedAt: response.updatedAt });
    if (this.hasUnsavedChanges) {
      // More typing happened while this request was in flight: save it too, soon.
      this.setStatus({ kind: 'dirty' });
      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => void this.syncNow(), this.options.debounceMs);
    } else {
      this.setStatus({ kind: 'saved' });
    }
  }
}
