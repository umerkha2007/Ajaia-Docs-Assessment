import { describe, expect, it } from 'vitest';
import { AppError, type ErrorCode } from '../errors.js';
import { IMPORT_MAX_BYTES, importFile } from '../import/file.js';

const buf = (s: string) => Buffer.from(s, 'utf8');
const failsWith = (code: ErrorCode, filename: unknown, bytes: Uint8Array, message?: RegExp) => {
  try {
    importFile(filename, bytes);
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
    if (message) expect((e as AppError).message).toMatch(message);
    return;
  }
  expect.unreachable(`expected ${code}`);
};

describe('File Import: accepted files', () => {
  it('[FR-2.1] a .txt file becomes a titled document with one paragraph per line', () => {
    const r = importFile('notes.txt', buf('hello\nworld'));
    expect(r.title).toBe('notes');
    expect(r.content.content).toHaveLength(2);
  });

  it('[FR-2.2] a .md file is converted as Markdown', () => {
    const r = importFile('Plan.md', buf('# Title\n\n- a'));
    expect(r.title).toBe('Plan');
    expect(r.content.content![0]).toMatchObject({ type: 'heading', attrs: { level: 1 } });
  });

  it.each(['A.TXT', 'B.Md', 'c.mD'])('[FR-2.1] file extensions are matched case-insensitively: %s', (name) => {
    expect(() => importFile(name, buf('x'))).not.toThrow();
  });

  it('[FR-2.1] a UTF-8 byte-order mark is stripped, and unicode text survives', () => {
    const r = importFile('u.txt', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf('日本語 é 😀')]));
    expect(JSON.stringify(r.content)).toContain('日本語 é 😀');
    expect(JSON.stringify(r.content)).not.toContain('\ufeff');
  });

  it('[FR-2.1] a file of exactly the size limit is accepted', () => {
    const body = Buffer.alloc(IMPORT_MAX_BYTES, 0x78); // exactly the limit, one long line
    expect(body.length).toBe(IMPORT_MAX_BYTES);
    expect(() => importFile('big.txt', body)).not.toThrow();
  });
});

describe('File Import: titles from filenames', () => {
  it.each([
    ['report.final.v2.txt', 'report.final.v2'],
    ['  spaced name .md', 'spaced name'],
    ['C:\\Users\\me\\docs\\win.txt', 'win'],
    ['../../etc/passwd.txt', 'passwd'],
    ['dir/sub/nested.md', 'nested'],
  ])('[FR-2.3] %s becomes the title "%s" (no path components)', (name, title) => {
    expect(importFile(name, buf('x')).title).toBe(title);
  });

  it('[FR-2.3] an over-long filename is truncated to a valid title', () => {
    const r = importFile('a'.repeat(250) + '.txt', buf('x'));
    expect(r.title).toHaveLength(200);
  });

  it('[FR-2.3] control characters are removed from titles', () => {
    expect(importFile('bad\u0007name\t.txt', buf('x')).title).toBe('badname');
  });

  it('[FR-2.3] a filename with nothing but the extension gets a default title', () => {
    expect(importFile('  .txt', buf('x')).title).toBe('Imported document');
  });
});

describe('File Import: rejected files', () => {
  it.each(['report.pdf', 'doc.docx', 'image.png', 'run.exe', 'page.html', 'data.csv', 'archive.zip', 'noextension', 'trailingdot.', '.txt.exe', 'a.md.exe', 'a.txt.', 'a.markdown'])(
    '[FR-2.4] rejects unsupported file "%s" with a message naming the supported types',
    (name) => failsWith('UNSUPPORTED_FILE', name, buf('hello'), /\.txt.*\.md/),
  );

  it.each([undefined, null, 5, '', '   '])('[NFR-VAL] rejects a missing or non-string filename: %s', (name) => {
    failsWith('VALIDATION_ERROR', name, buf('hello'));
  });

  it('[NFR-VAL] rejects an over-long filename', () => {
    failsWith('VALIDATION_ERROR', 'a'.repeat(300) + '.txt', buf('x'));
  });

  it('[FR-2.5] rejects an empty file', () => failsWith('INVALID_FILE', 'e.txt', Buffer.alloc(0), /empty/i));

  it.each(['\n\n   \t\n', ' '])('[FR-2.5] rejects a file that contains only whitespace', (body) => {
    failsWith('INVALID_FILE', 'ws.md', buf(body), /no text/i);
  });

  it('[FR-2.5] rejects a Markdown file that has no importable content (just a rule)', () => {
    failsWith('INVALID_FILE', 'rule.md', buf('---\n'), /no text/i);
  });

  it('[FR-2.5] rejects binary data renamed to .txt (NUL bytes)', () => {
    failsWith('INVALID_FILE', 'fake.txt', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00]), /text/i);
  });

  it('[FR-2.5] rejects UTF-16 text (it contains NUL bytes) with a UTF-8 hint', () => {
    failsWith('INVALID_FILE', 'utf16.txt', Buffer.from('hello', 'utf16le'), /UTF-8/);
  });

  it('[FR-2.5] rejects bytes that are not valid UTF-8', () => {
    failsWith('INVALID_FILE', 'latin1.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0xff, 0xfe]), /UTF-8/);
  });

  it('[FR-2.5] rejects a file over the size limit before decoding it', () => {
    failsWith('FILE_TOO_LARGE', 'huge.txt', Buffer.alloc(IMPORT_MAX_BYTES + 1, 0x61), /512 KB/);
  });

  it('[FR-2.5] rejects content too complex to store, with a clear error instead of a crash', () => {
    const manyLines = 'x\n\ny\n'.repeat(15_000); // > 20,000 paragraphs once converted
    failsWith('INVALID_FILE', 'lines.txt', buf(manyLines), /too many nodes|too large|too complex/i);
    const deepList = Array.from({ length: 60 }, (_, i) => `${'  '.repeat(i)}- level ${i}`).join('\n');
    failsWith('INVALID_FILE', 'deep.md', buf(deepList), /nested too deeply|too complex/i);
  });
});
