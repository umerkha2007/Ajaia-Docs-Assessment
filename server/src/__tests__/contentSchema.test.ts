import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { MAX_DEPTH, MAX_NODES, validateContent } from '../validation.js';

const text = (t: string, marks?: unknown[]) => ({ type: 'text', text: t, ...(marks ? { marks } : {}) });
const p = (...c: unknown[]) => ({ type: 'paragraph', ...(c.length ? { content: c } : {}) });
const doc = (...c: unknown[]) => ({ type: 'doc', content: c });
const li = (...c: unknown[]) => ({ type: 'listItem', content: c });

const rejects = (content: unknown, message?: RegExp) => {
  try {
    validateContent(content);
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe('VALIDATION_ERROR');
    if (message) expect((e as AppError).message).toMatch(message);
    return;
  }
  expect.unreachable('expected validation to fail');
};

describe('Rich-Text Formatting: content schema accepts what the editor can produce', () => {
  it('[FR-1.7] accepts an empty document and an empty paragraph', () => {
    expect(() => validateContent({ type: 'doc' })).not.toThrow();
    expect(() => validateContent(doc(p()))).not.toThrow();
  });

  it.each(['bold', 'italic', 'underline'])('[FR-1.7] accepts the %s mark', (mark) => {
    expect(() => validateContent(doc(p(text('x', [{ type: mark }]))))).not.toThrow();
  });

  it('[FR-1.7] accepts combined marks', () => {
    const marks = [{ type: 'bold' }, { type: 'italic' }, { type: 'underline' }];
    expect(() => validateContent(doc(p(text('x', marks))))).not.toThrow();
  });

  it.each([1, 2, 3])('[FR-1.8] accepts heading level %i', (level) => {
    expect(() => validateContent(doc({ type: 'heading', attrs: { level }, content: [text('h')] }))).not.toThrow();
  });

  it('[FR-1.9] accepts bulleted and numbered lists, including nesting and orderedList attrs', () => {
    const bullets = { type: 'bulletList', content: [li(p(text('a'))), li(p(text('b')))] };
    const numbered = { type: 'orderedList', attrs: { start: 1, type: null }, content: [li(p(text('1')), bullets)] };
    expect(() => validateContent(doc(bullets, numbered))).not.toThrow();
  });

  it('[FR-1.7] returns the content unchanged', () => {
    const d = doc(p(text('same', [{ type: 'bold' }])));
    expect(validateContent(d)).toEqual(d);
  });
});

describe('Validation and Error Handling: content schema rejects anything else', () => {
  it.each([
    ['script-like node', doc({ type: 'script', content: [text('alert(1)')] })],
    ['image node', doc({ type: 'image', attrs: { src: 'javascript:alert(1)' } })],
    ['codeBlock (not enabled)', doc({ type: 'codeBlock', content: [text('x')] })],
    ['a nested doc node', doc({ type: 'doc', content: [] })],
  ])('[NFR-VAL] rejects a disallowed node: %s', (_l, bad) => rejects(bad, /not allowed|Unknown/i));

  it.each([
    ['link with href', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }]],
    ['link without attrs', [{ type: 'link' }]],
    ['strike', [{ type: 'strike' }]],
    ['code', [{ type: 'code' }]],
    ['mark with attrs', [{ type: 'bold', attrs: { onclick: 'x' } }]],
    ['mark that is not an object', ['bold']],
  ])('[NFR-VAL] rejects a disallowed mark: %s', (_l, marks) => rejects(doc(p(text('x', marks as unknown[])))));

  it.each([0, 4, 7, -1, 1.5, '1', null, undefined])('[NFR-VAL] rejects heading level %s', (level) => {
    const attrs = level === undefined ? {} : { level };
    rejects(doc({ type: 'heading', attrs, content: [text('h')] }));
  });

  it('[NFR-VAL] rejects unknown attributes on known nodes', () => {
    rejects(doc({ type: 'heading', attrs: { level: 1, id: 'x' }, content: [text('h')] }));
    rejects(doc({ type: 'paragraph', attrs: { class: 'evil' } }));
  });

  it('[NFR-VAL] rejects unknown top-level keys on a node', () => {
    rejects(doc({ type: 'paragraph', html: '<img src=x onerror=alert(1)>' }));
  });

  it('[NFR-VAL] rejects invalid structure: text directly in the doc, blocks inside paragraphs, items outside lists', () => {
    rejects(doc(text('loose')));
    rejects(doc(p(p(text('nested')))));
    rejects(doc(li(p(text('orphan')))));
    rejects(doc({ type: 'bulletList', content: [p(text('not an item'))] }));
    rejects(doc({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'bulletList', content: [] }] }));
  });

  it('[NFR-VAL] rejects malformed text nodes', () => {
    rejects(doc(p({ type: 'text' })));
    rejects(doc(p({ type: 'text', text: '' })));
    rejects(doc(p({ type: 'text', text: 5 })));
    rejects(doc(p({ type: 'text', text: 'x', content: [] })));
    rejects(doc({ type: 'paragraph', content: 'plain string' }));
  });

  it('[NFR-VAL] rejects documents nested deeper than the limit', () => {
    let node: unknown = p(text('deep'));
    for (let i = 0; i < MAX_DEPTH + 2; i++) node = { type: 'bulletList', content: [li(node)] };
    rejects(doc(node), /nested too deeply/);
  });

  it('[NFR-VAL] rejects documents with too many nodes', () => {
    const many = Array.from({ length: MAX_NODES + 1 }, () => p());
    rejects(doc(...many), /too many nodes/);
  });

  it('[NFR-VAL] rejects prototype-pollution style keys without polluting Object.prototype', () => {
    rejects(JSON.parse('{"type":"doc","content":[{"type":"paragraph","__proto__":{"polluted":true}}]}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
