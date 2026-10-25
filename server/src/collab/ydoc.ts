import { getSchema } from '@tiptap/core';
import { prosemirrorJSONToYDoc, prosemirrorJSONToYXmlFragment, yXmlFragmentToProsemirrorJSON } from '@tiptap/y-tiptap';
import * as Y from 'yjs';
import { editorExtensions, YJS_FIELD } from '../../../shared/editorExtensions.js';
import { AppError } from '../errors.js';
import { validateContent } from '../validation.js';

/** The editor's ProseMirror schema, built from the same extensions the browser uses. */
export const schema = getSchema(editorExtensions);

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * A shared document must always hold at least one block. If it were empty, every browser
 * that opened it would add its own empty paragraph and the merged document would grow one
 * paragraph per client.
 */
const withBlocks = (json: Record<string, unknown>): Record<string, unknown> =>
  Array.isArray(json.content) && json.content.length > 0 ? json : EMPTY_DOC;

/** Build the shared document from stored JSON. Only used the first time a document is opened for editing. */
export function docFromJson(json: Record<string, unknown>): Y.Doc {
  try {
    return prosemirrorJSONToYDoc(schema, withBlocks(json), YJS_FIELD);
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Stored document content cannot be opened for editing', { cause });
  }
}

export function docFromState(state: Uint8Array): Y.Doc {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
  } catch (cause) {
    throw new AppError('INTERNAL_ERROR', 'Stored collaboration state is corrupt', { cause });
  }
  return doc;
}

/**
 * The document as clean, validated JSON. The raw conversion is passed through the schema
 * (which also checks structure and drops empty attributes) and then the same allowlist
 * validator every other save uses. Throws VALIDATION_ERROR if the document, as changed
 * by a client, is not something the editor could have produced.
 */
export function contentOf(doc: Y.Doc): Record<string, unknown> {
  let json: Record<string, unknown>;
  try {
    const node = schema.nodeFromJSON(yXmlFragmentToProsemirrorJSON(doc.getXmlFragment(YJS_FIELD)));
    node.check();
    json = node.toJSON() as Record<string, unknown>;
  } catch (cause) {
    throw new AppError('VALIDATION_ERROR', 'The edit is not valid for this document', { cause });
  }
  return validateContent(json);
}

/** Replace the whole shared document (used when content is saved through the plain API). */
export function replaceContent(doc: Y.Doc, json: Record<string, unknown>): void {
  doc.transact(() => {
    const fragment = doc.getXmlFragment(YJS_FIELD);
    fragment.delete(0, fragment.length);
    prosemirrorJSONToYXmlFragment(schema, withBlocks(json), fragment);
  });
}
