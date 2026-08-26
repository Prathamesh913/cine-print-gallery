import { describe, it, expect } from "vitest";
import { withEnvelope } from "../../src/server/errors/error-response";
import { FakeDb } from "../security/fake-db";
import {
  listMyCollectionsCore,
  getCollectionCore,
  createCollectionCore,
  updateCollectionCore,
  deleteCollectionCore,
  addPosterToCollectionCore,
  removePosterFromCollectionCore,
} from "../../src/lib/collections-core";

/**
 * Phase 4 wire-contract coverage for the seven migrated collections
 * operations. Each case mirrors its production handler body one-for-one
 * (optionalViewerUid → withEnvelope(operation, uid, core-call)), pinning the
 * ENVELOPE SHAPES clients receive.
 *
 * Deliberate layering (do not duplicate):
 * - cross-user authorization + visibility semantics of the cores themselves
 *     → tests/security/collections-core.test.ts, tests/security/cross-user.test.ts
 * - optional token verification (missing/invalid/config-failure) of the
 *   public read path
 *     → tests/security/server-auth.test.ts ("optionalViewerUid")
 * - generic envelope/redaction machinery
 *     → tests/server/error-response.test.ts
 *
 * Note: invoking createServerFn objects locally is not possible under vitest
 * ("No Start context" — the RPC runtime isn't emulated), which is why every
 * feature suite tests handler-equivalent composition instead.
 */

function runListMine(db: FakeDb, verifiedUid: string) {
  return withEnvelope("collections.listMine", verifiedUid, async () => {
    return listMyCollectionsCore(db, verifiedUid);
  });
}

function runGet(db: FakeDb, id: string, viewerUid: string | null) {
  return withEnvelope("collections.get", viewerUid ?? undefined, () =>
    getCollectionCore(db, id, viewerUid),
  );
}

// Payload type deliberately loose: proves extra client-sent identity fields
// (uid / requesterUid) are inert — handlers never read them.
type LoosePayload = Record<string, unknown>;

function runCreate(db: FakeDb, verifiedUid: string, payload: LoosePayload) {
  return withEnvelope("collections.create", verifiedUid, async () => {
    return createCollectionCore(db, {
      uid: verifiedUid,
      ownerName: payload.ownerName as string | null | undefined,
      name: payload.name as string,
      description: payload.description as string | undefined,
      visibility: payload.visibility as never,
      posterId: (payload.posterId as string | null | undefined) ?? null,
    });
  });
}

function runUpdate(db: FakeDb, verifiedUid: string, id: string, payload: LoosePayload) {
  return withEnvelope("collections.update", verifiedUid, async () => {
    return updateCollectionCore(db, {
      uid: verifiedUid,
      id,
      name: payload.name as string | undefined,
      description: payload.description as string | undefined,
      visibility: payload.visibility as never,
      coverPosterId: payload.coverPosterId as string | null | undefined,
      posterIds: payload.posterIds as string[] | undefined,
    });
  });
}

function runDelete(db: FakeDb, verifiedUid: string, id: string) {
  return withEnvelope("collections.delete", verifiedUid, async () =>
    deleteCollectionCore(db, { uid: verifiedUid, id }),
  );
}

function runAdd(db: FakeDb, verifiedUid: string, collectionId: string, posterId: string) {
  return withEnvelope("collections.addPoster", verifiedUid, async () =>
    addPosterToCollectionCore(db, { uid: verifiedUid, collectionId, posterId }),
  );
}

function runRemove(db: FakeDb, verifiedUid: string, collectionId: string, posterId: string) {
  return withEnvelope("collections.removePoster", verifiedUid, async () =>
    removePosterFromCollectionCore(db, { uid: verifiedUid, collectionId, posterId }),
  );
}

describe("collections wire contracts (envelopes over real cores)", () => {
  it("collections.listMine resolves { ok:true, data:UserCollection[] } scoped to the acting uid", async () => {
    const db = new FakeDb();
    await createCollectionCore(db, { uid: "user-a", name: "A one" });
    await createCollectionCore(db, { uid: "user-b", name: "B secret" });

    const res = await runListMine(db, "user-a");

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.map((c) => c.name)).toEqual(["A one"]);
      expect(JSON.stringify(res)).not.toContain("B secret");
    }
  });

  it("collections.get keeps public/unlisted readable without a viewer and hides private", async () => {
    const db = new FakeDb();
    const pub = await createCollectionCore(db, { uid: "user-a", name: "pub", visibility: "public" });
    const unlisted = await createCollectionCore(db, { uid: "user-a", name: "unl", visibility: "unlisted" });
    const priv = await createCollectionCore(db, { uid: "user-a", name: "priv", visibility: "private" });

    // No token → public/unlisted previews still resolve (OG loader path).
    expect(await runGet(db, pub.id, null)).toEqual({ ok: true, data: expect.objectContaining({ name: "pub" }) });
    expect(await runGet(db, unlisted.id, null)).toEqual({ ok: true, data: expect.objectContaining({ name: "unl" }) });
    // Private without a viewer resolves to a null-data SUCCESS (not an error).
    expect(await runGet(db, priv.id, null)).toEqual({ ok: true, data: null });

    // Private WITH the owner's verified viewer resolves.
    const owned = await runGet(db, priv.id, "user-a");
    expect(owned).toEqual({ ok: true, data: expect.objectContaining({ name: "priv" }) });
  });

  it("collections.create takes ownership from the VERIFIED uid — forged payload fields are inert", async () => {
    const db = new FakeDb();

    const res = await runCreate(db, "user-real", {
      name: "Mine",
      // Old-style spoofing fields: must have no path to the acting identity.
      uid: "user-attacker",
      requesterUid: "user-attacker",
    });

    expect(res).toEqual({
      ok: true,
      data: expect.objectContaining({ ownerId: "user-real", name: "Mine" }),
    });
    expect(JSON.stringify(res)).not.toContain("user-attacker");
  });

  it("collections.update scopes writes to the verified uid; cross-owner attempts collapse safely", async () => {
    const db = new FakeDb();
    const mine = await createCollectionCore(db, { uid: "user-real", name: "Before" });
    const theirs = await createCollectionCore(db, { uid: "user-b", name: "B's" });

    // Owner rename succeeds with the updated collection in data.
    const ok = await runUpdate(db, "user-real", mine.id, {
      name: "After",
      uid: "user-attacker",
    });
    expect(ok).toEqual({
      ok: true,
      data: expect.objectContaining({ id: mine.id, name: "After" }),
    });

    // Non-owner write attempt: plain core Error collapses to a safe INTERNAL
    // envelope — no driver/internal details leak (authorization still held).
    const denied = await runUpdate(db, "user-attacker", theirs.id, { name: "Hacked" });
    expect(denied).toEqual({
      ok: false,
      error: { code: "INTERNAL", message: "Something went wrong. Please try again." },
    });
    expect((await getCollectionCore(db, theirs.id, "user-b"))?.name).toBe("B's");
  });

  it("collections.delete resolves { ok:true, data:{ok:true} } for the owner and is idempotent for missing ids", async () => {
    const db = new FakeDb();
    const col = await createCollectionCore(db, { uid: "user-real", name: "Gone soon" });

    expect(await runDelete(db, "user-real", col.id)).toEqual({ ok: true, data: { ok: true } });
    expect(await getCollectionCore(db, col.id, "user-real")).toBeNull();
    // Already-deleted ids stay a success (core behavior preserved).
    expect(await runDelete(db, "user-real", col.id)).toEqual({ ok: true, data: { ok: true } });
  });

  it("collections.addPoster / removePoster resolve the updated collection scoped to the verified uid", async () => {
    const db = new FakeDb();
    const col = await createCollectionCore(db, { uid: "user-real", name: "Shelf" });

    const added = await runAdd(db, "user-real", col.id, "p1");
    expect(added).toEqual({
      ok: true,
      data: expect.objectContaining({ posterIds: ["p1"], coverPosterId: "p1" }),
    });

    const removed = await runRemove(db, "user-real", col.id, "p1");
    expect(removed).toEqual({
      ok: true,
      data: expect.objectContaining({ posterIds: [], coverPosterId: null }),
    });
  });
});
