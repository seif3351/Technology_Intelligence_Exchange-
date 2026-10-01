import { pino, type Logger } from 'pino';

/**
 * Structured JSON logging with defence-in-depth redaction. The primary rule
 * is to never pass sensitive values to the logger at all; redaction catches
 * accidents (headers, tokens, passwords, private requirement text).
 */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.passwordHash',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.confirmationToken',
  '*.authorization',
  '*.code',
  '*.secret',
  '*.confidentialTerms',
];

export const createLogger = (options: { readonly service: string; readonly level: string }): Logger =>
  pino({
    name: options.service,
    level: options.level,
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    base: { service: options.service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: { level: (label) => ({ level: label }) },
  });

export type { Logger };
