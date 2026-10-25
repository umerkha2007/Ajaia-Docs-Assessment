import { describe, expect, it } from 'vitest';
import { checkImportFile, IMPORT_HELP, IMPORT_MAX_BYTES } from '../importRules';

describe('File Import (UI): client-side pre-checks', () => {
  it.each(['a.txt', 'a.md', 'A.TXT', 'Notes.Md', 'dir/a.txt', 'two.dots.md'])('[FR-2.1] accepts %s', (name) => {
    expect(checkImportFile({ name, size: 10 })).toBeNull();
  });

  it.each(['a.pdf', 'a.docx', 'a.png', 'a.exe', 'a.markdown', 'a', 'a.txt.exe', 'a.md.', 'a.html'])(
    '[FR-2.4] rejects %s with the supported-types message',
    (name) => {
      expect(checkImportFile({ name, size: 10 })).toBe('Unsupported file type. Only .txt and .md files can be imported.');
    },
  );

  it('[FR-2.5] rejects an empty file', () => {
    expect(checkImportFile({ name: 'a.txt', size: 0 })).toBe('The file is empty');
  });

  it('[FR-2.5] accepts a file of exactly the limit and rejects one byte more', () => {
    expect(checkImportFile({ name: 'a.txt', size: IMPORT_MAX_BYTES })).toBeNull();
    expect(checkImportFile({ name: 'a.txt', size: IMPORT_MAX_BYTES + 1 })).toBe('File is too large. The limit is 512 KB.');
  });

  it('[FR-2.7] the help text names both supported types and the limits', () => {
    expect(IMPORT_HELP).toContain('.txt');
    expect(IMPORT_HELP).toContain('.md');
    expect(IMPORT_HELP).toContain('512 KB');
  });
});
