import * as Y from 'yjs';
import type { SyncRequest, SyncResponse } from '../sync/DocSync';

export const b64 = (u: Uint8Array): string => btoa(String.fromCharCode(...u));
export const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * A tiny in-memory server speaking the same sync protocol as the real one (which has its
 * own tests), so clients and screens can be tested against each other without HTTP.
 */
export class FakeServer {
  readonly doc = new Y.Doc();
  title = 'Doc';
  calls: SyncRequest[] = [];
  failWith: (Error & { status?: number }) | null = null;
  hold: Promise<void> | null = null;

  constructor(firstParagraph = 'hello') {
    const p = new Y.XmlElement('paragraph');
    p.insert(0, [new Y.XmlText(firstParagraph)]);
    this.doc.getXmlFragment('default').insert(0, [p]);
  }

  /** Apply a request and build the response. Throws `failWith` when set. */
  respond(req: SyncRequest): SyncResponse {
    this.calls.push(req);
    if (this.failWith) throw this.failWith;
    if (req.update) Y.applyUpdate(this.doc, unb64(req.update), 'client');
    return {
      update: b64(Y.encodeStateAsUpdate(this.doc, unb64(req.stateVector))),
      stateVector: b64(Y.encodeStateVector(this.doc)),
      title: this.title,
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
  }

  readonly transport = async (req: SyncRequest): Promise<SyncResponse> => {
    if (this.hold) await this.hold;
    return this.respond(req);
  };

  /** The text of the first paragraph. */
  text(): string {
    return ((this.doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText).toString();
  }

  /** Change the first paragraph as another person would. */
  editElsewhere(fn: (t: Y.XmlText) => void): void {
    fn((this.doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText);
  }
}
