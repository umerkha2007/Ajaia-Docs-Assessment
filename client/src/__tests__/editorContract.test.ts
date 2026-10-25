import { Editor } from '@tiptap/react';
import { afterEach, describe, expect, it } from 'vitest';
import { AppError } from '../../../server/src/errors';
import { validateContent } from '../../../server/src/validation';
import { editorExtensions } from '../editor/extensions';

// These tests drive the real Tiptap editor (headless) with the same commands the
// toolbar uses, then check the JSON it produces against the server's validator.

const editors: Editor[] = [];
function makeEditor(content: unknown): Editor {
  const e = new Editor({ element: document.createElement('div'), extensions: editorExtensions, content: content as never });
  editors.push(e);
  return e;
}
afterEach(() => {
  while (editors.length) editors.pop()!.destroy();
});

const para = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
const accepted = (json: unknown) => expect(() => validateContent(json)).not.toThrow();

type Json = { content?: { type: string; attrs?: Record<string, unknown>; content?: Json['content'] }[] };
type TextNode = { type: 'text'; text: string; marks?: { type: string }[] };
type AnyNode = { type: string; content?: AnyNode[] } | TextNode;
const firstText = (json: unknown): TextNode => {
  const walk = (n: AnyNode): TextNode | undefined =>
    n.type === 'text' ? (n as TextNode) : ((n as { content?: AnyNode[] }).content ?? []).map(walk).find(Boolean);
  return walk(json as AnyNode)!;
};

describe('Rich-Text Formatting: toolbar commands produce valid, storable content', () => {
  it.each([
    ['bold', (e: Editor) => e.chain().selectAll().toggleBold().run()],
    ['italic', (e: Editor) => e.chain().selectAll().toggleItalic().run()],
    ['underline', (e: Editor) => e.chain().selectAll().toggleUnderline().run()],
  ])('[FR-1.7] %s: applying then removing the mark changes the JSON and passes server validation', (mark, toggle) => {
    const e = makeEditor(para('hello'));
    toggle(e);
    const on = e.getJSON();
    expect(firstText(on).marks).toEqual([{ type: mark }]);
    accepted(on);
    toggle(e);
    expect(firstText(e.getJSON()).marks).toBeUndefined();
  });

  it('[FR-1.7] bold, italic and underline can be combined on the same text', () => {
    const e = makeEditor(para('hello'));
    e.chain().selectAll().toggleBold().toggleItalic().toggleUnderline().run();
    const marks = firstText(e.getJSON()).marks!.map((m: { type: string }) => m.type).sort();
    expect(marks).toEqual(['bold', 'italic', 'underline']);
    accepted(e.getJSON());
  });

  it.each([1, 2, 3] as const)('[FR-1.8] heading level %i is created, validated, and toggles back to a paragraph', (level) => {
    const e = makeEditor(para('Title'));
    e.chain().selectAll().toggleHeading({ level }).run();
    const json = e.getJSON() as Json;
    expect(json.content![0]).toMatchObject({ type: 'heading', attrs: { level } });
    accepted(json);
    e.chain().selectAll().toggleHeading({ level }).run();
    expect((e.getJSON() as Json).content![0]!.type).toBe('paragraph');
  });

  it('[FR-1.8] the editor offers no heading level beyond 3', () => {
    const e = makeEditor(para('x'));
    e.chain().selectAll().setHeading({ level: 4 as never }).run();
    expect((e.getJSON() as Json).content![0]!.type).toBe('paragraph');
  });

  it('[FR-1.9] bulleted list: created, valid, and toggles off', () => {
    const e = makeEditor(para('item'));
    e.chain().selectAll().toggleBulletList().run();
    const json = e.getJSON() as Json;
    expect(json.content![0]!.type).toBe('bulletList');
    expect(json.content![0]!.content![0]!.type).toBe('listItem');
    accepted(json);
    e.chain().selectAll().toggleBulletList().run();
    expect((e.getJSON() as Json).content![0]!.type).toBe('paragraph');
  });

  it('[FR-1.9] numbered list: created, valid, and toggles off', () => {
    const e = makeEditor(para('item'));
    e.chain().selectAll().toggleOrderedList().run();
    const json = e.getJSON() as Json;
    expect(json.content![0]!.type).toBe('orderedList');
    accepted(json);
    e.chain().selectAll().toggleOrderedList().run();
    expect((e.getJSON() as Json).content![0]!.type).toBe('paragraph');
  });

  it('[FR-1.9] a bulleted list can be switched to a numbered list without losing its text', () => {
    const e = makeEditor(para('keep me'));
    e.chain().selectAll().toggleBulletList().run();
    e.chain().selectAll().toggleOrderedList().run();
    const json = e.getJSON() as Json;
    expect(json.content![0]!.type).toBe('orderedList');
    expect(firstText(json).text).toBe('keep me');
  });
});

describe('Rich-Text Formatting: stored content loads back unchanged', () => {
  const t = (text: string, ...marks: string[]) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
  const li = (...c: unknown[]) => ({ type: 'listItem', content: c });
  const full = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [t('H1')] },
      { type: 'heading', attrs: { level: 2 }, content: [t('H2')] },
      { type: 'heading', attrs: { level: 3 }, content: [t('H3')] },
      { type: 'paragraph', content: [t('plain '), t('b', 'bold'), t(' '), t('i', 'italic'), t(' '), t('u', 'underline'), t(' '), t('all', 'bold', 'italic', 'underline')] },
      { type: 'bulletList', content: [li({ type: 'paragraph', content: [t('one')] }), li({ type: 'paragraph', content: [t('two')] })] },
      { type: 'orderedList', attrs: { start: 1, type: null }, content: [li({ type: 'paragraph', content: [t('first')] }, { type: 'bulletList', content: [li({ type: 'paragraph', content: [t('nested')] })] })] },
    ],
  };

  it('[FR-1.7][FR-1.8][FR-1.9] loading saved JSON into the editor and reading it back gives identical JSON', () => {
    accepted(full);
    expect(makeEditor(full).getJSON()).toEqual(full);
  });

  it('[FR-1.7] a second load-and-read cycle is stable (no drift on repeated save/reopen)', () => {
    const once = makeEditor(full).getJSON();
    expect(makeEditor(once).getJSON()).toEqual(once);
  });

  it('[FR-1.4] an empty new document loads as one empty paragraph and passes validation', () => {
    const empty = { type: 'doc', content: [{ type: 'paragraph' }] };
    expect(makeEditor(empty).getJSON()).toEqual(empty);
    accepted(empty);
  });
});

describe('Validation and Error Handling: unsupported markup cannot leave the editor', () => {
  it('[NFR-VAL] pasted HTML with links, images, scripts, code and quotes is reduced to allowed content', () => {
    const html =
      // Both a harmless https link and a javascript: link: neither may survive as a link mark.
      '<h1>Keep</h1><p>a <a href="https://example.test">safe link</a> <a href="javascript:alert(1)">link</a> <img src=x onerror=alert(1)> <script>alert(1)</script>' +
      '<code>code</code> <s>strike</s></p><blockquote>quote</blockquote><pre>pre</pre><hr>';
    const e = makeEditor('');
    e.commands.setContent(html);
    const json = e.getJSON();
    accepted(json);
    const text = JSON.stringify(json);
    expect(text).not.toMatch(/javascript:|onerror|<script|"link"|"image"|"code"|"strike"/);
    expect(text).toContain('Keep');
  });

  it('[NFR-VAL] the server validator really would reject what the editor refuses to emit (sanity check of the contract)', () => {
    const withLink = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'https://x.test' } }] }] }] };
    expect(() => validateContent(withLink)).toThrow(AppError);
  });
});

// ---------------------------------------------------------------------------
// The same contract for the collaborative editor: what a browser sends the server is a
// Yjs document, and the server turns it back into JSON with its own code (contentOf).
// Whatever the toolbar can do must survive that round trip and pass the validator.
// ---------------------------------------------------------------------------
import Collaboration from '@tiptap/extension-collaboration';
import { prosemirrorJSONToYDoc } from '@tiptap/y-tiptap';
import { getSchema } from '@tiptap/core';
import * as Y from 'yjs';
import { contentOf } from '../../../server/src/collab/ydoc';
import { YJS_FIELD } from '../editor/extensions';

describe('Autosave and Sync: the collaborative editor produces content the server accepts', () => {
  const seeded = () => prosemirrorJSONToYDoc(getSchema(editorExtensions), para('hello world'), YJS_FIELD);
  const collab = (ydoc: Y.Doc): Editor => {
    const e = new Editor({
      element: document.createElement('div'),
      extensions: [...editorExtensions, Collaboration.configure({ document: ydoc, field: YJS_FIELD })],
    });
    editors.push(e);
    return e;
  };

  it('[FR-5.2] an unedited shared document converts to exactly the content it was created from', () => {
    const ydoc = seeded();
    collab(ydoc);
    expect(contentOf(ydoc)).toEqual(para('hello world'));
  });

  it.each([
    ['bold', (e: Editor) => e.chain().selectAll().toggleBold().run(), '"marks":[{"type":"bold"}]'],
    ['italic', (e: Editor) => e.chain().selectAll().toggleItalic().run(), '"marks":[{"type":"italic"}]'],
    ['underline', (e: Editor) => e.chain().selectAll().toggleUnderline().run(), '"marks":[{"type":"underline"}]'],
    ['heading 1', (e: Editor) => e.chain().selectAll().toggleHeading({ level: 1 }).run(), '"type":"heading","attrs":{"level":1}'],
    ['heading 3', (e: Editor) => e.chain().selectAll().toggleHeading({ level: 3 }).run(), '"level":3'],
    ['bulleted list', (e: Editor) => e.chain().selectAll().toggleBulletList().run(), '"type":"bulletList"'],
    ['numbered list', (e: Editor) => e.chain().selectAll().toggleOrderedList().run(), '"type":"orderedList"'],
  ])('[FR-5.2][FR-1.7] %s applied in the collaborative editor is stored by the server as valid content', (_name, apply, expected) => {
    const ydoc = seeded();
    const editor = collab(ydoc);
    apply(editor);
    const stored = contentOf(ydoc); // throws if the server would refuse it
    expect(JSON.stringify(stored)).toContain(expected);
    expect(() => validateContent(stored)).not.toThrow();
    expect(JSON.stringify(stored)).toContain('hello world');
  });

  it('[FR-5.2] combined marks, nested lists and typed text all convert to valid content', () => {
    const ydoc = seeded();
    const editor = collab(ydoc);
    editor.chain().selectAll().toggleBold().toggleItalic().toggleUnderline().toggleBulletList().run();
    editor.chain().focus('end').insertContent(' more').run();
    const stored = contentOf(ydoc);
    expect(() => validateContent(stored)).not.toThrow();
    expect(JSON.stringify(stored)).toContain('hello world more');
    const marks = (JSON.stringify(stored).match(/"type":"(bold|italic|underline)"/g) ?? []).length;
    expect(marks).toBeGreaterThanOrEqual(3);
  });

  it('[FR-5.3] two editors on two copies of the document, edited at the same time, merge into valid content that has both edits', () => {
    const base = seeded();
    const copyA = new Y.Doc();
    const copyB = new Y.Doc();
    Y.applyUpdate(copyA, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(copyB, Y.encodeStateAsUpdate(base));
    const a = collab(copyA);
    const b = collab(copyB);
    a.chain().focus('start').insertContent('Alice ').run();
    b.chain().focus('end').insertContent(' Bob').run();
    Y.applyUpdate(copyA, Y.encodeStateAsUpdate(copyB, Y.encodeStateVector(copyA)));
    Y.applyUpdate(copyB, Y.encodeStateAsUpdate(copyA, Y.encodeStateVector(copyB)));
    expect(a.getText()).toBe('Alice hello world Bob');
    expect(b.getText()).toBe('Alice hello world Bob');
    expect(() => validateContent(contentOf(copyA))).not.toThrow();
    expect(contentOf(copyA)).toEqual(contentOf(copyB));
  });
});
