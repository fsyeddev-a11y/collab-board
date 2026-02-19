import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    // Point to the test-specific tsconfig so cloudflare:test types resolve
    // without affecting the production build.
    typecheck: { tsconfig: './tsconfig.test.json' },
    include: ['src/**/__tests__/**/*.test.ts'],
    poolOptions: {
      workers: {
        // The workers pool reads wrangler.toml to wire up Durable Object
        // bindings, SQLite migrations, and environment variables — giving
        // tests the same runtime as production Workers.
        wrangler: { configPath: './wrangler.test.toml' },
        // Disable per-test isolated storage — the per-test storage snapshot/
        // restore conflicts with Miniflare's SQLite WAL files (.sqlite-shm).
        // Tests are isolated by using unique DO idFromName() keys instead.
        isolatedStorage: false,
      },
    },
  },
});
