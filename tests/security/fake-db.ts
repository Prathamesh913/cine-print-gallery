import type { FirestoreApi } from "../../src/lib/firestore-db";

export class FakeAuthError extends Error {
  constructor(message = "token invalid") {
    super(message);
    this.name = "FakeAuthError";
  }
}

interface FakeRef {
  __path: string;
}

/**
 * Minimal in-memory Firestore for testing the pure core functions.
 */
export class FakeDb implements FirestoreApi {
  private data = new Map<string, Record<string, unknown>>();
  private ids = new Map<string, number>();

  constructor(seed?: Record<string, Record<string, unknown>>) {
    if (seed) {
      for (const [path, value] of Object.entries(seed)) {
        this.data.set(path, structuredClone(value));
      }
    }
  }

  doc(path: string, ...segments: string[]): FakeRef {
    return { __path: [path, ...segments].join("/") };
  }

  private nextId(colName: string): string {
    const n = (this.ids.get(colName) ?? 0) + 1;
    this.ids.set(colName, n);
    return `${colName.slice(0, 2)}-${n}`;
  }

  async getDoc(ref: FakeRef) {
    const entry = this.data.get(ref.__path);
    return { exists: !!entry, data: () => structuredClone(entry ?? {}) };
  }

  async setDoc(ref: FakeRef, data: Record<string, unknown>, opts?: { merge?: boolean }) {
    const existing = this.data.get(ref.__path) ?? {};
    this.data.set(ref.__path, opts?.merge ? { ...existing, ...data } : structuredClone(data));
  }

  async updateDoc(ref: FakeRef, data: Record<string, unknown>) {
    const existing = this.data.get(ref.__path) ?? {};
    const next: Record<string, unknown> = { ...existing };
    for (const [key, value] of Object.entries(data)) {
      const op = value && typeof value === "object" ? (value as { __op?: string }) : null;
      const current = Array.isArray(existing[key]) ? (existing[key] as unknown[]) : [];
      if (op?.__op === "arrayUnion") {
        const args = (value as { args: unknown[] }).args;
        next[key] = [...current, ...args.filter((a) => !current.includes(a))];
      } else if (op?.__op === "arrayRemove") {
        const args = (value as { args: unknown[] }).args;
        next[key] = current.filter((a) => !args.includes(a));
      } else {
        next[key] = value;
      }
    }
    this.data.set(ref.__path, next);
  }

  async deleteDoc(ref: FakeRef) {
    this.data.delete(ref.__path);
  }

  async addDoc(colName: string, data: Record<string, unknown>) {
    const id = this.nextId(colName);
    this.data.set(`${colName}/${id}`, structuredClone(data));
    return { id };
  }

  async queryCol(colName: string, field: string, op: string, value: unknown) {
    const docs = [...this.data.entries()]
      .filter(([path]) => path.startsWith(`${colName}/`))
      .map(([path, d]) => ({ id: path.split("/").pop()!, data: () => structuredClone(d) }))
      .filter((entry) => {
        if (op === "==") return entry.data()[field] === value;
        return true;
      });
    return docs;
  }

  serverTimestamp() {
    return new Date().toISOString();
  }

  arrayUnion(...args: unknown[]) {
    return { __op: "arrayUnion", args };
  }

  arrayRemove(...args: unknown[]) {
    return { __op: "arrayRemove", args };
  }

  timestampFromDate(date: Date) {
    return date.toISOString();
  }
}
