import type { RequestContext } from "./context";

/**
 * Structured JSON-line logging for the server foundation.
 *
 * One line per event: level, message, then structured fields (requestId,
 * operation, uid, durationMs, ...meta). Vercel's log viewer parses these
 * natively and grep stays trivial.
 *
 * Security invariants (enforced by redact()):
 * - never emits tokens, Authorization values, cookies, private keys,
 *   service-account JSON, or credential material under any key name
 * - callers pass UIDs explicitly where appropriate; nothing here scrapes
 *   them from request state
 */

// ponytail: single global redaction regex instead of per-logger config; add
// allow-lists only if a future field name collides.
const SENSITIVE_KEY =
  /token|authorization|cookie|password|secret|private[_-]?key|service[_-]?account|credential|api[_-]?key/i;

const LEVELS = ["info", "warn", "error"] as const;
export type LogLevel = (typeof LEVELS)[number];

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[max-depth]";
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

function emit(
  sink: (line: string) => void,
  level: LogLevel,
  context: RequestContext,
  message: string,
  meta?: Record<string, unknown>,
  durationMs?: number,
): void {
  const safeMeta = redact(meta ?? {}) as Record<string, unknown>;
  const fields: Record<string, unknown> = {
    level,
    msg: message,
    requestId: context.requestId,
    ...(context.operation !== undefined ? { operation: context.operation } : {}),
    ...(context.uid !== undefined ? { uid: context.uid } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...safeMeta,
  };
  sink(JSON.stringify(fields));
}

export function createLogger(
  context: RequestContext,
  options: { sink?: (line: string) => void } = {},
): Logger {
  // Default sink keeps one console call per event so levels survive Vercel log ingestion.
  const sink = options.sink ?? ((line: string) => console.log(line));
  return {
    info: (message, meta) => emit(sink, "info", context, message, meta),
    warn: (message, meta) => emit(sink, "warn", context, message, meta),
    error: (message, meta) => emit(sink, "error", context, message, meta),
  };
}

/** Wrap an async operation with start/end logging at the given level. */
export async function withLogging<T>(
  logger: Logger,
  operation: string,
  fn: () => Promise<T>,
  options: { level?: "info" | "warn" | "error" } = {},
): Promise<T> {
  const start = Date.now();
  try {
    const result = await fn();
    const level = options.level ?? "info";
    logger[level]("request completed", { operation, durationMs: Date.now() - start });
    return result;
  } catch (err) {
    logger.error("request failed", { operation, durationMs: Date.now() - start });
    throw err;
  }
}
