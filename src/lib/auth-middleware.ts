import { createMiddleware } from "@tanstack/react-start";
import { FirebaseAdminError, verifyTokenUid } from "./server-auth";
import { unauthorized, unauthenticated } from "../server/errors/app-error";
import type { RequestContext } from "../server/request/context";

/**
 * Auth foundation: verifies a Firebase ID token and injects the VERIFIED uid
 * into server-function context. Handlers read `context.uid` — never trust any
 * client-declared UID again.
 *
 * PLACEMENT: this file lives in src/lib/, NOT src/server/. A function
 * middleware is ISOMORPHIC — its object is part of every server-fn chain that
 * features import from client-reachable modules, and TanStack Start's
 * import-protection denies any client-retained edge into src/server/**.
 * Only the .server() closure below touches server-only modules; the compiler
 * extracts it server-side and it shakes out of client bundles. Keep it that
 * way — do not add module-scope references to src/server/* here.
 *
 * Token transport (deliberate Phase 1 boundary):
 *   Reads `data.token` from the request payload, matching TODAY's transport
 *   (`{ token, uid, ... }` bodies sent by src/lib/auth-token.ts). This lets the
 *   Account migration attach this middleware without touching the client.
 *
 *   Migration path to header transport (Phase 2+ decision): function
 *   middleware supports a `.client()` phase whose `next()` accepts `headers`,
 *   so a client-side middleware can attach an Authorization header from the
 *   session token — after which this middleware additionally reads
 *   headers/context instead of data. No cookie redesign required. Do NOT
 *   change transport until a feature migration switches both sides together.
 *
 * Failure semantics mirror the existing hotfix behavior:
 * - missing token            → AppError UNAUTHENTICATED (401)
 * - invalid/expired token    → AppError UNAUTHORIZED (403), cause logged
 * - FirebaseAdminError       → PROPAGATED (config/module failures must stay
 *                              visible as 5xx-class errors, not masquerade
 *                              as expired sessions)
 */
import type { AnyFunctionMiddleware } from "@tanstack/react-start";

// The installed TanStack Start version's function-middleware generics use
// in/out variance that collapses TSendContext/TServerContext to `never` for
// any concrete chain, rejecting assignability to Any*Middleware at attachment
// sites. One documented bridge at THIS definition site keeps every feature's
// `.middleware([authMiddleware])` cleanly typed; runtime shape and behavior
// are unchanged and covered by tests/server/auth-middleware.test.ts.
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ data, context, next }) => {
    const token =
      typeof data === "object" && data !== null && "token" in data
        ? ((data as { token?: unknown }).token as string | null | undefined)
        : undefined;

    if (!token) {
      throw unauthenticated();
    }

    let uid: string;
    try {
      uid = await verifyTokenUid(token);
    } catch (err) {
      // Config/infrastructure misconfiguration stays loud (see admin.ts stages);
      // genuine bad tokens become a safe 403.
      if (err instanceof FirebaseAdminError) throw err;
      throw unauthorized("Invalid or expired session.", { cause: err });
    }

    return next({
      context: Object.assign({}, context, { uid } satisfies Partial<RequestContext>),
    });
  },
) as unknown as AnyFunctionMiddleware;

/**
 * The typed contract between authMiddleware and migrated handlers: extract the
 * verified UID from server-function context. Annotating the middleware as
 * AnyFunctionMiddleware (required by this TanStack version's .middleware()
 * constraint) drops per-handler context inference, so this helper carries the
 * invariant instead — one place, loud failure if wiring regresses.
 */
export function requireUid(context: unknown): string {
  if (
    typeof context === "object" &&
    context !== null &&
    typeof (context as { uid?: unknown }).uid === "string"
  ) {
    return (context as { uid: string }).uid;
  }
  throw new Error("auth middleware did not inject uid into context");
}
