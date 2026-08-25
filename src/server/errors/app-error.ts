/**
 * Application error foundation.
 *
 * One class, explicit codes, HTTP semantics, safe public messages. Internal
 * causes stay server-side (see toPublicError in ./error-response).
 *
 * Compatibility note: src/start.ts's global error middleware rethrows anything
 * carrying a `statusCode` property, so an AppError thrown from a server
 * function keeps its intended status through the existing pipeline.
 */

export const APP_ERROR_CODES = [
  "UNAUTHENTICATED",
  "UNAUTHORIZED",
  "VALIDATION_FAILED",
  "NOT_FOUND",
  "CONFLICT",
  "INFRASTRUCTURE",
  "INTERNAL",
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

const DEFAULT_STATUS: Record<AppErrorCode, number> = {
  UNAUTHENTICATED: 401,
  UNAUTHORIZED: 403,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INFRASTRUCTURE: 503,
  INTERNAL: 500,
};

export interface AppErrorOptions {
  /** Overrides the category default. */
  statusCode?: number;
  /** Original error, preserved for server-side logs. Never sent to clients. */
  cause?: unknown;
  /** Structured diagnostic fields. Must already be secret-free. */
  meta?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly statusCode: number;
  readonly meta?: Record<string, unknown>;

  constructor(code: AppErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.statusCode = options.statusCode ?? DEFAULT_STATUS[code];
    if (options.meta !== undefined) this.meta = options.meta;
  }
}

/** Thin factories so services read as intent, not configuration. */
export const unauthenticated = (message = "You need to sign in to continue.", options: AppErrorOptions = {}) =>
  new AppError("UNAUTHENTICATED", message, options);

export const unauthorized = (message = "You don't have access to this resource.", options: AppErrorOptions = {}) =>
  new AppError("UNAUTHORIZED", message, options);

export const validationFailed = (message = "That request wasn't valid.", options: AppErrorOptions = {}) =>
  new AppError("VALIDATION_FAILED", message, options);

export const notFound = (message = "Not found.", options: AppErrorOptions = {}) =>
  new AppError("NOT_FOUND", message, options);

export const conflict = (message = "That conflicts with existing data.", options: AppErrorOptions = {}) =>
  new AppError("CONFLICT", message, options);

export const infrastructure = (message = "A server dependency is unavailable.", options: AppErrorOptions = {}) =>
  new AppError("INFRASTRUCTURE", message, options);

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
