import { createServerFn } from "@tanstack/react-start";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "./firebase";

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
    if (!db) throw new Error("Firestore not initialized");

    const userRef = doc(db, "users", data.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
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
    if (!db) throw new Error("Firestore not initialized");

    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) return [];
    return userSnap.data().likedPostIds || [];
  });

export const toggleUserLike = createServerFn({ method: "POST" })
  .validator((data: { uid: string; posterId: string }) => data)
  .handler(async ({ data }): Promise<{ added: boolean }> => {
    if (!db) throw new Error("Firestore not initialized");

    const userRef = doc(db, "users", data.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
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

export const mergeLikedPosters = createServerFn({ method: "POST" })
  .validator((data: { uid: string; posterIds: string[] }) => data)
  .handler(async ({ data }) => {
    if (!db) throw new Error("Firestore not initialized");
    if (data.posterIds.length === 0) return;

    const userRef = doc(db, "users", data.uid);
    const userSnap = await getDoc(userRef);

    const existing = userSnap.exists() ? userSnap.data().likedPostIds || [] : [];
    const merged = [...new Set([...existing, ...data.posterIds])];

    if (!userSnap.exists()) {
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
