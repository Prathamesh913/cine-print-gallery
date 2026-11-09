import { describe, expect, it, vi } from "vitest";
import {
  applySyncPlan,
  buildSyncPlan,
  type SyncPlanRecord,
} from "../../scripts/poster-identity.js";
import {
  parsePageData,
  pruneRecords,
  writeRecords,
} from "../../scripts/sync-notion-to-firestore.js";
import { buildPostBackfillFixture } from "./fixtures";

function fakeFirestore(existingIds: Set<string>) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const setCalls = vi.fn();
  const db = {
    batch: () => ({
      update: (ref: { id: string }, data: Record<string, unknown>) => {
        if (!existingIds.has(ref.id)) {
          throw new Error(`NOT_FOUND: ${ref.id}`);
        }
        updates.push({ id: ref.id, data });
      },
      set: setCalls,
      commit: async () => undefined,
    }),
  };
  const col = { doc: (id: string) => ({ id }) };
  return { db, col, updates, setCalls };
}

function record(id: string): SyncPlanRecord {
  return {
    id,
    data: { title: id },
    identity: {
      posterId: id,
      identitySource: "notion_property",
      groupingPageId: "page",
      identityRecordId: null,
      imageUrl: "https://example.com/image.jpg",
    },
  };
}

describe("Firestore adapter safety", () => {
  it("uses batch.update only and never set/create", async () => {
    const existing = new Set(["poster-a", "poster-b"]);
    const fake = fakeFirestore(existing);
    await writeRecords(fake.db as never, fake.col as never, [
      record("poster-a"),
      record("poster-b"),
    ]);
    expect(fake.updates.map((entry) => entry.id).sort()).toEqual(["poster-a", "poster-b"]);
    expect(fake.setCalls).not.toHaveBeenCalled();
  });

  it("fails instead of recreating a missing document", async () => {
    const fake = fakeFirestore(new Set(["poster-a"]));
    await expect(
      writeRecords(fake.db as never, fake.col as never, [record("poster-a"), record("missing")]),
    ).rejects.toThrow(/NOT_FOUND/);
    expect(fake.setCalls).not.toHaveBeenCalled();
  });

  it("prunes with update only", async () => {
    const fake = fakeFirestore(new Set(["orphan"]));
    await pruneRecords(fake.db as never, fake.col as never, [
      { posterId: "orphan", notionPageId: "page" },
    ]);
    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0].data.status).toBe("archived");
    expect(fake.setCalls).not.toHaveBeenCalled();
  });

  it("does not call the writer when the plan is invalid", async () => {
    const fixture = buildPostBackfillFixture();
    const plan = buildSyncPlan({
      ...fixture,
      parsePage: parsePageData,
      mode: "canonical",
      allowLegacy: false,
      identityRecords: fixture.identityRecords.map((entry) =>
        entry.posterId === "stranger-things-2" ? { ...entry, posterId: "unknown-999" } : entry,
      ),
    });
    const fake = fakeFirestore(new Set(fixture.knownPosterIds));
    const write = vi.fn(async () => undefined);
    const prune = vi.fn(async () => undefined);
    const result = await applySyncPlan(plan, { write, prune });
    expect(result.ok).toBe(false);
    expect(write).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
    expect(fake.updates).toHaveLength(0);
  });
});
