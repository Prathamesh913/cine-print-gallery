import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyTokenUid } from "../../src/lib/server-auth";
import { FakeDb } from "./fake-db";
import {
  getUserLikedIdsCore,
  updateBioCore,
  getUserProfileCore,
} from "../../src/lib/user-likes-core";
import {
  createCollectionCore,
  getCollectionCore,
  deleteCollectionCore,
} from "../../src/lib/collections-core";

// Simulates the CURRENT server-function wrapper path:
//   token verification -> verifyTokenUid(token) -> core with VERIFIED UID.
// There is no client-declared UID parameter anymore; forged uid fields never
// reach verification (pinned by tests/server/auth-middleware.test.ts).
// The FakeDb stands in for Firestore; verification is mocked to the token holder.

const verifyIdToken = vi.fn();
vi.mock("../../src/server/firebase/admin", () => {
  class FirebaseAdminError extends Error {
    stage: string;
    constructor(stage: string, message: string) {
      super(`[firebase-admin/${stage}] ${message}`);
      this.name = "FirebaseAdminError";
      this.stage = stage;
    }
  }
  return {
    getAdminAuth: () => Promise.resolve({ verifyIdToken }),
    FirebaseAdminError,
  };
});

async function asUser(token: string): Promise<string> {
  return verifyTokenUid(token);
}

describe("cross-user protection through the full wrapper path", () => {
  beforeEach(() => {
    verifyIdToken.mockReset();
  });

  it("User A cannot read User B's saved posters", async () => {
    verifyIdToken.mockImplementation(async () => ({ uid: "user-a" }));
    const db = new FakeDb();
    await updateBioCore(db, "user-b", "B's bio");
    // Seed B's likes directly.
    await import("../../src/lib/user-likes-core").then((m) =>
      m.toggleUserLikeCore(db, "user-b", "p-secret"),
    );

    // A reads with its own verified UID — must not see B's data.
    const aUid = await asUser("token-of-a");
    expect(await getUserLikedIdsCore(db, aUid)).toEqual([]);
    expect(await getUserLikedIdsCore(db, "user-b")).toEqual(["p-secret"]);
  });

  it("User A cannot modify User B's profile", async () => {
    verifyIdToken.mockImplementation(async () => ({ uid: "user-a" }));
    const db = new FakeDb();
    await updateBioCore(db, "user-b", "original");

    const aUid = await asUser("token-of-a");
    await updateBioCore(db, aUid, "A's new bio");
    expect((await getUserProfileCore(db, "user-b")).bio).toBe("original");
    expect((await getUserProfileCore(db, "user-a")).bio).toBe("A's new bio");
  });

  it("User A cannot modify or delete User B's collection", async () => {
    verifyIdToken.mockImplementation(async () => ({ uid: "user-a" }));
    const db = new FakeDb();
    const bCol = await createCollectionCore(db, {
      uid: "user-b",
      name: "B's private",
      visibility: "private",
    });

    // A uses its own verified UID.
    const aUid = await asUser("token-of-a");

    // A cannot see B's private collection.
    await expect(getCollectionCore(db, bCol.id, aUid)).resolves.toBeNull();

    // A cannot delete B's collection.
    await expect(deleteCollectionCore(db, { uid: aUid, id: bCol.id })).rejects.toThrow(
      "Not authorized",
    );

    // B's collection is intact.
    await expect(getCollectionCore(db, bCol.id, "user-b")).resolves.not.toBeNull();
  });

  it("public collections remain readable to an unauthenticated caller", async () => {
    verifyIdToken.mockImplementation(async () => ({ uid: "user-a" }));
    const db = new FakeDb();
    const pub = await createCollectionCore(db, {
      uid: "user-b",
      name: "B's public",
      visibility: "public",
    });

    expect(await getCollectionCore(db, pub.id, null)).not.toBeNull();
  });

  it("private collection access is denied to an authenticated non-owner", async () => {
    verifyIdToken.mockImplementation(async () => ({ uid: "user-a" }));
    const db = new FakeDb();
    const priv = await createCollectionCore(db, {
      uid: "user-b",
      name: "B's private",
      visibility: "private",
    });

    const aUid = await asUser("token-of-a");
    await expect(getCollectionCore(db, priv.id, aUid)).resolves.toBeNull();
  });
});
