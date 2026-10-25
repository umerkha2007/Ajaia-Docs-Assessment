import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    globals: true,
    reporters: ['verbose'],
    // Yjs probes localStorage on import; Node 25+ prints an experimental-feature warning for that.
    execArgv: ['--no-experimental-webstorage'],
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          globals: true,
          include: ['server/src/**/*.test.ts'],
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          globals: true,
          include: ['client/src/**/*.test.{ts,tsx}'],
          setupFiles: ['client/src/test-setup.ts'],
        },
      },
    ],
  },
});
