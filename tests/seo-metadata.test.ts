import { describe, it, expect } from "vitest";
import {
  SITE_DEFAULT_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
  SITE_TITLE,
  artistHeadMeta,
  canonicalUrl,
  pageHead,
  posterHeadMeta,
  utilityHeadMeta,
} from "../src/lib/seo";
import type { Poster } from "../src/lib/posters";

/**
 * M2 — metadata completeness.
 *
 * Calls the real head builders in `src/lib/seo.ts` (the exact objects route
 * `head()` options return to TanStack Start) with representative fixtures and
 * asserts literal tag values. Route wiring (which route calls which builder)
 * is verified over HTTP against the running app, where the real framework
 * path renders the tags into SSR HTML.
 */

function fixturePoster(overrides: Partial<Poster> & { id: string }): Poster {
  return {
    title: "Dune",
    year: 2021,
    artists: [{ name: "Olly Moss" }],
    artist: "Olly Moss",
    artistUrl: undefined,
    source: "Test",
    sourceUrl: "",
    image: "https://example.com/dune.jpg",
    style: "Minimalist",
    genre: ["Sci-Fi"],
    tags: [],
    note: undefined,
    mediaType: "movie",
    tmdbId: undefined,
    imdbId: undefined,
    seasonNumber: undefined,
    collectionName: undefined,
    posterImageUrl: undefined,
    backgroundUrl: undefined,
    libraryNames: undefined,
    slug: "dune",
    ...overrides,
  } as Poster;
}

const POSTERS = [
  fixturePoster({ id: "dune-part-two", title: "Dune: Part Two" }),
  fixturePoster({
    id: "blade-runner-2049",
    title: "Blade Runner 2049",
    artist: "Kil Osc",
    artists: [{ name: "Kil Osc" }],
    slug: "blade-runner-2049",
  }),
];

function metaValue(
  meta: { name?: string; property?: string; title?: string; content?: string }[],
  key: string,
): string | undefined {
  const tag = meta.find((t) => t.name === key || t.property === key);
  return tag?.content;
}

function duplicateKeys(meta: { name?: string; property?: string; title?: string }[]): string[] {
  const seen = new Map<string, number>();
  for (const tag of meta) {
    const key = tag.title !== undefined ? "title" : (tag.name ?? tag.property ?? "?");
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

describe("canonical policy", () => {
  it("canonical URLs are absolute HTTPS apex URLs without query strings", () => {
    expect(canonicalUrl("/about")).toBe("https://cineprint.click/about");
    expect(canonicalUrl("/poster/dune-part-two")).toBe(
      "https://cineprint.click/poster/dune-part-two",
    );
    for (const path of ["/", "/about", "/submit", "/constellation"]) {
      const url = canonicalUrl(path);
      expect(url.startsWith(`${SITE_ORIGIN}/`) || url === `${SITE_ORIGIN}/`).toBe(true);
      expect(url).not.toContain("?");
      expect(url).not.toContain("www.");
    }
  });

  it("site constants match the production brand", () => {
    expect(SITE_ORIGIN).toBe("https://cineprint.click");
    expect(SITE_NAME).toBe("CinePrint");
    expect(SITE_TITLE).toBe("CinePrint — Curated Alternative Movie & TV Posters Gallery");
    expect(SITE_DESCRIPTION).toContain("alternative movie posters");
    expect(SITE_DEFAULT_IMAGE).toBe("https://cineprint.click/og-image.png");
  });
});

describe("pageHead completeness", () => {
  const head = pageHead({
    path: "/about",
    title: "About CinePrint — Curated Alternative Film & TV Art Gallery",
    description: "About-page description.",
    image: SITE_DEFAULT_IMAGE,
  });

  it("emits a single self-referencing canonical link", () => {
    expect(head.links).toEqual([{ rel: "canonical", href: "https://cineprint.click/about" }]);
  });

  it("og:url matches the canonical URL", () => {
    expect(metaValue(head.meta, "og:url")).toBe("https://cineprint.click/about");
  });

  it("emits complete Open Graph tags", () => {
    expect(metaValue(head.meta, "og:title")).toBe(
      "About CinePrint — Curated Alternative Film & TV Art Gallery",
    );
    expect(metaValue(head.meta, "og:description")).toBe("About-page description.");
    expect(metaValue(head.meta, "og:type")).toBe("website");
    expect(metaValue(head.meta, "og:site_name")).toBe("CinePrint");
    expect(metaValue(head.meta, "og:image")).toBe(SITE_DEFAULT_IMAGE);
  });

  it("emits a large-image Twitter card when an image exists", () => {
    expect(metaValue(head.meta, "twitter:card")).toBe("summary_large_image");
    expect(metaValue(head.meta, "twitter:title")).toBe(
      "About CinePrint — Curated Alternative Film & TV Art Gallery",
    );
    expect(metaValue(head.meta, "twitter:description")).toBe("About-page description.");
    expect(metaValue(head.meta, "twitter:image")).toBe(SITE_DEFAULT_IMAGE);
  });

  it("falls back to a summary card with no image tags when no image exists", () => {
    const imageless = pageHead({ path: "/x", title: "T", description: "D" });
    expect(metaValue(imageless.meta, "twitter:card")).toBe("summary");
    expect(metaValue(imageless.meta, "og:image")).toBeUndefined();
    expect(metaValue(imageless.meta, "twitter:image")).toBeUndefined();
  });

  it("treats empty or blank images as missing", () => {
    for (const image of ["", "   ", null, undefined]) {
      const head = pageHead({ path: "/x", title: "T", description: "D", image });
      expect(metaValue(head.meta, "og:image")).toBeUndefined();
      expect(metaValue(head.meta, "twitter:image")).toBeUndefined();
    }
  });

  it("never emits robots directives and never duplicates tags", () => {
    expect(head.meta.some((t) => t.name === "robots")).toBe(false);
    expect(duplicateKeys(head.meta)).toEqual([]);
  });
});

describe("dynamic poster metadata", () => {
  it("valid poster canonical uses the actual poster ID", () => {
    const head = posterHeadMeta(POSTERS[0]);
    expect(head.links).toEqual([
      { rel: "canonical", href: "https://cineprint.click/poster/dune-part-two" },
    ]);
    expect(metaValue(head.meta, "og:url")).toBe("https://cineprint.click/poster/dune-part-two");
  });

  it("valid poster metadata is page-specific (no placeholder copy)", () => {
    const head = posterHeadMeta(POSTERS[1]);
    expect(metaValue(head.meta, "og:title")).toContain("Blade Runner 2049");
    const title = head.meta.find((t) => t.title !== undefined)?.title ?? "";
    expect(title).toContain("Kil Osc");
    expect(metaValue(head.meta, "og:site_name")).toBe("CinePrint");
  });

  it("valid poster keeps a single tag per key and stays indexable", () => {
    const head = posterHeadMeta(POSTERS[0]);
    expect(duplicateKeys(head.meta)).toEqual([]);
    expect(head.meta.some((t) => t.name === "robots")).toBe(false);
  });

  it("invalid poster stays noindex with no canonical and no social tags", () => {
    const head = posterHeadMeta(null);
    expect(head.meta.some((t) => t.name === "robots" && t.content === "noindex")).toBe(true);
    expect(head.links ?? []).toEqual([]);
    expect(head.meta.some((t) => (t.property ?? "").startsWith("og:"))).toBe(false);
    expect(head.meta.some((t) => (t.name ?? "").startsWith("twitter:"))).toBe(false);
  });
});

describe("dynamic artist metadata", () => {
  it("valid artist canonical uses the actual artist slug", () => {
    const head = artistHeadMeta(POSTERS, "kil-osc");
    expect(head.links).toEqual([
      { rel: "canonical", href: "https://cineprint.click/artist/kil-osc" },
    ]);
    expect(metaValue(head.meta, "og:url")).toBe("https://cineprint.click/artist/kil-osc");
  });

  it("valid artist metadata names the artist and uses their artwork", () => {
    const head = artistHeadMeta(POSTERS, "olly-moss");
    const title = head.meta.find((t) => t.title !== undefined)?.title ?? "";
    expect(title).toContain("Olly Moss");
    expect(metaValue(head.meta, "og:image")).toContain("example.com");
    expect(metaValue(head.meta, "twitter:card")).toBe("summary_large_image");
  });

  it("unknown artist falls back to the site image without inventing a name", () => {
    const head = artistHeadMeta(POSTERS, "nobody-here");
    const title = head.meta.find((t) => t.title !== undefined)?.title ?? "";
    expect(title).toContain("Artist");
    expect(metaValue(head.meta, "og:image")).toBe(SITE_DEFAULT_IMAGE);
    expect(head.meta.some((t) => t.name === "robots")).toBe(false);
  });
});

describe("indexing directives preserved (M0/M1)", () => {
  it("utility heads carry noindex,follow and no canonical", () => {
    for (const title of ["Saved — CinePrint", "Sign In — CinePrint", "Profile — CinePrint"]) {
      const head = utilityHeadMeta(title, "Desc.");
      expect(head.meta.some((t) => t.name === "robots" && t.content === "noindex, follow")).toBe(
        true,
      );
      expect(head.links ?? []).toEqual([]);
    }
  });
});
