import { AppError } from '../errors.js';
import { TITLE_MAX, validateContent } from '../validation.js';
import { markdownToDoc } from './markdown.js';
import { stripControlChars, textToDoc, type Doc } from './text.js';

export const IMPORT_MAX_BYTES = 512 * 1024;
export const SUPPORTED_EXTENSIONS = ['.txt', '.md'] as const;
const FILENAME_MAX = 255;
const IMPORTED_TITLE = 'Imported document';

export interface ImportResult {
  title: string;
  content: Doc;
}

function extensionOf(name: string): (typeof SUPPORTED_EXTENSIONS)[number] | undefined {
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.find((ext) => lower.endsWith(ext));
}

/** Title from a client-supplied filename: no path components, no extension, valid title. */
function titleFrom(name: string, ext: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const stem = stripControlChars(base.slice(0, base.length - ext.length)).trim();
  return stem.slice(0, TITLE_MAX).trim() || IMPORTED_TITLE;
}

/**
 * Validate an uploaded file and convert it to a document. Everything about the
 * upload is untrusted: the name only picks the converter and the title, and the
 * content must be UTF-8 text. The result is checked against the same content
 * schema as every save, so imported documents are indistinguishable from typed ones.
 */
export function importFile(filename: unknown, bytes: Uint8Array): ImportResult {
  if (typeof filename !== 'string' || filename.trim() === '') {
    throw new AppError('VALIDATION_ERROR', 'A file name is required');
  }
  const name = filename.trim();
  if (name.length > FILENAME_MAX) throw new AppError('VALIDATION_ERROR', `File name must be at most ${FILENAME_MAX} characters`);

  const ext = extensionOf(name);
  if (!ext) throw new AppError('UNSUPPORTED_FILE', 'Unsupported file type. Only .txt and .md files can be imported.');

  if (bytes.length === 0) throw new AppError('INVALID_FILE', 'The file is empty');
  if (bytes.length > IMPORT_MAX_BYTES) throw new AppError('FILE_TOO_LARGE', `File is too large. The limit is ${IMPORT_MAX_BYTES / 1024} KB.`);
  if (bytes.includes(0)) throw new AppError('INVALID_FILE', 'The file is not a UTF-8 text file (it contains binary data)');

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (cause) {
    throw new AppError('INVALID_FILE', 'The file is not valid UTF-8 text', { cause });
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // UTF-8 byte-order mark

  const content = ext === '.md' ? markdownToDoc(text) : textToDoc(text);
  if (content.content.length === 0) throw new AppError('INVALID_FILE', 'The file contains no text to import');

  try {
    validateContent(content);
  } catch (cause) {
    const detail = cause instanceof AppError ? cause.message : 'invalid content';
    throw new AppError('INVALID_FILE', `The file is too large or too complex to import (${detail})`, { cause });
  }
  return { title: titleFrom(name, ext), content };
}
