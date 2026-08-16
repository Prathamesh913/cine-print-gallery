import { describe, it, expect } from "vitest";
import { FakeDb } from "./fake-db";
import {
  createCollectionCore,
  getCollectionCore,
  listMyCollectionsCore,
  updateCollectionCore,
  deleteCollectionCore,
  addPosterToCollectionCore,
  removePosterFromCollectionCore,
  assertOwner,
  type UserCollection,
} from "../../src/lib/collections-core";

async function seedOwnerCollections(
  owner: string,
): Promise<{ db: FakeDb; ids: Record<string, string> }> {
  const db = new FakeDb();
  const ids: Record<string, string> = {};

  const priv = await createCollectionCore(db, {
    uid: owner,
    name: "Private list",
    visibility: "private",
  });
  ids.private = priv.id;
  const unlisted = await createCollectionCore(db, {
    uid: owner,
    name: "Unlisted list",
    visibility: "unlisted",
  });
  ids.unlisted = unlisted.id;
  const pub = await createCollectionCore(db, {
    uid: owner,
    name: "Public list",
    visibility: "public",
  });
  ids.public = pub.id;

  return { db, ids };
}

function asCollection(col: UserCollection | null): UserCollection {
  if (!col) throw new Error("expected collection");
  return col;
}

describe("collection ownership enforcement (mutations use the verified UID)", () => {
  it("rejects an update to another user's collection", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    await expect(
      updateCollectionCore(db, { uid: "user-b", id: ids.private, name: "Hacked" }),
    ).rejects.toThrow("Not authorized");
  });

  it("rejects a delete of another user's collection", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    await expect(deleteCollectionCore(db, { uid: "user-b", id: ids.private })).rejects.toThrow(
      "Not authorized",
    );
  });

  it("rejects adding a poster to another user's collection", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    await expect(
      addPosterToCollectionCore(db, {
        uid: "user-b",
        collectionId: ids.private,
        posterId: "p-1",
      }),
    ).rejects.toThrow("Not authorized");
  });

  it("rejects removing a poster from another user's collection", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    await expect(
      removePosterFromCollectionCore(db, {
        uid: "user-b",
        collectionId: ids.private,
        posterId: "p-1",
      }),
    ).rejects.toThrow("Not authorized");
  });

  it("allows the owner to rename their own collection", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    const updated = asCollection(
      await updateCollectionCore(db, { uid: "user-a", id: ids.private, name: "Renamed" }),
    );
    expect(updated.name).toBe("Renamed");
  });

  it("allows the owner to delete their own collection", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    await expect(deleteCollectionCore(db, { uid: "user-a", id: ids.private })).resolves.toEqual({
      ok: true,
    });
    await expect(getCollectionCore(db, ids.private, "user-a")).resolves.toBeNull();
  });

  it("owner can add/remove posters in their own collection", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    await addPosterToCollectionCore(db, {
      uid: "user-a",
      collectionId: ids.private,
      posterId: "p-1",
    });
    const withPoster = asCollection(await getCollectionCore(db, ids.private, "user-a"));
    expect(withPoster.posterIds).toContain("p-1");

    await removePosterFromCollectionCore(db, {
      uid: "user-a",
      collectionId: ids.private,
      posterId: "p-1",
    });
    const without = asCollection(await getCollectionCore(db, ids.private, "user-a"));
    expect(without.posterIds).not.toContain("p-1");
  });
});

describe("collection read visibility", () => {
  it("returns null for a private collection when the reader is not the owner", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    await expect(getCollectionCore(db, ids.private, "user-b")).resolves.toBeNull();
  });

  it("returns the private collection for its owner", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    const col = asCollection(await getCollectionCore(db, ids.private, "user-a"));
    expect(col.visibility).toBe("private");
  });

  it("returns null for a private collection for an unauthenticated reader", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    await expect(getCollectionCore(db, ids.private, null)).resolves.toBeNull();
  });

  it("returns a public collection to unauthenticated readers", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    const col = asCollection(await getCollectionCore(db, ids.public, null));
    expect(col.visibility).toBe("public");
  });

  it("returns a public collection to other authenticated users", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    const col = asCollection(await getCollectionCore(db, ids.public, "user-b"));
    expect(col.ownerId).toBe("user-a");
  });

  it("returns an unlisted collection to unauthenticated readers", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    const col = asCollection(await getCollectionCore(db, ids.unlisted, null));
    expect(col.visibility).toBe("unlisted");
  });
});

describe("listMyCollections", () => {
  it("only returns collections owned by the given UID", async () => {
    const { db, ids } = await seedOwnerCollections("user-a");
    await createCollectionCore(db, { uid: "user-b", name: "B's private", visibility: "private" });

    const mine = await listMyCollectionsCore(db, "user-a");
    const mineIds = mine.map((c) => c.id).sort();
    expect(mineIds).toEqual(Object.values(ids).sort());

    const b = await listMyCollectionsCore(db, "user-b");
    expect(b.length).toBe(1);
    expect(b[0].name).toBe("B's private");
  });
});

describe("assertOwner", () => {
  it("throws when UIDs differ", () => {
    const col: UserCollection = {
      id: "x",
      ownerId: "user-a",
      ownerName: null,
      name: "X",
      description: "",
      coverPosterId: null,
      visibility: "private",
      posterIds: [],
      createdAt: null,
      updatedAt: null,
    };
    expect(() => assertOwner(col, "user-b")).toThrow("Not authorized");
    expect(() => assertOwner(col, "user-a")).not.toThrow();
  });
});
