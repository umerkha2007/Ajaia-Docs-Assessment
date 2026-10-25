import { vi } from 'vitest';

type Handler = (body: unknown, url: string) => { status?: number; json?: unknown };

/**
 * Stub global fetch with handlers keyed "METHOD /path". Unmatched requests fail the
 * test loudly. Returns the mock so tests can assert on the calls actually made.
 */
export function stubApi(handlers: Record<string, Handler>) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const h = handlers[key];
    if (!h) throw new Error(`Unexpected request: ${key}`);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body;
    const { status = 200, json } = h(body, url);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (json === undefined) throw new Error('no body');
        return json;
      },
    };
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

export const summary = (over: Partial<{ id: string; title: string; updatedAt: string }> = {}) => ({
  id: 'id-1',
  ownerId: 'user-alice',
  title: 'Doc One',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over,
});

export const textDoc = (...lines: string[]) => ({
  type: 'doc',
  content: lines.map((l) => (l ? { type: 'paragraph', content: [{ type: 'text', text: l }] } : { type: 'paragraph' })),
});
