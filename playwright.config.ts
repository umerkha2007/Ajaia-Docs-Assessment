import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// E2E runs against its own throwaway database so it never touches data/app.db.
// Dedicated ports so E2E never collides with (or talks to) a developer's running `npm run dev`.
const CLIENT_PORT = 5273;
const API_PORT = 3101;
const e2eDb = join(tmpdir(), `ajaia-e2e-${process.pid}.db`);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://127.0.0.1:${CLIENT_PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL } }],
  webServer: {
    command: 'npm run dev',
    // Wait for the backend too, otherwise the page can load before the API is up.
    wait: { stdout: /Server listening/ },
    url: `http://127.0.0.1:${CLIENT_PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { DB_PATH: e2eDb, PORT: String(API_PORT), CLIENT_PORT: String(CLIENT_PORT) },
  },
});
