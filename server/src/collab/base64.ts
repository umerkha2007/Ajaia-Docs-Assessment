import { AppError } from '../errors.js';

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const MAX_BASE64_LENGTH = 4 * 1024 * 1024;

/** Decode a base64 request field; undefined and null stay undefined. */
export function decodeBase64(value: unknown, name: string): Uint8Array | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.length > MAX_BASE64_LENGTH || !BASE64.test(value)) {
    throw new AppError('VALIDATION_ERROR', `${name} must be base64 text`);
  }
  return new Uint8Array(Buffer.from(value, 'base64'));
}

export const encodeBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');
