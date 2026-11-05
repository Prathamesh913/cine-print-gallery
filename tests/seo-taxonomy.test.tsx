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
  GENRE_DIMENSION,
  STYLE_DIMENSION,
  buildTaxonomy,
  eligibleTaxonomy,
  filterTaxonomy,
  findCollidedSlugs,
  normalizeTaxonomyLabel,
  resolveTaxonomySlug,
  slugifyTaxonomyLabel,
  taxonomyUrlEntries,
  type TaxonomyPosterInput,
} from "../src/lib/taxonomy";
import { pageHead } from "../src/lib/seo";
import { breadcrumbEntity, webpageEntity, withJsonLd } from "../src/lib/structured-data";
import type { Poster } from "../src/lib/posters";
import { TaxonomyDirectory } from "../src/routes/-components/taxonomy-directory";
import { TaxonomyDetail } from "../src/routes/-components/taxonomy-detail";

/**
 * M9 taxonomy tests. Pure builders are exercised with fixtures (no
 * Firestore); rendering is asserted on real SSR markup through a minimal
 * TanStack Router. `useSaved` is mocked like the M3/M7 suites since
 * PosterGrid cards read it.
 */
vi.mock("../src/lib/saved", () => ({
  useSaved: () => ({
    saved: [] as string[],
    isSaved: () => false,
    toggle: vi.fn(),
    error: null,
    loading: false,
    retry: vi.fn(),
  }),
}));

/**
 * M9 taxonomy unit tests. Pure builders over fixtures, no Firestore.
 * Genre and style share one engine; both dimensions are exercised.
 */

function input(overrides: Partial<TaxonomyPosterInput> & { id: string }): TaxonomyPosterInput {
  return {
    genre: ["Horror"],
    style: "Minimalist",
    image: "https://example.com/p.jpg",
    ...overrides,
  };
}

const G = GENRE_DIMENSION;
const S = STYLE_DIMENSION;

describe("normalization", () => {
  it("trims, collapses whitespace, and folds case for identity", () => {
    expect(normalizeTaxonomyLabel("  Sci-Fi  ")).toBe("sci-fi");
    expect(normalizeTaxonomyLabel("SCI   FI")).toBe("sci fi");
  });

  it("folds unicode dashes to ASCII hyphens", () => {
    expect(normalizeTaxonomyLabel("Sci‑Fi")).toBe("sci-fi");
    expect(slugifyTaxonomyLabel("Sci-Fi")).toBe("sci-fi");
  });

  it("resolves the documented science-fiction synonym without fuzzy matching", () => {
    const groups = buildTaxonomy(
      [
        input({ id: "a", genre: ["Sci-Fi"] }),
        input({ id: "b", genre: ["Science Fiction"] }),
        input({ id: "c", genre: ["Science Fiction"] }),
      ],
      G,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].slug).toBe("sci-fi");
    expect(groups[0].name).toBe("Sci-Fi");
    expect(groups[0].posterIds).toEqual(["a", "b", "c"]);
  });

  it("keeps distinct labels distinct", () => {
    const groups = buildTaxonomy(
      [input({ id: "a", genre: ["Horror"] }), input({ id: "b", genre: ["Comedy"] })],
      G,
    );
    expect(groups.map((g) => g.slug)).toEqual(["comedy", "horror"]);
  });

  it("drops missing, empty, and whitespace-only values", () => {
    const groups = buildTaxonomy(
      [
        input({ id: "a", genre: [] }),
        input({ id: "b", genre: ["  "] }),
        input({ id: "c", genre: ["Horror"] }),
        input({ id: "d", style: "" }),
      ],
      G,
    );
    expect(groups.map((g) => g.slug)).toEqual(["horror"]);
    const styles = buildTaxonomy(
      [input({ id: "d", style: "" }), input({ id: "e", style: "Vintage" })],
      S,
    );
    expect(styles.map((s) => s.slug)).toEqual(["vintage"]);
  });

  it("accepts a lone string value as well as arrays", () => {
    const groups = buildTaxonomy([input({ id: "a", genre: "Horror" as never })], G);
    expect(groups).toHaveLength(1);
  });
});

describe("slug safety", () => {
  it("produces stable slugs across input orders", () => {
    const a = buildTaxonomy([input({ id: "a", genre: ["Horror"] })], G).map((g) => g.slug);
    const b = buildTaxonomy([input({ id: "a", genre: ["  horror  "] })], G).map((g) => g.slug);
    expect(a).toEqual(["horror"]);
    expect(b).toEqual(["horror"]);
  });

  it("suffixes colliding slugs instead of merging distinct categories", () => {
    const groups = buildTaxonomy(
      [
        { id: "a", genre: ["C++"], image: "https://example.com/x.jpg" },
        { id: "b", genre: ["C"], image: "https://example.com/x.jpg" },
        { id: "c", genre: ["C++"], image: "https://example.com/x.jpg" },
      ],
      G,
    );
    expect(groups.map((g) => g.slug).sort()).toEqual(["c", "c-2"]);
    expect(findCollidedSlugs([], G)).toEqual([]);
  });

  it("reports slugs that required disambiguation", () => {
    const rows = [
      { id: "a", genre: ["C++"], image: "https://example.com/x.jpg" },
      { id: "b", genre: ["C"], image: "https://example.com/x.jpg" },
    ];
    const collisions = findCollidedSlugs(rows, G);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].slug).toMatch(/^c-2$/);
  });
});

describe("eligibility", () => {
  const three = (base: string) =>
    [1, 2, 3].map((n) => input({ id: `${base}-${n}`, genre: ["Horror"] }));

  it("needs three unique posters with usable artwork", () => {
    expect(resolveTaxonomySlug(three("h").slice(0, 2), G, "horror")).toBeNull();
    expect(resolveTaxonomySlug(three("h"), G, "horror")?.posterIds).toEqual(["h-1", "h-2", "h-3"]);
  });

  it("counts duplicate poster ids once", () => {
    const dupes = [three("h")[0], three("h")[0], three("h")[1], three("h")[1]];
    expect(resolveTaxonomySlug(dupes, G, "horror")).toBeNull();
  });

  it("excludes posters without usable artwork from counts", () => {
    const rows = [
      ...three("h"),
      input({ id: "no-img", genre: ["Horror"], image: "" }),
      input({ id: "blank-img", genre: ["Horror"], image: "  " }),
    ];
    expect(resolveTaxonomySlug(rows, G, "horror")?.posterIds).toHaveLength(3);
  });

  it("a poster may belong to multiple genres", () => {
    const rows = [
      input({ id: "m-1", genre: ["Horror", "Mystery"] }),
      input({ id: "h-1", genre: ["Horror"] }),
      input({ id: "h-2", genre: ["Horror"] }),
      input({ id: "y-1", genre: ["Mystery"] }),
      input({ id: "y-2", genre: ["Mystery"] }),
    ];
    const slugs = eligibleTaxonomy(rows, G).map((g) => g.slug);
    expect(slugs).toContain("horror");
    expect(slugs).toContain("mystery");
    expect(eligibleTaxonomy(rows, G).find((g) => g.slug === "mystery")?.posterIds).toContain("m-1");
  });

  it("route and sitemap eligibility use the same shared rule", () => {
    const rows = [...three("h"), input({ id: "solo-1", genre: ["Romance"] })];
    const eligible = eligibleTaxonomy(rows, G);
    expect(eligible.map((g) => g.slug)).toEqual(["horror"]);
    expect(taxonomyUrlEntries(eligible, G).map((e) => e.loc)).toEqual([
      "https://cineprint.click/genre/horror",
    ]);
  });

  it("representative artwork is deterministic", () => {
    const a = eligibleTaxonomy(three("h"), G)[0];
    const b = eligibleTaxonomy([...three("h")].reverse(), G)[0];
    expect(a.representative.id).toBe("h-1");
    expect(b.representative.id).toBe("h-1");
  });

  it("sorts by count desc with name tiebreak", () => {
    const rows = [
      ...[1, 2, 3, 4].map((n) => input({ id: `z-${n}`, genre: ["Drama"] })),
      ...[1, 2, 3].map((n) => input({ id: `a-${n}`, genre: ["Comedy"] })),
      ...[1, 2, 3].map((n) => input({ id: `m-${n}`, genre: ["Horror"] })),
    ];
    expect(eligibleTaxonomy(rows, G).map((g) => g.slug)).toEqual(["drama", "comedy", "horror"]);
  });
});

describe("style dimension", () => {
  it("groups the clean style taxonomy", () => {
    const rows = [
      input({ id: "m-1", style: "Minimalist" }),
      input({ id: "m-2", style: "Minimalist" }),
      input({ id: "m-3", style: "Minimalist" }),
      input({ id: "v-1", style: "Vintage" }),
      input({ id: "v-2", style: "Vintage" }),
      input({ id: "v-3", style: "Vintage" }),
      input({ id: "r-1", style: "Retro" }),
    ];
    const eligible = eligibleTaxonomy(rows, S);
    expect(eligible.map((g) => g.slug)).toEqual(["minimalist", "vintage"]);
    expect(resolveTaxonomySlug(rows, S, "retro")).toBeNull();
    expect(resolveTaxonomySlug(rows, S, "nope")).toBeNull();
  });
});

describe("filter", () => {
  it("matches substrings case-insensitively and passes everything on empty query", () => {
    const rows = [
      input({ id: "a", genre: ["Horror"] }),
      input({ id: "b", genre: ["Horror"] }),
      input({ id: "c", genre: ["Horror"] }),
    ];
    const entries = eligibleTaxonomy(rows, G);
    expect(filterTaxonomy(entries, "hor").map((e) => e.slug)).toEqual(["horror"]);
    expect(filterTaxonomy(entries, "  ").map((e) => e.slug)).toEqual(["horror"]);
    expect(filterTaxonomy(entries, "zzz")).toEqual([]);
  });
});

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

describe("directory SSR", () => {
  const posters = [
    posterFixture({ id: "h-1", title: "Dune", artists: [{ name: "Olly Moss" }] }),
    posterFixture({ id: "h-2", title: "Dune", artists: [{ name: "Olly Moss" }] }),
    posterFixture({ id: "h-3", title: "Dune", artists: [{ name: "Kil Osc" }] }),
    posterFixture({ id: "c-1", title: "Heat", genre: ["Crime"], artists: [{ name: "Kil Osc" }] }),
    posterFixture({ id: "c-2", title: "Heat", genre: ["Crime"], artists: [{ name: "A. Fan" }] }),
    posterFixture({ id: "c-3", title: "Heat", genre: ["Crime"] }),
  ];
  let html = "";

  async function renderDirectory(entries: ReturnType<typeof eligibleTaxonomy>) {
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => (
        <TaxonomyDirectory
          eyebrow="Browse the archive"
          heading="Movie Genres"
          lede="Browse the archive by cinematic genre."
          searchLabel="Search genres"
          searchPlaceholder="Try “Horror”…"
          emptyTitle="No genres yet"
          emptyBody="Nothing to show right now."
          entries={entries}
          basePath="/genre"
        />
      ),
    });
    const genreRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/genre/$slug",
      component: () => null,
    });
    const posterRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/poster/$id",
      component: () => null,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute, genreRoute, posterRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    return renderToStaticMarkup(<RouterProvider router={router} />);
  }

  beforeAll(async () => {
    html = await renderDirectory(eligibleTaxonomy(posters, GENRE_DIMENSION));
  });

  it("renders exactly one meaningful H1", () => {
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim(),
    );
    expect(h1s).toEqual(["Movie Genres"]);
  });

  it("lists every eligible category with an accurate count", () => {
    expect(html).toContain("Sci-Fi");
    expect(html).toContain("Crime");
    expect(html.match(/3 posters/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("Comedy");
  });

  it("links every card to the correct category route with real anchors", () => {
    const hrefs = [...html.matchAll(/<a\b[^>]*href="(\/genre\/[^"]*)"[^>]*>/g)].map((m) => m[1]);
    expect(hrefs).toEqual(["/genre/crime", "/genre/sci-fi"]);
  });

  it("renders representative artwork with meaningful alt text", () => {
    const imgs = [...html.matchAll(/<img[^>]*alt="([^"]*)"[^>]*>/g)].map((m) => m[1]);
    expect(imgs.length).toBeGreaterThan(0);
    for (const alt of imgs) expect(alt.trim().length).toBeGreaterThan(0);
    expect(imgs.some((a) => a.includes("Dune"))).toBe(true);
  });

  it("has no nested interactive elements and keeps search accessible", () => {
    const anchors = [...html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1]);
    for (const inner of anchors) expect(inner).not.toContain("<button");
    expect(html).toContain('id="taxonomy-search"');
    expect(html).toContain('aria-label="Breadcrumb"');
  });

  it("renders an accessible empty state when the catalogue has no categories", async () => {
    const emptyHtml = await renderDirectory([]);
    expect(emptyHtml).toContain("No genres yet");
    expect(emptyHtml).toContain('href="/"');
  });
});

describe("detail page SSR", () => {
  const posters = [
    posterFixture({
      id: "h-1",
      title: "Dune",
      year: 2021,
      artist: "Olly Moss",
      artists: [{ name: "Olly Moss" }],
    }),
    posterFixture({
      id: "h-2",
      title: "Dune",
      year: 2021,
      artist: "Kil Osc",
      artists: [{ name: "Kil Osc" }],
    }),
    posterFixture({
      id: "h-3",
      title: "Dune",
      year: 2021,
      artist: "Olly Moss",
      artists: [{ name: "Olly Moss" }],
    }),
  ];
  let html = "";

  beforeAll(async () => {
    const group = eligibleTaxonomy(posters, GENRE_DIMENSION)[0];
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => (
        <TaxonomyDetail
          eyebrow="Movie genre"
          heading={`Alternative ${group.name} Movie Posters`}
          meta={[{ label: "Posters", value: `${group.posterIds.length} posters` }]}
          description={`Explore ${group.posterIds.length} alternative ${group.name} movie posters.`}
          relatedTitle="Featured films"
          related={[{ name: "Dune", slug: null, count: 3 }]}
          posters={group.posters}
          basePath="/genre"
          title={group.name}
        />
      ),
    });
    const filmRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/film/$slug",
      component: () => null,
    });
    const posterRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/poster/$id",
      component: () => null,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute, filmRoute, posterRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    html = renderToStaticMarkup(<RouterProvider router={router} />);
  });

  it("renders exactly one meaningful H1", () => {
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
      m[1].replace(/<[^>]+>/g, "").trim(),
    );
    expect(h1s).toEqual(["Alternative Sci-Fi Movie Posters"]);
  });

  it("links every eligible poster to its existing route", () => {
    for (const id of ["h-1", "h-2", "h-3"]) {
      expect(html).toContain(`href="/poster/${id}"`);
    }
  });

  it("shows artist attribution from real catalogue data", () => {
    expect(html).toContain("Olly Moss");
    expect(html).toContain("Kil Osc");
  });

  it("has breadcrumb navigation with a real directory link", () => {
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/genres"');
    expect(html).toContain('aria-current="page"');
  });

  it("omits missing metadata without placeholders", () => {
    expect(html).not.toContain("Unknown");
    expect(html).not.toContain("undefined");
  });
});

describe("taxonomy SEO", () => {
  it("emits self-referencing canonicals with complete metadata", () => {
    const head = pageHead({
      path: "/genres",
      title: "Movie Genres — CinePrint Gallery",
      description: "Browse genres.",
      image: "https://example.com/dune.jpg",
    });
    expect(head.links).toEqual([{ rel: "canonical", href: "https://cineprint.click/genres" }]);
    expect(head.meta.find((t) => t.property === "og:url")?.content).toBe(
      "https://cineprint.click/genres",
    );
    expect(head.meta.some((t) => t.name === "robots")).toBe(false);
  });

  it("wraps directory entities in a single JSON-LD graph", () => {
    const head = withJsonLd(pageHead({ path: "/styles", title: "T", description: "D" }), [
      { "@type": "WebPage", "@id": "https://cineprint.click/styles" },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: "https://cineprint.click" },
        ],
      },
    ]);
    const scripts = head.meta.filter((t) => t["script:ld+json"] !== undefined);
    expect(scripts).toHaveLength(1);
    expect(head.links).toHaveLength(1);
  });

  it("detail JSON-LD parses with the correct collection identity", () => {
    const page = JSON.parse(
      JSON.stringify({
        "@type": "CollectionPage",
        "@id": "https://cineprint.click/genre/horror",
      }),
    );
    expect(page["@type"]).toBe("CollectionPage");
    expect(page["@id"]).toBe("https://cineprint.click/genre/horror");
  });
});
