import { describe, expect, it } from "vitest";
import {
  dedupeBookmarks,
  isSameSourceRevision,
  validateBookmark,
  type BookmarkInput,
} from "./validation";
import { posterIdForRaindrop, reviewDecisionFromJob, stableStringify } from "./identity";

function bookmark(overrides: Partial<BookmarkInput> = {}): BookmarkInput {
  return {
    _id: 123,
    tags: ["movie:BlacKkKlansman|2018", "artist:Eileen Steinbach"],
    link: "https://api.raindrop.io/v2/raindrop/123/file?type=image/png",
    note: "https://example.com/source",
    lastUpdate: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("bookmark validation", () => {
  it("validates a complete bookmark and derives stable identities", () => {
    const result = validateBookmark(bookmark());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.posterId).toBe("artwork-123");
    expect(result.value.sourceKey).toBe("raindrop:123");
    expect(result.value.draft.title).toBe("BlacKkKlansman");
    expect(result.value.draft.year).toBe(2018);
    expect(result.value.raindropUpdatedAt).toBe("2026-11-01T00:00:00.000Z");
  });

  it("rejects a bookmark with no media tag", () => {
    const result = validateBookmark(bookmark({ tags: ["artist:Eileen Steinbach"] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("movie or show tag is missing");
  });

  it("rejects a bookmark with a missing year", () => {
    const result = validateBookmark(bookmark({ tags: ["movie:Test", "artist:A"] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Year is missing");
  });

  it("rejects a bookmark with no image URL", () => {
    const result = validateBookmark(bookmark({ link: "https://example.com/article" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("Image URL is missing");
  });

  it("rejects a non-numeric Raindrop ID", () => {
    const result = validateBookmark(bookmark({ _id: undefined }));
    expect(result.ok).toBe(false);
    expect(posterIdForRaindrop).toBeTypeOf("function");
  });

  it("deduplicates repeated bookmarks and keeps the newest revision", () => {
    const older = bookmark({ lastUpdate: "2026-11-01T00:00:00.000Z" });
    const newer = bookmark({ lastUpdate: "2026-11-05T00:00:00.000Z" });
    const { unique, duplicates } = dedupeBookmarks([older, newer, older]);

    expect(unique).toHaveLength(1);
    expect(unique[0].lastUpdate).toBe("2026-11-05T00:00:00.000Z");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].raindropId).toBe("123");
  });

  it("compares source revisions for skip decisions", () => {
    expect(
      isSameSourceRevision({ raindropUpdatedAt: "2026-11-01T00:00:00.000Z" }, bookmark()),
    ).toBe(true);
    expect(
      isSameSourceRevision(
        { raindropUpdatedAt: "2026-11-01T00:00:00.000Z" },
        bookmark({ lastUpdate: "2026-11-02T00:00:00.000Z" }),
      ),
    ).toBe(false);
    expect(isSameSourceRevision(null, bookmark())).toBe(false);
  });
});

describe("identity helpers", () => {
  it("rejects non-numeric Raindrop IDs", () => {
    expect(() => posterIdForRaindrop("abc")).toThrow("numeric");
  });

  it("serializes objects deterministically", () => {
    expect(stableStringify({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(
      stableStringify({ a: [2, { c: 4, d: 3 }], b: 1 }),
    );
  });

  it("accepts a complete review decision and rejects an invalid one", () => {
    expect(
      reviewDecisionFromJob({
        reviewDecision: {
          posterId: "artwork-123",
          raindropId: "123",
          tmdbId: 487558,
          decidedAt: "2026-11-01T00:00:00.000Z",
        },
      }),
    ).not.toBeNull();
    expect(
      reviewDecisionFromJob({
        reviewDecision: { posterId: "x", raindropId: "1", tmdbId: 0, decidedAt: "bad" },
      }),
    ).toBeNull();
  });
});
