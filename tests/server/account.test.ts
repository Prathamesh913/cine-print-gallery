import { describe, it, expect, vi, beforeEach } from "vitest";
import { FakeDb } from "../security/fake-db";
import {
  buildAccountExport,
  performAccountDeletion,
} from "../../src/lib/account-core";
import { toggleUserLikeCore } from "../../src/lib/user-likes-core";
import { createCollectionCore } from "../../src/lib/collections-core";

/**
 * Phase 2 regression coverage for the Account feature's business logic.
 *
 * Follows the repo convention (tests/security/cross-user.test.ts,
 * tests/collections-atomic.test.ts): pure core functions against FakeDb.
 *
 * Covered elsewhere by design:
 * - auth middleware semantics (verified-uid injection, forged client uid
 *   ignored, missing/invalid token failures, FirebaseAdminError propagation)
 *     → tests/server/auth-middleware.test.ts
 * - envelope shapes + leak-proofing of toPublicError/serializeForLog
 *     → tests/server/error-response.test.ts
 */

beforeEach(() => {
  db = new FakeDb();
});

let db: FakeDb;

function fakeAuth() {
  return { deleteUser: vi.fn<(uid: string) => Promise<void>>(async () => {}) };
}

async function seedUserData(database: FakeDb, uid: string) {
  await database.setDoc(database.doc("users", uid), {
    bio: `${uid}'s private bio`,
    createdAt: "2020-01-01",
  });
  await toggleUserLikeCore(database, uid, `poster-of-${uid}`);
}

describe("buildAccountExport", () => {
  it("collects ONLY the acting user's profile, saved posters and collections", async () => {
    await seedUserData(db, "user-a");
    await seedUserData(db, "user-b");
    await createCollectionCore(db, { uid: "user-a", name: "A's gallery", visibility: "private" });
    await createCollectionCore(db, { uid: "user-b", name: "B's secret", visibility: "private" });

    const data = await buildAccountExport(db, "user-a");

    expect(data.savedPosterIds).toEqual(["poster-of-user-a"]);
    expect(data.profile.bio).toBe("user-a's private bio");
    expect(data.collections).toHaveLength(1);
    expect(data.collections[0]?.name).toBe("A's gallery");

    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("B's secret");
    expect(serialized).not.toContain("poster-of-user-b");
    expect(serialized).not.toContain("user-b's private bio");
  });
});

describe("performAccountDeletion", () => {
  it("deletes the Auth record, all owned collections and the user doc of the acting uid only", async () => {
    const auth = fakeAuth();

    await seedUserData(db, "user-a");
    await createCollectionCore(db, { uid: "user-a", name: "mine", visibility: "private" });
    // Another user whose data must survive untouched.
    await seedUserData(db, "user-b");
    await createCollectionCore(db, { uid: "user-b", name: "B's stuff", visibility: "private" });

    await performAccountDeletion(auth, db, "user-a");

    expect(auth.deleteUser).toHaveBeenCalledTimes(1);
    expect(auth.deleteUser).toHaveBeenCalledWith("user-a");
    expect(await db.queryCol("collections", "ownerId", "==", "user-a")).toEqual([]);
    expect((await db.getDoc(db.doc("users", "user-a"))).exists).toBe(false);

    // user-b is untouched.
    expect((await db.getDoc(db.doc("users", "user-b"))).exists).toBe(true);
    expect(await db.queryCol("collections", "ownerId", "==", "user-b")).toHaveLength(1);
  });

  it("stops before touching Firestore when Auth deletion fails (recoverable partial state)", async () => {
    const auth = fakeAuth();
    auth.deleteUser.mockRejectedValue(new Error("auth delete failed"));

    await seedUserData(db, "user-a");
    await createCollectionCore(db, { uid: "user-a", name: "mine", visibility: "private" });

    await expect(performAccountDeletion(auth, db, "user-a")).rejects.toThrow(
      "auth delete failed",
    );

    // Nothing was deleted — the failure left everything recoverable.
    expect((await db.getDoc(db.doc("users", "user-a"))).exists).toBe(true);
    expect(await db.queryCol("collections", "ownerId", "==", "user-a")).toHaveLength(1);
  });
});
