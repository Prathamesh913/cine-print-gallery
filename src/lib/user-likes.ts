import { createServerFn } from "@tanstack/react-start";
import { getDb } from "./firestore-db";
import { requireAuth } from "./server-auth";
import {
  ensureUserProfileCore,
  getUserLikedIdsCore,
  toggleUserLikeCore,
  getUserProfileCore,
  updateBioCore,
  mergeLikedPostersCore,
} from "./user-likes-core";

export type { UserProfile } from "./user-likes-core";

export const ensureUserProfile = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      uid: string;
      email: string | null;
      displayName: string | null;
      photoURL: string | null;
      creationTime?: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const uid = await requireAuth(data.token, data.uid);
    const api = await getDb();
    await ensureUserProfileCore(api, {
      uid,
      email: data.email,
      displayName: data.displayName,
      photoURL: data.photoURL,
      creationTime: data.creationTime,
    });
  });

export const getUserLikedIds = createServerFn({ method: "POST" })
  .validator((data: { token: string; uid: string }) => data)
  .handler(async ({ data }): Promise<string[]> => {
    const uid = await requireAuth(data.token, data.uid);
    const api = await getDb();
    return getUserLikedIdsCore(api, uid);
  });

export const toggleUserLike = createServerFn({ method: "POST" })
  .validator((data: { token: string; uid: string; posterId: string }) => data)
  .handler(async ({ data }): Promise<{ added: boolean }> => {
    const uid = await requireAuth(data.token, data.uid);
    const api = await getDb();
    return toggleUserLikeCore(api, uid, data.posterId);
  });

export const getUserProfile = createServerFn({ method: "POST" })
  .validator((data: { token: string; uid: string }) => data)
  .handler(async ({ data }) => {
    const uid = await requireAuth(data.token, data.uid);
    const api = await getDb();
    return getUserProfileCore(api, uid);
  });

export const updateBio = createServerFn({ method: "POST" })
  .validator((data: { token: string; uid: string; bio: string }) => data)
  .handler(async ({ data }) => {
    const uid = await requireAuth(data.token, data.uid);
    const api = await getDb();
    await updateBioCore(api, uid, data.bio);
  });

export const mergeLikedPosters = createServerFn({ method: "POST" })
  .validator((data: { token: string; uid: string; posterIds: string[] }) => data)
  .handler(async ({ data }) => {
    const uid = await requireAuth(data.token, data.uid);
    const api = await getDb();
    await mergeLikedPostersCore(api, uid, data.posterIds);
  });
