import { createServerFn } from "@tanstack/react-start";
import { getAdminDb } from "./firebase";

async function getDb() {
  const { db, isAdmin } = await getAdminDb();
  if (!db) throw new Error("Firestore not initialized");

  if (isAdmin) {
    const { FieldValue } = await import("firebase-admin/firestore");
    return {
      docRef: (path: string, ...segments: string[]) => db.doc([path, ...segments].join("/")),
      getDoc: (ref: any) => ref.get(),
      setDoc: (ref: any, data: any) => ref.set(data),
      updateDoc: (ref: any, data: any) => ref.update(data),
      arrayUnion: (...args: any[]) => FieldValue.arrayUnion(...args),
      arrayRemove: (...args: any[]) => FieldValue.arrayRemove(...args),
      serverTimestamp: () => FieldValue.serverTimestamp(),
    };
  }

  const mod = await import("firebase/firestore");
  return {
    docRef: (path: string, ...segments: string[]) => mod.doc(db, path, ...segments),
    getDoc: (ref: any) => mod.getDoc(ref),
    setDoc: (ref: any, data: any) => mod.setDoc(ref, data),
    updateDoc: (ref: any, data: any) => mod.updateDoc(ref, data),
    arrayUnion: (...args: any[]) => mod.arrayUnion(...args),
    arrayRemove: (...args: any[]) => mod.arrayRemove(...args),
    serverTimestamp: () => mod.serverTimestamp(),
  };
}

export const ensureUserProfile = createServerFn({ method: "POST" })
  .validator(
    (data: {
      uid: string;
      email: string | null;
      displayName: string | null;
      photoURL: string | null;
    }) => data,
  )
  .handler(async ({ data }) => {
    const { docRef, getDoc, setDoc, serverTimestamp } = await getDb();

    const userRef = docRef("users", data.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists) {
      await setDoc(userRef, {
        uid: data.uid,
        email: data.email || "",
        displayName: data.displayName || "",
        photoURL: data.photoURL || null,
        createdAt: serverTimestamp(),
        likedPostIds: [],
      });
    }
  });

export const getUserLikedIds = createServerFn({ method: "POST" })
  .validator((uid: string) => uid)
  .handler(async ({ data: uid }): Promise<string[]> => {
    const { docRef, getDoc } = await getDb();

    const userRef = docRef("users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists) return [];
    return userSnap.data().likedPostIds || [];
  });

export const toggleUserLike = createServerFn({ method: "POST" })
  .validator((data: { uid: string; posterId: string }) => data)
  .handler(async ({ data }): Promise<{ added: boolean }> => {
    const { docRef, getDoc, setDoc, updateDoc, arrayUnion, arrayRemove, serverTimestamp } =
      await getDb();

    const userRef = docRef("users", data.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists) {
      await setDoc(userRef, {
        uid: data.uid,
        email: "",
        displayName: "",
        photoURL: null,
        createdAt: serverTimestamp(),
        likedPostIds: [data.posterId],
      });
      return { added: true };
    }

    const userData = userSnap.data();
    const liked = userData.likedPostIds || [];
    const isLiked = liked.includes(data.posterId);

    if (isLiked) {
      await updateDoc(userRef, { likedPostIds: arrayRemove(data.posterId) });
      return { added: false };
    } else {
      await updateDoc(userRef, { likedPostIds: arrayUnion(data.posterId) });
      return { added: true };
    }
  });

export interface UserProfile {
  createdAt: string | null;
  bio: string;
}

export const getUserProfile = createServerFn({ method: "POST" })
  .validator((uid: string) => uid)
  .handler(async ({ data: uid }): Promise<UserProfile> => {
    const { docRef, getDoc } = await getDb();

    const userRef = docRef("users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists) return { createdAt: null, bio: "" };

    const data = userSnap.data();
    const ts = data.createdAt;
    return {
      createdAt: ts?.toDate?.()?.toISOString?.() ?? ts?.toMillis?.()?.toString?.() ?? null,
      bio: data.bio || "",
    };
  });

export const updateBio = createServerFn({ method: "POST" })
  .validator((data: { uid: string; bio: string }) => data)
  .handler(async ({ data }) => {
    const { docRef, getDoc, setDoc, updateDoc, serverTimestamp } = await getDb();

    const userRef = docRef("users", data.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists) {
      await setDoc(userRef, {
        uid: data.uid,
        email: "",
        displayName: "",
        photoURL: null,
        createdAt: serverTimestamp(),
        likedPostIds: [],
        bio: data.bio,
      });
    } else {
      await updateDoc(userRef, { bio: data.bio });
    }
  });

export const mergeLikedPosters = createServerFn({ method: "POST" })
  .validator((data: { uid: string; posterIds: string[] }) => data)
  .handler(async ({ data }) => {
    const { docRef, getDoc, setDoc, updateDoc, arrayUnion, serverTimestamp } = await getDb();
    if (data.posterIds.length === 0) return;

    const userRef = docRef("users", data.uid);
    const userSnap = await getDoc(userRef);

    const existing = userSnap.exists ? userSnap.data().likedPostIds || [] : [];
    const merged = [...new Set([...existing, ...data.posterIds])];

    if (!userSnap.exists) {
      await setDoc(userRef, {
        uid: data.uid,
        email: "",
        displayName: "",
        photoURL: null,
        createdAt: serverTimestamp(),
        likedPostIds: merged,
      });
    } else {
      await updateDoc(userRef, { likedPostIds: merged });
    }
  });
