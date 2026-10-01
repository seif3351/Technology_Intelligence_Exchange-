import path from 'node:path';
import {
  type Application,
  type EmbeddingProvider,
  type RequirementExtractor,
  type SupplierProfileDraftGenerator,
  createApplication,
} from '@atx/application';
import {
  createAiProfileDraftGenerator,
  createAiRequirementExtractor,
  createAnthropicLlm,
  createHashingEmbeddingProvider,
  createHttpEmbeddingProvider,
  deterministicProfileDraftGenerator,
  deterministicRequirementExtractor,
} from '@atx/ai';
import {
  type AccessTokenVerifier,
  createAccessTokenIssuer,
  createAccessTokenVerifier,
  createAssetUrlSigner,
  createConfirmationTokens,
  loadSigningKey,
  scryptPasswordHasher,
} from '@atx/auth';
import { type Env, authIssuer } from '@atx/config';
import {
  basicContentScanner,
  chainScanners,
  createClamdScanner,
  createFilesystemStorage,
  createJobQueue,
  createJobRunnerStore,
  createPool,
  createPostgresOntologyProvider,
  createPostgresSearchIndex,
  createRepositories,
  createS3Storage,
  createTransactionRunner,
  defaultTextExtractor,
  systemClock,
} from '@atx/infrastructure';
import { type Logger, createLogger, openTelemetry, startTelemetry, stopTelemetry } from '@atx/observability';

/**
 * Composition root shared by the API, MCP server and worker. This is the only
 * place where concrete adapters are chosen; everything else depends on ports.
 */
export interface Runtime {
  readonly env: Env;
  readonly app: Application;
  readonly logger: Logger;
  readonly pool: ReturnType<typeof createPool>;
  readonly tokens: {
    readonly issuer: Awaited<ReturnType<typeof createIssuer>>;
    readonly apiVerifier: AccessTokenVerifier;
    readonly mcpVerifier: AccessTokenVerifier;
  };
  readonly assetUrls: ReturnType<typeof createAssetUrlSigner>;
  readonly storage: ReturnType<typeof createFilesystemStorage>;
  readonly jobStore: ReturnType<typeof createJobRunnerStore>;
  close(): Promise<void>;
}

const createIssuer = async (env: Env) => {
  const key = await loadSigningKey({
    privateJwkJson: env.AUTH_SIGNING_JWK ?? null,
    devKeyFile: env.NODE_ENV === 'production' ? null : path.resolve(env.AUTH_DEV_KEY_FILE),
  });
  return createAccessTokenIssuer(key, authIssuer(env));
};

export const createRuntime = async (env: Env, service: string): Promise<Runtime> => {
  const logger = createLogger({ service, level: env.LOG_LEVEL });
  startTelemetry({
    serviceName: service,
    namespace: env.OTEL_SERVICE_NAMESPACE,
    otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  });
  const pool = createPool({
    connectionString: env.DATABASE_URL,
    maxConnections: env.DATABASE_MAX_CONNECTIONS,
  });

  const issuer = await createIssuer(env);
  const builtInJwks = issuer.jwks();
  const apiVerifier = createAccessTokenVerifier({
    issuer: authIssuer(env),
    audience: env.API_PUBLIC_URL,
    jwks: builtInJwks,
  });
  const mcpVerifier = createAccessTokenVerifier({
    issuer: env.MCP_AUTH_ISSUER ?? authIssuer(env),
    audience: env.MCP_PUBLIC_URL,
    jwks: env.MCP_AUTH_JWKS_URL ? new URL(env.MCP_AUTH_JWKS_URL) : builtInJwks,
  });

  const storage =
    env.STORAGE_DRIVER === 's3'
      ? createS3Storage({
          bucket: env.S3_BUCKET ?? '',
          region: env.S3_REGION,
          endpoint: env.S3_ENDPOINT ?? null,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        })
      : createFilesystemStorage(path.resolve(env.STORAGE_DIR));
  const scanner = env.CLAMAV_HOST
    ? chainScanners(basicContentScanner, createClamdScanner(env.CLAMAV_HOST, env.CLAMAV_PORT))
    : basicContentScanner;
  const assetUrls = createAssetUrlSigner(env.ASSET_URL_SECRET, env.API_PUBLIC_URL);

  const aiFailure = (error: unknown) =>
    logger.warn({ err: error }, 'AI provider failed; using deterministic fallback');
  let requirementExtractor: RequirementExtractor = deterministicRequirementExtractor;
  let profileDraftGenerator: SupplierProfileDraftGenerator = deterministicProfileDraftGenerator;
  if (env.AI_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY) {
    const llm = createAnthropicLlm({ apiKey: env.ANTHROPIC_API_KEY, model: env.ANTHROPIC_MODEL });
    requirementExtractor = createAiRequirementExtractor(llm, aiFailure);
    profileDraftGenerator = createAiProfileDraftGenerator(llm, aiFailure);
  }
  const embeddings: EmbeddingProvider | null =
    env.EMBEDDINGS_PROVIDER === 'hashing'
      ? createHashingEmbeddingProvider()
      : env.EMBEDDINGS_PROVIDER === 'http' && env.EMBEDDINGS_URL
        ? createHttpEmbeddingProvider({
            baseUrl: env.EMBEDDINGS_URL,
            apiKey: env.EMBEDDINGS_API_KEY ?? null,
            model: env.EMBEDDINGS_MODEL,
          })
        : null;

  const app = createApplication(
    {
      repos: createRepositories(pool),
      transaction: createTransactionRunner(pool),
      ontology: createPostgresOntologyProvider(pool),
      searchIndex: createPostgresSearchIndex(pool),
      embeddings,
      requirementExtractor,
      profileDraftGenerator,
      storage,
      scanner,
      textExtractor: defaultTextExtractor,
      assetUrls,
      jobs: createJobQueue(pool),
      confirmations: createConfirmationTokens(env.CONFIRMATION_SECRET, authIssuer(env)),
      clock: systemClock,
      telemetry: openTelemetry,
      features: { engagementActions: env.FEATURE_ENGAGEMENT_ACTIONS },
    },
    scryptPasswordHasher,
  );

  return {
    env,
    app,
    logger,
    pool,
    tokens: { issuer, apiVerifier, mcpVerifier },
    assetUrls,
    storage,
    jobStore: createJobRunnerStore(pool),
    async close() {
      await pool.end();
      await stopTelemetry();
    },
  };
};

export * from './seed';
