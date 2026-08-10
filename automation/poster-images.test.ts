import { describe, expect, it } from "vitest";
import { getOptimizedPosterImageUrl, getPosterImageUrl } from "../src/lib/poster-images";
import type { Poster } from "../src/lib/posters";

function poster(overrides: Partial<Poster> = {}): Poster {
  return {
    id: "backrooms-1",
    title: "Backrooms",
    year: 2022,
    artist: "Artist",
    source: "Source",
    sourceUrl: "https://example.com/source",
    image:
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1779301125.png",
    style: "Minimalist",
    genre: [],
    tags: [],
    ...overrides,
  };
}

describe("poster image resolution", () => {
  it("resolves legacy posters to optimized/legacy paths", () => {
    expect(getOptimizedPosterImageUrl(poster())).toBe(
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/legacy/backrooms-1.webp",
    );
  });

  it("resolves automated posters to Raindrop-ID optimized paths", () => {
    expect(
      getOptimizedPosterImageUrl(
        poster({
          id: "artwork-1812274995",
          image:
            "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1812274995.png",
        }),
      ),
    ).toBe(
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/1812274995.webp",
    );
  });

  it("falls back to the original for external images", () => {
    const external = poster({ image: "https://pbs.twimg.com/media/example.jpg" });
    expect(getOptimizedPosterImageUrl(external)).toBeNull();
    expect(getPosterImageUrl(external, "gallery")).toBe(external.image);
  });

  it("keeps original and download purposes on the original URL", () => {
    const value = poster();
    expect(getPosterImageUrl(value, "original")).toBe(value.image);
    expect(getPosterImageUrl(value, "download")).toBe(value.image);
  });
});
