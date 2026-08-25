import type { AppErrorCode } from "../errors/app-error";

/**
 * Lightweight request context for server functions.
 *
 * Plain data + tiny factories only — no framework coupling. TanStack Start
 * function middleware injects this via next({ context }) so handlers read it
 * from their standard context argument.
 *
 *   requestId — correlation ID across logs; taken from the incoming
 *               x-request-id header when present (set by the platform/CDN),
 *               otherwise generated.
 *   uid       — VERIFIED Firebase UID, set exclusively by auth middleware.
 *               Handlers must treat any other UID source as untrusted.
 *   operation — feature/operation label supplied by the caller, e.g.
 *               "account.export".
 */
export interface RequestContext {
  requestId: string;
  uid?: string;
  operation?: string;
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

/** Generate a correlation ID: timestamp-ordered, URL-safe, no deps. */
export function createRequestId(now: number = Date.now()): string {
  const time = now.toString(36);
  let rand = "";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  for (const b of bytes) rand += b.toString(36).padStart(2, "0");
  return `req-${time}-${rand}`;
}

/**
 * Pick a usable request ID from an incoming header value. Untrusted input:
 * anything absent or malformed is replaced with a generated ID rather than
 * echoed into logs.
 */
export function requestIdFromHeader(value: unknown): string {
  if (typeof value === "string" && REQUEST_ID_RE.test(value)) return value;
  return createRequestId();
}
