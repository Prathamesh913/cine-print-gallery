import { tsToIso, type FirestoreApi } from "./firestore-shared";

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

export function plainCollection(id: string, data: Record<string, unknown>): UserCollection {
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

export function assertOwner(col: UserCollection, uid: string) {
  if (col.ownerId !== uid) throw new Error("Not authorized");
}

export async function listMyCollectionsCore(
  api: FirestoreApi,
  uid: string,
): Promise<UserCollection[]> {
  const docs = await api.queryCol("collections", "ownerId", "==", uid);
  const list = docs.map((d) => plainCollection(d.id, d.data()));
  list.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return list;
}

/**
 * Read a collection. `uid` must be the VERIFIED authenticated UID (or null for
 * public/unlisted previews). Private collections are only visible to their owner.
 */
export async function getCollectionCore(
  api: FirestoreApi,
  id: string,
  uid: string | null,
): Promise<UserCollection | null> {
  const snap = await api.getDoc(api.doc("collections", id));
  if (!snap.exists) return null;

  const col = plainCollection(id, snap.data());
  if (col.visibility === "private" && col.ownerId !== uid) {
    return null;
  }
  return col;
}

export interface CreateCollectionInput {
  uid: string;
  ownerName?: string | null;
  name: string;
  description?: string;
  visibility?: CollectionVisibility;
  posterId?: string | null;
}

export async function createCollectionCore(
  api: FirestoreApi,
  data: CreateCollectionInput,
): Promise<UserCollection> {
  const name = data.name.trim();
  if (!data.uid) throw new Error("Sign in required");
  if (!name) throw new Error("Name is required");

  const posterIds = data.posterId ? [data.posterId] : [];
  const payload: Record<string, unknown> = {
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

  const ref = await api.addDoc("collections", payload);
  return plainCollection(ref.id, {
    ...payload,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
}

export interface UpdateCollectionInput {
  uid: string;
  id: string;
  name?: string;
  description?: string;
  visibility?: CollectionVisibility;
  coverPosterId?: string | null;
  posterIds?: string[];
}

export async function updateCollectionCore(
  api: FirestoreApi,
  data: UpdateCollectionInput,
): Promise<UserCollection> {
  const ref = api.doc("collections", data.id);
  const snap = await api.getDoc(ref);
  if (!snap.exists) throw new Error("Collection not found");

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
}

export async function deleteCollectionCore(
  api: FirestoreApi,
  data: { uid: string; id: string },
): Promise<{ ok: true }> {
  const ref = api.doc("collections", data.id);
  const snap = await api.getDoc(ref);
  if (!snap.exists) return { ok: true };

  const current = plainCollection(data.id, snap.data());
  assertOwner(current, data.uid);
  await api.deleteDoc(ref);
  return { ok: true };
}

export async function addPosterToCollectionCore(
  api: FirestoreApi,
  data: { uid: string; collectionId: string; posterId: string },
): Promise<UserCollection> {
  const ref = api.doc("collections", data.collectionId);
  const snap = await api.getDoc(ref);
  if (!snap.exists) throw new Error("Collection not found");

  const current = plainCollection(data.collectionId, snap.data());
  assertOwner(current, data.uid);

  if (current.posterIds.includes(data.posterId)) {
    return current; // idempotent
  }

  // Atomic append: arrayUnion avoids losing posters when multiple adds race.
  const patch: Record<string, unknown> = {
    posterIds: api.arrayUnion(data.posterId),
    updatedAt: api.serverTimestamp(),
  };
  if (!current.coverPosterId) {
    patch.coverPosterId = data.posterId;
  }

  await api.updateDoc(ref, patch);
  return plainCollection(data.collectionId, {
    ...current,
    posterIds: [...current.posterIds, data.posterId],
    coverPosterId: current.coverPosterId ?? data.posterId,
    updatedAt: new Date().toISOString(),
  });
}

export async function removePosterFromCollectionCore(
  api: FirestoreApi,
  data: { uid: string; collectionId: string; posterId: string },
): Promise<UserCollection> {
  const ref = api.doc("collections", data.collectionId);
  const snap = await api.getDoc(ref);
  if (!snap.exists) throw new Error("Collection not found");

  const current = plainCollection(data.collectionId, snap.data());
  assertOwner(current, data.uid);

  if (!current.posterIds.includes(data.posterId)) {
    return current; // idempotent
  }

  const posterIds = current.posterIds.filter((id) => id !== data.posterId);
  // Atomic removal: arrayRemove cannot be clobbered by a concurrent full-array write.
  const patch: Record<string, unknown> = {
    posterIds: api.arrayRemove(data.posterId),
    updatedAt: api.serverTimestamp(),
  };
  if (current.coverPosterId === data.posterId) {
    patch.coverPosterId = posterIds[0] || null;
  }

  await api.updateDoc(ref, patch);
  return plainCollection(data.collectionId, {
    ...current,
    posterIds,
    coverPosterId:
      current.coverPosterId === data.posterId ? posterIds[0] || null : current.coverPosterId,
    updatedAt: new Date().toISOString(),
  });
}
