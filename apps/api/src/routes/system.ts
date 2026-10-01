import type { Runtime } from '@atx/runtime';
import { Uuid } from '@atx/contracts';
import { notFound } from '@atx/domain';
import { z } from 'zod';
import { type AnyRouteSpec, defineRoute } from '../http/route';

export const systemRoutes = (runtime: Runtime): AnyRouteSpec[] => [
  defineRoute({
    method: 'GET',
    url: '/healthz',
    operationId: 'liveness',
    summary: 'Liveness probe',
    tags: ['system'],
    auth: 'none',
    response: z.object({ status: z.literal('ok') }),
    handler: async () => ({ status: 'ok' as const }),
  }),
  defineRoute({
    method: 'GET',
    url: '/readyz',
    operationId: 'readiness',
    summary: 'Readiness probe (database reachable)',
    tags: ['system'],
    auth: 'none',
    response: z.object({ status: z.literal('ready') }),
    handler: async () => {
      await runtime.pool.query('SELECT 1');
      return { status: 'ready' as const };
    },
  }),
  defineRoute({
    method: 'GET',
    url: '/v1/assets/:assetId/content',
    operationId: 'downloadAsset',
    summary: 'Download a stored public asset through a short-lived signed URL',
    tags: ['catalog'],
    auth: 'none',
    params: z.object({ assetId: Uuid }),
    query: z.object({ expires: z.string().max(20), signature: z.string().max(100) }),
    response: z.unknown(),
    handler: async ({ params, query, reply }) => {
      if (!runtime.assetUrls.verify(params.assetId, query.expires, query.signature)) throw notFound('Asset');
      const asset = await runtime.app.catalog.downloadableAsset(params.assetId);
      const bytes = await runtime.storage.get(asset.storageKey);
      // Downloads are never rendered inline: untrusted HTML/PDF must not execute in our origin.
      return reply
        .header('content-type', asset.contentType)
        .header('content-disposition', `attachment; filename="asset-${asset.id}"`)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', 'private, max-age=300')
        .send(Buffer.from(bytes));
    },
  }),
];
