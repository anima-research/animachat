import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    testTimeout: 10000,
    passWithNoTests: true,
    // Pin the env-var fixtures used across all backend tests (JWT_SECRET,
    // NODE_ENV=test, rate-limit caps). See src/test-setup.ts for why these
    // can't be set inside individual test files — several modules read
    // env at load time and treat the values as immutable thereafter.
    setupFiles: ['./src/test-setup.ts'],
  },
});
