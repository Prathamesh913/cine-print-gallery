import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Poster } from "../src/lib/posters";
import type { R2ImageMapEntry } from "../src/lib/r2-image-map.generated";
import type { R2ImageReference } from "../src/lib/r2-image-reference";
import { createPosterImageResolver } from "../src/lib/poster-images";
import {
  posterDownloadBaseName,
  posterDownloadFilename,
  posterDownloadHref,
  sourceForImageUrl,
} from "../src/lib/download-image";
import { handlePosterDownload } from "../src/server/poster-download";
import { POSTER_DOWNLOAD_PATH } from "../src/lib/download-image";
import { R2_IMAGE_MAP } from "../src/lib/r2-image-map.generated";
import { R2_DOWNLOADS_ENABLED } from "../src/lib/r2-image-activation";

/**
 * Contract for the restored original/optimized poster download feature.
 *
 * The resolver is the single source of truth for download URLs: the endpoint
 * and the UI must never construct keys, use an unverified URL or fall back to
 * the blocked Vercel Blob original.
 */

const SHA = "a".repeat(64);
const ORIGINAL = `https://images.cineprint.click/cineprint/versions/original/poster-1/${SHA}.png`;
const OPTIMIZED = `https://images.cineprint.click/cineprint/versions/optimized/poster-1/${SHA}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`;

function mapEntry(overrides: Partial<R2ImageMapEntry> = {}): R2ImageMapEntry {
  return {
    blobImageUrl:
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/external/poster-1.jpg",
    originalUrl: ORIGINAL,
    optimizedUrl: OPTIMIZED,
    originalKey: `cineprint/versions/original/poster-1/${SHA}.png`,
    optimizedKey: `cineprint/versions/optimized/poster-1/${SHA}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
    verifiedAt: "2026-11-10T00:00:00.000Z",
    ...overrides,
  };
}

function dynamicRef(posterId: string): R2ImageReference {
  return {
    sourceSha256: SHA,
    original: {
      key: `cineprint/versions/original/${posterId}/${SHA}.png`,
      url: `https://images.cineprint.click/cineprint/versions/original/${posterId}/${SHA}.png`,
      sha256: SHA,
      sizeBytes: 1000,
      contentType: "image/png",
    },
    optimized: {
      key: `cineprint/versions/optimized/${posterId}/${SHA}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
      url: `https://images.cineprint.click/cineprint/versions/optimized/${posterId}/${SHA}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
      sha256: "b".repeat(64),
      sizeBytes: 400,
      contentType: "image/webp",
    },
    verifiedAt: "2026-11-10T00:00:00.000Z",
  };
}

function poster(overrides: Partial<Poster> = {}): Poster {
  return {
    id: "poster-1",
    title: "A Movie",
    year: 2024,
    artist: "An Artist",
    source: "Raindrop",
    sourceUrl: "https://example.com",
    image: mapEntry().blobImageUrl,
    style: "Minimalist",
    genre: [],
    tags: [],
    ...overrides,
  };
}

function resolver(map: Record<string, R2ImageMapEntry> = {}, downloadsEnabled = true) {
  return createPosterImageResolver(map, {
    browserEnabled: true,
    seoEnabled: true,
    downloadsEnabled,
  });
}

describe("download activation", () => {
  it("is enabled for production delivery", () => {
    expect(R2_DOWNLOADS_ENABLED).toBe(true);
  });
});

describe("poster download source resolution", () => {
  it("resolves both sources for a static-map poster", () => {
    const entry = mapEntry();
    expect(resolver({ "poster-1": entry }).getPosterDownloadSources(poster())).toEqual([
      { kind: "original", url: ORIGINAL, contentType: "image/png", extension: "png" },
      { kind: "optimized", url: OPTIMIZED, contentType: "image/webp", extension: "webp" },
    ]);
  });

  it("resolves both sources for a dynamic r2Image poster", () => {
    const ref = dynamicRef("poster-1");
    const sources = resolver().getPosterDownloadSources(poster({ r2Image: ref }));
    expect(sources.map((s) => [s.kind, s.url, s.extension])).toEqual([
      ["original", ref.original.url, "png"],
      ["optimized", ref.optimized.url, "webp"],
    ]);
  });

  it("resolves both repaired posters through their verified dynamic reference", () => {
    for (const id of ["the-substance-2", "stranger-things-2"]) {
      const ref = dynamicRef(id);
      const repaired = poster({ id, r2Image: ref });
      const sources = resolver().getPosterDownloadSources(repaired);
      expect(sources.map((s) => s.url)).toEqual([ref.original.url, ref.optimized.url]);
    }
  });

  it("omits the original when its mapped URL is untrusted", () => {
    const entry = mapEntry({ originalUrl: "https://example.com/original.png" });
    const sources = resolver({ "poster-1": entry }).getPosterDownloadSources(poster());
    expect(sources.map((s) => s.kind)).toEqual(["optimized"]);
  });

  it("omits the optimized source when the map has none", () => {
    const entry = mapEntry({ optimizedUrl: null, optimizedKey: null });
    const sources = resolver({ "poster-1": entry }).getPosterDownloadSources(poster());
    expect(sources.map((s) => s.kind)).toEqual(["original"]);
  });

  it("fails closed on an invalid dynamic reference", () => {
    expect(
      resolver().getPosterDownloadSources(
        poster({
          r2Image: {
            ...dynamicRef("poster-1"),
            optimized: { ...dynamicRef("poster-1").optimized, contentType: "image/jpeg" },
          },
        }),
      ),
    ).toEqual([]);
    expect(
      resolver().getPosterDownloadSources(poster({ id: "poster-1", r2ImageInvalid: true })),
    ).toEqual([]);
  });

  it("offers nothing for a legacy Blob-only poster", () => {
    expect(resolver().getPosterDownloadSources(poster())).toEqual([]);
  });

  it("offers nothing for an intentionally unavailable poster without a verified reference", () => {
    expect(resolver().getPosterDownloadSources(poster({ id: "the-substance-2" }))).toEqual([]);
  });

  it("never returns a legacy Blob URL as a download source", () => {
    const entry = mapEntry();
    for (const source of resolver({ "poster-1": entry }).getPosterDownloadSources(poster())) {
      expect(source.url).toMatch(/^https:\/\/images\.cineprint\.click\//);
      expect(source.url).not.toContain("blob.vercel-storage.com");
    }
  });

  it("keeps the legacy download URL API fail-closed too", () => {
    const subject = resolver({ "poster-1": mapEntry() });
    expect(subject.getPosterDownloadUrl(poster())).toBe(ORIGINAL);
    expect(subject.getPosterDownloadUrl(poster({ id: "unmapped" }))).toBe("");
  });
});

describe("download helper metadata", () => {
  it("derives MIME type and extension from a verified URL", () => {
    expect(sourceForImageUrl("original", ORIGINAL)).toMatchObject({
      contentType: "image/png",
      extension: "png",
    });
    expect(sourceForImageUrl("optimized", OPTIMIZED)).toMatchObject({
      contentType: "image/webp",
      extension: "webp",
    });
    expect(sourceForImageUrl("optimized", ORIGINAL)).toBeNull();
  });

  it("builds clean descriptive filenames", () => {
    expect(posterDownloadBaseName(poster())).toBe("A Movie (2024)");
    expect(posterDownloadFilename(poster(), { kind: "original", extension: "png" })).toBe(
      "A Movie (2024)-original.png",
    );
    expect(
      posterDownloadFilename(poster({ collectionName: "Backrooms: The Collection" }), {
        kind: "optimized",
        extension: "webp",
      }),
    ).toBe("Backrooms_ The Collection-optimized.webp");
    expect(
      posterDownloadBaseName(poster({ mediaType: "show", seasonNumber: 2, title: "A Show" })),
    ).toBe("A Show - Season 02");
  });

  it("encodes only the poster id and kind in the same-origin href", () => {
    expect(posterDownloadHref("a b/c", "optimized")).toBe(
      `${POSTER_DOWNLOAD_PATH}?id=a%20b%2Fc&kind=optimized`,
    );
  });
});

describe("same-origin download endpoint", () => {
  // Use a real static-map identity so the endpoint's server-side resolver can
  // verify it exactly as production does.
  const realId = Object.keys(R2_IMAGE_MAP)[0];
  const realEntry = R2_IMAGE_MAP[realId];
  const realPoster = poster({ id: realId, image: realEntry.blobImageUrl });
  const makeDeps = (catalogue: Poster[] = [realPoster]) => ({
    loadCatalogue: async () => catalogue,
    fetchImpl: vi.fn(
      async () =>
        new Response("image-bytes", {
          status: 200,
          headers: { "content-type": "image/png", "content-length": "11" },
        }),
    ) as unknown as typeof fetch,
  });

  it("ignores unrelated requests", async () => {
    expect(
      await handlePosterDownload(new Request("https://cineprint.click/"), makeDeps()),
    ).toBeNull();
  });

  it("streams the verified original source with attachment headers", async () => {
    const deps = makeDeps();
    const response = await handlePosterDownload(
      new Request(`https://cineprint.click${posterDownloadHref(realId, "original")}`),
      deps,
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toMatch(/^image\//);
    expect(response?.headers.get("content-disposition")).toContain("attachment;");
    expect(response?.headers.get("content-disposition")).toContain("-original.");
    expect(await response?.text()).toBe("image-bytes");
    expect(deps.fetchImpl).toHaveBeenCalledWith(
      realEntry.originalUrl,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("serves the optimized WebP source independently", async () => {
    const response = await handlePosterDownload(
      new Request(`https://cineprint.click${posterDownloadHref(realId, "optimized")}`),
      makeDeps(),
    );
    expect(response?.status).toBe(200);
    expect(response?.headers.get("content-type")).toBe("image/webp");
    expect(response?.headers.get("content-disposition")).toContain("-optimized.webp");
  });

  it("returns 404 for unknown posters and unavailable variants", async () => {
    expect(
      (
        await handlePosterDownload(
          new Request(`https://cineprint.click${posterDownloadHref("missing", "original")}`),
          makeDeps(),
        )
      )?.status,
    ).toBe(404);
    expect(
      (
        await handlePosterDownload(
          new Request(`https://cineprint.click${posterDownloadHref(realId, "optimized")}`),
          { ...makeDeps(), loadCatalogue: async () => [poster({ id: realId })] },
        )
      )?.status,
    ).toBe(404);
  });

  it("rejects invalid requests without constructing a source URL", async () => {
    const bad = await handlePosterDownload(
      new Request(
        `https://cineprint.click${POSTER_DOWNLOAD_PATH}?id=${realId}&kind=https://evil.example/x`,
      ),
      makeDeps(),
    );
    expect(bad?.status).toBe(400);
  });
});

describe("UI wiring", () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/Lightbox.tsx"),
    "utf8",
  );

  it("renders only resolver-verified download choices", () => {
    expect(source).toContain("getPosterDownloadSources(poster)");
    expect(source).toContain('source.kind === "original" ? "Original poster" : "Optimized poster"');
    expect(source).toContain('"JPEG/PNG · original quality"');
    expect(source).toContain('"WebP · smaller file"');
    expect(source).toContain("posterDownloadHref(poster!.id, source.kind)");
  });

  it("no longer proxies poster bytes or falls back to a Blob URL", () => {
    expect(source).not.toContain("getBase64Image");
    expect(source).not.toContain("downloadExtension(");
    expect(source).not.toContain("Preparing high-res download");
  });
});
