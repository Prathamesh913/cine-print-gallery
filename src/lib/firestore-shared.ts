/**
 * Client-safe Firestore contracts shared by pure *-core business logic and the
 * server-side adapter. MUST stay dependency-free: any import here can enter a
 * client-reachable module graph via collections.ts's assertOwner re-export.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FsRef = any;

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
