import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '@atx/config';
import { createRuntime } from '@atx/runtime';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { loadViews } from './apps/resources';
import { createMcpHttpApp } from './server';
import { loadSkills } from './skills/skills';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

const env = loadConfig();
const runtime = await createRuntime(env, 'atx-mcp');
const views = loadViews();
if (views.size === 0)
  runtime.logger.warn(
    'MCP App views not built; run `pnpm --filter @atx/mcp-server build:views`. Structured fallback still works.',
  );
const app = createMcpHttpApp(runtime, { skills: loadSkills(path.join(ROOT, 'skills')), views });

const server = createServer(
  toNodeHandler(app, { onerror: (error) => runtime.logger.error({ err: error }, 'mcp node adapter error') }),
);
server.listen(env.MCP_PORT, '0.0.0.0', () =>
  runtime.logger.info({ port: env.MCP_PORT, resource: env.MCP_PUBLIC_URL }, 'MCP server listening'),
);

const shutdown = async () => {
  server.close();
  await app.close();
  await runtime.close();
  process.exit(0);
};
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
