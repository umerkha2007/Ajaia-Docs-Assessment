import { Lexer } from 'marked';
import { paragraph, stripControlChars, textToBlocks, type BlockNode, type Doc, type TextNode } from './text.js';

/**
 * Markdown to the editor's document schema.
 *
 * Only marked's *lexer* is used: tokens in, document JSON out. No HTML is ever
 * generated, so markup in the file cannot become markup in the document. Anything
 * the editor has no node for (links, images, code, quotes, tables, raw HTML)
 * degrades to its text, which is stored as ordinary, inert text.
 */

interface Tok {
  type: string;
  text?: string;
  tokens?: Tok[];
  depth?: number;
  ordered?: boolean;
  start?: number | '';
  items?: Tok[];
  task?: boolean;
  checked?: boolean;
  header?: Tok[];
  rows?: Tok[][];
}

type Mark = 'bold' | 'italic';
const MARK_ORDER: Mark[] = ['bold', 'italic'];

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };
const decode = (s: string) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_m, e: string) => ENTITIES[e]!);

const sameMarks = (a: TextNode, b: TextNode) => JSON.stringify(a.marks ?? []) === JSON.stringify(b.marks ?? []);

function textNode(text: string, marks: ReadonlySet<Mark>): TextNode {
  const ordered = MARK_ORDER.filter((m) => marks.has(m));
  return ordered.length ? { type: 'text', text, marks: ordered.map((type) => ({ type })) } : { type: 'text', text };
}

function merge(nodes: TextNode[]): TextNode[] {
  const out: TextNode[] = [];
  for (const n of nodes) {
    const last = out[out.length - 1];
    if (last && sameMarks(last, n)) last.text += n.text;
    else out.push({ ...n });
  }
  return out;
}

/** Trim the outer edges of a run of text nodes and drop anything left empty. */
function tidy(nodes: TextNode[]): TextNode[] {
  const out = merge(nodes);
  if (out.length) out[0]!.text = out[0]!.text.trimStart();
  if (out.length) out[out.length - 1]!.text = out[out.length - 1]!.text.trimEnd();
  return out.filter((n) => n.text.length > 0);
}

/** Inline tokens to runs of text nodes. A hard line break (two trailing spaces) starts a new run. */
function inlineRuns(tokens: Tok[] | undefined): TextNode[][] {
  const runs: TextNode[][] = [[]];
  const push = (raw: string, marks: ReadonlySet<Mark>) => {
    // Soft line breaks inside a paragraph are just whitespace in Markdown.
    const text = stripControlChars(decode(raw)).replace(/\s*\n\s*/g, ' ');
    if (text) runs[runs.length - 1]!.push(textNode(text, marks));
  };
  const walk = (list: Tok[] | undefined, marks: ReadonlySet<Mark>): void => {
    for (const t of list ?? []) {
      switch (t.type) {
        case 'strong': walk(t.tokens, new Set([...marks, 'bold'] as Mark[])); break;
        case 'em': walk(t.tokens, new Set([...marks, 'italic'] as Mark[])); break;
        case 'br': runs.push([]); break;
        case 'checkbox': break; // handled by the list item
        case 'text':
        case 'escape':
        case 'codespan':
        case 'image': // alt text only
        case 'html': // raw HTML stays literal text
          if (t.tokens?.length) walk(t.tokens, marks);
          else push(t.text ?? '', marks);
          break;
        default: // link, del, and anything unknown: keep the text, drop the wrapper
          if (t.tokens?.length) walk(t.tokens, marks);
          else if (t.text) push(t.text, marks);
      }
    }
  };
  walk(tokens, new Set());
  return runs.map(tidy).filter((r) => r.length > 0);
}

const para = (nodes: TextNode[]): BlockNode => ({ type: 'paragraph', content: nodes });

/** Plain text of inline tokens, ignoring formatting (used for table cells). */
const plain = (tokens: Tok[] | undefined) => inlineRuns(tokens).map((r) => r.map((n) => n.text).join('')).join(' ');

function listItem(item: Tok): BlockNode {
  const content = blocks((item.tokens ?? []).filter((t) => t.type !== 'checkbox'));
  if (item.task) {
    const box = item.checked ? '[x]' : '[ ]';
    const first = content[0];
    if (first?.type === 'paragraph' && first.content?.length) {
      const head = first.content[0] as TextNode;
      if (head.marks) first.content.unshift({ type: 'text', text: `${box} ` });
      else head.text = `${box} ${head.text}`;
    } else {
      content.unshift(paragraph(box));
    }
  }
  // A list item must start with a paragraph.
  if (content.length === 0 || content[0]!.type !== 'paragraph') content.unshift(paragraph(''));
  return { type: 'listItem', content };
}

function list(tok: Tok): BlockNode {
  const items = (tok.items ?? []).map(listItem);
  if (!tok.ordered) return { type: 'bulletList', content: items };
  const start = typeof tok.start === 'number' && Number.isInteger(tok.start) && tok.start >= 1 && tok.start <= 1_000_000 ? tok.start : 1;
  return { type: 'orderedList', attrs: { start, type: null }, content: items };
}

function blocks(tokens: Tok[] | undefined): BlockNode[] {
  const out: BlockNode[] = [];
  for (const tok of tokens ?? []) {
    switch (tok.type) {
      case 'heading': {
        const runs = inlineRuns(tok.tokens);
        const nodes = runs.flatMap((r, i) => (i === 0 ? r : [{ type: 'text', text: ' ' } as TextNode, ...r]));
        if (nodes.length) out.push({ type: 'heading', attrs: { level: Math.min(Math.max(tok.depth ?? 1, 1), 3) }, content: merge(nodes) });
        break;
      }
      case 'paragraph':
      case 'text':
        for (const run of inlineRuns(tok.tokens ?? [{ type: 'text', text: tok.text }])) out.push(para(run));
        break;
      case 'list': out.push(list(tok)); break;
      case 'blockquote': out.push(...blocks(tok.tokens)); break;
      case 'code':
      case 'html':
        out.push(...textToBlocks(decode(tok.text ?? '')));
        break;
      case 'table':
        for (const row of [tok.header ?? [], ...(tok.rows ?? [])]) {
          const text = row.map((c) => plain(c.tokens)).join(' | ');
          if (text.replace(/[\s|]/g, '')) out.push(paragraph(text));
        }
        break;
      default: // hr, space, def, and anything unknown produce nothing
    }
  }
  return out;
}

export function markdownToDoc(src: string): Doc {
  const tokens = new Lexer().lex(src.replace(/\r\n?/g, '\n')) as unknown as Tok[];
  return { type: 'doc', content: blocks(tokens) };
}
