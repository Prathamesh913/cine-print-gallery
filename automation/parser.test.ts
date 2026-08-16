import { describe, expect, it } from "vitest";
import { parseBookmark } from "./parser";
import type { RaindropBookmark } from "./parser";

const baseBookmark = {
  _id: 1812274995,
  link: "https://api.raindrop.io/v2/raindrop/1812274995/file?type=image/png",
  note: "https://x.com/sg_posters/status/2074969264499392888?s=46",
  file: { name: "poster.png", size: 3251321, type: "image/png" },
};

const validTags = ["movie:BlacKkKlansman|2018", "artist:Eileen Steinbach"];

function expectDraft(bookmark: RaindropBookmark) {
  const result = parseBookmark(bookmark);
  expect(result.ok, result.ok ? "" : JSON.stringify(result.errors)).toBe(true);
  if (!result.ok) {
    throw new Error(`Expected parse to succeed, got: ${JSON.stringify(result.errors)}`);
  }
  return result.draft;
}

describe("imageUrl mapping", () => {
  it("maps imageUrl to the Raindrop file endpoint built from _id and file.type", () => {
    const draft = expectDraft({ ...baseBookmark, tags: validTags });
    expect(draft.imageUrl).toBe(
      "https://api.raindrop.io/v2/raindrop/1812274995/file?type=image/png",
    );
  });

  it("falls back to the file endpoint in link when file.type is missing", () => {
    const bookmark = { ...baseBookmark, file: undefined, tags: validTags };
    const draft = expectDraft(bookmark as RaindropBookmark);
    expect(draft.imageUrl).toBe(
      "https://api.raindrop.io/v2/raindrop/1812274995/file?type=image/png",
    );
  });

  it("never uses the rdl.ink render preview as the canonical image URL", () => {
    const bookmark = {
      ...baseBookmark,
      tags: validTags,
      cover: "https://rdl.ink/render/https%3A%2F%2Fup.raindrop.io%2Fposter.png",
    };
    const draft = expectDraft(bookmark as RaindropBookmark);
    expect(draft.imageUrl).not.toContain("rdl.ink");
    expect(draft.imageUrl).toBe(
      "https://api.raindrop.io/v2/raindrop/1812274995/file?type=image/png",
    );
  });

  it("reports an error when no image URL can be derived", () => {
    const bookmark = { ...baseBookmark, file: undefined, link: "https://x.com/post" };
    const result = parseBookmark(bookmark as RaindropBookmark);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual({ field: "imageUrl", message: "Image URL is missing" });
  });

  it("uses the bookmark link as the image URL for image-type raindrops without a file", () => {
    const bookmark = {
      _id: 1813721087,
      type: "image",
      link: "https://pbs.twimg.com/media/HJvh3p8WUAAyir?format=jpg&name=large",
      note: "https://x.com/Jimmyarts2009/status/2061489608068567431/photo/1",
      cover: "https://rdl.ink/render/https%3A%2F%2Fpbs.twimg.com%2Fmedia%2FHJvh3p8WUAAyir",
      media: [],
      tags: ["artist:Ahmed Gamal", "movie:Spider-Man: Brand New Day|2026"],
    };
    const draft = expectDraft(bookmark as RaindropBookmark);
    expect(draft.title).toBe("Spider-Man: Brand New Day");
    expect(draft.year).toBe(2026);
    expect(draft.mediaType).toBe("movie");
    expect(draft.artists).toEqual(["Ahmed Gamal"]);
    expect(draft.imageUrl).toBe("https://pbs.twimg.com/media/HJvh3p8WUAAyir?format=jpg&name=large");
    expect(draft.imageUrl).not.toContain("rdl.ink");
  });
});

describe("sourceUrl mapping", () => {
  it("maps sourceUrl to the bookmark Note when present", () => {
    const draft = expectDraft({ ...baseBookmark, tags: validTags });
    expect(draft.sourceUrl).toBe("https://x.com/sg_posters/status/2074969264499392888?s=46");
  });

  it("normalizes whitespace around the Note URL", () => {
    const bookmark = {
      ...baseBookmark,
      note: "  https://x.com/sg_posters/status/123  ",
      tags: validTags,
    };
    const draft = expectDraft(bookmark as RaindropBookmark);
    expect(draft.sourceUrl).toBe("https://x.com/sg_posters/status/123");
  });

  it("falls back to the original bookmark link when the Note is empty", () => {
    const bookmark = { ...baseBookmark, note: "", tags: validTags };
    const draft = expectDraft(bookmark as RaindropBookmark);
    expect(draft.sourceUrl).toBe(
      "https://api.raindrop.io/v2/raindrop/1812274995/file?type=image/png",
    );
  });

  it("reports an error when neither Note nor link exists", () => {
    const bookmark = { ...baseBookmark, note: "", link: undefined };
    const result = parseBookmark(bookmark as RaindropBookmark);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual({ field: "sourceUrl", message: "Source URL is missing" });
  });
});

describe("tag parsing", () => {
  it.each([
    "movie:BlacKkKlansman|2018",
    "movie: BlacKkKlansman|2018",
    "movie:BlacKkKlansman | 2018",
    "movie: BlacKkKlansman | 2018",
  ])("parses movie tag %j", (movieTag) => {
    const draft = expectDraft({ ...baseBookmark, tags: [movieTag, "artist:Eileen Steinbach"] });
    expect(draft.title).toBe("BlacKkKlansman");
    expect(draft.year).toBe(2018);
    expect(draft.mediaType).toBe("movie");
  });

  it("parses show tags with multiple artists", () => {
    const draft = expectDraft({
      ...baseBookmark,
      tags: ["show: Severance | 2022", "artist: A", "artist: B"],
    });
    expect(draft.title).toBe("Severance");
    expect(draft.year).toBe(2022);
    expect(draft.mediaType).toBe("show");
    expect(draft.artists).toEqual(["A", "B"]);
  });

  it("ignores unknown tags", () => {
    const draft = expectDraft({
      ...baseBookmark,
      tags: ["movie:BlacKkKlansman|2018", "artist:Eileen Steinbach", "foo:bar"],
    });
    expect(draft.title).toBe("BlacKkKlansman");
  });

  it("reports an error when the artist tag is missing", () => {
    const result = parseBookmark({ ...baseBookmark, tags: ["movie:BlacKkKlansman|2018"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual({
      field: "artists",
      message: "At least one artist tag is required",
    });
  });

  it("reports an error when the year is missing", () => {
    const result = parseBookmark({ ...baseBookmark, tags: ["movie:BlacKkKlansman", "artist:E"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual({ field: "year", message: "Year is missing" });
  });

  it("reports a specific error for an invalid year", () => {
    const result = parseBookmark({
      ...baseBookmark,
      tags: ["movie:BlacKkKlansman|201x", "artist:E"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual([{ field: "year", message: 'Year "201x" is not a valid year' }]);
  });

  it("reports an error when no movie or show tag exists", () => {
    const result = parseBookmark({ ...baseBookmark, tags: ["artist:E"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual({
      field: "mediaType",
      message: "movie or show tag is missing",
    });
  });
});
