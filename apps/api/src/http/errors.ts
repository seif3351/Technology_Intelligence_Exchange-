import { type ErrorCode, isAppError } from '@atx/domain';

const STATUS: Readonly<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  FEATURE_DISABLED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INVARIANT_VIOLATION: 422,
  CONFIDENTIALITY_VIOLATION: 422,
  CONFIRMATION_REQUIRED: 428,
  RATE_LIMITED: 429,
  DEPENDENCY_UNAVAILABLE: 503,
};

export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail?: string;
  readonly errors?: readonly { readonly path?: string; readonly message: string }[];
  readonly requestId?: string;
}

/** Maps any thrown value to RFC 9457 problem details. Unknown errors never leak internals. */
export const toProblem = (error: unknown, requestId: string): ProblemBody => {
  if (isAppError(error)) {
    const status = STATUS[error.code];
    return {
      type: `https://docs.atx.example/errors/${error.code.toLowerCase()}`,
      title: error.code.replace(/_/g, ' ').toLowerCase(),
      status,
      code: error.code,
      detail: error.message,
      ...(error.details.length > 0 ? { errors: error.details } : {}),
      requestId,
    };
  }
  const statusCode = (error as { statusCode?: number } | null)?.statusCode;
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode < 500) {
    return {
      type: 'https://docs.atx.example/errors/bad_request',
      title: statusCode === 429 ? 'rate limited' : 'bad request',
      status: statusCode,
      code: statusCode === 429 ? 'RATE_LIMITED' : statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : statusCode === 415 ? 'UNSUPPORTED_MEDIA_TYPE' : 'BAD_REQUEST',
      detail: statusCode === 429 ? 'Too many requests' : (error as Error).message,
      requestId,
    };
  }
  return { type: 'https://docs.atx.example/errors/internal', title: 'internal error', status: 500, code: 'INTERNAL', requestId };
};
