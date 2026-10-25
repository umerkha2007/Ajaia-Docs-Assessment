/** Minimal node shapes for building documents; validateContent is the authority on what is storable. */
export interface TextNode {
  type: 'text';
  text: string;
  marks?: { type: string }[];
}
export interface BlockNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: (BlockNode | TextNode)[];
}
export interface Doc {
  type: 'doc';
  content: BlockNode[];
}

// C0 controls except tab, plus DEL. Newlines are split out before this runs.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

export const stripControlChars = (s: string): string => s.replace(CONTROL_CHARS, '');

/** A paragraph holding `text`, or an empty paragraph when there is nothing but whitespace. */
export function paragraph(text: string): BlockNode {
  return text.trim() === '' ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text }] };
}

/**
 * Plain text to paragraphs: one per line, one empty paragraph for any run of
 * blank lines, blank lines at the start and end dropped. Leading spaces are kept.
 */
export function textToBlocks(text: string): BlockNode[] {
  const out: BlockNode[] = [];
  let lastBlank = false;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = stripControlChars(raw);
    if (line.trim() === '') {
      if (out.length > 0 && !lastBlank) out.push(paragraph(''));
      lastBlank = true;
    } else {
      out.push(paragraph(line));
      lastBlank = false;
    }
  }
  while (out.length > 0 && out[out.length - 1]!.content === undefined) out.pop();
  return out;
}

export function textToDoc(text: string): Doc {
  return { type: 'doc', content: textToBlocks(text) };
}
