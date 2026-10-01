import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { listSetting } from '@atx/config';
import type { Runtime } from '@atx/runtime';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { toProblem } from './http/errors';
import { buildOpenApiDocument } from './http/openapi';
import { createContextResolver } from './http/principal';
import { RouteRegistry, registerRoutes } from './http/route';
import { adminRoutes } from './routes/admin';
import { buyerRoutes } from './routes/buyer';
import { catalogRoutes } from './routes/catalog';
import { identityRoutes } from './routes/identity';
import { systemRoutes } from './routes/system';
import { workspaceRoutes } from './routes/workspace';

const REQUEST_ID = /^[A-Za-z0-9._-]{8,100}$/;
const UPLOAD_TYPES = ['application/pdf', 'text/plain', 'text/markdown', 'text/html', 'text/vtt', 'image/png', 'image/jpeg', 'image/webp'];
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const allRoutes = (runtime: Runtime) => [
  ...systemRoutes(runtime),
  ...identityRoutes(runtime),
  ...catalogRoutes(runtime.app),
  ...workspaceRoutes(runtime.app),
  ...buyerRoutes(runtime.app),
  ...adminRoutes(runtime.app),
];

/** Builds the HTTP adapter. Business logic lives in @atx/application; this file only wires transport concerns. */
export const buildServer = async (runtime: Runtime): Promise<FastifyInstance> => {
  const app = Fastify({
    // pino's Logger is the concrete implementation of Fastify's logger interface.
    loggerInstance: runtime.logger as FastifyBaseLogger,
    trustProxy: true,
    bodyLimit: 1024 * 1024,
    genReqId: (request) => {
      const incoming = request.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
    },
  });

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } } });
  await app.register(cors, { origin: listSetting(runtime.env.CORS_ORIGINS), credentials: false, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });

  // Raw binary uploads for asset ingestion only.
  app.addContentTypeParser(UPLOAD_TYPES, { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_request, body, done) => done(null, body));

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setErrorHandler((error, request, reply) => {
    const problem = toProblem(error, request.id);
    if (problem.status >= 500) request.log.error({ err: error }, 'request failed');
    else if (problem.status === 401 || problem.status === 403) request.log.warn({ code: problem.code, url: request.routeOptions.url }, 'authorization failure');
    return reply.status(problem.status).type('application/problem+json').send(problem);
  });
  app.setNotFoundHandler((request, reply) =>
    reply.status(404).type('application/problem+json').send({ type: 'https://docs.atx.example/errors/not_found', title: 'not found', status: 404, code: 'NOT_FOUND', requestId: request.id }),
  );

  const registry = new RouteRegistry();
  registerRoutes(app, registry, allRoutes(runtime), createContextResolver(runtime));
  const openApi = buildOpenApiDocument(registry.routes, runtime.env.API_PUBLIC_URL);
  app.get('/openapi.json', async () => openApi);
  return app;
};
