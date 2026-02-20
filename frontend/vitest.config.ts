import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Two environments, each targeting its own folder:
    //   src/__tests__ — pure utility tests, no DOM needed (node)
    //   src/tests     — tldraw Editor integration tests (jsdom)
    //
    // vitest picks the per-file environment via the environmentMatchGlobs
    // option so we don't force jsdom on the lightweight utility tests.
    environment: 'node',
    environmentMatchGlobs: [
      ['src/tests/**', 'happy-dom'],
    ],
    setupFiles: ['./src/tests/setup.ts'],
    include: [
      'src/**/__tests__/**/*.test.ts',
      'src/tests/**/*.test.ts',
    ],
  },
});
