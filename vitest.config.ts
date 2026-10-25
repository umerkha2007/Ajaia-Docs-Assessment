import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    globals: true,
    reporters: ['verbose'],
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
