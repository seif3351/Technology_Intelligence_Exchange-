/**
 * Explicit error taxonomy shared by every layer. Adapters (HTTP, MCP) map
 * these codes to transport-specific responses; nothing here knows about HTTP.
 */
export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVARIANT_VIOLATION'
  | 'CONFIDENTIALITY_VIOLATION'
  | 'CONFIRMATION_REQUIRED'
  | 'FEATURE_DISABLED'
  | 'RATE_LIMITED'
  | 'DEPENDENCY_UNAVAILABLE';

export interface ErrorDetail {
  readonly path?: string;
  readonly message: string;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: readonly ErrorDetail[];

  constructor(code: ErrorCode, message: string, details: readonly ErrorDetail[] = []) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

export const validationError = (message: string, details: readonly ErrorDetail[] = []) =>
  new AppError('VALIDATION_FAILED', message, details);

/** Deliberately does not reveal whether a resource exists in another tenant. */
export const notFound = (resource: string) => new AppError('NOT_FOUND', `${resource} not found`);

export const forbidden = (message = 'Not permitted') => new AppError('FORBIDDEN', message);

export const unauthenticated = (message = 'Authentication required') =>
  new AppError('UNAUTHENTICATED', message);

export const conflict = (message: string) => new AppError('CONFLICT', message);

export const invariant = (message: string) => new AppError('INVARIANT_VIOLATION', message);

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;
