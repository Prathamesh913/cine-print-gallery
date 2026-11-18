import { tsToIso, type FirestoreApi } from "./firestore-shared";

export interface UserProfile {
  createdAt: string | null;
  bio: string;
}

const userDoc = (api: FirestoreApi, uid: string) => api.doc("users", uid);

function newUserDoc(
  api: FirestoreApi,
  uid: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    uid,
    email: "",
    displayName: "",
    photoURL: null,
    createdAt: api.serverTimestamp(),
    likedPostIds: [],
    ...extra,
  };
}

export async function ensureUserProfileCore(
  api: FirestoreApi,
  user: { uid: string },
): Promise<void> {
  const ref = userDoc(api, user.uid);
  const snap = await api.getDoc(ref);

  if (!snap.exists) {
    // Only server-derived state is stored. Sign-in metadata (email,
    // displayName, photoURL, account creation time) arrives from the client and
    // is therefore unverified; nothing reads it, so it is not persisted.
    // `createdAt` is the first time this server saw the account, which is the
    // only value the server can vouch for. `likedPostIds` is created lazily by
    // the like paths, so a concurrent first like is never clobbered here.
    await api.setDoc(ref, { uid: user.uid, createdAt: api.serverTimestamp() }, { merge: true });
  }
}

export async function getUserLikedIdsCore(api: FirestoreApi, uid: string): Promise<string[]> {
  const snap = await api.getDoc(userDoc(api, uid));
  if (!snap.exists) return [];
  const liked = snap.data().likedPostIds;
  return Array.isArray(liked) ? (liked as string[]) : [];
}

export async function toggleUserLikeCore(
  api: FirestoreApi,
  uid: string,
  posterId: string,
): Promise<{ added: boolean }> {
  const ref = userDoc(api, uid);
  const snap = await api.getDoc(ref);

  if (!snap.exists) {
    await api.setDoc(ref, newUserDoc(api, uid, { likedPostIds: [posterId] }));
    return { added: true };
  }

  const liked: string[] = Array.isArray(snap.data().likedPostIds)
    ? (snap.data().likedPostIds as string[])
    : [];
  const isLiked = liked.includes(posterId);

  if (isLiked) {
    await api.updateDoc(ref, { likedPostIds: api.arrayRemove(posterId) });
    return { added: false };
  }
  await api.updateDoc(ref, { likedPostIds: api.arrayUnion(posterId) });
  return { added: true };
}

export async function getUserProfileCore(api: FirestoreApi, uid: string): Promise<UserProfile> {
  const snap = await api.getDoc(userDoc(api, uid));
  if (!snap.exists) return { createdAt: null, bio: "" };
  const data = snap.data();
  return {
    createdAt: tsToIso(data.createdAt),
    bio: typeof data.bio === "string" ? data.bio : "",
  };
}

export const MAX_BIO_LENGTH = 280;

export async function updateBioCore(api: FirestoreApi, uid: string, bio: string): Promise<void> {
  const ref = userDoc(api, uid);
  const snap = await api.getDoc(ref);
  // The client caps the textarea, but that is not an enforcement boundary: a
  // direct RPC call can send any length. Bound it server-side before the write.
  const trimmed = bio.slice(0, MAX_BIO_LENGTH);

  if (!snap.exists) {
    await api.setDoc(ref, newUserDoc(api, uid, { bio: trimmed }));
  } else {
    await api.updateDoc(ref, { bio: trimmed });
  }
}

export async function mergeLikedPostersCore(
  api: FirestoreApi,
  uid: string,
  posterIds: string[],
): Promise<void> {
  if (posterIds.length === 0) return;

  const ref = userDoc(api, uid);
  const snap = await api.getDoc(ref);

  // `data()` is undefined for a missing document, so the existence check must
  // come first — a brand-new user could otherwise crash the merge.
  const existing: string[] =
    snap.exists && Array.isArray(snap.data().likedPostIds)
      ? (snap.data().likedPostIds as string[])
      : [];
  const merged = [...new Set([...existing, ...posterIds])];

  if (!snap.exists) {
    await api.setDoc(ref, newUserDoc(api, uid, { likedPostIds: merged }));
  } else {
    await api.updateDoc(ref, { likedPostIds: merged });
  }
}
