import { describe, it, expect, vi, beforeAll } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  RouterProvider,
  createRouter,
} from "@tanstack/react-router";
import { PosterGrid } from "../src/components/PosterGrid";
import { DailySpotlight } from "../src/routes/-components/home-discovery";
import type { Poster } from "../src/lib/posters";

/**
 * M3 — crawlable poster links.
 *
 * Renders the real homepage discovery components (PosterGrid → PosterCard,
 * DailySpotlight) inside a minimal TanStack Router and asserts on the actual
 * server-rendered HTML: genuine `<a href="/poster/{id}">` anchors, correct
 * existing IDs, save controls as independent buttons outside anchors.
 *
 * `useSaved` (auth + Firestore backed) is mocked: save-state syncing is
 * covered by tests/saved-*.test.ts; these tests only need the control's
 * rendered semantics (button, not nested in the link).
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
  fixturePoster({ id: "2001-a-space-odyssey", title: "2001: A Space Odyssey" }),
  fixturePoster({ id: "artwork-1812274995", title: "BlacKkKlansman", artist: "Eileen Steinbach" }),
  fixturePoster({ id: "blade-runner-2049", title: "Blade Runner 2049", artist: "Kil Osc" }),
];

function posterAnchors(html: string): { href: string; inner: string }[] {
  const matches = [...html.matchAll(/<a\b[^>]*href="(\/poster\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/g)];
  return matches.map((m) => ({ href: m[1], inner: m[2] }));
}

async function renderHome(): Promise<string> {
  const rootRoute = createRootRoute();
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <>
        <DailySpotlight
          filmPosters={POSTERS}
          wallPosters={POSTERS}
          totalPosters={POSTERS.length}
          totalArtists={2}
        />
        <PosterGrid posters={POSTERS} />
      </>
    ),
  });
  const posterRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/poster/$id",
    component: () => null,
  });
  const routeTree = rootRoute.addChildren([indexRoute, posterRoute]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const html = renderToStaticMarkup(<RouterProvider router={router} />);
  router.clearCache?.();
  return html;
}

let homeHtml = "";

beforeAll(async () => {
  homeHtml = await renderHome();
});

describe("poster cards render genuine links", () => {
  it("every poster card exposes an anchor to its detail page", () => {
    const anchors = posterAnchors(homeHtml);
    // PosterGrid (3 cards) + DailySpotlight active card (3-poster fan case).
    expect(anchors.length).toBeGreaterThanOrEqual(POSTERS.length);
  });

  it("each poster links to its own existing /poster/{id} destination", () => {
    const hrefs = posterAnchors(homeHtml).map((a) => a.href);
    for (const poster of POSTERS) {
      expect(hrefs, `missing link for ${poster.id}`).toContain(`/poster/${poster.id}`);
    }
  });

  it("multiple posters produce distinct destinations (no ID mix-ups)", () => {
    const hrefs = posterAnchors(homeHtml)
      .map((a) => a.href)
      .filter((href) => POSTERS.some((p) => href === `/poster/${p.id}`));
    expect(new Set(hrefs).size).toBe(POSTERS.length);
  });

  it("all poster destinations use the existing /poster/{id} route format", () => {
    for (const { href } of posterAnchors(homeHtml)) {
      expect(href).toMatch(/^\/poster\/[^/]+$/);
    }
  });

  it("poster anchors contain meaningful accessible content", () => {
    for (const poster of POSTERS) {
      const anchor = posterAnchors(homeHtml).find((a) => a.href === `/poster/${poster.id}`);
      expect(anchor, `no anchor for ${poster.id}`).toBeDefined();
      expect(anchor!.inner).toContain(poster.title);
    }
  });

  it("the hero's top print is a real poster anchor", () => {
    const heroAnchors = posterAnchors(homeHtml).filter((a) => a.inner.includes("object-contain"));
    expect(heroAnchors).toHaveLength(1);
    expect(heroAnchors[0].href).toMatch(/^\/poster\/[^/]+$/);
  });

  it("malformed IDs never produce empty or undefined destinations", () => {
    const hrefs = posterAnchors(homeHtml).map((a) => a.href);
    for (const href of hrefs) {
      expect(href).not.toContain("undefined");
      expect(href.length).toBeGreaterThan("/poster/".length);
    }
  });
});

describe("independent controls stay outside anchors", () => {
  it("save controls remain buttons", () => {
    const saveButtons = homeHtml.match(/<button[^>]*aria-label="(Pin|Unpin) poster"[^>]*>/g) ?? [];
    expect(saveButtons.length).toBe(POSTERS.length);
  });

  it("no button is nested inside a poster anchor", () => {
    for (const { href, inner } of posterAnchors(homeHtml)) {
      expect(inner, `${href} nests a button`).not.toContain("<button");
    }
  });

  it("spotlight stack-reorder controls remain buttons, not links", () => {
    expect(homeHtml).toMatch(/<button[^>]*aria-label="Bring print \d+ to the top"[^>]*>/);
  });
});
