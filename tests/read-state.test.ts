import { describe, it, expect } from "vitest";
import { readStateIdle, loadStart, loadSuccess, loadFailure } from "../src/lib/read-state";

describe("ReadState helpers (shared saved/profile/collections pattern)", () => {
  it("readStateIdle starts with given data, no loading, no error", () => {
    expect(readStateIdle<string[]>(["a"])).toEqual({ data: ["a"], loading: false, error: null });
    expect(readStateIdle<string[]>()).toEqual({ data: null, loading: false, error: null });
  });

  it("loadStart sets loading, clears error, preserves data", () => {
    const prev = { data: ["a"], loading: false, error: "old error" };
    expect(loadStart(prev)).toEqual({ data: ["a"], loading: true, error: null });
  });

  it("loadSuccess sets data (including empty), stops loading, clears error", () => {
    const prev = { data: ["a"], loading: true, error: null };
    expect(loadSuccess(prev, ["b", "c"])).toEqual({
      data: ["b", "c"],
      loading: false,
      error: null,
    });
    expect(loadSuccess(prev, [])).toEqual({ data: [], loading: false, error: null });
  });

  it("loadFailure sets an error, stops loading, and preserves existing data (never replaces it)", () => {
    const prev = { data: ["a"], loading: true, error: null };
    const next = loadFailure(prev, "boom");
    expect(next.error).toBe("boom");
    expect(next.loading).toBe(false);
    expect(next.data).toEqual(["a"]);
  });

  it("retry sequence: failure -> start (error cleared, data kept) -> success replaces data", () => {
    const failed = loadFailure({ data: ["a"], loading: false, error: null }, "boom");
    const retrying = loadStart(failed);
    expect(retrying.error).toBeNull();
    expect(retrying.data).toEqual(["a"]);
    expect(retrying.loading).toBe(true);

    const recovered = loadSuccess(retrying, ["x"]);
    expect(recovered.error).toBeNull();
    expect(recovered.loading).toBe(false);
    expect(recovered.data).toEqual(["x"]);
  });
});
