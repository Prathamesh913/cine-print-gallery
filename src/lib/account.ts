import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./firestore-db";
import { getAdminAuth } from "../server/firebase/admin";
import { buildAccountExport, performAccountDeletion, type UserDataExport } from "./account-core";
import { authMiddleware, requireUid } from "./auth-middleware";
import { withEnvelope, type SuccessBody, type ErrorResponseBody } from "../server/errors/error-response";

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

// Shared envelope runner lives in src/server/errors/error-response.ts
// (withEnvelope) — lifted there once Account stopped being its only consumer.

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
