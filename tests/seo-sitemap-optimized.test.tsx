import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { posterUrlEntries, type RawPosterRow } from "../src/lib/sitemap";
import {
  getPosterImageFallbackUrl,
  getPosterImageUrl,
  getPosterSeoImageUrl,
} from "../src/lib/poster-images";
import { posterHeadMeta, artistHeadMeta } from "../src/lib/seo";
import { posterPageEntities } from "../src/lib/structured-data";
import { PosterImage } from "../src/components/PosterImage";
import { R2_DOWNLOADS_ENABLED } from "../src/lib/r2-image-activation";
import type { Poster } from "../src/lib/posters";
import { R2_IMAGE_MAP } from "../src/lib/r2-image-map.generated";

const BLOB = "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com";
const BLOB_ORIGINAL = `${BLOB}/cineprint/raindrop/1812274995.png`;
const R2_OPTIMIZED = R2_IMAGE_MAP["artwork-1812274995"].optimizedUrl;
const R2_LEGACY_OPTIMIZED = R2_IMAGE_MAP["backrooms-1"].optimizedUrl;
const UNAVAILABLE_URL = "https://cineprint.click/poster-unavailable.svg";
const UNAVAILABLE_IDS = ["stranger-things-2", "the-substance-2"];

function poster(overrides: Partial<Poster> = {}): Poster {
  return {
    id: "artwork-1812274995",
    title: "Test Film",
    year: 2024,
    artist: "Test Artist",
    source: "Test Source",
    sourceUrl: "",
    image: BLOB_ORIGINAL,
    style: "Minimalist",
    genre: ["Drama"],
    tags: [],
    ...overrides,
  } as Poster;
}

function row(id: string, image: string): RawPosterRow {
  return { id, data: { image, status: "published" } };
}

function metaContent(head: ReturnType<typeof posterHeadMeta>, key: string): string | undefined {
  return head.meta.find((tag) => tag.property === key || tag.name === key)?.content;
}

describe("sitemap optimized image URLs", () => {
  it("uses the R2 optimized URL for artwork records", () => {
    const entries = posterUrlEntries([row("artwork-1812274995", BLOB_ORIGINAL)]);
    expect(entries[0].image).toBe(R2_OPTIMIZED);
    expect(entries[0].image).toBe(getPosterSeoImageUrl(poster()));
  });

  it("uses the R2 optimized URL for legacy records", () => {
    const original = `${BLOB}/cineprint/raindrop/1779301125.png`;
    const entries = posterUrlEntries([row("backrooms-1", original)]);
    expect(entries[0].image).toBe(R2_LEGACY_OPTIMIZED);
  });

  it("falls back to the original for external images without a verified mapping", () => {
    const external = "https://pbs.twimg.com/media/example.jpg";
    const entries = posterUrlEntries([row("her", external)]);
    expect(entries[0].image).toBe(external);
  });

  it("keeps poster head, Twitter and JSON-LD image URLs consistent with the sitemap", () => {
    const p = poster();
    const entries = posterUrlEntries([row(p.id, p.image)]);
    const head = posterHeadMeta(p);
    expect(metaContent(head, "og:image")).toBe(entries[0].image);
    expect(metaContent(head, "twitter:image")).toBe(entries[0].image);
    const jsonLd = JSON.stringify(posterPageEntities(p, null));
    expect(jsonLd).toContain(entries[0].image!);
    expect(jsonLd).not.toContain("public.blob.vercel-storage.com");
  });

  it("keeps artist head images consistent with poster SEO images", () => {
    const p = poster();
    const head = artistHeadMeta([p], "test-artist");
    expect(metaContent(head, "og:image")).toBe(getPosterSeoImageUrl(p));
    expect(metaContent(head, "twitter:image")).toBe(getPosterSeoImageUrl(p));
  });

  it("uses R2 for SEO and browser on a mapped canary poster", () => {
    const p = poster({
      id: "artwork-1824607248",
      image: `${BLOB}/cineprint/raindrop/1824607248.jpg`,
    });
    const expected = R2_IMAGE_MAP["artwork-1824607248"].optimizedUrl;

    expect(getPosterSeoImageUrl(p)).toBe(expected);
    expect(getPosterImageUrl(p, "detail")).toBe(expected);

    const entries = posterUrlEntries([row(p.id, p.image)]);
    expect(entries[0].image).toBe(expected);

    const head = posterHeadMeta(p);
    expect(metaContent(head, "og:image")).toBe(expected);
    expect(metaContent(head, "twitter:image")).toBe(expected);

    const jsonLd = JSON.stringify(posterPageEntities(p, null));
    expect(jsonLd).toContain(expected);
    expect(jsonLd).not.toContain("public.blob.vercel-storage.com");

    const html = renderToStaticMarkup(<PosterImage poster={p} purpose="gallery" alt="t" />);
    expect(html).toContain(`src="${expected}"`);
  });

  it("uses the local placeholder for unavailable poster SEO and sitemap", () => {
    for (const id of UNAVAILABLE_IDS) {
      const p = poster({ id, image: `${BLOB}/cineprint/external/${id}.jpg` });
      expect(getPosterSeoImageUrl(p)).toBe(UNAVAILABLE_URL);

      const entries = posterUrlEntries([row(p.id, p.image)]);
      expect(entries[0].image).toBe(UNAVAILABLE_URL);

      const head = posterHeadMeta(p);
      expect(metaContent(head, "og:image")).toBe(UNAVAILABLE_URL);
      expect(metaContent(head, "twitter:image")).toBe(UNAVAILABLE_URL);

      const jsonLd = JSON.stringify(posterPageEntities(p, null));
      expect(jsonLd).toContain(UNAVAILABLE_URL);
      expect(jsonLd).not.toContain("public.blob.vercel-storage.com");
    }
  });

  it("covers all 63 catalogue identities with 61 R2 images and 2 placeholders", () => {
    const mappedIds = Object.keys(R2_IMAGE_MAP);
    const rows = [
      ...mappedIds.map((id) => row(id, R2_IMAGE_MAP[id].blobImageUrl)),
      ...UNAVAILABLE_IDS.map((id) => row(id, `${BLOB}/cineprint/external/${id}.jpg`)),
    ];
    const entries = posterUrlEntries(rows);
    expect(entries).toHaveLength(63);
    expect(new Set(entries.map((entry) => entry.loc)).size).toBe(63);

    const r2Entries = entries.filter((entry) => entry.image?.includes("images.cineprint.click"));
    const placeholderEntries = entries.filter((entry) => entry.image === UNAVAILABLE_URL);
    expect(r2Entries).toHaveLength(61);
    expect(placeholderEntries).toHaveLength(2);
    expect(entries.every((entry) => entry.image?.startsWith("https://"))).toBe(true);
    expect(entries.some((entry) => entry.image?.includes("public.blob.vercel-storage.com"))).toBe(
      false,
    );
    expect(entries.some((entry) => entry.image?.includes("localhost"))).toBe(false);
    expect(entries.some((entry) => entry.image?.includes("vercel.app"))).toBe(false);

    for (const id of mappedIds) {
      const p = poster({
        id,
        title: id,
        image: R2_IMAGE_MAP[id].blobImageUrl,
      });
      const head = posterHeadMeta(p);
      expect(metaContent(head, "og:image")).toBe(R2_IMAGE_MAP[id].optimizedUrl);
      expect(metaContent(head, "twitter:image")).toBe(R2_IMAGE_MAP[id].optimizedUrl);
    }

    for (const id of UNAVAILABLE_IDS) {
      const p = poster({ id, title: id, image: `${BLOB}/cineprint/external/${id}.jpg` });
      expect(metaContent(posterHeadMeta(p), "og:image")).toBe(UNAVAILABLE_URL);
      expect(metaContent(posterHeadMeta(p), "twitter:image")).toBe(UNAVAILABLE_URL);
    }
  });
});

describe("poster image fallback contract", () => {
  it("renders the R2 optimized URL as the initial SSR src", () => {
    const html = renderToStaticMarkup(<PosterImage poster={poster()} purpose="gallery" alt="t" />);
    expect(html).toContain(`src="${R2_OPTIMIZED}"`);
  });

  it("has exactly one fallback candidate for Blob posters", () => {
    const p = poster();
    expect(getPosterImageUrl(p, "gallery")).toBe(R2_OPTIMIZED);
    expect(getPosterImageFallbackUrl(p)).toBe(BLOB_ORIGINAL);
  });

  it("has no second request candidate for external posters", () => {
    const p = poster({ image: "https://pbs.twimg.com/media/example.jpg" });
    expect(getPosterImageUrl(p, "gallery")).toBe(getPosterImageFallbackUrl(p));
  });

  it("keeps download delivery disabled", () => {
    expect(R2_DOWNLOADS_ENABLED).toBe(false);
    expect(getPosterImageUrl(poster(), "download")).toBe(BLOB_ORIGINAL);
  });
});
