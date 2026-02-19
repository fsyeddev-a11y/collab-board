import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure utility tests — no DOM or browser APIs needed
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
  },
});
