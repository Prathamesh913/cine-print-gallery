import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ROBOTS_NOINDEX_FOLLOW,
  getRobotsContents,
  hasNoindex,
  loadPosterRoute,
  posterHeadMeta,
  utilityHeadMeta,
} from "../src/lib/seo";
import type { Poster } from "../src/lib/posters";

/**
 * M0 — SEO regression guardrails (M1 scope: soft-404s, utility-page
 * indexing, sitemap exclusions).
 *
 * Layering (matches the repo's core/handler precedent):
 * - `src/lib/seo.ts` holds the real decision logic the routes call
 *   (poster resolution, head meta builders). These tests exercise that
 *   logic directly — no Start server runtime needed.
 * - Route wiring (one-line delegation in each route file) plus real HTTP
 *   status codes are verified independently against the running app
 *   (see validation notes): production/dev server + curl.
 * - Sitemap tests parse the real generator source-of-truth and the real
 *   generated artifact — never string-existence stubs.
 */

const ROOT = new URL("../", import.meta.url).pathname;

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
  fixturePoster({ id: "dune-part-two", title: "Dune: Part Two", slug: "dune-part-two" }),
  fixturePoster({
    id: "blade-runner-2049",
    title: "Blade Runner 2049",
    artist: "Kil Osc",
    artists: [{ name: "Kil Osc" }],
    slug: "blade-runner-2049",
  }),
];

describe("A. valid poster", () => {
  it("an existing poster id resolves to ok with that poster (URL/id unchanged)", async () => {
    const result = await loadPosterRoute(async () => POSTERS, "dune-part-two");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.poster.id).toBe("dune-part-two");
    expect(result.poster.title).toBe("Dune: Part Two");
    expect(result.posters).toEqual(POSTERS);
  });

  it("a valid poster page is indexable: no robots tag, no noindex", () => {
    const head = posterHeadMeta(POSTERS[0]);
    expect(getRobotsContents(head.meta)).toEqual([]);
    expect(hasNoindex(head.meta)).toBe(false);
  });

  it("a valid poster keeps its existing title convention", () => {
    const head = posterHeadMeta(POSTERS[1]);
    const title = head.meta.find((tag) => typeof tag.title === "string")?.title ?? "";
    expect(title).toContain("Blade Runner 2049");
    expect(title).toContain("CinePrint");
  });
});

describe("B. invalid poster (soft-404)", () => {
  it("a nonexistent poster id resolves to not-found", async () => {
    const result = await loadPosterRoute(async () => POSTERS, "does-not-exist-123");
    expect(result.status).toBe("not-found");
  });

  it("a not-found result never leaks another poster's content", async () => {
    const result = await loadPosterRoute(async () => POSTERS, "does-not-exist-123");
    expect(result).toEqual({ status: "not-found" });
  });

  it("an empty catalogue resolves to not-found (not to a poster)", async () => {
    const result = await loadPosterRoute(async () => [], "dune-part-two");
    expect(result.status).toBe("not-found");
  });

  it("a catalogue load failure rejects instead of resolving not-found (failure != 404)", async () => {
    const failure = new Error("Firestore unavailable");
    await expect(
      loadPosterRoute(async () => Promise.reject(failure), "dune-part-two"),
    ).rejects.toBe(failure);
  });

  it("the not-found head carries noindex and a not-found title", () => {
    const head = posterHeadMeta(null);
    expect(hasNoindex(head.meta)).toBe(true);
    expect(getRobotsContents(head.meta)).toHaveLength(1);
    const title = head.meta.find((tag) => typeof tag.title === "string")?.title ?? "";
    expect(title).toMatch(/not found/i);
  });
});

describe("C. utility routes carry noindex,follow", () => {
  const cases = [
    { route: "/saved", title: "Saved — CinePrint" },
    { route: "/login", title: "Sign In — CinePrint" },
    { route: "/profile", title: "Profile — CinePrint" },
  ];

  for (const { route, title } of cases) {
    it(`${route} head has exactly one robots tag: "${ROBOTS_NOINDEX_FOLLOW}"`, () => {
      const head = utilityHeadMeta(title, "Some description.");
      expect(getRobotsContents(head.meta)).toEqual([ROBOTS_NOINDEX_FOLLOW]);
      expect(hasNoindex(head.meta)).toBe(true);
    });

    it(`${route} head preserves its title and description`, () => {
      const head = utilityHeadMeta(title, "Some description.");
      expect(head.meta.find((tag) => typeof tag.title === "string")?.title).toBe(title);
      expect(head.meta.find((tag) => tag.name === "description")?.content).toBe(
        "Some description.",
      );
    });
  }
});

describe("D. sitemap (M5 index architecture)", () => {
  const EXPECTED_STATIC = [
    "/",
    "/about",
    "/artists",
    "/genres",
    "/styles",
    "/submit",
    "/constellation",
  ];

  function readArtifact(name: string): string {
    return fs.readFileSync(path.join(ROOT, "public", name), "utf8");
  }

  function staticPaths(): string[] {
    const locs = [...readArtifact("sitemap-static.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );
    return locs.map((loc) => new URL(loc).pathname);
  }

  it("the sitemap index references the generated child files", () => {
    const children = [...readArtifact("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );
    expect(children).toEqual([
      "https://cineprint.click/sitemap-artists.xml",
      "https://cineprint.click/sitemap-films.xml",
      "https://cineprint.click/sitemap-genres.xml",
      "https://cineprint.click/sitemap-posters.xml",
      "https://cineprint.click/sitemap-static.xml",
      "https://cineprint.click/sitemap-styles.xml",
    ]);
  });

  it("the static child contains the valid indexable static URLs", () => {
    expect(staticPaths().sort()).toEqual([...EXPECTED_STATIC].sort());
  });

  it("utility routes do not appear in any generated sitemap file", () => {
    const all = [
      "sitemap.xml",
      "sitemap-static.xml",
      "sitemap-posters.xml",
      "sitemap-artists.xml",
      "sitemap-films.xml",
      "sitemap-genres.xml",
      "sitemap-styles.xml",
    ]
      .map(readArtifact)
      .join("\n");
    for (const excluded of ["/saved", "/login", "/profile"]) {
      expect(all).not.toContain(`${excluded}</loc>`);
    }
  });

  it("dynamic children hold canonical poster, artist, film, genre, and style URLs", () => {
    const posters = [...readArtifact("sitemap-posters.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );
    expect(posters.length).toBeGreaterThan(0);
    for (const loc of posters) {
      expect(loc).toMatch(/^https:\/\/cineprint\.click\/poster\/[^/]+$/);
    }
    const artists = [...readArtifact("sitemap-artists.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );
    expect(artists.length).toBeGreaterThan(0);
    for (const loc of artists) {
      expect(loc).toMatch(/^https:\/\/cineprint\.click\/artist\/[a-z0-9-]+$/);
    }
    const films = [...readArtifact("sitemap-films.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (match) => match[1],
    );
    expect(films.length).toBeGreaterThan(0);
    expect(new Set(films).size).toBe(films.length);
    for (const loc of films) {
      expect(loc).toMatch(/^https:\/\/cineprint\.click\/film\/[a-z0-9-]+$/);
    }
    for (const [file, pattern] of [
      ["sitemap-genres.xml", /^https:\/\/cineprint\.click\/genre\/[a-z0-9-]+$/],
      ["sitemap-styles.xml", /^https:\/\/cineprint\.click\/style\/[a-z0-9-]+$/],
    ] as const) {
      const urls = [...readArtifact(file).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
        (match) => match[1],
      );
      expect(urls.length).toBeGreaterThan(0);
      expect(new Set(urls).size).toBe(urls.length);
      for (const loc of urls) {
        expect(loc).toMatch(pattern);
      }
    }
  });

  it("generated XML files are well-formed with balanced url entries", () => {
    for (const name of [
      "sitemap-static.xml",
      "sitemap-posters.xml",
      "sitemap-artists.xml",
      "sitemap-films.xml",
      "sitemap-genres.xml",
      "sitemap-styles.xml",
    ]) {
      const xml = readArtifact(name);
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
      expect(xml.trimEnd().endsWith("</urlset>")).toBe(true);
      const opens = (xml.match(/<url>/g) ?? []).length;
      expect(opens).toBeGreaterThan(0);
      expect(opens).toBe((xml.match(/<\/url>/g) ?? []).length);
    }
  });
});

describe("submit stays indexable (acquisition page, decided for a later milestone)", () => {
  it("the /submit route file contains no robots/noindex head entry", () => {
    const source = fs.readFileSync(path.join(ROOT, "src/routes/submit.tsx"), "utf8");
    const headBlock = source.match(/head:\s*\(\)\s*=>\s*([\s\S]*?),\n\s*component:/);
    expect(headBlock, "submit.tsx must define a head option").not.toBeNull();
    expect(headBlock![1]).not.toMatch(/robots|noindex/i);
  });

  it("the static sitemap keeps /submit indexable", () => {
    const xml = fs.readFileSync(path.join(ROOT, "public/sitemap-static.xml"), "utf8");
    expect(xml).toContain("<loc>https://cineprint.click/submit</loc>");
  });
});
