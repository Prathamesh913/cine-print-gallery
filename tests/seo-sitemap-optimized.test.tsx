import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { posterUrlEntries, type RawPosterRow } from "../src/lib/sitemap";
import { getPosterImageFallbackUrl, getPosterImageUrl } from "../src/lib/poster-images";
import { posterHeadMeta, artistHeadMeta } from "../src/lib/seo";
import { posterPageEntities } from "../src/lib/structured-data";
import { PosterImage } from "../src/components/PosterImage";
import type { Poster } from "../src/lib/posters";

const BLOB = "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com";
const OPTIMIZED = `${BLOB}/cineprint/optimized/1812274995.webp`;
const ORIGINAL = `${BLOB}/cineprint/raindrop/1812274995.png`;

function poster(overrides: Partial<Poster> = {}): Poster {
  return {
    id: "artwork-1812274995",
    title: "Test Film",
    year: 2024,
    artist: "Test Artist",
    source: "Test Source",
    sourceUrl: "",
    image: ORIGINAL,
    style: "Minimalist",
    genre: ["Drama"],
    tags: [],
    ...overrides,
  } as Poster;
}

function row(id: string, image: string): RawPosterRow {
  return { id, data: { image, status: "published" } };
}

describe("sitemap optimized image URLs", () => {
  it("uses the same optimized URL as the poster page for artwork records", () => {
    const entries = posterUrlEntries([row("artwork-1812274995", ORIGINAL)]);
    expect(entries[0].image).toBe(OPTIMIZED);
    expect(entries[0].image).toBe(getPosterImageUrl(poster(), "detail"));
  });

  it("uses legacy optimized paths for legacy records", () => {
    const original = `${BLOB}/cineprint/raindrop/1779301125.png`;
    const entries = posterUrlEntries([row("backrooms-1", original)]);
    expect(entries[0].image).toBe(`${BLOB}/cineprint/optimized/legacy/backrooms-1.webp`);
  });

  it("falls back to the original for external images without an optimized variant", () => {
    const external = "https://pbs.twimg.com/media/example.jpg";
    const entries = posterUrlEntries([row("her", external)]);
    expect(entries[0].image).toBe(external);
  });

  it("keeps poster head and JSON-LD image URLs consistent with the sitemap", () => {
    const p = poster();
    const entries = posterUrlEntries([row(p.id, p.image)]);
    const head = posterHeadMeta(p);
    const og = head.meta.find((t) => t.property === "og:image")?.content;
    expect(og).toBe(entries[0].image);
    const entities = posterPageEntities(p, null);
    const jsonLd = JSON.stringify(entities);
    expect(jsonLd).toContain(entries[0].image!);
  });

  it("keeps artist head images consistent with poster detail images", () => {
    const p = poster();
    const head = artistHeadMeta([p], "test-artist");
    expect(head.meta.find((t) => t.property === "og:image")?.content).toBe(
      getPosterImageUrl(p, "detail"),
    );
  });
});

describe("poster image fallback contract", () => {
  it("renders the optimized URL as the initial SSR src", () => {
    const html = renderToStaticMarkup(<PosterImage poster={poster()} purpose="gallery" alt="t" />);
    expect(html).toContain(`src="${OPTIMIZED}"`);
  });

  it("has exactly one fallback candidate for Blob posters", () => {
    const p = poster();
    expect(getPosterImageUrl(p, "gallery")).not.toBe(getPosterImageFallbackUrl(p));
    expect(getPosterImageFallbackUrl(p)).toBe(ORIGINAL);
  });

  it("has no second request candidate for external posters", () => {
    const p = poster({ image: "https://pbs.twimg.com/media/example.jpg" });
    expect(getPosterImageUrl(p, "gallery")).toBe(getPosterImageFallbackUrl(p));
  });
});
