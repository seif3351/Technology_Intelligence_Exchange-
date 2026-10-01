import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src';

const SECURE = {
  NODE_ENV: 'production',
  CONFIRMATION_SECRET: 'p'.repeat(48),
  ASSET_URL_SECRET: 'q'.repeat(48),
  AUTH_SIGNING_JWK: '{"kty":"EC"}',
  MAIL_DRIVER: 'smtp',
  SMTP_URL: 'smtps://user:pw@smtp.example.com:465',
  CLAMAV_HOST: 'clamav',
  DATABASE_SSL: 'verify',
};

describe('production configuration guard', () => {
  it('accepts an explicit, secure production configuration', () => {
    expect(loadConfig(SECURE)).toMatchObject({ NODE_ENV: 'production', DATABASE_SSL: 'verify' });
  });

  it.each([
    ['development secrets', { CONFIRMATION_SECRET: undefined }],
    ['the file mailer', { MAIL_DRIVER: 'file' }],
    ['missing malware scanning', { CLAMAV_HOST: undefined }],
    ['an implicit database TLS mode', { DATABASE_SSL: undefined }],
  ])('refuses %s', (_name, override) => {
    expect(() => loadConfig({ ...SECURE, ...override })).toThrow(ConfigError);
  });

  it('names offending variables but never echoes their values', () => {
    try {
      loadConfig({ ...SECURE, CLAMAV_HOST: undefined, SMTP_URL: undefined, MAIL_DRIVER: 'smtp' });
    } catch (error) {
      expect(String(error)).not.toContain('pw@smtp');
      return;
    }
    throw new Error('expected a configuration error');
  });
});
