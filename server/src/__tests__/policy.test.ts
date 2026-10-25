import { describe, expect, it } from 'vitest';
import { AppError } from '../errors.js';
import { assertCan, can, type Action } from '../policy.js';

const ACTIONS: Action[] = ['read', 'write', 'delete', 'share'];
const owner = { ownerId: 'o' };
const sharedEditor = { ownerId: 'o', shareRole: 'editor' as const };

describe('Ownership and Sharing: permission policy', () => {
  it.each(ACTIONS)('[SEC-1] the owner may %s', (action) => {
    expect(can('o', owner, action)).toBe(true);
    expect(can('o', sharedEditor, action)).toBe(true);
  });

  it.each([
    ['read', true],
    ['write', true],
    ['delete', false],
    ['share', false],
  ] as const)('[FR-3.4][SEC-1] a user with an editor share may %s: %s', (action, allowed) => {
    expect(can('e', sharedEditor, action)).toBe(allowed);
  });

  it.each(ACTIONS)('[SEC-1] a user with no share may not %s', (action) => {
    expect(can('x', owner, action)).toBe(false);
    expect(can('x', { ownerId: 'o', shareRole: undefined }, action)).toBe(false);
  });

  it.each(ACTIONS)('[SEC-1] an unrecognised role grants nothing: %s', (action) => {
    expect(can('x', { ownerId: 'o', shareRole: 'admin' as never }, action)).toBe(false);
  });

  it('[SEC-1] assertCan throws FORBIDDEN when denied and returns quietly when allowed', () => {
    expect(() => assertCan('o', owner, 'delete')).not.toThrow();
    try {
      assertCan('x', owner, 'read');
      expect.unreachable('expected FORBIDDEN');
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe('FORBIDDEN');
    }
  });
});
