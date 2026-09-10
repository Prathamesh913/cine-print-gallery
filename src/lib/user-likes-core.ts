import { tsToIso, type FirestoreApi } from "./firestore-shared";

export interface UserProfile {
  createdAt: string | null;
  bio: string;
}

interface ProfileSeed {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  creationTime?: string | null;
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

export async function ensureUserProfileCore(api: FirestoreApi, user: ProfileSeed): Promise<void> {
  const ref = userDoc(api, user.uid);
  const snap = await api.getDoc(ref);

  if (!snap.exists) {
    const createdAt = user.creationTime
      ? api.timestampFromDate(new Date(user.creationTime))
      : api.serverTimestamp();
    await api.setDoc(ref, {
      uid: user.uid,
      email: user.email || "",
      displayName: user.displayName || "",
      photoURL: user.photoURL || null,
      createdAt,
      likedPostIds: [],
    });
    return;
  }

  if (!snap.data().createdAt && user.creationTime) {
    await api.updateDoc(ref, {
      createdAt: api.timestampFromDate(new Date(user.creationTime)),
    });
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

export async function updateBioCore(api: FirestoreApi, uid: string, bio: string): Promise<void> {
  const ref = userDoc(api, uid);
  const snap = await api.getDoc(ref);

  if (!snap.exists) {
    await api.setDoc(ref, newUserDoc(api, uid, { bio }));
  } else {
    await api.updateDoc(ref, { bio });
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

  const existing: string[] = Array.isArray(snap.data().likedPostIds)
    ? (snap.data().likedPostIds as string[])
    : [];
  const merged = [...new Set([...existing, ...posterIds])];

  if (!snap.exists) {
    await api.setDoc(ref, newUserDoc(api, uid, { likedPostIds: merged }));
  } else {
    await api.updateDoc(ref, { likedPostIds: merged });
  }
}
