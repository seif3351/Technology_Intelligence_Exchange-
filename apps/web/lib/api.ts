import 'server-only';
import { Me } from '@atx/contracts';
import { headers as requestHeaders } from 'next/headers';
import type { z } from 'zod';
import { webConfig } from './config';
import { getSessionToken } from './session';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: readonly { path?: string; message: string }[] = [],
  ) {
    super(message);
  }
}

interface CallOptions<T extends z.ZodType> {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  readonly body?: unknown;
  readonly raw?: { readonly bytes: ArrayBuffer; readonly contentType: string };
  readonly schema: T;
  /** Use the caller's session (default) or call anonymously. */
  readonly anonymous?: boolean;
}

/** Server-side API call. Responses are validated against the shared contracts. */
export const api = async <T extends z.ZodType>(
  path: string,
  options: CallOptions<T>,
): Promise<z.infer<T>> => {
  const token = options.anonymous ? null : await getSessionToken();
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers['authorization'] = `Bearer ${token}`;
  // Forward the end-user address so the API rate-limits per user, not per BFF instance.
  const forwardedFor = (await requestHeaders()).get('x-forwarded-for');
  if (forwardedFor) headers['x-forwarded-for'] = forwardedFor;
  let body: BodyInit | undefined;
  if (options.raw) {
    headers['content-type'] = options.raw.contentType;
    body = options.raw.bytes;
  } else if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  const response = await fetch(new URL(path, webConfig.apiUrl), {
    method: options.method ?? 'GET',
    headers,
    body,
    cache: 'no-store',
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const problem = (payload ?? {}) as {
      code?: string;
      detail?: string;
      title?: string;
      errors?: { path?: string; message: string }[];
    };
    throw new ApiError(
      response.status,
      problem.code ?? 'ERROR',
      problem.detail ?? problem.title ?? `Request failed (${response.status})`,
      problem.errors ?? [],
    );
  }
  return options.schema.parse(payload);
};

export type MeT = z.infer<typeof Me>;

/** The signed-in user, or null for anonymous visitors / expired sessions. */
export const currentUser = async (): Promise<MeT | null> => {
  if (!(await getSessionToken())) return null;
  try {
    return await api('/v1/me', { schema: Me });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
};

export const describeError = (error: unknown): string =>
  error instanceof ApiError
    ? `${error.message}${error.details.length ? ` (${error.details.map((d) => d.message).join('; ')})` : ''}`
    : 'Something went wrong. Please try again.';
