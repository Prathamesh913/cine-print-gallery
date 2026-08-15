import { describe, it, expect } from "vitest";
import { FakeDb } from "./security/fake-db";
import {
  createCollectionCore,
  addPosterToCollectionCore,
  removePosterFromCollectionCore,
  getCollectionCore,
} from "../src/lib/collections-core";

describe("collection poster mutations are atomic under concurrency", () => {
  it("concurrent adds never lose a poster", async () => {
    const db = new FakeDb();
    const col = await createCollectionCore(db, { uid: "u", name: "C", visibility: "private" });

    await Promise.all([
      addPosterToCollectionCore(db, { uid: "u", collectionId: col.id, posterId: "p1" }),
      addPosterToCollectionCore(db, { uid: "u", collectionId: col.id, posterId: "p2" }),
    ]);

    const after = await getCollectionCore(db, col.id, "u");
    expect(after?.posterIds.slice().sort()).toEqual(["p1", "p2"]);
  });

  it("a concurrent add cannot resurrect a poster removed at the same time", async () => {
    const db = new FakeDb();
    let col = await createCollectionCore(db, { uid: "u", name: "C", visibility: "private" });
    col = await addPosterToCollectionCore(db, { uid: "u", collectionId: col.id, posterId: "p1" });

    await Promise.all([
      removePosterFromCollectionCore(db, { uid: "u", collectionId: col.id, posterId: "p1" }),
      addPosterToCollectionCore(db, { uid: "u", collectionId: col.id, posterId: "p2" }),
    ]);

    const after = await getCollectionCore(db, col.id, "u");
    expect(after?.posterIds).toEqual(["p2"]);
  });

  it("preserves poster order for sequential adds", async () => {
    const db = new FakeDb();
    const col = await createCollectionCore(db, { uid: "u", name: "C" });

    await addPosterToCollectionCore(db, { uid: "u", collectionId: col.id, posterId: "p1" });
    await addPosterToCollectionCore(db, { uid: "u", collectionId: col.id, posterId: "p2" });
    await addPosterToCollectionCore(db, { uid: "u", collectionId: col.id, posterId: "p3" });

    const after = await getCollectionCore(db, col.id, "u");
    expect(after?.posterIds).toEqual(["p1", "p2", "p3"]);
  });
});
