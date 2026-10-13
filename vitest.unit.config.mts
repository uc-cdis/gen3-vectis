import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Logic and component tests (jsdom). The Storybook browser tests live in vitest.config.mts.
export default defineConfig({
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  test: {
    name: 'unit',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.unit.setup.ts'],
    css: false,
  },
});
