import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendStatus } from '../BackendStatus';

afterEach(() => vi.unstubAllGlobals());

describe('App shell: backend connectivity', () => {
  it('[P1-UI-1] shows the backend status and SQLite version once the health check succeeds', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', sqliteVersion: '3.53.4' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<BackendStatus />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking backend');
    expect(await screen.findByText('Backend: ok (SQLite 3.53.4)')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/health');
  });

  it('[P1-UI-2] shows a clear error when the backend responds with a failure status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    render(<BackendStatus />);
    expect(await screen.findByText(/Backend unavailable: Health check failed with HTTP 500/)).toBeInTheDocument();
  });

  it('[P1-UI-3] shows a clear error when the network request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Failed to fetch')));
    render(<BackendStatus />);
    expect(await screen.findByText('Backend unavailable: Failed to fetch')).toBeInTheDocument();
  });
});
