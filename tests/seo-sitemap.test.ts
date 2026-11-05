import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  STATIC_PATHS,
  SITEMAP_INDEX_FILE,
  SITEMAP_STATIC_FILE,
  SITEMAP_POSTERS_FILE,
  SITEMAP_ARTISTS_FILE,
  SITEMAP_FILMS_FILE,
  SITEMAP_GENRES_FILE,
  SITEMAP_STYLES_FILE,
  SITEMAP_MAX_URLS,
  artistUrlEntries,
  assertSitemapLimits,
  buildRobotsTxt,
  buildSitemapIndexXml,
  buildUrlsetXml,
  collectAllPages,
  escapeXml,
  posterUrlEntries,
  staticUrlEntries,
  toLastmod,
  type RawPosterRow,
} from "../src/lib/sitemap";

/**
 * M5 — dynamic sitemap.
 *
 * Calls the real pure builders in src/lib/sitemap.ts with representative
 * catalogue fixtures (no Firestore) and asserts literal XML and URLs.
 * Pagination is exercised through the real collectAllPages driver with an
 * injected page fetcher. Generated artifacts on disk are verified too.
 */

const ROOT = new URL("../", import.meta.url).pathname;

function row(id: string, data: Record<string, unknown> = {}): RawPosterRow {
  return {
    id,
    data: {
      image: "https://example.com/poster.jpg",
      status: "published",
      ...data,
    },
  };
}

const ROWS: RawPosterRow[] = [
  row("2001-a-space-odyssey", {
    artists: [{ name: "Gábor Gyárfás" }],
    updatedAt: new Date("2026-09-13T15:31:04.676Z"),
  }),
  row("artwork-1812274995", {
    artist: "Eileen Steinbach",
    updatedAt: "2026-09-13T15:31:04.676Z",
  }),
  row("dune-part-two", { artists: [{ name: "Olly Moss" }], image: "" }),
  row("", { artist: "Nobody" }),
  row("bad/id", { artist: "Nobody" }),
  row("2001-a-space-odyssey", { artists: [{ name: "Gábor Gyárfás" }] }),
  row("unknown-artist-print", { artist: "Unknown" }),
  row("no-name-print", { artist: "   " }),
];

describe("static pages", () => {
  it("contains exactly the seven public static paths", () => {
    expect(staticUrlEntries().map((e) => e.loc)).toEqual([
      "https://cineprint.click/",
      "https://cineprint.click/about",
      "https://cineprint.click/artists",
      "https://cineprint.click/genres",
      "https://cineprint.click/styles",
      "https://cineprint.click/submit",
      "https://cineprint.click/constellation",
    ]);
    expect([...STATIC_PATHS]).toEqual([
      "/",
      "/about",
      "/artists",
      "/genres",
      "/styles",
      "/submit",
      "/constellation",
    ]);
  });
});

describe("poster URL derivation", () => {
  it("preserves exact legacy and artwork-* IDs", () => {
    const locs = posterUrlEntries(ROWS).map((e) => e.loc);
    expect(locs).toContain("https://cineprint.click/poster/2001-a-space-odyssey");
    expect(locs).toContain("https://cineprint.click/poster/artwork-1812274995");
  });

  it("excludes missing, malformed, imageless, and duplicate records", () => {
    const locs = posterUrlEntries(ROWS).map((e) => e.loc);
    expect(locs).not.toContain("https://cineprint.click/poster/");
    expect(locs).not.toContain("https://cineprint.click/poster/bad/id");
    expect(locs).not.toContain("https://cineprint.click/poster/dune-part-two");
    expect(locs.filter((l) => l.endsWith("/poster/2001-a-space-odyssey"))).toHaveLength(1);
  });

  it("emits only /poster/ URLs in stable sorted order", () => {
    const locs = posterUrlEntries(ROWS).map((e) => e.loc);
    expect(locs.every((l) => l.startsWith("https://cineprint.click/poster/"))).toBe(true);
    expect([...locs].sort()).toEqual(locs);
  });
});

describe("artist URL derivation", () => {
  it("uses exact slugs from the authoritative helper", () => {
    const locs = artistUrlEntries(ROWS).map((e) => e.loc);
    expect(locs).toContain("https://cineprint.click/artist/eileen-steinbach");
  });

  it("excludes unknown, empty, and duplicate artists", () => {
    const locs = artistUrlEntries(ROWS).map((e) => e.loc);
    expect(locs).not.toContain("https://cineprint.click/artist/unknown");
    expect(locs).toEqual([...new Set(locs)].sort());
  });
});

describe("lastmod policy", () => {
  it("normalizes trustworthy timestamps to YYYY-MM-DD", () => {
    expect(toLastmod(new Date("2026-09-13T15:31:04.676Z"))).toBe("2026-09-13");
    expect(toLastmod("2026-09-13T15:31:04.676Z")).toBe("2026-09-13");
    expect(toLastmod({ toDate: () => new Date("2026-09-13T15:31:04.676Z") })).toBe("2026-09-13");
  });

  it("omits lastmod for missing or untrustworthy values", () => {
    for (const bad of [undefined, null, "", "  ", "not-a-date", NaN, -5, {}, []]) {
      expect(toLastmod(bad)).toBeUndefined();
    }
  });

  it("poster entries carry lastmod only when the source record has one", () => {
    const withDate = posterUrlEntries([row("a", { updatedAt: new Date("2026-09-13T00:00:00Z") })]);
    const withoutDate = posterUrlEntries([row("b", {})]);
    expect(withDate[0].lastmod).toBe("2026-09-13");
    expect(withoutDate[0].lastmod).toBeUndefined();
  });
});

describe("pagination driver", () => {
  const five = [row("a"), row("b"), row("c"), row("d"), row("e")];

  function fakeFetcher(pageSize: number, failOn?: number) {
    let calls = 0;
    return async (cursor: string | null) => {
      calls++;
      if (failOn !== undefined && calls === failOn) throw new Error("backend down");
      const start = cursor === null ? 0 : five.findIndex((r) => r.id === cursor) + 1;
      const slice = five.slice(start, start + pageSize);
      const last = slice[slice.length - 1];
      const rest = five.length - (start + slice.length);
      return {
        rows: slice,
        nextCursor: rest > 0 && last ? last.id : null,
      };
    };
  }

  it("collects every record across page boundaries without skips or duplicates", async () => {
    const all = await collectAllPages(fakeFetcher(2));
    expect(all.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("handles empty catalogues and exact page fits", async () => {
    expect(await collectAllPages(fakeFetcher(10))).toHaveLength(5);
    expect(await collectAllPages(async () => ({ rows: [], nextCursor: null }))).toEqual([]);
  });

  it("rejects instead of resolving a silent partial set on fetch failure", async () => {
    await expect(collectAllPages(fakeFetcher(2, 2))).rejects.toThrow("backend down");
  });
});

describe("XML builders", () => {
  it("escapes XML special characters", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
  });

  it("produces byte-identical output for identical input", () => {
    const entries = posterUrlEntries(ROWS);
    expect(buildUrlsetXml(entries, true)).toBe(buildUrlsetXml(entries, true));
    expect(buildSitemapIndexXml([SITEMAP_POSTERS_FILE])).toBe(
      buildSitemapIndexXml([SITEMAP_POSTERS_FILE]),
    );
  });

  it("emits the golden urlset with namespaces, lastmod, and image entries", () => {
    const xml = buildUrlsetXml(
      [
        {
          loc: "https://cineprint.click/poster/a&b",
          lastmod: "2026-09-13",
          image: "https://example.com/i.png",
        },
        { loc: "https://cineprint.click/about" },
      ],
      true,
    );
    expect(xml).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n` +
        `  <url>\n` +
        `    <loc>https://cineprint.click/poster/a&amp;b</loc>\n` +
        `    <lastmod>2026-09-13</lastmod>\n` +
        `    <image:image>\n` +
        `      <image:loc>https://example.com/i.png</image:loc>\n` +
        `    </image:image>\n` +
        `  </url>\n` +
        `  <url>\n` +
        `    <loc>https://cineprint.click/about</loc>\n` +
        `  </url>\n` +
        `</urlset>\n`,
    );
  });

  it("emits the golden sitemap index referencing each child exactly once", () => {
    expect(buildSitemapIndexXml([SITEMAP_POSTERS_FILE, SITEMAP_STATIC_FILE])).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
        `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
        `  <sitemap>\n` +
        `    <loc>https://cineprint.click/sitemap-posters.xml</loc>\n` +
        `  </sitemap>\n` +
        `  <sitemap>\n` +
        `    <loc>https://cineprint.click/sitemap-static.xml</loc>\n` +
        `  </sitemap>\n` +
        `</sitemapindex>\n`,
    );
  });

  it("emits robots.txt pointing at the canonical index", () => {
    expect(buildRobotsTxt()).toBe(
      `User-agent: *\nAllow: /\n\nSitemap: https://cineprint.click/sitemap.xml\n`,
    );
  });

  it("enforces protocol URL-count and size limits", () => {
    expect(() => assertSitemapLimits(SITEMAP_MAX_URLS, 10)).not.toThrow();
    expect(() => assertSitemapLimits(SITEMAP_MAX_URLS + 1, 10)).toThrow(/URL limit/);
    expect(() => assertSitemapLimits(10, 50_000_001)).toThrow(/size limit/);
  });
});

describe("generated artifacts on disk", () => {
  function read(name: string): string {
    return fs.readFileSync(path.join(ROOT, "public", name), "utf8");
  }

  function locs(xml: string): string[] {
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  }

  it("index references exactly the six generated child files", () => {
    const children = locs(read(SITEMAP_INDEX_FILE));
    expect(children).toEqual([
      `https://cineprint.click/${SITEMAP_ARTISTS_FILE}`,
      `https://cineprint.click/${SITEMAP_FILMS_FILE}`,
      `https://cineprint.click/${SITEMAP_GENRES_FILE}`,
      `https://cineprint.click/${SITEMAP_POSTERS_FILE}`,
      `https://cineprint.click/${SITEMAP_STATIC_FILE}`,
      `https://cineprint.click/${SITEMAP_STYLES_FILE}`,
    ]);
  });

  it("static child holds the four public URLs and no utility routes", () => {
    const paths = locs(read(SITEMAP_STATIC_FILE)).map((l) => new URL(l).pathname);
    expect(paths.sort()).toEqual([
      "/",
      "/about",
      "/artists",
      "/constellation",
      "/genres",
      "/styles",
      "/submit",
    ]);
  });

  it("poster child holds valid /poster/ URLs only", () => {
    const urls = locs(read(SITEMAP_POSTERS_FILE));
    expect(urls.length).toBeGreaterThan(0);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/cineprint\.click\/poster\/[^/]+$/);
    }
  });

  it("artist child holds valid /artist/ URLs only", () => {
    const urls = locs(read(SITEMAP_ARTISTS_FILE));
    expect(urls.length).toBeGreaterThan(0);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/cineprint\.click\/artist\/[a-z0-9-]+$/);
    }
  });

  it("film child holds valid eligible /film/ URLs only", () => {
    const urls = locs(read(SITEMAP_FILMS_FILE));
    expect(urls.length).toBeGreaterThan(0);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      expect(url).toMatch(/^https:\/\/cineprint\.click\/film\/[a-z0-9-]+$/);
    }
  });

  it("genre and style children hold valid eligible URLs only", () => {
    for (const [file, pattern] of [
      [SITEMAP_GENRES_FILE, /^https:\/\/cineprint\.click\/genre\/[a-z0-9-]+$/],
      [SITEMAP_STYLES_FILE, /^https:\/\/cineprint\.click\/style\/[a-z0-9-]+$/],
    ] as const) {
      const urls = locs(read(file));
      expect(urls.length).toBeGreaterThan(0);
      expect(new Set(urls).size).toBe(urls.length);
      for (const url of urls) {
        expect(url).toMatch(pattern);
      }
    }
  });

  it("no generated file references utility or private routes", () => {
    const all = [
      SITEMAP_INDEX_FILE,
      SITEMAP_STATIC_FILE,
      SITEMAP_POSTERS_FILE,
      SITEMAP_ARTISTS_FILE,
      SITEMAP_FILMS_FILE,
      SITEMAP_GENRES_FILE,
      SITEMAP_STYLES_FILE,
    ]
      .map(read)
      .join("\n");
    for (const bad of ["/saved", "/login", "/profile", "/c/"]) {
      expect(all).not.toContain(`${bad}</loc>`);
      expect(all).not.toContain(`${bad}/`);
    }
  });

  it("robots.txt on disk points at the canonical index", () => {
    expect(read("robots.txt")).toBe(buildRobotsTxt());
  });
});
