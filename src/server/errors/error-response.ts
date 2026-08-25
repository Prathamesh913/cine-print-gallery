import { AppError, isAppError } from "./app-error";

/**
 * The ONLY error shape clients receive from migrated server functions.
 *
 * Stable, minimal, secret-free: code + human message. Causes, stacks, stage
 * names, credential material — everything internal stays behind
 * serializeForLog().
 *
 * Shape:
 *   { ok: true, data }                              — success
 *   { ok: false, error: { code, message } }         — failure
 */
export interface ErrorResponseBody {
  ok: false;
  error: { code: string; message: string };
}

export interface SuccessBody<T> {
  ok: true;
  data: T;
}

/**
 * Reduce any thrown value to the client-safe envelope.
 *
 * Known AppErrors keep their code + public message. Anything else collapses
 * to a generic INTERNAL error — the original is preserved separately for
 * server logs via serializeForLog().
 */
export function toPublicError(error: unknown): ErrorResponseBody {
  if (isAppError(error)) {
    return {
      ok: false,
      error: { code: error.code, message: error.message },
    };
  }
  // Unknown/unexpected: never echo internals (messages may contain driver
  // errors, paths, credential hints).
  return {
    ok: false,
    error: { code: "INTERNAL", message: "Something went wrong. Please try again." },
  };
}

export function toSuccessBody<T>(data: T): SuccessBody<T> {
  return { ok: true, data };
}

const SENSITIVE_KEY =
  /token|authorization|cookie|password|secret|private[_-]?key|service[_-]?account|credential|api[_-]?key/i;

/**
 * Full-fidelity server-side representation for logging: name, message, code,
 * status, meta, cause chain (depth-limited) and stack.
 *
 * Redacts sensitive keys anywhere in meta/cause objects. Errors themselves are
 * walked only through their `cause` links — their messages are kept because
 * Firebase Admin's staged errors have safe curated messages, while arbitrary
 * nested structures inside meta get redacted key-wise.
 */
// ponytail: depth-limited cause chain (5) and shallow-ish recursion (6 levels)
// covers our flat error shapes; deeper chains truncate silently.
export function serializeForLog(error: unknown, depth = 0): unknown {
  if (depth > 5) return "[max-depth]";
  if (error instanceof Error) {
    const base: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
    if (error instanceof AppError) {
      base.code = error.code;
      base.statusCode = error.statusCode;
      if (error.meta) base.meta = redact(error.meta);
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) base.cause = serializeForLog(cause, depth + 1);
    return base;
  }
  if (typeof error === "object" && error !== null) {
    return redact(error as Record<string, unknown>);
  }
  return String(error);
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[max-depth]";
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[REDACTED]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}
