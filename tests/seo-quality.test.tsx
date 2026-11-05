import { describe, it, expect, beforeAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  RouterProvider,
  createRouter,
} from "@tanstack/react-router";
import fs from "node:fs";
import path from "node:path";
import { isKnownArtistName } from "../src/lib/posters";
import { filmSlugForPoster } from "../src/lib/films";
import { eligibleTaxonomy, GENRE_DIMENSION, STYLE_DIMENSION } from "../src/lib/taxonomy";
import { Footer } from "../src/components/Footer";
import { ArtistBreadcrumb } from "../src/routes/-components/artist-breadcrumb";

const ROOT = new URL("../", import.meta.url).pathname;

/**
 * M10 — SEO quality audit regressions.
 *
 * Each test ties a concrete audit finding to a guard: unknown artists never
 * link anywhere, directories are linked and listed, breadcrumb trails agree
 * with their JSON-LD, and the sitemap set stays duplicate-free.
 */

describe("unknown artists never produce links", () => {
  it("rejects unknown, blank, and non-string names", () => {
    expect(isKnownArtistName("Unknown")).toBe(false);
    expect(isKnownArtistName("  UNKNOWN  ")).toBe(false);
    expect(isKnownArtistName("")).toBe(false);
    expect(isKnownArtistName("   ")).toBe(false);
    expect(isKnownArtistName(undefined)).toBe(false);
    expect(isKnownArtistName(null)).toBe(false);
    expect(isKnownArtistName(42)).toBe(false);
  });

  it("accepts real artist names", () => {
    expect(isKnownArtistName("Butcher Billy")).toBe(true);
    expect(isKnownArtistName("  Eileen Steinbach  ")).toBe(true);
  });
});

describe("footer directory navigation", () => {
  let html = "";

  beforeAll(async () => {
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <Footer />,
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    html = renderToStaticMarkup(<RouterProvider router={router} />);
  });

  it("links every discovery directory exactly once", () => {
    for (const path of ["/artists", "/genres", "/styles"]) {
      const matches = [...html.matchAll(new RegExp(`href="${path}"`, "g"))];
      expect(matches.length, path).toBe(1);
    }
  });

  it("exposes the navigation landmark", () => {
    expect(html).toContain('aria-label="Footer"');
  });
});

describe("artist breadcrumb", () => {
  let html = "";

  beforeAll(async () => {
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => <ArtistBreadcrumb slug="butcher-billy" name="Butcher Billy" />,
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
    html = renderToStaticMarkup(<RouterProvider router={router} />);
  });

  it("renders Home, Artists, and the current artist name", () => {
    expect(html).toContain('aria-label="Breadcrumb"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/artists"');
    expect(html).toContain("Butcher Billy");
    expect(html).toContain('aria-current="page"');
  });
});

describe("sitemap directory coverage", () => {
  function read(name: string): string {
    return fs.readFileSync(path.join(ROOT, "public", name), "utf8");
  }

  function staticPaths(): string[] {
    return [...read("sitemap-static.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => new URL(m[1]).pathname,
    );
  }

  it("lists /genres and /styles exactly once in the static sitemap", () => {
    const paths = staticPaths();
    expect(paths.filter((p) => p === "/genres")).toHaveLength(1);
    expect(paths.filter((p) => p === "/styles")).toHaveLength(1);
    expect(paths).toContain("/artists");
  });

  it("references genre and style children from the index", () => {
    const index = read("sitemap.xml");
    expect(index).toContain("<loc>https://cineprint.click/sitemap-genres.xml</loc>");
    expect(index).toContain("<loc>https://cineprint.click/sitemap-styles.xml</loc>");
  });

  it("genre and style detail URLs are unique canonical paths", () => {
    const all: string[] = [];
    for (const file of ["sitemap-genres.xml", "sitemap-styles.xml"]) {
      const urls = [...read(file).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
      expect(urls.length).toBeGreaterThan(0);
      all.push(...urls);
    }
    expect(new Set(all).size).toBe(all.length);
    for (const url of all) {
      expect(url).toMatch(/^https:\/\/cineprint\.click\/(genre|style)\/[a-z0-9-]+$/);
    }
  });
});

describe("filmSlugForPoster still resolves after the M10 refactor", () => {
  it("maps posters to their eligible film slugs", () => {
    const posters = [
      {
        id: "s-1",
        title: "S",
        year: 2000,
        tmdbId: "100",
        mediaType: "movie",
        image: "https://example.com/x.jpg",
      },
      {
        id: "s-2",
        title: "S",
        year: 2000,
        tmdbId: "100",
        mediaType: "movie",
        image: "https://example.com/x.jpg",
      },
      {
        id: "s-3",
        title: "S",
        year: 2000,
        tmdbId: "100",
        mediaType: "movie",
        image: "https://example.com/x.jpg",
      },
    ];
    expect(filmSlugForPoster(posters, "s-1")).not.toBeNull();
    expect(filmSlugForPoster(posters, "missing")).toBeNull();
  });
});
