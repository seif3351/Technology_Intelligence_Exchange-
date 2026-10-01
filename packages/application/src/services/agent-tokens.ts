import {
  AGENT_TOKEN_MAX_DAYS,
  type AccessGrant,
  type AccessGrantStatus,
  accessGrantStatus,
  asId,
  forbidden,
  newId,
  notFound,
  sanitizeUntrustedText,
  validationError,
} from '@atx/domain';
import type { ApplicationDeps } from '../deps';
import { requireUser } from '../policies';
import type { RequestContext, Scope } from '../principal';
import { recordAudit } from './support';

export interface AgentTokenView {
  readonly id: string;
  readonly label: string;
  readonly scopes: readonly string[];
  readonly status: AccessGrantStatus;
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastUsedAt: string | null;
}

const present = (grant: AccessGrant, now: Date): AgentTokenView => ({
  id: grant.id,
  label: grant.label,
  scopes: grant.scopes,
  status: accessGrantStatus(grant, now),
  createdAt: grant.createdAt.toISOString(),
  expiresAt: grant.expiresAt.toISOString(),
  lastUsedAt: grant.lastUsedAt?.toISOString() ?? null,
});

/**
 * Personal agent tokens for MCP hosts that accept a bearer token. Each token
 * is backed by a persisted grant, so it can be listed and revoked one by one.
 */
export class AgentTokenService {
  constructor(private readonly deps: ApplicationDeps) {}

  async issue(
    ctx: RequestContext,
    input: { readonly label: string; readonly scopes: readonly string[]; readonly expiresInDays: number },
  ): Promise<{ readonly token: string; readonly grant: AgentTokenView }> {
    const user = requireUser(ctx.principal);
    // Only first-party sessions mint agent tokens: an agent cannot mint itself more tokens.
    if (user.clientId !== null) throw forbidden('Agent tokens can only be created from the ATX website');
    const days = Math.trunc(input.expiresInDays);
    if (days < 1 || days > AGENT_TOKEN_MAX_DAYS)
      throw validationError(`Agent tokens are valid for 1 to ${AGENT_TOKEN_MAX_DAYS} days`);
    // A token can never carry more than the issuing user currently has.
    const scopes = [...new Set(input.scopes)].filter((scope) => user.scopes.has(scope as Scope)).sort();
    if (scopes.length === 0) throw validationError('None of the requested scopes is available to you');
    const now = this.deps.clock.now();
    const grant: AccessGrant = {
      id: newId(),
      userId: user.userId,
      kind: 'agent_token',
      label: sanitizeUntrustedText(input.label, 80) || 'Agent token',
      clientId: 'personal-agent-token',
      scopes,
      createdAt: now,
      expiresAt: new Date(now.getTime() + days * 86_400_000),
      lastUsedAt: null,
      revokedAt: null,
    };
    await this.deps.transaction(async (repos) => {
      await repos.accessGrants.insert(grant);
      await recordAudit(repos.audit, ctx, now, {
        action: 'agent_token.create',
        resourceType: 'access_grant',
        resourceId: grant.id,
        organizationId: null,
        metadata: { scopes: scopes.join(' '), days },
      });
    });
    const token = await this.deps.tokenSigner.sign({
      subject: user.userId,
      audience: this.deps.settings.mcpResourceUrl,
      scopes,
      clientId: grant.clientId,
      ttlSeconds: days * 86_400,
      grantId: grant.id,
    });
    return { token, grant: present(grant, now) };
  }

  async list(ctx: RequestContext): Promise<AgentTokenView[]> {
    const user = requireUser(ctx.principal);
    const now = this.deps.clock.now();
    return (await this.deps.repos.accessGrants.listForUser(user.userId, 'agent_token')).map((g) =>
      present(g, now),
    );
  }

  async revoke(ctx: RequestContext, grantId: string): Promise<void> {
    const user = requireUser(ctx.principal);
    const now = this.deps.clock.now();
    // Same 404 for foreign, unknown and already revoked tokens.
    if (!(await this.deps.repos.accessGrants.revoke(asId(grantId), user.userId, now)))
      throw notFound('Agent token');
    await recordAudit(this.deps.repos.audit, ctx, now, {
      action: 'agent_token.revoke',
      resourceType: 'access_grant',
      resourceId: grantId,
      organizationId: null,
    });
  }
}
