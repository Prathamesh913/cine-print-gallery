import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./firestore-db";
import { requireAuth, resolveCollectionViewer } from "./server-auth";
import {
  type CollectionVisibility,
  listMyCollectionsCore,
  getCollectionCore,
  createCollectionCore,
  updateCollectionCore,
  deleteCollectionCore,
  addPosterToCollectionCore,
  removePosterFromCollectionCore,
} from "./collections-core";

export type { CollectionVisibility, UserCollection } from "./collections-core";
export { assertOwner } from "./collections-core";

export const listMyCollections = createServerFn({ method: "POST" })
  .validator((data: { token: string; uid: string }) => data)
  .handler(async ({ data }) => {
    const uid = await requireAuth(data.token, data.uid);
    const api = await getDb();
    return listMyCollectionsCore(api, uid);
  });

/**
 * Public/unlisted collections remain readable without authentication.
 * A token (when provided) is always verified and its UID is used for the
 * private-collection ownership check.
 */
export const getCollection = createServerFn({ method: "POST" })
  .validator((data: { id: string; token?: string | null; requesterUid?: string | null }) => data)
  .handler(async ({ data }) => {
    const uid = await resolveCollectionViewer(data.token, data.requesterUid ?? null);
    const api = await getDb();
    return getCollectionCore(api, data.id, uid);
  });

export const createCollection = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      uid: string;
      ownerName?: string | null;
      name: string;
      description?: string;
      visibility?: CollectionVisibility;
      posterId?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const uid = await requireAuth(data.token, data.uid);
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

export const updateCollection = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      uid: string;
      id: string;
      name?: string;
      description?: string;
      visibility?: CollectionVisibility;
      coverPosterId?: string | null;
      posterIds?: string[];
    }) => data,
  )
  .handler(async ({ data }) => {
    const uid = await requireAuth(data.token, data.uid);
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

export const deleteCollection = createServerFn({ method: "POST" })
  .validator((data: { token: string; uid: string; id: string }) => data)
  .handler(async ({ data }) => {
    const uid = await requireAuth(data.token, data.uid);
    const api = await getDb();
    return deleteCollectionCore(api, { uid, id: data.id });
  });

export const addPosterToCollection = createServerFn({ method: "POST" })
  .validator((data: { token: string; uid: string; collectionId: string; posterId: string }) => data)
  .handler(async ({ data }) => {
    const uid = await requireAuth(data.token, data.uid);
    const api = await getDb();
    return addPosterToCollectionCore(api, {
      uid,
      collectionId: data.collectionId,
      posterId: data.posterId,
    });
  });

export const removePosterFromCollection = createServerFn({ method: "POST" })
  .validator((data: { token: string; uid: string; collectionId: string; posterId: string }) => data)
  .handler(async ({ data }) => {
    const uid = await requireAuth(data.token, data.uid);
    const api = await getDb();
    return removePosterFromCollectionCore(api, {
      uid,
      collectionId: data.collectionId,
      posterId: data.posterId,
    });
  });
