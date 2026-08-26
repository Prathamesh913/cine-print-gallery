import { describe, it, expect } from "vitest";
import { AppError } from "../../src/server/errors/app-error";
import { withEnvelope } from "../../src/server/errors/error-response";
import { FakeDb } from "../security/fake-db";
import {
  ensureUserProfileCore,
  getUserLikedIdsCore,
  toggleUserLikeCore,
  getUserProfileCore,
  updateBioCore,
  mergeLikedPostersCore,
} from "../../src/lib/user-likes-core";

/**
 * Phase 3 wire-contract coverage for the six migrated user-likes operations.
 *
 * Each case mirrors its production handler body one-for-one
 * (withEnvelope(operation, uid, core-call)) so the ENVELOPE SHAPES clients
 * receive are pinned: string[] / {added} / null / UserProfile.
 *
 * Deliberate layering (do not duplicate):
 * - cross-user isolation + dedupe/merge semantics of the cores themselves
 *     → tests/security/user-likes-core.test.ts
 * - token verification, forged-uid inertness, UNAUTHENTICATED/UNAUTHORIZED,
 *   FirebaseAdminError propagation
 *     → tests/server/auth-middleware.test.ts
 * - generic envelope/redaction machinery
 *     → tests/server/error-response.test.ts
 *
 * Note: invoking createServerFn objects locally is not possible under vitest
 * ("No Start context" — the RPC runtime isn't emulated), which is why every
 * feature suite tests handler-equivalent composition instead.
 */

function runSavedListIds(db: FakeDb, uid: string) {
  return withEnvelope("saved.listIds", uid, async () => {
    return getUserLikedIdsCore(db, uid);
  });
}

function runSavedToggle(db: FakeDb, uid: string, posterId: string) {
  return withEnvelope("saved.toggle", uid, async () => {
    return toggleUserLikeCore(db, uid, posterId);
  });
}

function runSavedMerge(db: FakeDb, uid: string, posterIds: string[]) {
  return withEnvelope("saved.mergeAnonymous", uid, async () => {
    await mergeLikedPostersCore(db, uid, posterIds);
    return null as const;
  });
}

describe("user-likes wire contracts (envelopes over real cores)", () => {
  it("saved.listIds resolves { ok:true, data:string[] } scoped to the acting uid", async () => {
    const db = new FakeDb();
    await db.setDoc(db.doc("users", "user-a"), { likedPostIds: ["p1", "p2"] });
    await db.setDoc(db.doc("users", "user-b"), { likedPostIds: ["p-secret"] });

    const res = await runSavedListIds(db, "user-a");

    expect(res).toEqual({ ok: true, data: ["p1", "p2"] });
    // Verified identity scopes the read: B's data never appears.
    expect(JSON.stringify(res)).not.toContain("p-secret");
  });

  it("saved.toggle resolves { ok:true, data:{added} } and mutates only the acting uid's doc", async () => {
    const db = new FakeDb();
    await toggleUserLikeCore(db, "user-b", "b-poster");

    const addRes = await runSavedToggle(db, "user-a", "p-new");
    expect(addRes).toEqual({ ok: true, data: { added: true } });

    const removeRes = await runSavedToggle(db, "user-a", "p-new");
    expect(removeRes).toEqual({ ok: true, data: { added: false } });

    // user-b untouched by user-a's toggles.
    expect((await db.getDoc(db.doc("users", "user-b"))).data().likedPostIds).toEqual([
      "b-poster",
    ]);
  });

  it("saved.mergeAnonymous resolves { ok:true, data:null } and preserves void semantics", async () => {
    const db = new FakeDb();
    await db.setDoc(db.doc("users", "user-a"), { likedPostIds: ["p1"] });

    const res = await runSavedMerge(db, "user-a", ["p1", "anon-1", "anon-2"]);

    expect(res).toEqual({ ok: true, data: null });
    expect((await db.getDoc(db.doc("users", "user-a"))).data().likedPostIds).toEqual([
      "p1",
      "anon-1",
      "anon-2",
    ]);
  });

  it("profile.ensure / profile.get / profile.updateBio resolve their documented shapes", async () => {
    const db = new FakeDb();

    const ensured = await withEnvelope("profile.ensure", "user-a", async () => {
      await ensureUserProfileCore(db, {
        uid: "user-a",
        email: "a@test.dev",
        displayName: "A",
        photoURL: null,
        creationTime: null,
      });
      return null as const;
    });
    expect(ensured).toEqual({ ok: true, data: null });

    const got = await withEnvelope("profile.get", "user-a", () =>
      getUserProfileCore(db, "user-a"),
    );
    expect(got.ok).toBe(true);
    if (got.ok) expect(typeof got.data.bio).toBe("string");

    const bioRes = await withEnvelope("profile.updateBio", "user-a", async () => {
      await updateBioCore(db, "user-a", "new bio");
      return null as const;
    });
    expect(bioRes).toEqual({ ok: true, data: null });
    expect((await getUserProfileCore(db, "user-a")).bio).toBe("new bio");
  });

  it("database failures collapse to a safe INTERNAL envelope — no driver leakage", async () => {
    const explodingDb = {
      getDoc: async () => {
        throw new Error("firestore driver exploded secret-project/path");
      },
    };
    const res = await withEnvelope("saved.listIds", "user-a", () =>
      // Same shape the handler runs; a broken dependency surfaces generically.
      getUserLikedIdsCore(explodingDb as unknown as FakeDb, "user-a"),
    );

    expect(res).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong. Please try again." },
    });
    expect(JSON.stringify(res)).not.toContain("secret-project");
    expect(JSON.stringify(res)).not.toContain("driver");
  });

  it("AppErrors thrown inside an operation keep their public code/message", async () => {
    const res = await withEnvelope("profile.updateBio", "user-a", async () => {
      throw new AppError("VALIDATION_FAILED", "That request wasn't valid.");
    });
    expect(res).toEqual({
      ok: false,
      error: { code: "VALIDATION_FAILED", message: "That request wasn't valid." },
    });
  });
});
