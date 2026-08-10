import { createServerFn } from "@tanstack/react-start";
import { getAdminDb } from "./firebase";

export type CollectionVisibility = "private" | "unlisted" | "public";

export interface UserCollection {
  id: string;
  ownerId: string;
  ownerName: string | null;
  name: string;
  description: string;
  coverPosterId: string | null;
  visibility: CollectionVisibility;
  posterIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
}

function tsToIso(ts: unknown): string | null {
  if (!ts) return null;
  const t = ts as { toDate?: () => Date; toMillis?: () => number };
  if (typeof t.toDate === "function") return t.toDate().toISOString();
  if (typeof t.toMillis === "function") return new Date(t.toMillis()).toISOString();
  if (typeof ts === "string") return ts;
  return null;
}

function plainCollection(id: string, data: Record<string, unknown>): UserCollection {
  const visibility = (data.visibility as CollectionVisibility) || "private";
  return {
    id,
    ownerId: String(data.ownerId || ""),
    ownerName: data.ownerName ? String(data.ownerName) : null,
    name: String(data.name || "Untitled"),
    description: String(data.description || ""),
    coverPosterId: data.coverPosterId ? String(data.coverPosterId) : null,
    visibility: ["private", "unlisted", "public"].includes(visibility) ? visibility : "private",
    posterIds: Array.isArray(data.posterIds) ? data.posterIds.map(String) : [],
    createdAt: tsToIso(data.createdAt),
    updatedAt: tsToIso(data.updatedAt),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FsRef = any;

async function getDb() {
  const { db, isAdmin } = await getAdminDb();
  if (!db) throw new Error("Firestore not initialized");

  if (isAdmin) {
    const { FieldValue } = await import("firebase-admin/firestore");
    return {
      isAdmin: true as const,
      db,
      col: (name: string) => db.collection(name),
      doc: (path: string, ...segments: string[]) => db.doc([path, ...segments].join("/")),
      getDoc: (ref: FsRef) => ref.get(),
      setDoc: (ref: FsRef, data: Record<string, unknown>, opts?: { merge?: boolean }) =>
        opts ? ref.set(data, opts) : ref.set(data),
      updateDoc: (ref: FsRef, data: Record<string, unknown>) => ref.update(data),
      deleteDoc: (ref: FsRef) => ref.delete(),
      serverTimestamp: () => FieldValue.serverTimestamp(),
      arrayUnion: (...args: unknown[]) => FieldValue.arrayUnion(...args),
      arrayRemove: (...args: unknown[]) => FieldValue.arrayRemove(...args),
    };
  }

  const mod = await import("firebase/firestore");
  return {
    isAdmin: false as const,
    db,
    col: (name: string) => mod.collection(db, name),
    doc: (path: string, ...segments: string[]) => mod.doc(db, path, ...segments),
    getDoc: (ref: FsRef) => mod.getDoc(ref),
    setDoc: (ref: FsRef, data: Record<string, unknown>, opts?: { merge?: boolean }) =>
      opts ? mod.setDoc(ref, data as FsRef, opts) : mod.setDoc(ref, data as FsRef),
    updateDoc: (ref: FsRef, data: Record<string, unknown>) => mod.updateDoc(ref, data as FsRef),
    deleteDoc: (ref: FsRef) => mod.deleteDoc(ref),
    serverTimestamp: () => mod.serverTimestamp(),
    arrayUnion: (...args: unknown[]) => mod.arrayUnion(...args),
    arrayRemove: (...args: unknown[]) => mod.arrayRemove(...args),
  };
}

function assertOwner(col: UserCollection, uid: string) {
  if (col.ownerId !== uid) throw new Error("Not authorized");
}

export const listMyCollections = createServerFn({ method: "POST" })
  .validator((uid: string) => uid)
  .handler(async ({ data: uid }): Promise<UserCollection[]> => {
    if (!uid) return [];
    const api = await getDb();

    let docs: { id: string; data: () => Record<string, unknown> }[] = [];
    if (api.isAdmin) {
      const snap = await api.col("collections").where("ownerId", "==", uid).get();
      docs = snap.docs;
    } else {
      const mod = await import("firebase/firestore");
      const q = mod.query(api.col("collections") as FsRef, mod.where("ownerId", "==", uid));
      const snap = await mod.getDocs(q);
      docs = snap.docs.map((d) => ({ id: d.id, data: () => d.data() as Record<string, unknown> }));
    }

    const list = docs.map((d) => plainCollection(d.id, d.data()));
    list.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return list;
  });

export const getCollection = createServerFn({ method: "POST" })
  .validator((data: { id: string; requesterUid?: string | null }) => data)
  .handler(async ({ data }): Promise<UserCollection | null> => {
    const api = await getDb();
    const ref = api.doc("collections", data.id);
    const snap = await api.getDoc(ref);
    const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
    if (!exists) return null;

    const col = plainCollection(data.id, snap.data());
    if (col.visibility === "private" && col.ownerId !== data.requesterUid) {
      return null;
    }
    return col;
  });

export const createCollection = createServerFn({ method: "POST" })
  .validator(
    (data: {
      uid: string;
      ownerName?: string | null;
      name: string;
      description?: string;
      visibility?: CollectionVisibility;
      posterId?: string | null;
    }) => data,
  )
  .handler(async ({ data }): Promise<UserCollection> => {
    const name = data.name.trim();
    if (!data.uid) throw new Error("Sign in required");
    if (!name) throw new Error("Name is required");

    const api = await getDb();
    const posterIds = data.posterId ? [data.posterId] : [];
    const payload = {
      ownerId: data.uid,
      ownerName: data.ownerName || null,
      name: name.slice(0, 80),
      description: (data.description || "").slice(0, 500),
      coverPosterId: data.posterId || null,
      visibility: data.visibility || "private",
      posterIds,
      createdAt: api.serverTimestamp(),
      updatedAt: api.serverTimestamp(),
    };

    if (api.isAdmin) {
      const ref = await api.col("collections").add(payload);
      return plainCollection(ref.id, {
        ...payload,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    const mod = await import("firebase/firestore");
    const ref = await mod.addDoc(api.col("collections") as FsRef, payload);
    return plainCollection(ref.id, {
      ...payload,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

export const updateCollection = createServerFn({ method: "POST" })
  .validator(
    (data: {
      uid: string;
      id: string;
      name?: string;
      description?: string;
      visibility?: CollectionVisibility;
      coverPosterId?: string | null;
      posterIds?: string[];
    }) => data,
  )
  .handler(async ({ data }): Promise<UserCollection> => {
    const api = await getDb();
    const ref = api.doc("collections", data.id);
    const snap = await api.getDoc(ref);
    const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
    if (!exists) throw new Error("Collection not found");

    const current = plainCollection(data.id, snap.data());
    assertOwner(current, data.uid);

    const patch: Record<string, unknown> = { updatedAt: api.serverTimestamp() };
    if (typeof data.name === "string") {
      const name = data.name.trim();
      if (!name) throw new Error("Name is required");
      patch.name = name.slice(0, 80);
    }
    if (typeof data.description === "string") {
      patch.description = data.description.slice(0, 500);
    }
    if (data.visibility) {
      if (!["private", "unlisted", "public"].includes(data.visibility)) {
        throw new Error("Invalid visibility");
      }
      patch.visibility = data.visibility;
    }
    if (data.coverPosterId !== undefined) {
      patch.coverPosterId = data.coverPosterId;
    }
    if (Array.isArray(data.posterIds)) {
      // preserve order, dedupe
      const seen = new Set<string>();
      const ordered: string[] = [];
      for (const id of data.posterIds) {
        if (!seen.has(id)) {
          seen.add(id);
          ordered.push(id);
        }
      }
      patch.posterIds = ordered;
      if (current.coverPosterId && !ordered.includes(current.coverPosterId)) {
        patch.coverPosterId = ordered[0] || null;
      }
    }

    await api.updateDoc(ref, patch);
    return plainCollection(data.id, { ...current, ...patch, updatedAt: new Date().toISOString() });
  });

export const deleteCollection = createServerFn({ method: "POST" })
  .validator((data: { uid: string; id: string }) => data)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const api = await getDb();
    const ref = api.doc("collections", data.id);
    const snap = await api.getDoc(ref);
    const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
    if (!exists) return { ok: true };

    const current = plainCollection(data.id, snap.data());
    assertOwner(current, data.uid);
    await api.deleteDoc(ref);
    return { ok: true };
  });

export const addPosterToCollection = createServerFn({ method: "POST" })
  .validator((data: { uid: string; collectionId: string; posterId: string }) => data)
  .handler(async ({ data }): Promise<UserCollection> => {
    const api = await getDb();
    const ref = api.doc("collections", data.collectionId);
    const snap = await api.getDoc(ref);
    const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
    if (!exists) throw new Error("Collection not found");

    const current = plainCollection(data.collectionId, snap.data());
    assertOwner(current, data.uid);

    if (current.posterIds.includes(data.posterId)) {
      return current; // idempotent
    }

    const posterIds = [...current.posterIds, data.posterId];
    const patch: Record<string, unknown> = {
      posterIds,
      updatedAt: api.serverTimestamp(),
    };
    if (!current.coverPosterId) {
      patch.coverPosterId = data.posterId;
    }

    await api.updateDoc(ref, patch);
    return plainCollection(data.collectionId, {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  });

export const removePosterFromCollection = createServerFn({ method: "POST" })
  .validator((data: { uid: string; collectionId: string; posterId: string }) => data)
  .handler(async ({ data }): Promise<UserCollection> => {
    const api = await getDb();
    const ref = api.doc("collections", data.collectionId);
    const snap = await api.getDoc(ref);
    const exists = typeof snap.exists === "function" ? snap.exists() : snap.exists;
    if (!exists) throw new Error("Collection not found");

    const current = plainCollection(data.collectionId, snap.data());
    assertOwner(current, data.uid);

    const posterIds = current.posterIds.filter((id) => id !== data.posterId);
    const patch: Record<string, unknown> = {
      posterIds,
      updatedAt: api.serverTimestamp(),
    };
    if (current.coverPosterId === data.posterId) {
      patch.coverPosterId = posterIds[0] || null;
    }

    await api.updateDoc(ref, patch);
    return plainCollection(data.collectionId, {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  });
