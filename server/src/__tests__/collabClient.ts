import * as Y from 'yjs';
import { YJS_FIELD } from '../../../shared/editorExtensions.js';
import type { DocumentService } from '../services/documents.js';

export const toB64 = (u: Uint8Array): string => Buffer.from(u).toString('base64');
export const fromB64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, 'base64'));

/**
 * A stand-in for one browser: its own Yjs document, synced to the service the same way
 * the real client does (send what the server has not seen, apply what it returns).
 * Edits are made directly on the Yjs document, as the editor's binding would.
 */
export class FakeClient {
  readonly doc = new Y.Doc();
  private knownServerSV: Uint8Array | null = null;
  title = '';

  constructor(
    private readonly svc: DocumentService,
    readonly userId: string,
    readonly docId: string,
  ) {}

  /** One sync round trip. Throws whatever the service throws (forbidden, validation, ...). */
  sync(opts: { sendUpdate?: boolean } = {}) {
    const sendUpdate = opts.sendUpdate ?? true;
    const res = this.svc.sync(this.userId, this.docId, {
      stateVector: toB64(Y.encodeStateVector(this.doc)),
      ...(sendUpdate ? { update: toB64(Y.encodeStateAsUpdate(this.doc, this.knownServerSV ?? undefined)) } : {}),
    });
    Y.applyUpdate(this.doc, fromB64(res.update), 'remote');
    this.knownServerSV = fromB64(res.stateVector);
    this.title = res.title;
    return res;
  }

  get fragment(): Y.XmlFragment {
    return this.doc.getXmlFragment(YJS_FIELD);
  }

  block(i: number): Y.XmlElement {
    return this.fragment.get(i) as Y.XmlElement;
  }

  /** The XmlText inside the i-th top-level block (paragraph or heading). */
  text(i: number): Y.XmlText {
    return this.block(i).get(0) as Y.XmlText;
  }

  /** The text of every top-level block, as a user sees it. */
  lines(): string[] {
    return this.fragment.toArray().map((b) => (b as Y.XmlElement).toArray().map((t) => (t instanceof Y.XmlText ? t.toString() : '')).join(''));
  }
}

/** Sync every client twice, in order, so each has seen everyone's changes. */
export function settle(...clients: FakeClient[]): void {
  for (let round = 0; round < 2; round++) for (const c of clients) c.sync();
}
