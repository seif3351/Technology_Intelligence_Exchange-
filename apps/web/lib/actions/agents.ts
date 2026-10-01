'use server';

import { TokenResponse } from '@atx/contracts';
import { api, describeError } from '../api';

export interface AgentTokenState {
  readonly token?: string;
  readonly expiresIn?: number;
  readonly scopes?: readonly string[];
  readonly error?: string;
}

export async function issueAgentToken(_state: AgentTokenState, form: FormData): Promise<AgentTokenState> {
  const scopes = form.getAll('scope').map(String);
  try {
    const result = await api('/v1/auth/agent-tokens', {
      method: 'POST',
      body: { scopes, ttlHours: 8 },
      schema: TokenResponse,
    });
    return { token: result.accessToken, expiresIn: result.expiresIn, scopes: result.scopes };
  } catch (error) {
    return { error: describeError(error) };
  }
}
