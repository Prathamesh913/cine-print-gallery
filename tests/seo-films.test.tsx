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
  MIN_FILM_POSTERS,
  buildFilmGroups,
  eligibleFilmGroups,
  filmInputFromRow,
  filmSlugForPoster,
  filmUrlEntries,
  resolveFilmSlug,
  slugifyFilmTitle,
  type FilmPosterInput,
} from "../src/lib/films";
import { collectionPageEntity } from "../src/lib/structured-data";
import { pageHead } from "../src/lib/seo";
import { FilmArticle } from "../src/routes/-components/film-article";
import type { Poster } from "../src/lib/posters";

/**
 * M7 — film/show landing pages.
 *
 * Identity, grouping, and eligibility are pure functions over fixtures
 * (no Firestore). Rendering is asserted on real FilmArticle SSR markup
 * inside a minimal TanStack Router. Route-vs-sitemap consistency is
 * asserted by feeding both consumers from one shared rule.
 *
 * `useSaved` (auth + Firestore backed) is mocked like the M3 tests: save
 * state syncing is covered by tests/saved-*.test.ts; only the rendered
 * card semantics matter here.
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

function input(overrides: Partial<FilmPosterInput> & { id: string }): FilmPosterInput {
  return {
    title: "Dune",
    year: 2021,
    mediaType: "movie",
    image: "https://example.com/dune.jpg",
    ...overrides,
  };
}

const DUNE_A = input({ id: "dune-1", tmdbId: "62", title: "Dune", year: 2021 });
const DUNE_B = input({ id: "dune-2", tmdbId: "62", title: "Dune", year: 2021 });
const DUNE_C = input({ id: "dune-3", tmdbId: "62", title: "Dune", year: 2021 });

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

describe("identity resolution", () => {
  it("groups the same TMDB id + media type", () => {
    const groups = buildFilmGroups([DUNE_A, DUNE_B]);
    expect(groups).toHaveLength(1);
    expect(groups[0].posterIds).toEqual(["dune-1", "dune-2"]);
  });

  it("groups the same IMDb id + media type without TMDB ids", () => {
    const groups = buildFilmGroups([
      input({ id: "x-1", tmdbId: "", imdbId: "tt123", title: "X", year: 2000 }),
      input({ id: "x-2", tmdbId: "", imdbId: "tt123", title: "X", year: 2000 }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it("does not merge across media types", () => {
    const groups = buildFilmGroups([
      input({ id: "s-1", tmdbId: "100", mediaType: "show", title: "S" }),
      input({ id: "m-1", tmdbId: "100", mediaType: "movie", title: "S" }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("separates the same title by year without ids", () => {
    const groups = buildFilmGroups([
      input({ id: "d-1", title: "Dune", year: 1984 }),
      input({ id: "d-2", title: "Dune", year: 2021 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("never merges remakes sharing a title under different TMDB ids", () => {
    const groups = buildFilmGroups([
      input({ id: "t-1", tmdbId: "933260", title: "The Substance", year: 2024 }),
      input({ id: "t-2", tmdbId: "933268", title: "The Substance", year: 2024 }),
      input({ id: "t-3", tmdbId: "933268", title: "The Substance", year: 2024 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.posterIds.sort())).toEqual([["t-1"], ["t-2", "t-3"]]);
  });

  it("keeps TMDB-identified and title-fallback records separate", () => {
    const groups = buildFilmGroups([
      input({ id: "a-1", tmdbId: "62", title: "Dune", year: 2021 }),
      input({ id: "a-2", title: "Dune", year: 2021 }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it("produces deterministic slugs", () => {
    const once = buildFilmGroups([DUNE_A, DUNE_B, DUNE_C]).map((g) => g.slug);
    const twice = buildFilmGroups([DUNE_C, DUNE_A, DUNE_B]).map((g) => g.slug);
    expect(once).toEqual(["dune"]);
    expect(twice).toEqual(["dune"]);
    expect(slugifyFilmTitle("2001: A Space Odyssey")).toBe("2001-a-space-odyssey");
  });

  it("disambiguates slug collisions with the year, never silently merging", () => {
    const groups = buildFilmGroups([
      input({ id: "q-1", tmdbId: "1", title: "Dune", year: 1984 }),
      input({ id: "q-2", tmdbId: "1", title: "Dune", year: 1984 }),
      input({ id: "q-3", tmdbId: "1", title: "Dune", year: 1984 }),
      input({ id: "w-1", tmdbId: "2", title: "Dune!", year: 2021 }),
      input({ id: "w-2", tmdbId: "2", title: "Dune!", year: 2021 }),
      input({ id: "w-3", tmdbId: "2", title: "Dune!", year: 2021 }),
    ]);
    expect(groups.map((g) => g.slug).sort()).toEqual(["dune", "dune-2021"]);
    expect(groups.map((g) => g.posterIds.length)).toEqual([3, 3]);
  });
});

describe("eligibility threshold", () => {
  it("rejects two posters", () => {
    expect(resolveFilmSlug([DUNE_A, DUNE_B], "dune")).toBeNull();
  });

  it("accepts three distinct valid posters", () => {
    const group = resolveFilmSlug([DUNE_A, DUNE_B, DUNE_C], "dune");
    expect(group?.posterIds).toEqual(["dune-1", "dune-2", "dune-3"]);
  });

  it("counts duplicate poster ids once", () => {
    const dupes = [DUNE_A, DUNE_B, { ...DUNE_A }, { ...DUNE_B }];
    expect(resolveFilmSlug(dupes, "dune")).toBeNull();
  });

  it("excludes unpublished records", () => {
    const row = {
      id: "u-1",
      data: { title: "Dune", year: 2021, image: "https://example.com/x.jpg", status: "review" },
    };
    expect(filmInputFromRow(row)).toBeNull();
  });

  it("excludes invalid records", () => {
    expect(
      filmInputFromRow({ id: "", data: { title: "X", image: "https://example.com/x.jpg" } }),
    ).toBeNull();
    expect(filmInputFromRow({ id: "no-img", data: { title: "X" } })).toBeNull();
  });

  it("resolves the film slug for posters with an eligible page", () => {
    const inputs = [DUNE_A, DUNE_B, DUNE_C, input({ id: "solo-1", tmdbId: "9", title: "Solo" })];
    expect(filmSlugForPoster(inputs, "dune-2")).toBe("dune");
    expect(filmSlugForPoster(inputs, "solo-1")).toBeNull();
    expect(filmSlugForPoster(inputs, "missing")).toBeNull();
  });

  it("enforces the shared minimum threshold at the boundary", () => {
    const three = [DUNE_A, DUNE_B, DUNE_C].slice(0, MIN_FILM_POSTERS);
    expect(resolveFilmSlug(three, "dune")).not.toBeNull();
    expect(resolveFilmSlug(three.slice(0, MIN_FILM_POSTERS - 1), "dune")).toBeNull();
  });
  it("route and sitemap eligibility agree on the same rule", () => {
    const inputs = [DUNE_A, DUNE_B, DUNE_C, input({ id: "solo-1", tmdbId: "9", title: "Solo" })];
    const slugs = eligibleFilmGroups(inputs).map((g) => g.slug);
    expect(slugs).toEqual(["dune"]);
    expect(resolveFilmSlug(inputs, "dune")).not.toBeNull();
    expect(resolveFilmSlug(inputs, "solo")).toBeNull();
    expect(filmUrlEntries(eligibleFilmGroups(inputs)).map((e) => e.loc)).toEqual([
      "https://cineprint.click/film/dune",
    ]);
  });
});

describe("film page rendering", () => {
  const posters = [DUNE_A, DUNE_B, DUNE_C].map((d, i) =>
    posterFixture({ id: d.id, title: "Dune", year: 2021, artist: `Artist ${i}` }),
  );
  const group = eligibleFilmGroups(posters)[0];
  let html = "";

  beforeAll(async () => {
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => (
        <FilmArticle
          title={group.title}
          year={group.year}
          isShow={group.isShow}
          genres={["Sci-Fi"]}
          description="Explore Dune posters."
          posters={group.posters}
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
    expect(h1s).toEqual(["Alternative Posters for Dune"]);
  });

  it("shows year, media type, and genre metadata", () => {
    expect(html).toContain("2021");
    expect(html).toContain("Movie");
    expect(html).toContain("Sci-Fi");
  });

  it("links every eligible poster to its existing route", () => {
    for (const id of ["dune-1", "dune-2", "dune-3"]) {
      expect(html).toContain(`href="/poster/${id}"`);
    }
  });

  it("attributes artists by name without inventing biographies", () => {
    expect(html).toContain("Artist 0");
    expect(html).not.toContain("biography");
  });

  it("has a Home breadcrumb with the film as current page", () => {
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/"');
    expect(html).toContain('aria-current="page"');
  });

  it("has no hidden text or duplicate H1 content", () => {
    // PosterCard images fade in on load (opacity-0 until loaded) as
    // established progressive enhancement across the gallery; they carry
    // real alt text and become visible. Truly hidden text is what we forbid.
    expect(html).not.toMatch(/display:\s*none|visually-hidden/);
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
    expect(h1s).toHaveLength(1);
    const alts = [...html.matchAll(/<img[^>]*alt="([^"]*)"/g)].map((m) => m[1]);
    expect(alts.length).toBeGreaterThan(0);
    for (const alt of alts) expect(alt.trim().length).toBeGreaterThan(0);
  });
});

describe("film SEO and structured data", () => {
  const group = eligibleFilmGroups([DUNE_A, DUNE_B, DUNE_C])[0];

  it("canonical matches the route and metadata is complete", () => {
    const head = pageHead({
      path: `/film/${group.slug}`,
      title: "Alternative Dune Movie Posters — CinePrint Gallery",
      description: "Explore Dune posters.",
      image: "https://example.com/dune.jpg",
    });
    expect(head.links).toEqual([{ rel: "canonical", href: "https://cineprint.click/film/dune" }]);
    const get = (k: string) => head.meta.find((t) => t.property === k)?.content;
    expect(get("og:url")).toBe("https://cineprint.click/film/dune");
    expect(get("og:title")).toContain("Dune");
    expect(get("og:image")).toBe("https://example.com/dune.jpg");
    expect(get("og:site_name")).toBe("CinePrint");
  });

  it("representative image is deterministic", () => {
    const again = eligibleFilmGroups([DUNE_C, DUNE_A, DUNE_B])[0];
    expect(again.representative.id).toBe(group.representative.id);
  });

  it("emits a valid CollectionPage with breadcrumb references", () => {
    const page = JSON.parse(
      JSON.stringify(
        collectionPageEntity({
          slug: "dune",
          name: "Alternative Posters for Dune",
          description: "Explore Dune posters.",
          image: "https://example.com/dune.jpg",
          aboutType: "Movie",
          aboutName: "Dune",
        }),
      ),
    );
    expect(page["@type"]).toBe("CollectionPage");
    expect(page["@id"]).toBe("https://cineprint.click/film/dune");
    expect(page.about).toEqual({ "@type": "Movie", name: "Dune" });
  });
});
