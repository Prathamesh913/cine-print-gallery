import { describe, it, expect, beforeAll, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  RouterProvider,
  createRouter,
} from "@tanstack/react-router";
import {
  buildArtistDirectory,
  filterArtists,
  findAmbiguousSlugs,
  resolveArtistEntry,
  type ArtistPosterInput,
} from "../src/lib/artists";
import { pageHead, resolveArtist } from "../src/lib/seo";
import { breadcrumbEntity, webpageEntity, withJsonLd } from "../src/lib/structured-data";
import { ArtistsDirectory } from "../src/routes/-components/artists-directory";
import type { Poster } from "../src/lib/posters";

/**
 * M8 — artist directory data.
 * Pure grouping, eligibility, and search over representative fixtures.
 * No Firestore, no router.
 */

function input(overrides: Partial<ArtistPosterInput> & { id: string }): ArtistPosterInput {
  return {
    title: "Dune",
    image: "https://example.com/dune.jpg",
    ...overrides,
  };
}

const OLLY_1 = input({ id: "p-1", artists: [{ name: "Olly Moss" }] });
const OLLY_2 = input({ id: "p-2", artists: [{ name: "Olly Moss" }] });
const KIL = input({ id: "p-3", artist: "Kil Osc" });

describe("grouping", () => {
  it("groups posters under the correct artist with accurate counts", () => {
    const entries = buildArtistDirectory([OLLY_1, OLLY_2, KIL]);
    const olly = entries.find((e) => e.slug === "olly-moss");
    expect(olly?.name).toBe("Olly Moss");
    expect(olly?.posterIds).toEqual(["p-1", "p-2"]);
    expect(olly?.posters).toHaveLength(2);
    expect(entries.find((e) => e.slug === "kil-osc")?.posterIds).toEqual(["p-3"]);
  });

  it("attributes multi-artist posters to every credited artist", () => {
    const joint = input({ id: "p-9", artists: [{ name: "Olly Moss" }, { name: "Kil Osc" }] });
    const entries = buildArtistDirectory([joint]);
    expect(entries.map((e) => e.slug).sort()).toEqual(["kil-osc", "olly-moss"]);
  });

  it("supports the legacy flat artist field", () => {
    const entries = buildArtistDirectory([input({ id: "p-9", artist: "Solo Act" })]);
    expect(entries).toHaveLength(1);
    expect(entries[0].slug).toBe("solo-act");
  });

  it("deduplicates poster ids instead of inflating counts", () => {
    const dupes = [OLLY_1, OLLY_1, OLLY_2, { ...OLLY_2 }];
    expect(buildArtistDirectory(dupes).find((e) => e.slug === "olly-moss")?.posterIds).toEqual([
      "p-1",
      "p-2",
    ]);
  });

  it("excludes records without usable artwork", () => {
    const entries = buildArtistDirectory([
      { id: "no-img", artists: [{ name: "Ghost" }] },
      { id: "blank-img", artists: [{ name: "Ghost" }], image: "  " },
    ]);
    expect(entries).toEqual([]);
  });

  it("excludes unknown and empty artist names", () => {
    const entries = buildArtistDirectory([
      input({ id: "u-1", artist: "Unknown" }),
      input({ id: "u-2", artist: "   " }),
      input({ id: "u-3", artists: [{ name: "???" }] }),
    ]);
    expect(entries).toEqual([]);
  });

  it("returns an empty directory for an empty catalogue", () => {
    expect(buildArtistDirectory([])).toEqual([]);
  });

  it("is deterministic regardless of input order", () => {
    const a = buildArtistDirectory([OLLY_1, OLLY_2, KIL]);
    const b = buildArtistDirectory([KIL, OLLY_2, OLLY_1]);
    expect(a).toEqual(b);
  });

  it("selects the deterministic representative preview", () => {
    const entries = buildArtistDirectory([OLLY_2, OLLY_1]);
    expect(entries[0].representative.id).toBe("p-1");
  });

  it("keeps existing artist slugs unchanged", () => {
    const entries = buildArtistDirectory([
      input({ id: "b-1", artists: [{ name: "Butcher Billy" }] }),
      input({ id: "e-1", artists: [{ name: "Eileen Steinbach" }] }),
    ]);
    expect(entries.map((e) => e.slug).sort()).toEqual(["butcher-billy", "eileen-steinbach"]);
  });
});

describe("ambiguity", () => {
  it("excludes slug groups with distinct names instead of merging them", () => {
    const entries = buildArtistDirectory([
      input({ id: "m-1", artist: "Mary-Kate" }),
      input({ id: "m-2", artist: "Mary Kate" }),
      OLLY_1,
    ]);
    expect(entries.map((e) => e.slug)).toEqual(["olly-moss"]);
  });

  it("reports ambiguous slugs with their colliding names", () => {
    expect(
      findAmbiguousSlugs([
        input({ id: "m-1", artist: "Mary-Kate" }),
        input({ id: "m-2", artist: "Mary Kate" }),
        input({ id: "a-1", artist: "A. Smith" }),
        input({ id: "a-2", artist: "A Smith" }),
      ]),
    ).toEqual([
      { slug: "a-smith", names: ["a smith", "a. smith"] },
      { slug: "mary-kate", names: ["mary kate", "mary-kate"] },
    ]);
  });

  it("treats case and whitespace variants as the same artist", () => {
    const entries = buildArtistDirectory([
      input({ id: "c-1", artist: "OLLY MOSS" }),
      input({ id: "c-2", artist: "  Olly Moss " }),
    ]);
    expect(entries).toHaveLength(1);
    expect(entries[0].posterIds).toEqual(["c-1", "c-2"]);
    expect(findAmbiguousSlugs([input({ id: "c-1", artist: "OLLY MOSS" })])).toEqual([]);
  });
});

describe("resolution and search", () => {
  const entries = () => buildArtistDirectory([OLLY_1, OLLY_2, KIL]);

  it("resolves listed slugs and misses unlisted ones", () => {
    expect(resolveArtistEntry([OLLY_1, OLLY_2], "olly-moss")?.name).toBe("Olly Moss");
    expect(resolveArtistEntry([OLLY_1], "kil-osc")).toBeNull();
  });

  it("filters by name substring case-insensitively", () => {
    expect(filterArtists(entries(), "olly").map((e) => e.slug)).toEqual(["olly-moss"]);
    expect(filterArtists(entries(), "KIL").map((e) => e.slug)).toEqual(["kil-osc"]);
    expect(filterArtists(entries(), "zzz")).toEqual([]);
  });

  it("returns every entry for an empty query", () => {
    expect(filterArtists(entries(), "   ")).toHaveLength(2);
  });

  it("every directory entry resolves to a valid artist page", () => {
    const posters: Poster[] = [
      {
        id: "p-1",
        title: "Dune",
        year: 2021,
        artists: [{ name: "Olly Moss" }],
        artist: "Olly Moss",
        source: "Test",
        sourceUrl: "",
        image: "https://example.com/a.jpg",
        style: "Minimalist",
        genre: [],
        tags: [],
      } as Poster,
      {
        id: "p-3",
        title: "BR",
        year: 2019,
        artist: "Kil Osc",
        source: "Test",
        sourceUrl: "",
        image: "https://example.com/b.jpg",
        style: "Minimalist",
        genre: [],
        tags: [],
      } as Poster,
    ];
    for (const entry of buildArtistDirectory(posters)) {
      const resolved = resolveArtist(posters, entry.slug);
      expect(resolved.matchingPoster, `${entry.slug} must resolve`).toBeDefined();
      expect(resolved.name).toBe(entry.name);
    }
  });
});

describe("directory SSR", () => {
  function posterFixture(overrides: Partial<Poster> & { id: string }): Poster {
    return {
      title: "Dune",
      year: 2021,
      artists: [{ name: "Olly Moss" }],
      artist: "Olly Moss",
      source: "Test",
      sourceUrl: "",
      image: "https://example.com/dune.jpg",
      style: "Minimalist",
      genre: ["Sci-Fi"],
      tags: [],
      mediaType: "movie",
      ...overrides,
    } as Poster;
  }

  const posters = [
    posterFixture({ id: "p-1", title: "Dune", artists: [{ name: "Olly Moss" }] }),
    posterFixture({ id: "p-2", title: "Dune", artists: [{ name: "Olly Moss" }] }),
    posterFixture({
      id: "p-3",
      title: "Blade Runner 2049",
      artist: "Kil Osc",
      artists: undefined,
    }),
  ];
  const entries = buildArtistDirectory(posters);
  let html = "";

  async function renderEntries(list: typeof entries): Promise<string> {
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <ArtistsDirectory entries={list} />,
    });
    const artistRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/artist/$slug",
      component: () => null,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute, artistRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    return renderToStaticMarkup(<RouterProvider router={router} />);
  }

  beforeAll(async () => {
    html = await renderEntries(entries);
  });

  function anchors(): { href: string; inner: string }[] {
    return [...html.matchAll(/<a\b[^>]*href="(\/artist\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(
      (m) => ({ href: m[1], inner: m[2] }),
    );
  }

  it("renders exactly one meaningful H1", () => {
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim(),
    );
    expect(h1s).toEqual(["Poster Artists"]);
  });

  it("shows every artist name with an accurate poster count", () => {
    expect(html).toContain("Olly Moss");
    expect(html).toContain("Kil Osc");
    expect(html).toContain("2 posters");
    expect(html).toContain("1 poster");
    expect(html).not.toContain("1 posters");
  });

  it("links every card to the correct existing artist route", () => {
    expect(
      anchors()
        .map((a) => a.href)
        .sort(),
    ).toEqual(["/artist/kil-osc", "/artist/olly-moss"]);
  });

  it("renders representative artwork with meaningful alt text", () => {
    const imgs = [...html.matchAll(/<img[^>]*alt="([^"]*)"[^>]*>/g)].map((m) => m[1]);
    expect(imgs.length).toBeGreaterThan(0);
    for (const alt of imgs) {
      expect(alt.trim().length).toBeGreaterThan(0);
      expect(alt).toMatch(/Olly Moss|Kil Osc/);
    }
  });

  it("has no nested interactive controls inside artist anchors", () => {
    for (const { href, inner } of anchors()) {
      expect(inner, `${href} nests a button`).not.toContain("<button");
    }
    expect(html).toContain('id="artist-search"');
  });

  it("renders breadcrumb navigation with a real home link", () => {
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/"');
    expect(html).toContain('aria-current="page"');
  });

  it("renders an accessible empty state when the catalogue is empty", async () => {
    const emptyHtml = await renderEntries([]);
    expect(emptyHtml).toContain("No artists yet");
    expect(emptyHtml).toContain('href="/"');
  });
});

describe("directory SEO", () => {
  it("emits one self-referencing canonical with complete metadata", () => {
    const head = pageHead({
      path: "/artists",
      title: "Poster Artists — CinePrint Gallery",
      description: "Discover the independent artists.",
      image: "https://example.com/dune.jpg",
    });
    expect(head.links).toEqual([{ rel: "canonical", href: "https://cineprint.click/artists" }]);
    const get = (k: string) => head.meta.find((t) => t.property === k)?.content;
    expect(get("og:url")).toBe("https://cineprint.click/artists");
    expect(get("og:image")).toBe("https://example.com/dune.jpg");
    expect(get("og:site_name")).toBe("CinePrint");
    expect(head.meta.some((t) => t.name === "robots")).toBe(false);
  });

  it("wraps directory entities in a single JSON-LD graph", () => {
    const head = withJsonLd(pageHead({ path: "/artists", title: "T", description: "D" }), [
      { "@type": "WebPage", "@id": "https://cineprint.click/artists" },
    ]);
    expect(head.meta.filter((t) => t["script:ld+json"] !== undefined)).toHaveLength(1);
    expect(head.links).toHaveLength(1);
  });

  it("directory entities parse as valid JSON-LD", () => {
    const page = JSON.parse(
      JSON.stringify(webpageEntity("/artists", "Poster Artists", "Discover artists.")),
    );
    expect(page["@type"]).toBe("WebPage");
    expect(page["@id"]).toBe("https://cineprint.click/artists");
    const crumbs = JSON.parse(
      JSON.stringify(
        breadcrumbEntity([
          { name: "Home", url: "https://cineprint.click" },
          { name: "Artists", url: "https://cineprint.click/artists" },
        ]),
      ),
    );
    expect(crumbs.itemListElement.map((i: { position: number }) => i.position)).toEqual([1, 2]);
  });
});
