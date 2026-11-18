import { describe, expect, it } from "vitest";
import { FakeDb } from "./fake-db";
import {
  MAX_BIO_LENGTH,
  ensureUserProfileCore,
  getUserProfileCore,
  mergeLikedPostersCore,
  updateBioCore,
} from "../../src/lib/user-likes-core";

/**
 * Regression tripwires for the profile-write hardening from security audit
 * run 1.
 *
 * 1. updateBioCore had no server-side length cap. The textarea maxLength is not
 *    an enforcement boundary for a direct RPC call.
 *
 * 2. mergeLikedPostersCore read `snap.data()` before checking `snap.exists`.
 *    Real Firestore returns undefined for a missing document, so the first
 *    merge for a brand-new user threw. The FakeDb double used to hide this by
 *    returning {} for a missing doc; it now mirrors the SDK, which is what makes
 *    this case meaningful.
 *
 * 3. ensureUserProfileCore persisted client-supplied email, displayName,
 *    photoURL and account creation time. Those are unverified claims from the
 *    sign-in payload; only the verified uid and a server timestamp are stored.
 */

describe("updateBioCore", () => {
  it("caps bio length server-side", async () => {
    const db = new FakeDb({ "users/u1": { uid: "u1", likedPostIds: [] } });

    await updateBioCore(db, "u1", "x".repeat(MAX_BIO_LENGTH * 4));

    const profile = await getUserProfileCore(db, "u1");
    expect(profile.bio).toHaveLength(MAX_BIO_LENGTH);
  });

  it("keeps a normal bio intact", async () => {
    const db = new FakeDb({ "users/u1": { uid: "u1", likedPostIds: [] } });

    await updateBioCore(db, "u1", "Collector of 1970s Polish posters.");

    const profile = await getUserProfileCore(db, "u1");
    expect(profile.bio).toBe("Collector of 1970s Polish posters.");
  });
});

describe("mergeLikedPostersCore", () => {
  it("merges likes for a user whose document does not exist yet", async () => {
    const db = new FakeDb();

    await expect(mergeLikedPostersCore(db, "u2", ["p1", "p2"])).resolves.toBeUndefined();

    const created = await db.getDoc(db.doc("users", "u2"));
    expect(created.exists).toBe(true);
    expect(created.data().likedPostIds).toEqual(["p1", "p2"]);
  });

  it("deduplicates against ids already stored", async () => {
    const db = new FakeDb({ "users/u3": { uid: "u3", likedPostIds: ["p1"] } });

    await mergeLikedPostersCore(db, "u3", ["p1", "p2"]);

    const doc = await db.getDoc(db.doc("users", "u3"));
    expect(doc.data().likedPostIds).toEqual(["p1", "p2"]);
  });
});

describe("ensureUserProfileCore", () => {
  it("stores only server-vouched fields when seeding a profile", async () => {
    const db = new FakeDb();

    await ensureUserProfileCore(db, { uid: "u4" });

    const doc = (await db.getDoc(db.doc("users", "u4"))).data();
    expect(doc.uid).toBe("u4");
    expect(doc.createdAt).toBeDefined();
    expect(doc).not.toHaveProperty("email");
    expect(doc).not.toHaveProperty("displayName");
    expect(doc).not.toHaveProperty("photoURL");
  });

  it("never overwrites an existing profile", async () => {
    const db = new FakeDb({
      "users/u5": { uid: "u5", createdAt: "2020-01-01T00:00:00.000Z", bio: "keep me" },
    });

    await ensureUserProfileCore(db, { uid: "u5" });

    const doc = (await db.getDoc(db.doc("users", "u5"))).data();
    expect(doc.bio).toBe("keep me");
    expect(doc.createdAt).toBe("2020-01-01T00:00:00.000Z");
  });
});
