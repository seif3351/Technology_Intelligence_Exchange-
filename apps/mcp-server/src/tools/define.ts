import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@atx/application';
import { type McpToolName, McpTools } from '@atx/contracts';
import { isAppError } from '@atx/domain';
import { RESOURCE_MIME_TYPE, getUiCapability, registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import {
  CLIENT_CAPABILITIES_META_KEY,
  type CallToolResult,
  type ClientCapabilities,
  type McpServer,
  type ScopeChallengeHandler,
  type ServerContext,
  type ToolAnnotations,
} from '@modelcontextprotocol/server';
import type { Runtime } from '@atx/runtime';
import type { z } from 'zod';
import type { Links } from '../presenters';

export interface ToolEnvironment {
  readonly runtime: Runtime;
  readonly ctx: RequestContext;
  readonly links: Links;
  /** True when the calling host renders MCP Apps; text output is then kept minimal. */
  readonly uiSupported: boolean;
}

export interface ToolDefinition<K extends McpToolName> {
  readonly name: K;
  readonly title: string;
  readonly description: string;
  readonly annotations: ToolAnnotations;
  /** ui:// resource rendered by MCP Apps hosts (progressive enhancement). */
  readonly uiResource?: string;
  /** OAuth scopes required, possibly depending on arguments (enables step-up authorization). */
  readonly requiredScopes?: (args: Record<string, unknown>) => readonly string[];
  readonly run: (
    args: z.infer<(typeof McpTools)[K]['input']>,
    env: ToolEnvironment,
  ) => Promise<{ readonly structured: z.input<(typeof McpTools)[K]['output']>; readonly text: string }>;
}

/** Any one tool definition (a union over all tool names, so lists stay type-safe). */
export type AnyToolDefinition = { [K in McpToolName]: ToolDefinition<K> }[McpToolName];

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: false,
  destructiveHint: false,
};

const uiSupported = (sdkCtx: ServerContext): boolean => {
  const envelope = sdkCtx.mcpReq.envelope as Record<string, unknown> | undefined;
  const capabilities = envelope?.[CLIENT_CAPABILITIES_META_KEY] as ClientCapabilities | undefined;
  return getUiCapability(capabilities)?.mimeTypes?.includes(RESOURCE_MIME_TYPE) ?? false;
};

/** Maps application errors to in-band tool errors the agent can act on. */
const toolError = (error: unknown): CallToolResult => {
  if (isAppError(error)) {
    const hint =
      error.code === 'UNAUTHENTICATED'
        ? ' Ask the user to connect their Automotive Technology Exchange account (OAuth) and retry.'
        : error.code === 'FEATURE_DISABLED'
          ? ' This action is not enabled on this deployment; give the user the offering URL instead.'
          : error.code === 'CONFIRMATION_REQUIRED'
            ? ' Call prepare_engagement_request again and get explicit user approval of the new preview.'
            : '';
    const details = error.details.map((d) => `${d.path ? `${d.path}: ` : ''}${d.message}`).join('; ');
    return {
      isError: true,
      content: [
        { type: 'text', text: `${error.code}: ${error.message}${details ? ` (${details})` : ''}.${hint}` },
      ],
    };
  }
  return {
    isError: true,
    content: [{ type: 'text', text: 'INTERNAL: the request could not be completed. Try again later.' }],
  };
};

const scopeChallenge =
  (requiredScopes: AnyToolDefinition['requiredScopes']): ScopeChallengeHandler =>
  ({ request, authInfo }) => {
    if (!requiredScopes || !authInfo) return undefined; // unauthenticated callers get an in-band UNAUTHENTICATED error
    const args = ((request.params as { arguments?: Record<string, unknown> } | undefined)?.arguments ??
      {}) as Record<string, unknown>;
    const missing = requiredScopes(args).filter((scope) => !authInfo.scopes.includes(scope));
    if (missing.length === 0) return undefined;
    const scopes = [...new Set([...authInfo.scopes, ...missing])] as [string, ...string[]];
    return { scopes, errorDescription: `This operation requires: ${missing.join(' ')}` };
  };

export const registerTool = (
  server: McpServer,
  definition: AnyToolDefinition,
  environment: Omit<ToolEnvironment, 'uiSupported' | 'ctx'> & {
    readonly principal: RequestContext['principal'];
  },
): void => {
  const contract = McpTools[definition.name];
  const handler = async (args: unknown, sdkCtx: ServerContext): Promise<CallToolResult> => {
    const telemetry = environment.runtime.app.deps.telemetry;
    const started = Date.now();
    const env: ToolEnvironment = {
      runtime: environment.runtime,
      links: environment.links,
      ctx: { principal: environment.principal, requestId: `mcp-${randomUUID()}` },
      uiSupported: uiSupported(sdkCtx),
    };
    let outcome = 'success';
    try {
      const { structured, text } = await telemetry.span(
        `mcp.tool ${definition.name}`,
        { 'mcp.tool.name': definition.name },
        () =>
          // The SDK validated `args` against this tool's own input schema.
          (
            definition.run as (
              input: unknown,
              env: ToolEnvironment,
            ) => Promise<{ structured: unknown; text: string }>
          )(args, env),
      );
      return {
        content: [
          { type: 'text', text: env.uiSupported && definition.uiResource ? truncate(text, 600) : text },
        ],
        structuredContent: structured as Record<string, unknown>,
      };
    } catch (error) {
      outcome = isAppError(error) ? error.code : 'internal_error';
      if (!isAppError(error))
        environment.runtime.logger.error({ err: error, tool: definition.name }, 'mcp tool failed');
      return toolError(error);
    } finally {
      telemetry.recordDuration('atx.mcp.tool.duration', Date.now() - started, {
        tool: definition.name,
        outcome,
      });
      telemetry.increment('atx.mcp.tool.calls', {
        tool: definition.name,
        outcome,
        authenticated: environment.principal.kind === 'user',
      });
    }
  };

  const config = {
    title: definition.title,
    description: definition.description,
    inputSchema: contract.input,
    outputSchema: contract.output,
    annotations: definition.annotations,
    ...(definition.requiredScopes ? { scopeChallenge: scopeChallenge(definition.requiredScopes) } : {}),
  };
  if (definition.uiResource) {
    registerAppTool(
      server,
      definition.name,
      { ...config, _meta: { ui: { resourceUri: definition.uiResource } } },
      handler as never,
    );
  } else {
    server.registerTool(definition.name, config, handler as never);
  }
};

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;
