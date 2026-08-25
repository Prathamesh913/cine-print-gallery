import type { FirestoreApi } from "./firestore-db";
import { getUserProfileCore, getUserLikedIdsCore, type UserProfile } from "./user-likes-core";
import {
  listMyCollectionsCore,
  deleteCollectionCore,
  type UserCollection,
} from "./collections-core";

/**
 * Pure Account business logic over injected Firestore/Auth handles — no
 * server-only imports (mirrors user-likes-core / collections-core). This keeps
 * the module testable against FakeDb AND absent from TanStack Start's client
 * bundle graph; src/lib/account.ts owns the server-fn wiring.
 */

export interface UserDataExport {
  profile: UserProfile;
  savedPosterIds: string[];
  collections: UserCollection[];
}

/** Minimal structural slice of the Firebase Admin Auth handle we need. */
export interface AdminAuthApi {
  deleteUser(uid: string): Promise<void>;
}

/** Collects the authenticated user's profile, saved posters and collections. */
export async function buildAccountExport(
  api: FirestoreApi,
  uid: string,
): Promise<UserDataExport> {
  const [profile, savedPosterIds, collections] = await Promise.all([
    getUserProfileCore(api, uid),
    getUserLikedIdsCore(api, uid),
    listMyCollectionsCore(api, uid),
  ]);
  return { profile, savedPosterIds, collections };
}

/**
 * Permanently deletes the account: the Firebase Auth user first (so a partial
 * failure leaves everything recoverable), then user-owned collections, then
 * the user document.
 */
export async function performAccountDeletion(
  auth: AdminAuthApi,
  api: FirestoreApi,
  uid: string,
): Promise<void> {
  // 1) Remove the Auth account first: if this fails, nothing else is deleted.
  await auth.deleteUser(uid);

  // 2) Delete user-owned collections.
  const collections = await listMyCollectionsCore(api, uid);
  for (const col of collections) {
    await deleteCollectionCore(api, { uid, id: col.id });
  }

  // 3) Delete the user document.
  await api.deleteDoc(api.doc("users", uid));
}
