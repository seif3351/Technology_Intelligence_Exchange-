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

  it('treats empty values as unset, as orchestrators pass optional variables', () => {
    const env = loadConfig({
      ...SECURE,
      OTEL_EXPORTER_OTLP_ENDPOINT: '',
      S3_ENDPOINT: '',
      DATABASE_SSL_CA: '',
    });
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(env.DATABASE_SSL_CA).toBeUndefined();
    // ...including for the production guard: an empty secret is still a missing secret.
    expect(() => loadConfig({ ...SECURE, CLAMAV_HOST: '' })).toThrow(/CLAMAV_HOST/);
    expect(() => loadConfig({ ...SECURE, CONFIRMATION_SECRET: '' })).toThrow(/CONFIRMATION_SECRET/);
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
