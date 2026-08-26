import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./firestore-db";
import {
  ensureUserProfileCore,
  getUserLikedIdsCore,
  toggleUserLikeCore,
  getUserProfileCore,
  updateBioCore,
  mergeLikedPostersCore,
  type UserProfile,
} from "./user-likes-core";
import { authMiddleware, requireUid } from "./auth-middleware";
import { withEnvelope, type SuccessBody, type ErrorResponseBody } from "../server/errors/error-response";

export type { UserProfile } from "./user-likes-core";

/**
 * Saved/Pins + Profile server-fn wiring (Phase 3 migration). Business logic
 * lives in user-likes-core.ts (pure, FakeDb-testable). Identity comes
 * exclusively from the verified token (authMiddleware → context.uid) — never a
 * client-supplied field.
 *
 * Client-bundle note: saved.ts / auth.tsx / user-profile.ts import this module
 * for the RPC stubs, so everything touching ../server/* must stay referenced
 * ONLY from .handler() closures (which the TanStack compiler extracts
 * server-side). Do not export module-level helpers from here — an export pins
 * its server imports into the client graph and trips import-protection.
 */

/** Returns the authenticated user's liked poster IDs. */
export const getUserLikedIds = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .middleware([authMiddleware])
  .handler(
    async ({ context }): Promise<SuccessBody<string[]> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("saved.listIds", uid, async () => {
        const api = await getDb();
        return getUserLikedIdsCore(api, uid);
      });
    },
  );

/** Adds/removes the authenticated user's like for one poster. */
export const toggleUserLike = createServerFn({ method: "POST" })
  .validator((data: { token: string; posterId: string }) => data)
  .middleware([authMiddleware])
  .handler(
    async ({
      data,
      context,
    }): Promise<SuccessBody<{ added: boolean }> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("saved.toggle", uid, async () => {
        const api = await getDb();
        return toggleUserLikeCore(api, uid, data.posterId);
      });
    },
  );

/** Merges anonymous local IDs into the authenticated user's likes. */
export const mergeLikedPosters = createServerFn({ method: "POST" })
  .validator((data: { token: string; posterIds: string[] }) => data)
  .middleware([authMiddleware])
  .handler(
    async ({ data, context }): Promise<SuccessBody<null> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("saved.mergeAnonymous", uid, async () => {
        const api = await getDb();
        await mergeLikedPostersCore(api, uid, data.posterIds);
        return null;
      });
    },
  );

/** Seeds the authenticated user's profile document from sign-in metadata. */
export const ensureUserProfile = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      email: string | null;
      displayName: string | null;
      photoURL: string | null;
      creationTime?: string | null;
    }) => data,
  )
  .middleware([authMiddleware])
  .handler(
    async ({ data, context }): Promise<SuccessBody<null> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("profile.ensure", uid, async () => {
        const api = await getDb();
        await ensureUserProfileCore(api, {
          uid,
          email: data.email,
          displayName: data.displayName,
          photoURL: data.photoURL,
          creationTime: data.creationTime,
        });
        return null;
      });
    },
  );

/** Returns the authenticated user's profile. */
export const getUserProfile = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .middleware([authMiddleware])
  .handler(
    async ({ context }): Promise<SuccessBody<UserProfile> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("profile.get", uid, async () => {
        const api = await getDb();
        return getUserProfileCore(api, uid);
      });
    },
  );

/** Updates the authenticated user's bio. */
export const updateBio = createServerFn({ method: "POST" })
  .validator((data: { token: string; bio: string }) => data)
  .middleware([authMiddleware])
  .handler(
    async ({ data, context }): Promise<SuccessBody<null> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("profile.updateBio", uid, async () => {
        const api = await getDb();
        await updateBioCore(api, uid, data.bio);
        return null;
      });
    },
  );
