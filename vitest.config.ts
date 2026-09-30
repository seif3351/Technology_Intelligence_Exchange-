import { defineConfig } from 'vitest/config';

/**
 * Two projects:
 *  - unit:        pure tests, no I/O. Must stay fast and hermetic.
 *  - integration: tests that need PostgreSQL (DATABASE_URL_TEST) and exercise
 *                 repositories, application services, the HTTP API and MCP server.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', '**/node_modules/**', 'apps/web/**'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['packages/*/test/**/*.int.test.ts', 'apps/*/test/**/*.int.test.ts'],
          exclude: ['**/node_modules/**', 'apps/web/**'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
