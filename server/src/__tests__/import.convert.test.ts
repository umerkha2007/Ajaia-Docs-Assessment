import { describe, expect, it } from 'vitest';
import { markdownToDoc } from '../import/markdown.js';
import { textToDoc } from '../import/text.js';
import { validateContent } from '../validation.js';

type N = { type: string; text?: string; attrs?: Record<string, unknown>; marks?: { type: string }[]; content?: N[] };
const blocks = (doc: unknown) => (doc as { content: N[] }).content;
const t = (text: string, ...marks: string[]): N => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
const p = (...c: N[]): N => ({ type: 'paragraph', ...(c.length ? { content: c } : {}) });
/** Every conversion result must be storable, whatever the input. */
const valid = <T>(doc: T): T => (validateContent(doc), doc);

describe('File Import: plain text conversion', () => {
  it('[FR-2.1] turns each line into a paragraph', () => {
    expect(blocks(valid(textToDoc('one\ntwo\nthree')))).toEqual([p(t('one')), p(t('two')), p(t('three'))]);
  });

  it('[FR-2.1] normalises Windows and old-Mac line endings', () => {
    expect(blocks(textToDoc('a\r\nb\rc'))).toEqual([p(t('a')), p(t('b')), p(t('c'))]);
  });

  it('[FR-2.1] keeps a single blank line as an empty paragraph and collapses longer runs', () => {
    expect(blocks(textToDoc('a\n\n\n\n\nb'))).toEqual([p(t('a')), p(), p(t('b'))]);
  });

  it('[FR-2.1] trims leading and trailing blank lines', () => {
    expect(blocks(textToDoc('\n\n  \nhello\n\n\n'))).toEqual([p(t('hello'))]);
  });

  it('[FR-2.1] preserves leading spaces and tabs within a line', () => {
    expect(blocks(textToDoc('  indented\n\ttabbed'))).toEqual([p(t('  indented')), p(t('\ttabbed'))]);
  });

  it('[FR-2.1] a line of only spaces becomes an empty paragraph', () => {
    expect(blocks(textToDoc('a\n   \nb'))).toEqual([p(t('a')), p(), p(t('b'))]);
  });

  it('[FR-2.1] strips control characters but keeps tabs and unicode', () => {
    expect(blocks(textToDoc('a\u0001b\u0007c' + String.fromCharCode(0x200b) + 'é 日本 😀'))).toEqual([p(t('abc' + String.fromCharCode(0x200b) + 'é 日本 😀'))]);
  });

  it('[NFR-VAL] markup in a .txt file is kept as literal text', () => {
    const html = '<script>alert(1)</script><img src=x onerror=alert(1)>';
    expect(blocks(valid(textToDoc(html)))).toEqual([p(t(html))]);
  });
});

describe('File Import: Markdown conversion', () => {
  it('[FR-2.2] headings 1-3 map to heading levels and deeper levels are clamped to 3', () => {
    const out = blocks(valid(markdownToDoc('# a\n\n## b\n\n### c\n\n#### d\n\n###### e')));
    expect(out.map((n) => n.attrs?.level)).toEqual([1, 2, 3, 3, 3]);
    expect(out.every((n) => n.type === 'heading')).toBe(true);
    expect(out[3]!.content).toEqual([t('d')]);
  });

  it('[FR-2.2] bold, italic and nested emphasis become marks', () => {
    const out = blocks(valid(markdownToDoc('plain **bold** *ital* ***both*** __b2__ _i2_')));
    expect(out[0]!.content).toEqual([
      t('plain '), t('bold', 'bold'), t(' '), t('ital', 'italic'), t(' '), t('both', 'bold', 'italic'), t(' '), t('b2', 'bold'), t(' '), t('i2', 'italic'),
    ]);
  });

  it('[FR-2.2] adjacent text with the same marks is merged into one text node', () => {
    expect(blocks(markdownToDoc('a \\* b \\_ c'))[0]!.content).toEqual([t('a * b _ c')]);
    expect(blocks(markdownToDoc('**a \\* b**'))[0]!.content).toEqual([t('a * b', 'bold')]);
  });

  it('[FR-2.2] bulleted lists become bulletList with paragraph items', () => {
    const out = blocks(valid(markdownToDoc('- one\n- two')));
    expect(out).toEqual([{ type: 'bulletList', content: [{ type: 'listItem', content: [p(t('one'))] }, { type: 'listItem', content: [p(t('two'))] }] }]);
  });

  it('[FR-2.2] numbered lists become orderedList and keep their start number', () => {
    const out = blocks(valid(markdownToDoc('3. three\n4. four')));
    expect(out[0]).toMatchObject({ type: 'orderedList', attrs: { start: 3 } });
    expect(out[0]!.content).toHaveLength(2);
  });

  it('[FR-2.2] nested lists, and a list item that starts with a nested list, stay valid', () => {
    const out = blocks(valid(markdownToDoc('- a\n  1. x\n  2. y\n- b')));
    const first = out[0]!.content![0]!;
    expect(first.content![0]).toEqual(p(t('a')));
    expect(first.content![1]!.type).toBe('orderedList');
    valid(markdownToDoc('- \n  - nested only'));
  });

  it('[FR-2.2] inline formatting inside list items and headings is kept', () => {
    const out = blocks(valid(markdownToDoc('# Hello **world**\n\n- an *item*')));
    expect(out[0]!.content).toEqual([t('Hello '), t('world', 'bold')]);
    expect(out[1]!.content![0]!.content![0]!.content).toEqual([t('an '), t('item', 'italic')]);
  });

  it('[FR-2.2] soft line breaks inside a paragraph join with a space; two trailing spaces start a new paragraph', () => {
    expect(blocks(markdownToDoc('one\ntwo'))[0]).toEqual(p(t('one two')));
    expect(blocks(markdownToDoc('one  \ntwo'))).toEqual([p(t('one')), p(t('two'))]);
  });

  it('[FR-2.2] task list items keep their checkbox state as text', () => {
    const out = blocks(valid(markdownToDoc('- [x] done\n- [ ] todo')));
    const texts = out[0]!.content!.map((li) => li.content![0]!.content![0]!.text);
    expect(texts).toEqual(['[x] done', '[ ] todo']);
  });

  it('[FR-2.2] separate paragraphs stay separate', () => {
    expect(blocks(markdownToDoc('first\n\nsecond'))).toEqual([p(t('first')), p(t('second'))]);
  });

  it('[FR-2.2] decodes the basic HTML entities that Markdown renders', () => {
    expect(blocks(markdownToDoc('AT&amp;T &lt;ok&gt; &quot;q&quot; it&#39;s'))[0]).toEqual(p(t('AT&T <ok> "q" it\'s')));
  });

  it('[FR-2.2] backslash escapes give the literal character', () => {
    expect(blocks(markdownToDoc('\\*not bold\\*'))[0]).toEqual(p(t('*not bold*')));
  });
});

describe('File Import: Markdown features outside the editor schema degrade safely', () => {
  it('[NFR-VAL] links keep their text but lose the link and URL; images keep alt text', () => {
    const out = blocks(valid(markdownToDoc('see [the docs](https://x.test) and ![a cat](cat.png) and [bad](javascript:alert(1))')));
    expect(out[0]).toEqual(p(t('see the docs and a cat and bad')));
    expect(JSON.stringify(out)).not.toMatch(/https:|javascript|cat\.png/);
  });

  it('[NFR-VAL] inline code, strike-through and code blocks become plain text', () => {
    const out = blocks(valid(markdownToDoc('use `npm test` and ~~old~~\n\n```js\nconst a = 1;\n\nconst b = 2;\n```')));
    expect(out[0]).toEqual(p(t('use npm test and old')));
    expect(out.slice(1).map((n) => n.content?.[0]?.text ?? '')).toEqual(['const a = 1;', '', 'const b = 2;']);
  });

  it('[NFR-VAL] blockquotes keep their text; horizontal rules disappear', () => {
    const out = blocks(valid(markdownToDoc('> quoted\n\n---\n\nafter')));
    expect(out).toEqual([p(t('quoted')), p(t('after'))]);
  });

  it('[NFR-VAL] tables become one paragraph per row with cells separated by " | "', () => {
    const out = blocks(valid(markdownToDoc('| a | b |\n|---|---|\n| 1 | 2 |')));
    expect(out).toEqual([p(t('a | b')), p(t('1 | 2'))]);
  });

  it('[NFR-VAL] raw HTML (block and inline) is kept as inert literal text, never as markup', () => {
    const out = blocks(valid(markdownToDoc('<script>alert(1)</script>\n\nhi <b>there</b> <img src=x onerror=alert(1)>')));
    expect(JSON.stringify(out)).toContain('<script>alert(1)</script>');
    expect(out.every((n) => n.type === 'paragraph')).toBe(true);
    expect(JSON.stringify(out)).not.toMatch(/"type":"(html|image|script)"/);
  });

  it('[NFR-VAL] link reference definitions produce no output', () => {
    expect(blocks(markdownToDoc('[ref]: https://x.test\n\ntext'))).toEqual([p(t('text'))]);
  });

  it('[NFR-VAL] every sample, however odd, converts to a document the server accepts', () => {
    const samples = [
      '', '   ', '#', '# ', '- ', '1.', '> ', '```', '|a|', '***', '* * *', '\\', '<>', '[](', '![]()', '- a\n\n  b\n\n- c',
      '1. a\n   - b\n     1. c\n        - d', '> - quote list\n> 1. n', '# H1\ntext\n## H2\n- x', 'a  \n  \nb',
      '- [ ]', '~~~\ncode\n~~~', '<!-- comment -->', '&nbsp; &#x41; &unknown;',
    ];
    for (const s of samples) expect(() => validateContent(markdownToDoc(s)), JSON.stringify(s)).not.toThrow();
  });
});
