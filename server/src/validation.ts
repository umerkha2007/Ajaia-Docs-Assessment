import { AppError } from './errors.js';

export const TITLE_MAX = 200;
export const CONTENT_MAX_BYTES = 1_000_000;
export const MAX_DEPTH = 30;
export const MAX_NODES = 20_000;
export const DEFAULT_TITLE = 'Untitled document';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function validateDocumentId(id: unknown): string {
  if (typeof id !== 'string' || !UUID.test(id)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid document id');
  }
  return id.toLowerCase();
}

/** Trims, then requires 1..TITLE_MAX characters and no control characters. */
export function validateTitle(title: unknown): string {
  if (typeof title !== 'string') throw new AppError('VALIDATION_ERROR', 'Title must be a string');
  const t = title.trim();
  if (t.length === 0) throw new AppError('VALIDATION_ERROR', 'Title must not be empty');
  if (t.length > TITLE_MAX) {
    throw new AppError('VALIDATION_ERROR', `Title must be at most ${TITLE_MAX} characters`);
  }
  if (CONTROL_CHARS.test(t)) {
    throw new AppError('VALIDATION_ERROR', 'Title must not contain control characters');
  }
  return t;
}

// ---------------------------------------------------------------------------
// Document content schema (Tiptap/ProseMirror JSON)
//
// An allowlist that mirrors the editor's schema in client/src/editor/extensions.ts.
// A contract test (client/src/__tests__/editorContract.test.ts) checks that
// everything the editor can emit passes this validator. Anything not listed is
// rejected, so stored content can never carry scripts, links, images or
// arbitrary attributes. Phase 4 imports must also produce content that passes.
// ---------------------------------------------------------------------------

const MARKS = new Set(['bold', 'italic', 'underline']);
const BLOCKS = ['paragraph', 'heading', 'bulletList', 'orderedList'];

/** Allowed child node types per node type. */
const CHILDREN: Record<string, readonly string[]> = {
  doc: BLOCKS,
  paragraph: ['text'],
  heading: ['text'],
  bulletList: ['listItem'],
  orderedList: ['listItem'],
  listItem: BLOCKS,
  text: [],
};

const bad = (message: string): never => {
  throw new AppError('VALIDATION_ERROR', message);
};

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

function validateAttrs(type: string, attrs: unknown): void {
  if (attrs === undefined) {
    if (type === 'heading') bad('Heading requires a level');
    return;
  }
  if (!isPlainObject(attrs)) return bad(`Invalid attributes on "${type}"`);
  const keys = Object.keys(attrs);
  if (type === 'heading') {
    if (keys.some((k) => k !== 'level')) bad('Unknown attribute on "heading"');
    if (!isInt(attrs.level, 1, 3)) bad('Heading level must be an integer from 1 to 3');
  } else if (type === 'orderedList') {
    if (keys.some((k) => k !== 'start' && k !== 'type')) bad('Unknown attribute on "orderedList"');
    if (attrs.start !== undefined && !isInt(attrs.start, 1, 1_000_000)) bad('Invalid list start number');
    const t = attrs.type;
    if (t !== undefined && t !== null && !(typeof t === 'string' && t.length <= 10)) bad('Invalid list type');
  } else if (keys.length > 0) {
    bad(`Attributes are not allowed on "${type}"`);
  }
}

function validateMarks(marks: unknown): void {
  if (!Array.isArray(marks)) return bad('Text marks must be an array');
  for (const m of marks) {
    if (!isPlainObject(m) || typeof m.type !== 'string' || !MARKS.has(m.type)) {
      bad('Mark type is not allowed');
    }
    if (Object.keys(m as Record<string, unknown>).some((k) => k !== 'type')) bad('Attributes are not allowed on marks');
  }
}

function validateNode(node: unknown, parent: string, depth: number, counter: { n: number }): void {
  if (depth > MAX_DEPTH) bad('Document is nested too deeply');
  if (++counter.n > MAX_NODES) bad('Document has too many nodes');
  if (!isPlainObject(node) || typeof node.type !== 'string') return bad('Every node must be an object with a type');
  const type = node.type;
  if (type === 'doc' || !Object.hasOwn(CHILDREN, type)) bad(`Node type "${type}" is not allowed`);
  if (!CHILDREN[parent]!.includes(type)) bad(`Node "${type}" is not allowed inside "${parent}"`);

  const allowedKeys = new Set(['type']);
  if (type === 'text') {
    allowedKeys.add('text').add('marks');
  } else {
    allowedKeys.add('attrs');
    if (CHILDREN[type]!.length > 0) allowedKeys.add('content');
  }
  for (const k of Object.keys(node)) if (!allowedKeys.has(k)) bad(`Unknown property "${k}" on "${type}"`);

  if (type === 'text') {
    if (typeof node.text !== 'string' || node.text.length === 0) bad('Text nodes need non-empty text');
    if (node.marks !== undefined) validateMarks(node.marks);
    return;
  }
  validateAttrs(type, node.attrs);
  if (node.content === undefined) return;
  if (!Array.isArray(node.content)) return bad(`Content of "${type}" must be an array`);
  for (const child of node.content) validateNode(child, type, depth + 1, counter);
}

/**
 * Validates a document against the allowlist schema above, then the size limit.
 * Structure is checked first so a hostile, deeply nested payload is rejected
 * before anything recursive (such as JSON.stringify) touches it.
 */
export function validateContent(content: unknown): Record<string, unknown> {
  if (!isPlainObject(content) || content.type !== 'doc') {
    throw new AppError('VALIDATION_ERROR', 'Content must be a document object with type "doc"');
  }
  for (const k of Object.keys(content)) {
    if (k !== 'type' && k !== 'content') bad(`Unknown property "${k}" on "doc"`);
  }
  if (content.content !== undefined && !Array.isArray(content.content)) {
    throw new AppError('VALIDATION_ERROR', 'Content "content" must be an array');
  }
  const counter = { n: 0 };
  for (const child of (content.content as unknown[] | undefined) ?? []) validateNode(child, 'doc', 1, counter);
  if (new TextEncoder().encode(JSON.stringify(content)).length > CONTENT_MAX_BYTES) {
    throw new AppError('VALIDATION_ERROR', `Content must be at most ${CONTENT_MAX_BYTES} bytes`);
  }
  return content;
}
