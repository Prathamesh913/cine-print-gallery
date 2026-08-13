import { describe, it, expect } from "vitest";
import { FakeDb } from "./fake-db";
import {
  ensureUserProfileCore,
  getUserLikedIdsCore,
  toggleUserLikeCore,
  getUserProfileCore,
  updateBioCore,
  mergeLikedPostersCore,
} from "../../src/lib/user-likes-core";

async function seedUser(db: FakeDb, uid: string, liked: string[]) {
  await ensureUserProfileCore(db, {
    uid,
    email: `${uid}@test.dev`,
    displayName: uid,
    photoURL: null,
  });
  for (const id of liked) {
    await toggleUserLikeCore(db, uid, id);
  }
}

describe("user saved-posters isolation", () => {
  it("getUserLikedIds only returns the requested user's own saved posters", async () => {
    const db = new FakeDb();
    await seedUser(db, "user-a", ["p-a1", "p-a2"]);
    await seedUser(db, "user-b", ["p-b1"]);

    expect(await getUserLikedIdsCore(db, "user-a")).toEqual(["p-a1", "p-a2"]);
    expect(await getUserLikedIdsCore(db, "user-b")).toEqual(["p-b1"]);
  });

  it("User A's toggle never writes to User B's document", async () => {
    const db = new FakeDb();
    await seedUser(db, "user-b", ["p-b1"]);

    await toggleUserLikeCore(db, "user-a", "p-x");

    expect(await getUserLikedIdsCore(db, "user-b")).toEqual(["p-b1"]);
    expect(await getUserLikedIdsCore(db, "user-a")).toEqual(["p-x"]);
  });

  it("unsaving removes only the target poster ID", async () => {
    const db = new FakeDb();
    await seedUser(db, "user-a", ["p-a1", "p-a2"]);
    const result = await toggleUserLikeCore(db, "user-a", "p-a1");
    expect(result.added).toBe(false);
    expect(await getUserLikedIdsCore(db, "user-a")).toEqual(["p-a2"]);
  });

  it("mergeLikedPosters merges only into the given user's doc and dedupes", async () => {
    const db = new FakeDb();
    await seedUser(db, "user-a", ["p-a1"]);
    await mergeLikedPostersCore(db, "user-a", ["p-local", "p-a1"]);

    expect(await getUserLikedIdsCore(db, "user-a")).toEqual(["p-a1", "p-local"]);
    expect(await getUserLikedIdsCore(db, "user-b")).toEqual([]);
  });
});

describe("profile isolation", () => {
  it("getUserProfile returns only the requested user's data", async () => {
    const db = new FakeDb();
    await seedUser(db, "user-a", []);
    await updateBioCore(db, "user-a", "hello from A");
    await updateBioCore(db, "user-b", "hello from B");

    expect((await getUserProfileCore(db, "user-a")).bio).toBe("hello from A");
    expect((await getUserProfileCore(db, "user-b")).bio).toBe("hello from B");
  });

  it("updateBio only mutates the requested user's document", async () => {
    const db = new FakeDb();
    await seedUser(db, "user-a", []);
    await seedUser(db, "user-b", []);
    await updateBioCore(db, "user-b", "B's bio");

    expect((await getUserProfileCore(db, "user-a")).bio).toBe("");
    expect((await getUserProfileCore(db, "user-b")).bio).toBe("B's bio");
  });
});
