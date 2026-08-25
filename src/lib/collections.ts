import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./firestore-db";
import { optionalViewerUid } from "./server-auth";
import {
  type CollectionVisibility,
  type UserCollection,
  listMyCollectionsCore,
  getCollectionCore,
  createCollectionCore,
  updateCollectionCore,
  deleteCollectionCore,
  addPosterToCollectionCore,
  removePosterFromCollectionCore,
} from "./collections-core";
import { authMiddleware, requireUid } from "./auth-middleware";
import { withEnvelope, type SuccessBody, type ErrorResponseBody } from "../server/errors/error-response";

export type { CollectionVisibility, UserCollection } from "./collections-core";
export { assertOwner } from "./collections-core";

/**
 * Collections server-fn wiring (Phase 4 migration). Business logic lives in
 * collections-core.ts (pure, FakeDb-testable) and is UNCHANGED. Identity comes
 * exclusively from the verified token (authMiddleware → context.uid) — never a
 * client-supplied field. Collection id / collectionId / posterId are RESOURCE
 * identity and legitimately remain in payloads; they never decide WHO acts.
 *
 * getCollection is intentionally PUBLIC (no authMiddleware): route loaders
 * fetch public/unlisted previews without a token for OG tags. Its optional
 * viewer resolution lives in server-auth.optionalViewerUid.
 *
 * Client-bundle note: client-reachable modules import this file for the RPC
 * stubs, so everything touching ../server/* must stay referenced ONLY from
 * .handler() closures. Do not export module-level helpers from here — an
 * export pins its server imports into the client graph and trips
 * import-protection.
 */

/** Returns the authenticated user's collections, newest-updated first. */
export const listMyCollections = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .middleware([authMiddleware])
  .handler(
    async ({ context }): Promise<SuccessBody<UserCollection[]> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("collections.listMine", uid, async () => {
        const api = await getDb();
        return listMyCollectionsCore(api, uid);
      });
    },
  );

/**
 * Read one collection. Public/unlisted collections are readable WITHOUT a
 * token (OG previews); private ones resolve to null unless the VERIFIED
 * viewer is the owner. A provided token is always verified — its UID decides
 * ownership, never a client-declared requesterUid.
 */
export const getCollection = createServerFn({ method: "POST" })
  .validator((data: { id: string; token?: string | null }) => data)
  .handler(
    async ({ data }): Promise<SuccessBody<UserCollection | null> | ErrorResponseBody> => {
      // Resolved OUTSIDE withEnvelope so config failures (FirebaseAdminError)
      // propagate 5xx-class exactly like authMiddleware, while a bad/expired
      // token rejects with UNAUTHORIZED — matching the pre-envelope behavior.
      const viewerUid = await optionalViewerUid(data.token ?? null);
      const api = await getDb();
      return withEnvelope("collections.get", viewerUid ?? undefined, () =>
        getCollectionCore(api, data.id, viewerUid),
      );
    },
  );

/** Creates a collection owned by the authenticated user. */
export const createCollection = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      ownerName?: string | null;
      name: string;
      description?: string;
      visibility?: CollectionVisibility;
      posterId?: string | null;
    }) => data,
  )
  .middleware([authMiddleware])
  .handler(
    async ({ data, context }): Promise<SuccessBody<UserCollection> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("collections.create", uid, async () => {
        const api = await getDb();
        return createCollectionCore(api, {
          uid,
          ownerName: data.ownerName,
          name: data.name,
          description: data.description,
          visibility: data.visibility,
          posterId: data.posterId,
        });
      });
    },
  );

/**
 * Updates a collection's metadata/posters. `id` is resource identity;
 * authorization (owner-only) is enforced against the verified UID.
 */
export const updateCollection = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      id: string;
      name?: string;
      description?: string;
      visibility?: CollectionVisibility;
      coverPosterId?: string | null;
      posterIds?: string[];
    }) => data,
  )
  .middleware([authMiddleware])
  .handler(
    async ({ data, context }): Promise<SuccessBody<UserCollection> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("collections.update", uid, async () => {
        const api = await getDb();
        return updateCollectionCore(api, {
          uid,
          id: data.id,
          name: data.name,
          description: data.description,
          visibility: data.visibility,
          coverPosterId: data.coverPosterId,
          posterIds: data.posterIds,
        });
      });
    },
  );

/** Deletes a collection. Owner-only via the verified UID. */
export const deleteCollection = createServerFn({ method: "POST" })
  .validator((data: { token: string; id: string }) => data)
  .middleware([authMiddleware])
  .handler(
    async ({ data, context }): Promise<SuccessBody<{ ok: true }> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("collections.delete", uid, async () => {
        const api = await getDb();
        return deleteCollectionCore(api, { uid, id: data.id });
      });
    },
  );

/** Adds a poster to a collection. Owner-only via the verified UID. */
export const addPosterToCollection = createServerFn({ method: "POST" })
  .validator((data: { token: string; collectionId: string; posterId: string }) => data)
  .middleware([authMiddleware])
  .handler(
    async ({ data, context }): Promise<SuccessBody<UserCollection> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("collections.addPoster", uid, async () => {
        const api = await getDb();
        return addPosterToCollectionCore(api, {
          uid,
          collectionId: data.collectionId,
          posterId: data.posterId,
        });
      });
    },
  );

/** Removes a poster from a collection. Owner-only via the verified UID. */
export const removePosterFromCollection = createServerFn({ method: "POST" })
  .validator((data: { token: string; collectionId: string; posterId: string }) => data)
  .middleware([authMiddleware])
  .handler(
    async ({ data, context }): Promise<SuccessBody<UserCollection> | ErrorResponseBody> => {
      const uid = requireUid(context);
      return withEnvelope("collections.removePoster", uid, async () => {
        const api = await getDb();
        return removePosterFromCollectionCore(api, {
          uid,
          collectionId: data.collectionId,
          posterId: data.posterId,
        });
      });
    },
  );
