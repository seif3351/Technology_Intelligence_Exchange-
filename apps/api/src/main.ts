import { loadConfig } from '@atx/config';
import { migrate } from '@atx/infrastructure';
import { createRuntime } from '@atx/runtime';
import { buildServer } from './server';

const env = loadConfig();
const runtime = await createRuntime(env, 'atx-api');
if (env.MIGRATE_ON_START) await migrate(runtime.pool);
const server = await buildServer(runtime);

const shutdown = async (signal: string) => {
  runtime.logger.info({ signal }, 'shutting down');
  await server.close();
  await runtime.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

await server.listen({ port: env.API_PORT, host: '0.0.0.0' });
