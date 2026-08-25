import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./firestore-db";
import { getAdminAuth } from "../server/firebase/admin";
import { requireAuth } from "./server-auth";
import { getUserProfileCore, getUserLikedIdsCore, type UserProfile } from "./user-likes-core";
import {
  listMyCollectionsCore,
  deleteCollectionCore,
  type UserCollection,
} from "./collections-core";

export interface UserDataExport {
  profile: UserProfile;
  savedPosterIds: string[];
  collections: UserCollection[];
}

/**
 * Returns the authenticated user's profile, saved posters and collections in a
 * JSON-friendly shape. The UID is derived from the verified ID token.
 */
export const exportUserData = createServerFn({ method: "POST" })
  .validator((data: { token: string; uid: string }) => data)
  .handler(async ({ data }): Promise<UserDataExport> => {
    const uid = await requireAuth(data.token, data.uid);
    const api = await getDb();
    const [profile, savedPosterIds, collections] = await Promise.all([
      getUserProfileCore(api, uid),
      getUserLikedIdsCore(api, uid),
      listMyCollectionsCore(api, uid),
    ]);
    return { profile, savedPosterIds, collections };
  });

/**
 * Permanently deletes the authenticated account: the Firebase Auth user, all
 * user-owned collections, and the user document. Only the verified owner may
 * trigger this.
 */
export const deleteAccount = createServerFn({ method: "POST" })
  .validator((data: { token: string; uid: string }) => data)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const uid = await requireAuth(data.token, data.uid);

    // 1) Remove the Auth account first: if this fails, nothing else is deleted.
    const auth = await getAdminAuth();
    await auth.deleteUser(uid);

    // 2) Delete user-owned collections.
    const api = await getDb();
    const collections = await listMyCollectionsCore(api, uid);
    for (const col of collections) {
      await deleteCollectionCore(api, { uid, id: col.id });
    }

    // 3) Delete the user document.
    await api.deleteDoc(api.doc("users", uid));
    return { ok: true };
  });
