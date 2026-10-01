import { buildServer } from '@atx/api';
import type { Runtime } from '@atx/runtime';

/** In-process HTTP client for root-level integration tests (no network). */
export const createHttpHarness = async (runtime: Runtime) => {
  const server = await buildServer(runtime);
  const call = (method: 'GET' | 'POST', url: string, token: string | null, payload?: unknown) =>
    server.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as object }),
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  return {
    server,
    get: (url: string, token: string | null = null) => call('GET', url, token),
    post: (url: string, payload: unknown = {}, token: string | null = null) =>
      call('POST', url, token, payload),
    async login(email: string, password: string): Promise<string> {
      const response = await call('POST', '/v1/auth/login', null, { email, password });
      if (response.statusCode !== 200) throw new Error(`login failed: ${response.statusCode}`);
      return response.json().accessToken as string;
    },
  };
};

/** Extracts the `token` query parameter of the first link in an email body. */
export const linkToken = (text: string): string => {
  const link = /https?:\/\/\S+/.exec(text)?.[0];
  if (!link) throw new Error('no link in email');
  return new URL(link).searchParams.get('token') ?? new URL(link).searchParams.get('invite') ?? '';
};
