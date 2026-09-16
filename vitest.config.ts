import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@', replacement: path.resolve(import.meta.dirname, 'shared') },
    ],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['shared/**/*.test.{ts,tsx}'],
    // main is the skeleton — shared/ has no tests of its own yet. Plugin
    // branches (app/<id>/main) keep the original config without this: a
    // plugin branch finding zero tests IS a real regression.
    passWithNoTests: true,
  },
});
