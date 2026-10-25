import { AppError } from './errors.js';

export type Action = 'read' | 'write' | 'delete' | 'share';
export type ShareRole = 'editor';

/** Everything the policy needs to know about one document and one actor. */
export interface DocAccess {
  ownerId: string;
  /** The actor's share grant on this document, if any. */
  shareRole?: ShareRole | undefined;
}

/**
 * The single place that decides who may do what to a document.
 *
 * - The owner may do everything.
 * - A user with an `editor` share may read and write (edit content, rename).
 * - Only the owner may delete the document or manage who it is shared with.
 * - Anyone else may do nothing. An unrecognised role grants nothing.
 */
export function can(actorId: string, doc: DocAccess, action: Action): boolean {
  if (doc.ownerId === actorId) return true;
  if (doc.shareRole === 'editor') return action === 'read' || action === 'write';
  return false;
}

export function assertCan(actorId: string, doc: DocAccess, action: Action): void {
  if (!can(actorId, doc, action)) {
    throw new AppError('FORBIDDEN', 'You do not have permission to perform this action on this document');
  }
}
