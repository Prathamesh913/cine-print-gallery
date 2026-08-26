/**
 * SERVER-ONLY Firestore adapter. Acquires Firebase Admin and returns the
 * injected FirestoreApi. Import this ONLY from createServerFn modules
 * (collections.ts / user-likes.ts / account.ts) whose handler bodies are
 * stripped from client bundles — never from pure *-core logic or anything
 * client-reachable at module level. Pure contracts live in ./firestore-shared.
 */
import { getAdminDb, adminRequire } from "../server/firebase/admin";
import type { FirestoreApi, FsRef } from "./firestore-shared";

export async function getDb(): Promise<FirestoreApi> {
  const { db, isAdmin } = await getAdminDb();
  if (!db) throw new Error("Firestore not initialized");
  // Defense-in-depth: authenticated server-side access must never run through
  // an unauthenticated client SDK (it would fail Firestore rules with an
  // opaque permission-denied). getAdminDb() no longer produces this state; if
  // a future refactor reintroduces it, fail loudly here.
  if (!isAdmin) {
    throw new Error(
      "Firestore Admin unavailable — refusing to fall back to unauthenticated client SDK",
    );
  }

  const { FieldValue, Timestamp } = await adminRequire<{
    FieldValue: {
      serverTimestamp: () => unknown;
      arrayUnion: (...args: unknown[]) => unknown;
      arrayRemove: (...args: unknown[]) => unknown;
    };
    Timestamp: { fromDate: (date: Date) => unknown };
  }>("firebase-admin/firestore");
  return {
    doc: (path: string, ...segments: string[]) => db.doc([path, ...segments].join("/")),
    getDoc: async (ref: FsRef) => {
      const snap = await ref.get();
      return { exists: snap.exists, data: () => snap.data() };
    },
    setDoc: (ref: FsRef, data: Record<string, unknown>, opts?: { merge?: boolean }) =>
      opts ? ref.set(data, opts) : ref.set(data),
    updateDoc: (ref: FsRef, data: Record<string, unknown>) => ref.update(data),
    deleteDoc: (ref: FsRef) => ref.delete(),
    addDoc: async (colName: string, data: Record<string, unknown>) => {
      const ref = await db.collection(colName).add(data);
      return { id: ref.id };
    },
    queryCol: async (colName: string, field: string, op: string, value: unknown) => {
      const snap = await db.collection(colName).where(field, op, value).get();
      return snap.docs.map((d: { id: string; data: () => Record<string, unknown> }) => ({
        id: d.id,
        data: () => d.data(),
      }));
    },
    serverTimestamp: () => FieldValue.serverTimestamp(),
    arrayUnion: (...args: unknown[]) => FieldValue.arrayUnion(...args),
    arrayRemove: (...args: unknown[]) => FieldValue.arrayRemove(...args),
    timestampFromDate: (date: Date) => Timestamp.fromDate(date),
  };
}
