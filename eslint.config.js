import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Architectural import rules are enforced here AND by test/architecture.test.ts
 * (which checks package.json dependency direction).
 */
const restrict = (patterns, message) => ({
  'no-restricted-imports': ['error', { patterns: patterns.map((group) => ({ group: [group], message })) }],
});

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/.next/**', 'coverage/**', '.var/**', 'apps/web/next-env.d.ts', '**/*.generated.*'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
    },
  },
  {
    files: ['apps/mcp-server/src/apps/views/**/*.ts'],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['packages/domain/src/**/*.ts'],
    rules: restrict(
      ['@atx/*', 'pg', 'zod', 'fastify', 'react', 'next', '@modelcontextprotocol/*', 'node:*'],
      'The domain layer must stay free of frameworks, I/O and other packages.',
    ),
  },
  {
    files: ['packages/search/src/**/*.ts'],
    rules: restrict(
      ['@atx/application', '@atx/infrastructure', '@atx/contracts', '@atx/runtime', 'pg', 'fastify', 'react', 'next', '@modelcontextprotocol/*'],
      'The search/matching engine may only depend on @atx/domain.',
    ),
  },
  {
    files: ['packages/application/src/**/*.ts'],
    rules: restrict(
      ['@atx/infrastructure', '@atx/ai', '@atx/auth', '@atx/contracts', '@atx/runtime', '@atx/observability', 'pg', 'fastify', 'react', 'next', '@modelcontextprotocol/*', 'jose'],
      'Application use cases depend on ports, never on adapters, transports or frameworks.',
    ),
  },
  {
    files: ['apps/*/src/**/*.ts', 'apps/*/scripts/**/*.ts', 'apps/web/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
