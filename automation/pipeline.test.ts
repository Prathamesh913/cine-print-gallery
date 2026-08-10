import { describe, expect, it, vi } from "vitest";
import { applyImageStage, isRaindropFileUrl } from "./pipeline";
import type { EnrichedDraft } from "./tmdb/types";
import type { BlobImageImporter } from "./blob/import";

function draft(overrides: Partial<EnrichedDraft> = {}): EnrichedDraft {
  return {
    raindropId: "1812274995",
    title: "BlacKkKlansman",
    year: 2018,
    mediaType: "movie",
    artists: ["Eileen Steinbach"],
    imageUrl: "https://api.raindrop.io/v2/raindrop/1812274995/file?type=image/png",
    sourceUrl: "https://x.com/sg_posters/status/2074969264499392888?s=46",
    status: "enriched",
    tmdb: {
      id: 487558,
      imdbId: "tt7349662",
      genres: ["Crime", "Drama"],
      slug: "blackkklansman-2018",
      libraryName: "Movies",
    },
    ...overrides,
  };
}

function fakeImporter(overrides: Partial<BlobImageImporter> = {}) {
  return {
    importImage: vi.fn(),
    ...overrides,
  } as unknown as Pick<BlobImageImporter, "importImage">;
}

describe("isRaindropFileUrl", () => {
  it("detects Raindrop-hosted file endpoints", () => {
    expect(
      isRaindropFileUrl("https://api.raindrop.io/v2/raindrop/1812274995/file?type=image/png"),
    ).toBe(true);
  });

  it("detects external image URLs", () => {
    expect(isRaindropFileUrl("https://pbs.twimg.com/media/HJvh3p8WUAAyir?format=jpg")).toBe(false);
    expect(isRaindropFileUrl("not a url")).toBe(false);
  });
});

describe("applyImageStage", () => {
  it("replaces draft.imageUrl with the public Blob URL after upload", async () => {
    const importer = fakeImporter();
    importer.importImage.mockResolvedValue({
      url: "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.png",
      pathname: "cineprint/raindrop/1812274995.png",
      status: "uploaded",
    });

    const result = await applyImageStage(draft(), importer, {
      raindropToken: "raindrop-token",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.imageUrl).toBe(
      "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.png",
    );
    expect(result.status).toBe("uploaded");
    expect(result.sourceKind).toBe("raindrop");
    expect(importer.importImage).toHaveBeenCalledWith(
      expect.objectContaining({
        raindropId: "1812274995",
        raindropToken: "raindrop-token",
        sourceKind: "raindrop",
      }),
      {},
    );
  });

  it("keeps the source URL unchanged on failure so Notion never receives the old URL", async () => {
    const importer = fakeImporter();
    importer.importImage.mockRejectedValue(new Error("Blob API is down"));

    const result = await applyImageStage(draft(), importer, {
      raindropToken: "raindrop-token",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("Blob API is down");
    expect(result.draft.imageUrl).toBe(
      "https://api.raindrop.io/v2/raindrop/1812274995/file?type=image/png",
    );
  });

  it("passes dry-run through to the importer", async () => {
    const importer = fakeImporter();
    importer.importImage.mockResolvedValue({
      url: "https://source.example.com/image.png",
      pathname: "cineprint/raindrop/1812274995.png",
      status: "would-upload",
    });

    const result = await applyImageStage(draft(), importer, {
      raindropToken: "raindrop-token",
      dryRun: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("would-upload");
    expect(importer.importImage).toHaveBeenCalledWith(expect.anything(), { dryRun: true });
  });
});
