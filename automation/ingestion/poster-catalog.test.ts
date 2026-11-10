import { describe, expect, it, vi } from "vitest";
import { InMemoryPosterCatalog, PosterDocumentMissingError } from "./poster-catalog";
import { FirestorePosterCatalog } from "./firestore-adapters";
import type { FirestoreLike } from "./state";

function firestoreLike(options: { exists: boolean; updateFails?: boolean }) {
  const set = vi.fn(async () => undefined);
  const update = vi.fn(async () => {
    if (options.updateFails || !options.exists) {
      throw Object.assign(new Error("NOT_FOUND"), { code: "not-found" });
    }
    return undefined;
  });

  const db: FirestoreLike = {
    collection: () => ({
      doc: () => ({
        get: async () => ({
          exists: options.exists,
          data: () => (options.exists ? { status: "published" } : undefined),
        }),
        set,
        update,
      }),
      limit: () => ({ get: async () => ({ docs: [] }) }),
      where: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
    }),
  };

  return { db, set, update };
}

describe("PosterCatalog update semantics", () => {
  it("updates an existing in-memory document", async () => {
    const catalog = new InMemoryPosterCatalog([{ id: "artwork-1", data: { status: "draft" } }]);

    await catalog.update("artwork-1", { title: "Updated" });

    expect(await catalog.get("artwork-1")).toMatchObject({
      data: { status: "draft", title: "Updated" },
    });
  });

  it("fails instead of recreating a missing in-memory document", async () => {
    const catalog = new InMemoryPosterCatalog();

    await expect(catalog.update("artwork-1", { title: "Updated" })).rejects.toBeInstanceOf(
      PosterDocumentMissingError,
    );
    expect(await catalog.get("artwork-1")).toBeNull();
  });

  it("uses Firestore update, never set, for an existing document", async () => {
    const { db, set, update } = firestoreLike({ exists: true });
    const catalog = new FirestorePosterCatalog(db);

    await catalog.update("artwork-1", { title: "Updated" });

    expect(update).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
  });

  it("throws a typed error and does not recreate when Firestore update misses", async () => {
    const { db, set, update } = firestoreLike({ exists: false });
    const catalog = new FirestorePosterCatalog(db);

    await expect(catalog.update("artwork-1", { title: "Updated" })).rejects.toBeInstanceOf(
      PosterDocumentMissingError,
    );
    expect(update).toHaveBeenCalledTimes(1);
    expect(set).not.toHaveBeenCalled();
  });

  it("keeps creation as a separate explicit set path", async () => {
    const { db, set, update } = firestoreLike({ exists: false });
    const catalog = new FirestorePosterCatalog(db);

    await catalog.create("artwork-1", { title: "New" });

    expect(set).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
  });
});
