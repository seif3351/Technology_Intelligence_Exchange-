import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const DEV_SECRET = 'dev-only-insecure-secret-change-me-0123456789';

/**
 * Single, validated source of runtime configuration. Secrets only ever come
 * from the environment (platform secret store in production). Development
 * defaults are rejected when NODE_ENV=production.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().default('postgres://atx:atx@localhost:5432/atx'),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(10),

  PUBLIC_WEB_URL: z.url().default('http://localhost:3000'),
  API_PUBLIC_URL: z.url().default('http://localhost:4000'),
  API_PORT: z.coerce.number().int().default(4000),
  MCP_PUBLIC_URL: z.url().default('http://localhost:4100/mcp'),
  MCP_PORT: z.coerce.number().int().default(4100),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  AUTH_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),
  ALLOWED_HOSTS: z.string().default('localhost,127.0.0.1'),

  AUTH_ISSUER: z.url().optional(),
  AUTH_SIGNING_JWK: z.string().optional(),
  AUTH_DEV_KEY_FILE: z.string().default('.var/dev-signing-key.json'),
  /** External OAuth authorization server for MCP clients (issuer + JWKS). Defaults to the built-in issuer. */
  MCP_AUTH_ISSUER: z.url().optional(),
  MCP_AUTH_JWKS_URL: z.url().optional(),
  MCP_REQUIRE_AUTH: bool.default(false),

  CONFIRMATION_SECRET: z.string().min(32).default(DEV_SECRET),
  ASSET_URL_SECRET: z.string().min(32).default(DEV_SECRET),

  STORAGE_DRIVER: z.enum(['filesystem', 's3']).default('filesystem'),
  STORAGE_DIR: z.string().default('.var/storage'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('eu-central-1'),
  S3_ENDPOINT: z.url().optional(),
  S3_FORCE_PATH_STYLE: bool.default(false),
  CLAMAV_HOST: z.string().optional(),
  CLAMAV_PORT: z.coerce.number().int().default(3310),

  AI_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default('claude-opus-5-5'),
  EMBEDDINGS_PROVIDER: z.enum(['none', 'hashing', 'http']).default('hashing'),
  EMBEDDINGS_URL: z.url().optional(),
  EMBEDDINGS_API_KEY: z.string().optional(),
  EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),

  FEATURE_ENGAGEMENT_ACTIONS: bool.default(false),

  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_SERVICE_NAMESPACE: z.string().default('atx'),
});

export type Env = z.infer<typeof EnvSchema>;

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export const loadConfig = (source: NodeJS.ProcessEnv = process.env): Env => {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    // Report variable names only — never values, which may be secrets.
    const names = [...new Set(parsed.error.issues.map((issue) => issue.path.join('.')))];
    throw new ConfigError(`Invalid configuration for: ${names.join(', ')}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const problems: string[] = [];
    if (env.CONFIRMATION_SECRET === DEV_SECRET) problems.push('CONFIRMATION_SECRET');
    if (env.ASSET_URL_SECRET === DEV_SECRET) problems.push('ASSET_URL_SECRET');
    if (!env.AUTH_SIGNING_JWK && !env.MCP_AUTH_JWKS_URL) problems.push('AUTH_SIGNING_JWK');
    if (env.STORAGE_DRIVER === 's3' && !env.S3_BUCKET) problems.push('S3_BUCKET');
    if (problems.length > 0) throw new ConfigError(`Production requires explicit secure values for: ${problems.join(', ')}`);
  }
  if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) throw new ConfigError('AI_PROVIDER=anthropic requires ANTHROPIC_API_KEY');
  if (env.EMBEDDINGS_PROVIDER === 'http' && !env.EMBEDDINGS_URL) throw new ConfigError('EMBEDDINGS_PROVIDER=http requires EMBEDDINGS_URL');
  return env;
};

export const authIssuer = (env: Env): string => env.AUTH_ISSUER ?? env.API_PUBLIC_URL;
export const listSetting = (value: string): string[] => value.split(',').map((item) => item.trim()).filter(Boolean);
