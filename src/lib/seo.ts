import { slugifyArtist, type Poster } from "./posters";
import { getPosterSeoImageUrl } from "./poster-images";

/**
 * Shared SEO helpers for route `head` metadata and poster-route resolution.
 *
 * M0/M1 SEO foundation. These are pure, dependency-free functions returning
 * the exact `meta` shapes consumed by TanStack Start route `head` options,
 * so regression tests can exercise the real contract without the Start
 * server runtime.
 */

export const ROBOTS_NOINDEX_FOLLOW = "noindex, follow";
export const ROBOTS_NOINDEX = "noindex";

/** Production origin. Canonical URLs and absolute social image URLs build on this. */
export const SITE_ORIGIN = "https://cineprint.click";
export const SITE_NAME = "CinePrint";
export const SITE_DEFAULT_IMAGE = `${SITE_ORIGIN}/og-image.png`;

/** Brand strings shared by the root head and the homepage head. */
export const SITE_TITLE = "CinePrint — Curated Alternative Movie & TV Posters Gallery";
export const SITE_DESCRIPTION =
  "Explore a curated gallery of custom alternative movie posters, minimalist film art, and television key designs created by talented designers globally.";

export interface SeoMetaTag {
  title?: string;
  name?: string;
  property?: string;
  content?: string;
  /** JSON-LD block rendered as <script type="application/ld+json">. */
  "script:ld+json"?: Record<string, unknown>;
}

export interface SeoLinkTag {
  rel?: string;
  href?: string;
}

export interface SeoHead {
  meta: SeoMetaTag[];
  links?: SeoLinkTag[];
}

/** Absolute self-referencing canonical URL for a route path (no query strings). */
export function canonicalUrl(path: string): string {
  return `${SITE_ORIGIN}${path}`;
}

export interface PageMetaInput {
  /** Route path, e.g. "/about" or "/poster/xyz". */
  path: string;
  /** Page <title>; reused for og:title and twitter:title. */
  title: string;
  /** Meta description; reused for og:description and twitter:description. */
  description: string;
  /** Absolute social image URL. Omit when none exists — no empty tags emitted. */
  image?: string | null;
  /** og:type. Defaults to "website". */
  type?: string;
  /** Optional distinct social title/description (defaults to title/description). */
  socialTitle?: string;
  socialDescription?: string;
}

/**
 * Complete head metadata for an indexable public page: self-referencing
 * canonical, Open Graph, and Twitter card tags plus og:site_name.
 * Never emits robots directives — indexing policy stays with the route.
 */
export function pageHead(input: PageMetaInput): SeoHead {
  const canonical = canonicalUrl(input.path);
  const type = input.type ?? "website";
  const image = input.image?.trim() ? input.image!.trim() : null;
  const socialTitle = input.socialTitle ?? input.title;
  const socialDescription = input.socialDescription ?? input.description;
  return {
    meta: [
      { title: input.title },
      { name: "description", content: input.description },
      { property: "og:title", content: socialTitle },
      { property: "og:description", content: socialDescription },
      { property: "og:type", content: type },
      { property: "og:url", content: canonical },
      { property: "og:site_name", content: SITE_NAME },
      ...(image
        ? [
            { property: "og:image", content: image },
            { property: "og:image:alt", content: socialTitle },
          ]
        : []),
      {
        name: "twitter:card",
        content: image ? "summary_large_image" : "summary",
      },
      { name: "twitter:title", content: socialTitle },
      { name: "twitter:description", content: socialDescription },
      ...(image
        ? [
            { name: "twitter:image", content: image },
            { name: "twitter:image:alt", content: socialTitle },
          ]
        : []),
    ],
    links: [{ rel: "canonical", href: canonical }],
  };
}

export function robotsMeta(content: string): SeoMetaTag {
  return { name: "robots", content };
}

/** All `content` values of `robots` meta tags in a head meta array. */
export function getRobotsContents(meta: readonly SeoMetaTag[]): string[] {
  return meta
    .filter((tag) => tag.name === "robots" && typeof tag.content === "string")
    .map((tag) => tag.content as string);
}

function directivesOf(content: string): string[] {
  return content
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

/** True when any robots tag includes the `noindex` directive. */
export function hasNoindex(meta: readonly SeoMetaTag[]): boolean {
  return getRobotsContents(meta).some((content) => directivesOf(content).includes("noindex"));
}

/**
 * Head metadata for private utility pages (`/saved`, `/login`, `/profile`).
 * Pages stay fully functional; crawlers can still fetch them (nothing is
 * blocked in robots.txt) and observe `noindex, follow`.
 */
export function utilityHeadMeta(title: string, description: string): SeoHead {
  return {
    meta: [
      { title },
      { name: "description", content: description },
      robotsMeta(ROBOTS_NOINDEX_FOLLOW),
    ],
  };
}

/**
 * Head metadata for `/poster/$id`.
 * - Valid poster: indexable, page-specific, complete social metadata built
 *   from the actual loaded poster (existing title/description/OG strings kept).
 * - Missing poster: `noindex` with no canonical and no social tags, so
 *   soft-404 responses are never indexed or shared as real content.
 */
export function posterHeadMeta(
  poster: Poster | null,
  resolveImage: (poster: Poster) => string = getPosterSeoImageUrl,
): SeoHead {
  if (!poster) {
    return {
      meta: [{ title: "Poster Not Found — CinePrint" }, robotsMeta(ROBOTS_NOINDEX)],
    };
  }
  return pageHead({
    path: `/poster/${poster.id}`,
    title: `${poster.title} by ${poster.artist} — CinePrint Gallery`,
    description: `Minimalist alternative movie poster for ${poster.title} (${poster.year}) by ${poster.artist}.`,
    socialTitle: `${poster.title} by ${poster.artist} — CinePrint`,
    socialDescription: `Alternative movie poster for ${poster.title}.`,
    image: resolveImage(poster),
  });
}

/**
 * Shared artist resolution used by the M2 artist head builder and the M6
 * artist entities, so slug matching never drifts between the two.
 */
export function resolveArtist(
  posters: readonly Poster[] | undefined,
  slug: string,
): { name: string; matchingPoster?: Poster } {
  const list = posters ?? [];
  const matchingPoster = list.find((poster) => {
    const names =
      poster.artists && poster.artists.length > 0
        ? poster.artists.map((a) => a.name)
        : [poster.artist];
    return names.some((name) => slugifyArtist(name) === slug);
  });
  const name =
    matchingPoster?.artists?.find((a) => slugifyArtist(a.name) === slug)?.name ||
    matchingPoster?.artist ||
    "Artist";
  return matchingPoster ? { name, matchingPoster } : { name };
}

/**
 * Head metadata for `/artist/$slug`, derived from the actual catalogue rows.
 * Uses the artist's own poster artwork when one matches, otherwise the
 * site-level fallback image. Existing title/description strings preserved.
 */
export function artistHeadMeta(
  posters: Poster[] | undefined,
  slug: string,
  resolveImage: (poster: Poster) => string = getPosterSeoImageUrl,
): SeoHead {
  const { name: artistName, matchingPoster } = resolveArtist(posters, slug);
  return pageHead({
    path: `/artist/${slug}`,
    title: `${artistName} — CinePrint Gallery`,
    description: `Explore the alternative movie posters and minimalist film art curated for ${artistName} on CinePrint.`,
    image: matchingPoster ? resolveImage(matchingPoster) : SITE_DEFAULT_IMAGE,
  });
}

export type PosterRouteResolution =
  { status: "ok"; poster: Poster; posters: Poster[] } | { status: "not-found" };
/**
 * Resolve a `/poster/$id` request against the published catalogue.
 *
 * - Known id → `{ status: "ok", ... }` (the route renders it indexable).
 * - Unknown id → `{ status: "not-found" }` (the route throws `notFound()`,
 *   producing a genuine HTTP 404 — never a 200 soft-404).
 * - Catalogue load failure (Firebase/network) rejects instead of resolving
 *   `not-found`: an infrastructure failure must surface via the error
 *   boundary and must never silently become a 404.
 */
export async function loadPosterRoute(
  loadPosters: () => Promise<Poster[]>,
  id: string,
): Promise<PosterRouteResolution> {
  const posters = await loadPosters();
  const poster = posters.find((candidate) => candidate.id === id) ?? null;
  if (!poster) {
    return { status: "not-found" };
  }
  return { status: "ok", poster, posters };
}
