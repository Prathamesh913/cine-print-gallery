import { describe, it, expect } from "vitest";
import { collectionsReducer, COLLECTIONS_LOAD_ERROR } from "../src/lib/collections-read-state";
import { readStateIdle } from "../src/lib/read-state";
import type { UserCollection } from "../src/lib/collections-core";

function col(id: string, name: string): UserCollection {
  return {
    id,
    ownerId: "user-a",
    ownerName: "A",
    name,
    description: "",
    coverPosterId: null,
    visibility: "private",
    posterIds: [],
    createdAt: null,
    updatedAt: null,
  };
}

describe("collectionsReducer read-state", () => {
  const idle = readStateIdle<UserCollection[]>([]);

  it("START transitions to loading and clears any prior error", () => {
    const prev = { ...idle, error: "old" };
    expect(collectionsReducer(prev, { type: "START" })).toEqual({
      data: [],
      loading: true,
      error: null,
    });
  });

  it("SUCCESS with data stops loading and stores the list", () => {
    const next = collectionsReducer(idle, { type: "START" });
    const done = collectionsReducer(next, { type: "SUCCESS", data: [col("1", "Horror")] });
    expect(done.loading).toBe(false);
    expect(done.error).toBeNull();
    expect(done.data).toEqual([col("1", "Horror")]);
  });

  it("SUCCESS with an empty list is a valid, non-error state", () => {
    const done = collectionsReducer(idle, { type: "SUCCESS", data: [] });
    expect(done.loading).toBe(false);
    expect(done.error).toBeNull();
    expect(done.data).toEqual([]);
  });

  it("FAIL exposes an error and preserves the existing list (not replaced with empty)", () => {
    const loaded = collectionsReducer(idle, { type: "SUCCESS", data: [col("1", "Horror")] });
    const failed = collectionsReducer(loaded, { type: "FAIL", error: COLLECTIONS_LOAD_ERROR });
    expect(failed.error).toBe(COLLECTIONS_LOAD_ERROR);
    expect(failed.loading).toBe(false);
    expect(failed.data).toEqual([col("1", "Horror")]);
  });

  it("retry succeeds after a failure", () => {
    const failed = collectionsReducer(idle, { type: "FAIL", error: COLLECTIONS_LOAD_ERROR });
    const retrying = collectionsReducer(failed, { type: "START" });
    expect(retrying.error).toBeNull();
    const recovered = collectionsReducer(retrying, {
      type: "SUCCESS",
      data: [col("2", "Minimal")],
    });
    expect(recovered.error).toBeNull();
    expect(recovered.data).toEqual([col("2", "Minimal")]);
  });

  it("SET replaces the list (used after create/update/delete mutations)", () => {
    const next = collectionsReducer(idle, { type: "SET", data: [col("3", "Korean")] });
    expect(next.data).toEqual([col("3", "Korean")]);
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
  });
});
