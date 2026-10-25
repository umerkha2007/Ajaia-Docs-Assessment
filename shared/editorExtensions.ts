import StarterKit from '@tiptap/starter-kit';

/**
 * The editor schema, shared by the browser editor and the server so they can never
 * disagree about what a document may contain: paragraphs, headings 1-3, bulleted
 * and numbered lists, and bold / italic / underline. Everything else StarterKit
 * ships (links, code, quotes, rules, strike, hard breaks, trailing node) is off.
 *
 * Undo/redo is off here because the collaboration extension provides its own
 * (an undo that only reverts *your* edits, not other people's).
 *
 * server/src/validation.ts is the allowlist for stored content; the contract tests
 * (client/src/__tests__/editorContract.test.ts) check this schema against it.
 */
export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    blockquote: false,
    code: false,
    codeBlock: false,
    hardBreak: false,
    horizontalRule: false,
    link: false,
    strike: false,
    trailingNode: false,
    undoRedo: false,
  }),
];

/** Name of the Yjs fragment that holds the document. Client and server must agree. */
export const YJS_FIELD = 'default';
