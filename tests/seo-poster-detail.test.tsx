import { describe, it, expect, beforeAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  RouterProvider,
  createRouter,
} from "@tanstack/react-router";
import { PosterArticle } from "../src/routes/-components/poster-article";
import type { Poster } from "../src/lib/posters";

/**
 * M4 — server-rendered poster detail content.
 *
 * Renders the real PosterArticle inside a minimal TanStack Router (no DOM,
 * no hydration — the same conditions as SSR HTML) and asserts literal
 * content. Complete and sparse fixtures prove optional metadata is omitted
 * cleanly instead of invented.
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

const COMPLETE = fixturePoster({
  id: "dune-part-two",
  title: "Dune: Part Two",
  source: "PosterSpy",
  sourceUrl: "https://example.com/source",
  note: "A sweeping desert epic in duotone.",
  imdbId: "tt15239678",
  libraryNames: ["Sci-Fi Classics"],
});

const SAME_FILM = fixturePoster({
  id: "dune-part-two-variant",
  title: "Dune: Part Two",
  artist: "Kil Osc",
  artists: [{ name: "Kil Osc" }],
});

const SPARSE = fixturePoster({
  id: "mystery-print",
  title: "Mystery Print",
  year: 0,
  artists: undefined,
  artist: "Unknown",
  source: "Unknown",
  style: "Minimalist",
  genre: [],
  mediaType: "show",
  image: "https://example.com/mystery.jpg",
});

const CATALOGUE = [COMPLETE, SAME_FILM, SPARSE];

async function renderArticle(poster: Poster): Promise<string> {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <PosterArticle poster={poster} posters={CATALOGUE} />,
  });
  const posterRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/poster/$id",
    component: () => null,
  });
  const artistRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/artist/$slug",
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, posterRoute, artistRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  return renderToStaticMarkup(<RouterProvider router={router} />);
}

let completeHtml = "";
let sparseHtml = "";

beforeAll(async () => {
  completeHtml = await renderArticle(COMPLETE);
  sparseHtml = await renderArticle(SPARSE);
});

function h1s(html: string): string[] {
  return [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, "").trim(),
  );
}

describe("complete poster SSR content", () => {
  it("renders exactly one meaningful H1 using the film title", () => {
    expect(h1s(completeHtml)).toEqual(["Dune: Part Two — Alternative Movie Poster"]);
  });

  it("renders the artwork image with meaningful alt text", () => {
    const img = completeHtml.match(/<img[^>]*src="([^"]*)"[^>]*>/)?.[0] ?? "";
    expect(img).toContain('src="https://example.com/dune.jpg"');
    expect(img).toContain("Dune: Part Two");
    expect(img).toContain("Olly Moss");
  });

  it("renders film metadata when available", () => {
    expect(completeHtml).toContain("2021");
    expect(completeHtml).toContain("Sci-Fi");
    expect(completeHtml).toContain("Minimalist");
    expect(completeHtml).toContain("A sweeping desert epic in duotone.");
  });

  it("links the artist to the real /artist/$slug route", () => {
    expect(completeHtml).toContain('href="/artist/olly-moss"');
  });

  it("renders breadcrumb navigation with a real home link", () => {
    expect(completeHtml).toContain('aria-label="Breadcrumb"');
    expect(completeHtml).toContain('href="/"');
    expect(completeHtml).toContain('aria-current="page"');
  });

  it("links related posters and never the current poster", () => {
    expect(completeHtml).toContain('href="/poster/dune-part-two-variant"');
    const selfLinks = (completeHtml.match(/<a\b[^>]*href="\/poster\/dune-part-two"[^>]*>/g) ?? [])
      .length;
    expect(selfLinks).toBe(0);
  });

  it("has no hidden duplicate SEO content and no duplicate H1", () => {
    expect(h1s(completeHtml)).toHaveLength(1);
    expect(completeHtml).not.toMatch(/opacity-0|display:\s*none|visually-hidden/);
  });
});

describe("sparse poster omits missing metadata cleanly", () => {
  it("still renders a meaningful H1 with the TV label from media type", () => {
    expect(h1s(sparseHtml)).toEqual(["Mystery Print — Alternative TV Poster"]);
  });

  it("omits artist attribution instead of linking an unknown placeholder", () => {
    expect(sparseHtml).not.toContain("/artist/unknown");
    expect(sparseHtml).not.toMatch(/>\s*Unknown\s*</);
  });

  it("omits note, database, library, and source rows when absent", () => {
    expect(sparseHtml).not.toContain("View On");
    expect(sparseHtml).not.toContain("Libraries");
    expect(sparseHtml).not.toContain("imdb.com");
    expect(sparseHtml).not.toContain("themoviedb.org");
  });

  it("still renders artwork, breadcrumb, and exactly one H1", () => {
    expect(sparseHtml).toContain('src="https://example.com/mystery.jpg"');
    expect(sparseHtml).toContain('aria-label="Breadcrumb"');
    expect(h1s(sparseHtml)).toHaveLength(1);
  });
});
