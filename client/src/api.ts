import type { SyncRequest, SyncResponse } from './sync/DocSync';

export interface Health {
  status: string;
  sqliteVersion: string;
}

export interface DocumentSummary {
  id: string;
  ownerId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

/** A document the current user owns. */
export interface OwnedSummary extends DocumentSummary {
  shareCount: number;
}

/** A document someone else owns that was shared with the current user. */
export interface SharedSummary extends DocumentSummary {
  ownerName: string;
  role: 'editor';
}

export interface DocumentRecord extends DocumentSummary {
  content: DocJson;
  ownerName: string;
  /** The current user's relationship to this document. */
  access: 'owner' | 'editor';
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export interface ShareRecord {
  userId: string;
  name: string;
  email: string;
  role: 'editor';
  createdAt: string;
}

export interface DocJson {
  type: 'doc';
  content?: unknown[];
}

/** A failure from the backend (or from reaching it), with the server's error code when there is one. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  init: { method?: string; body?: unknown; raw?: Blob } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: {
        ...(init.raw ? { 'content-type': 'application/octet-stream' } : {}),
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined),
    });
  } catch (cause) {
    throw new ApiError('NETWORK', `Cannot reach the server (${(cause as Error).message})`);
  }
  if (res.status === 204) return undefined as T;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new ApiError('BAD_RESPONSE', `Unexpected response from server (HTTP ${res.status})`, res.status);
  }
  if (!res.ok) {
    const e = (data ?? {}) as { error?: string; message?: string };
    throw new ApiError(e.error ?? 'HTTP_ERROR', e.message ?? `Request failed with HTTP ${res.status}`, res.status);
  }
  return data as T;
}

export async function fetchHealth(): Promise<Health> {
  const res = await fetch('/api/health');
  if (!res.ok) throw new Error(`Health check failed with HTTP ${res.status}`);
  return (await res.json()) as Health;
}

export const getSession = () => request<{ user: SessionUser | null; users: SessionUser[] }>('/api/session');

/** Simulated sign-in as one of the seeded users. The server sets the signed session cookie. */
export const signIn = async (userId: string) =>
  (await request<{ user: SessionUser }>('/api/session', { method: 'POST', body: { userId } })).user;

export const signOut = () => request<void>('/api/session', { method: 'DELETE' });

export const listDocuments = () => request<{ documents: OwnedSummary[]; shared: SharedSummary[] }>('/api/documents');

export const listShares = async (id: string) =>
  (await request<{ shares: ShareRecord[] }>(`/api/documents/${encodeURIComponent(id)}/shares`)).shares;

export const shareDocument = async (id: string, userId: string) =>
  (await request<{ shares: ShareRecord[] }>(`/api/documents/${encodeURIComponent(id)}/shares`, {
    method: 'POST',
    body: { userId },
  })).shares;

export const unshareDocument = async (id: string, userId: string) =>
  (await request<{ shares: ShareRecord[] }>(
    `/api/documents/${encodeURIComponent(id)}/shares/${encodeURIComponent(userId)}`,
    { method: 'DELETE' },
  )).shares;

export const createDocument = async (title?: string) =>
  (await request<{ document: DocumentRecord }>('/api/documents', { method: 'POST', body: { title } })).document;

export const getDocument = async (id: string) =>
  (await request<{ document: DocumentRecord }>(`/api/documents/${encodeURIComponent(id)}`)).document;

export const renameDocument = async (id: string, title: string) =>
  (await request<{ document: DocumentRecord }>(`/api/documents/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { title },
  })).document;

export const saveDocumentContent = async (id: string, content: DocJson) =>
  (await request<{ document: DocumentRecord }>(`/api/documents/${encodeURIComponent(id)}/content`, {
    method: 'PUT',
    body: { content },
  })).document;

/** Upload a .txt or .md file; the server converts it into a new document owned by the current user. */
export const importDocument = async (file: File) =>
  (await request<{ document: DocumentRecord }>(`/api/documents/import?filename=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    raw: file,
  })).document;

/** One round trip of collaborative editing: send our unsaved changes, receive other people's. */
export const syncDocument = (id: string, body: SyncRequest) =>
  request<SyncResponse>(`/api/documents/${encodeURIComponent(id)}/sync`, { method: 'POST', body });

export const deleteDocument = (id: string) =>
  request<void>(`/api/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
