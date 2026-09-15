import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@/components/tools/container', replacement: path.resolve(import.meta.dirname, 'plugins/container-manager/ui') },
      { find: '@', replacement: path.resolve(import.meta.dirname, 'shared') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['plugins/**/*.test.{ts,tsx}', 'shared/**/*.test.{ts,tsx}'],
  },
});
