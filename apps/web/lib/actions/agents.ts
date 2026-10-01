'use server';

import { IssuedAgentToken } from '@atx/contracts';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { api, describeError } from '../api';

export interface AgentTokenState {
  readonly token?: string;
  readonly expiresAt?: string;
  readonly scopes?: readonly string[];
  readonly error?: string;
}

export async function issueAgentToken(_state: AgentTokenState, form: FormData): Promise<AgentTokenState> {
  const scopes = form.getAll('scope').map(String);
  try {
    const result = await api('/v1/auth/agent-tokens', {
      method: 'POST',
      body: {
        scopes,
        label: String(form.get('label') ?? '').trim() || 'Agent token',
        expiresInDays: Number(form.get('expiresInDays') ?? 30),
      },
      schema: IssuedAgentToken,
    });
    revalidatePath('/docs/mcp');
    return { token: result.accessToken, expiresAt: result.grant.expiresAt, scopes: result.grant.scopes };
  } catch (error) {
    return { error: describeError(error) };
  }
}

export async function revokeAgentToken(form: FormData): Promise<void> {
  await api(`/v1/auth/agent-tokens/${String(form.get('grantId') ?? '')}/revoke`, {
    method: 'POST',
    body: {},
    schema: z.object({ revoked: z.literal(true) }),
  });
  revalidatePath('/docs/mcp');
}
