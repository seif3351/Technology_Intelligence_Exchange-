import type { Principal, RequestContext } from '@atx/application';
import { unauthenticated } from '@atx/domain';
import { InvalidTokenError } from '@atx/auth';
import type { Runtime } from '@atx/runtime';
import type { FastifyRequest } from 'fastify';
import type { AuthMode } from './route';

/**
 * Resolves the caller from `Authorization: Bearer <jwt>`. The token must be
 * issued for THIS API (audience check); tokens minted for the MCP server or
 * any other resource are rejected.
 */
export const createContextResolver =
  (runtime: Runtime) =>
  async (request: FastifyRequest, auth: AuthMode): Promise<RequestContext> => {
    const header = request.headers.authorization;
    let principal: Principal = { kind: 'anonymous', channel: 'api' };
    if (header && auth !== 'none') {
      const match = /^Bearer ([A-Za-z0-9._~+/-]+=*)$/.exec(header);
      if (!match?.[1]) throw unauthenticated('Malformed Authorization header');
      try {
        const claims = await runtime.tokens.apiVerifier.verify(match[1]);
        principal = await runtime.app.identity.principalFor(claims.subject as never, {
          channel: claims.clientId ? 'api' : 'web',
          clientId: claims.clientId,
          grantedScopes: claims.scopes,
          issuedAtMs: claims.issuedAtMs,
          grantId: claims.grantId,
        });
      } catch (error) {
        if (error instanceof InvalidTokenError) throw unauthenticated(error.message);
        throw error;
      }
    }
    if (auth === 'required' && principal.kind !== 'user') throw unauthenticated();
    return { principal, requestId: request.id };
  };
