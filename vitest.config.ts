import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@shared': new URL('./supabase/functions/_shared', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
    },
  },
});
