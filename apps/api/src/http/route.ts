import type { RequestContext } from '@atx/application';
import { validationError } from '@atx/domain';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';

export type AuthMode = 'none' | 'optional' | 'required';

/**
 * Structural shape a handler may return for a response schema: readonly
 * arrays, Dates where strings are serialized, and any object for open
 * records. The value is JSON-serialized and then validated against the
 * schema at runtime, so this only relaxes compile-time strictness.
 */
export type Loose<T> = T extends string
  ? string | Date
  : T extends number | boolean | null | undefined
    ? T
    : T extends readonly (infer U)[]
      ? readonly Loose<U>[]
      : T extends object
        ? string extends keyof T
          ? object
          : { readonly [K in keyof T]: Loose<T[K]> }
        : T;

export interface RouteSpec<
  B extends z.ZodType,
  Q extends z.ZodType,
  P extends z.ZodType,
  R extends z.ZodType,
> {
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly operationId: string;
  readonly summary: string;
  readonly tags: readonly string[];
  readonly auth: AuthMode;
  readonly body?: B;
  readonly query?: Q;
  readonly params?: P;
  readonly response: R;
  readonly status?: number;
  readonly rateLimit?: { readonly max: number; readonly timeWindow: string };
  readonly handler: (input: {
    readonly body: z.infer<B>;
    readonly query: z.infer<Q>;
    readonly params: z.infer<P>;
    readonly ctx: RequestContext;
    readonly request: FastifyRequest;
    readonly reply: FastifyReply;
  }) => Promise<Loose<z.input<R>>>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRouteSpec = RouteSpec<any, any, any, any>;

/** Collects route specs so the OpenAPI document is generated from exactly what is served. */
export class RouteRegistry {
  readonly routes: AnyRouteSpec[] = [];
}

const parse = <T extends z.ZodType>(schema: T | undefined, value: unknown, where: string): z.infer<T> => {
  if (!schema) return undefined as z.infer<T>;
  const result = schema.safeParse(value ?? {});
  if (!result.success) {
    throw validationError(
      `Invalid ${where}`,
      result.error.issues
        .slice(0, 20)
        .map((issue) => ({ path: [where, ...issue.path.map(String)].join('.'), message: issue.message })),
    );
  }
  return result.data;
};

export const defineRoute = <
  B extends z.ZodType,
  Q extends z.ZodType,
  P extends z.ZodType,
  R extends z.ZodType,
>(
  spec: RouteSpec<B, Q, P, R>,
): RouteSpec<B, Q, P, R> => spec;

export const registerRoutes = (
  app: FastifyInstance,
  registry: RouteRegistry,
  specs: readonly AnyRouteSpec[],
  resolveContext: (request: FastifyRequest, auth: AuthMode) => Promise<RequestContext>,
): void => {
  for (const spec of specs) {
    registry.routes.push(spec);
    app.route({
      method: spec.method,
      url: spec.url,
      ...(spec.rateLimit ? { config: { rateLimit: spec.rateLimit } } : {}),
      handler: async (request, reply) => {
        const ctx = await resolveContext(request, spec.auth);
        const body = parse(spec.body, request.body, 'body');
        const query = parse(spec.query, request.query, 'query');
        const params = parse(spec.params, request.params, 'params');
        const result = await spec.handler({ body, query, params, ctx, request, reply });
        if (reply.sent) return reply;
        // Output validation doubles as an allow-list: unknown fields are stripped.
        const output = spec.response.parse(JSON.parse(JSON.stringify(result ?? null)));
        return reply.status(spec.status ?? 200).send(output);
      },
    });
  }
};
