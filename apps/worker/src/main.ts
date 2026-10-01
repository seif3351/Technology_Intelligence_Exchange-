import { loadConfig } from '@atx/config';
import { migrate } from '@atx/infrastructure';
import { createRuntime } from '@atx/runtime';
import { runWorker } from './worker';

const env = loadConfig();
const runtime = await createRuntime(env, 'atx-worker');
await migrate(runtime.pool);

if (process.argv[2] === 'reindex') {
  // Search index and embeddings are derived data: rebuild from canonical tables.
  const counts = await runtime.app.indexing.reindexAll();
  runtime.logger.info(counts, 'search index rebuilt');
  await runtime.close();
} else {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  runtime.logger.info('worker started');
  await runWorker(runtime, { signal: controller.signal });
  await runtime.close();
}
