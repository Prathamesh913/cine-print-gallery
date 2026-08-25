import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./firestore-db";
import { getAdminAuth } from "../server/firebase/admin";
import { buildAccountExport, performAccountDeletion, type UserDataExport } from "./account-core";
import { authMiddleware, requireUid } from "./auth-middleware";
import { toPublicError, type SuccessBody, type ErrorResponseBody } from "../server/errors/error-response";
import { createLogger } from "../server/request/logging";
import { createRequestId } from "../server/request/context";

export type { UserDataExport } from "./account-core";

/**
 * Account feature: server-fn wiring. Business logic lives in account-core.ts
 * (pure, FakeDb-testable). Identity comes exclusively from the verified token
 * (authMiddleware → context.uid) — never a client-supplied field.
 *
 * Client-bundle note: profile.tsx imports this module for the RPC stubs, so
 * everything touching ../server/* must stay referenced ONLY from .handler()
 * closures (which the TanStack compiler extracts server-side). Do not export
 * module-level helpers from here — an export pins its server imports into the
 * client graph and trips import-protection.
 */

/**
 * Feature envelope runner: success/failure bodies with one structured log line
 * per operation. Promote to src/server when the next feature adopts the same
 * convention (kept here until a second consumer proves the shape).
 */
// ponytail: duplicate this helper per feature ONLY until two exist; then lift
// to src/server/errors/error-response.ts unchanged.
async function withEnvelope<T>(
  operation: string,
  uid: string | undefined,
  fn: () => Promise<T>,
): Promise<SuccessBody<T> | ErrorResponseBody> {
  const logger = createLogger({
    requestId: createRequestId(),
    operation,
    ...(uid !== undefined ? { uid } : {}),
  });
  const start = Date.now();
  try {
    const data = await fn();
    logger.info("request completed", { durationMs: Date.now() - start });
    return { ok: true, data };
  } catch (err) {
    logger.error("request failed", { durationMs: Date.now() - start });
    // Unknown errors collapse to a safe INTERNAL body; causes stay server-side.
    return toPublicError(err);
  }
}

/**
 * Returns the authenticated user's data export.
 */
export const exportUserData = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .middleware([authMiddleware])
  .handler(
    async ({ context }): Promise<SuccessBody<UserDataExport> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("account.export", uid, async () => {
        const api = await getDb();
        return buildAccountExport(api, uid);
      });
    },
  );

/**
 * Permanently deletes the authenticated account. Only the verified owner can
 * trigger it — there is no client-declared identity in this path at all.
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .middleware([authMiddleware])
  .handler(
    async ({ context }): Promise<SuccessBody<{ deleted: true }> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("account.delete", uid, async () => {
        // Auth deletion first inside performAccountDeletion; both handles are
        // needed so fetch them together.
        const [auth, api] = await Promise.all([getAdminAuth(), getDb()]);
        await performAccountDeletion(auth, api, uid);
        return { deleted: true } as const;
      });
    },
  );
