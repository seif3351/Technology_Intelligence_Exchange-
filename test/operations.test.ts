import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { EnvSchema } from '../packages/config/src';

/**
 * Configuration is declared in several places (schema, env templates, deploy
 * compose, operator docs). These checks keep them from drifting apart: a typo
 * in the deploy compose would otherwise be silently ignored at runtime.
 */
const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8');
const schemaKeys = new Set(Object.keys(EnvSchema.shape));

/** Read by the web app or the deploy compose itself, not by `loadConfig`. */
const NON_SCHEMA = new Set([
  'API_INTERNAL_URL',
  'SHOW_DEMO_ACCOUNTS',
  'SERVICE',
  'ACME_EMAIL',
  'POSTGRES_PASSWORD',
  'ATX_IMAGE_REGISTRY',
  'ATX_IMAGE_TAG',
  'ATX_WEB_HOST',
  'ATX_API_HOST',
  'ATX_MCP_HOST',
  'ATX_SITE_SCHEME',
]);

const envFileKeys = (file: string) =>
  [...read(file).matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((match) => match[1] ?? '');

const composeAppEnvKeys = () => {
  const compose = read('infra/deploy/compose.yml');
  const block = compose.slice(compose.indexOf('x-app-env: &app-env'), compose.indexOf('\nservices:'));
  return [...block.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1] ?? '');
};

describe('operations configuration stays consistent', () => {
  it('documents every configuration variable in the environment reference', () => {
    const reference = read('docs/operations/environment.md');
    const undocumented = [...schemaKeys].filter((key) => !reference.includes(`\`${key}\``));
    expect(undocumented).toEqual([]);
  });

  it('the deploy compose only sets variables the application reads', () => {
    const keys = composeAppEnvKeys();
    expect(keys.length).toBeGreaterThan(20);
    expect(keys.filter((key) => !schemaKeys.has(key) && !NON_SCHEMA.has(key))).toEqual([]);
  });

  it.each(['.env.example', 'infra/deploy/atx.env.example'])('%s only names known variables', (file) => {
    const unknown = envFileKeys(file).filter((key) => !schemaKeys.has(key) && !NON_SCHEMA.has(key));
    expect(unknown).toEqual([]);
  });

  it('production deployments never run migrations on start and require MCP authentication', () => {
    const compose = read('infra/deploy/compose.yml');
    expect(compose).toMatch(/MIGRATE_ON_START: 'false'/);
    expect(compose).toMatch(/MCP_REQUIRE_AUTH: 'true'/);
    expect(compose).toMatch(/NODE_ENV: production/);
    expect(compose).not.toMatch(/FEATURE_ENGAGEMENT_ACTIONS: 'true'/);
  });
});
