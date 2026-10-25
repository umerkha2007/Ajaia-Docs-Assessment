/**
 * What the Import button accepts. These mirror the server's rules (server/src/import/file.ts)
 * so users get instant feedback; the server checks everything again and is the authority.
 */
export const IMPORT_EXTENSIONS = ['.txt', '.md'] as const;
export const IMPORT_MAX_BYTES = 512 * 1024;
export const IMPORT_HELP = 'Supported file types: .txt and .md (UTF-8 text, up to 512 KB). The file becomes a new document.';
export const IMPORT_ACCEPT = '.txt,.md,text/plain,text/markdown';

/** Returns a user-facing problem with the file, or null if it looks importable. */
export function checkImportFile(file: { name: string; size: number }): string | null {
  const name = file.name.toLowerCase();
  if (!IMPORT_EXTENSIONS.some((ext) => name.endsWith(ext))) {
    return 'Unsupported file type. Only .txt and .md files can be imported.';
  }
  if (file.size === 0) return 'The file is empty';
  if (file.size > IMPORT_MAX_BYTES) return `File is too large. The limit is ${IMPORT_MAX_BYTES / 1024} KB.`;
  return null;
}
