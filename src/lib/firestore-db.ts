import { getAdminDb } from "./firebase";
import { adminRequire } from "./firebase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FsRef = any;

export interface FirestoreApi {
  doc: (path: string, ...segments: string[]) => FsRef;
  getDoc: (ref: FsRef) => Promise<{ exists: boolean; data: () => Record<string, unknown> }>;
  setDoc: (ref: FsRef, data: Record<string, unknown>, opts?: { merge?: boolean }) => Promise<FsRef>;
  updateDoc: (ref: FsRef, data: Record<string, unknown>) => Promise<FsRef>;
  deleteDoc: (ref: FsRef) => Promise<FsRef>;
  addDoc: (colName: string, data: Record<string, unknown>) => Promise<{ id: string }>;
  queryCol: (
    colName: string,
    field: string,
    op: string,
    value: unknown,
  ) => Promise<Array<{ id: string; data: () => Record<string, unknown> }>>;
  serverTimestamp: () => unknown;
  arrayUnion: (...args: unknown[]) => unknown;
  arrayRemove: (...args: unknown[]) => unknown;
  timestampFromDate: (date: Date) => unknown;
}

export function tsToIso(ts: unknown): string | null {
  if (!ts) return null;
  const t = ts as { toDate?: () => Date; toMillis?: () => number };
  if (typeof t.toDate === "function") return t.toDate().toISOString();
  if (typeof t.toMillis === "function") return new Date(t.toMillis()).toISOString();
  if (typeof ts === "string") return ts;
  return null;
}

export async function getDb(): Promise<FirestoreApi> {
  const { db, isAdmin } = await getAdminDb();
  if (!db) throw new Error("Firestore not initialized");

  if (isAdmin) {
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

  const mod = await import("firebase/firestore");
  return {
    doc: (path: string, ...segments: string[]) => mod.doc(db, path, ...segments),
    getDoc: async (ref: FsRef) => {
      const snap = await mod.getDoc(ref);
      return { exists: snap.exists(), data: () => snap.data() as Record<string, unknown> };
    },
    setDoc: (ref: FsRef, data: Record<string, unknown>, opts?: { merge?: boolean }) =>
      opts ? mod.setDoc(ref, data as FsRef, opts) : mod.setDoc(ref, data as FsRef),
    updateDoc: (ref: FsRef, data: Record<string, unknown>) => mod.updateDoc(ref, data as FsRef),
    deleteDoc: (ref: FsRef) => mod.deleteDoc(ref),
    addDoc: async (colName: string, data: Record<string, unknown>) => {
      const ref = await mod.addDoc(mod.collection(db, colName), data as FsRef);
      return { id: ref.id };
    },
    queryCol: async (colName: string, field: string, op: string, value: unknown) => {
      const q = mod.query(
        mod.collection(db, colName) as FsRef,
        mod.where(field, op as never, value) as FsRef,
      );
      const snap = await mod.getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, data: () => d.data() as Record<string, unknown> }));
    },
    serverTimestamp: () => mod.serverTimestamp(),
    arrayUnion: (...args: unknown[]) => mod.arrayUnion(...args),
    arrayRemove: (...args: unknown[]) => mod.arrayRemove(...args),
    timestampFromDate: (date: Date) => mod.Timestamp.fromDate(date),
  };
}
