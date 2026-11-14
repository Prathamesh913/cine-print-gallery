import { describe, expect, it } from "vitest";
import type { FirestoreLike } from "../ingestion/state";
import { FirestoreRepairStore } from "./firestore";
import type { R2ImageReference } from "../../src/lib/r2-image-reference";

const REFERENCE: R2ImageReference = {
  sourceSha256: "a".repeat(64),
  original: {
    key: `cineprint/versions/original/the-substance-2/${"a".repeat(64)}.jpg`,
    url: `https://images.cineprint.click/cineprint/versions/original/the-substance-2/${"a".repeat(64)}.jpg`,
    sha256: "a".repeat(64),
    sizeBytes: 100,
    contentType: "image/jpeg",
  },
  optimized: {
    key: `cineprint/versions/optimized/the-substance-2/${"a".repeat(64)}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
    url: `https://images.cineprint.click/cineprint/versions/optimized/the-substance-2/${"a".repeat(64)}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
    sha256: "b".repeat(64),
    sizeBytes: 50,
    contentType: "image/webp",
  },
  verifiedAt: "2026-11-14T00:00:00.000Z",
};

function fakeDb(options: { exists?: boolean } = {}) {
  const updates: Record<string, unknown>[] = [];
  const documents = new Map<string, Record<string, unknown>>([
    ["the-substance-2", { status: "published", title: "The Substance" }],
  ]);
  const db: FirestoreLike = {
    collection: () => ({
      doc: (id: string) => ({
        get: async () => ({
          exists: options.exists ?? documents.has(id),
          data: () => documents.get(id),
        }),
        set: async () => {
          throw new Error("set must not be called");
        },
        update: async (data: Record<string, unknown>) => {
          updates.push(data);
          documents.set(id, { ...(documents.get(id) ?? {}), ...data });
        },
      }),
      limit: () => ({ get: async () => ({ docs: [] }) }),
    }),
  };
  return { db, updates, documents };
}

describe("Firestore repair store", () => {
  it("updates only r2Image and never uses create/set", async () => {
    const { db, updates, documents } = fakeDb();
    const store = new FirestoreRepairStore(db);

    await store.updateR2Image("the-substance-2", REFERENCE);

    expect(updates).toEqual([{ r2Image: REFERENCE }]);
    expect(documents.get("the-substance-2")).toMatchObject({
      status: "published",
      title: "The Substance",
      r2Image: REFERENCE,
    });
    expect(documents.get("the-substance-2")).not.toHaveProperty("updatedAt");
    expect(documents.get("the-substance-2")).not.toHaveProperty("syncedAt");
  });

  it("returns null for a missing document and does not create one", async () => {
    const { db, documents } = fakeDb({ exists: false });
    const store = new FirestoreRepairStore(db);

    await expect(store.getPoster("missing")).resolves.toBeNull();
    expect(documents.has("missing")).toBe(false);
  });
});
