import { slugifyArtist, type Poster } from "./posters";
import { getPosterSeoImageUrl } from "./poster-images";
import {
  SITE_DEFAULT_IMAGE,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
  resolveArtist,
  type SeoHead,
  type SeoMetaTag,
} from "./seo";

/**
 * M6 structured data. Pure builders returning JSON-LD entity objects.
 *
 * Entities use stable absolute @id values so pages reference shared
 * identities (website, organization, artist pages) instead of embedding
 * duplicate full entities. Only real catalogue data is represented:
 * optional properties are omitted when the source field is missing.
 *
 * Serialization safety comes from the TanStack Router `script:ld+json`
 * head entry, which JSON-stringifies and HTML-escapes the object.
 */

export type JsonLdEntity = Record<string, unknown>;

export const WEBSITE_ID = `${SITE_ORIGIN}/#website`;
export const ORGANIZATION_ID = `${SITE_ORIGIN}/#organization`;

function websiteId(): string {
  return WEBSITE_ID;
}

function isKnown(value: string | undefined): value is string {
  return !!value && value.trim() !== "" && value.trim().toLowerCase() !== "unknown";
}

export interface ResolvedArtist {
  name: string;
  matchingPoster?: Poster;
}

/**
 * Shared artist resolution lives in seo.ts next to artistHeadMeta.
 * Re-exported here so entity builders and tests share one entry point.
 */
export { resolveArtist } from "./seo";

export function websiteEntity(): JsonLdEntity {
  return {
    "@type": "WebSite",
    "@id": websiteId(),
    url: SITE_ORIGIN,
    name: SITE_NAME,
    description: SITE_DESCRIPTION,
    publisher: { "@id": ORGANIZATION_ID },
  };
}

export function organizationEntity(): JsonLdEntity {
  // Minimal Organization: only verified project facts (name, canonical URL).
  // The about page links are the author's personal accounts, not
  // organization accounts, so no sameAs is emitted. No logo file exists
  // in the project, so no logo is emitted.
  return {
    "@type": "Organization",
    "@id": ORGANIZATION_ID,
    url: SITE_ORIGIN,
    name: SITE_NAME,
  };
}

export function webpageEntity(path: string, title: string, description: string): JsonLdEntity {
  return {
    "@type": "WebPage",
    "@id": `${SITE_ORIGIN}${path}`,
    url: `${SITE_ORIGIN}${path}`,
    name: title,
    description,
    isPartOf: { "@id": websiteId() },
  };
}

export interface BreadcrumbItem {
  name: string;
  url: string;
}

export function breadcrumbEntity(items: BreadcrumbItem[]): JsonLdEntity {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

/**
 * CollectionPage for an eligible film/show landing page. Compact by design:
 * the collection is described once and references the film identity — full
 * artwork entities live on the poster pages, not here.
 */
export function collectionPageEntity(input: {
  slug: string;
  name: string;
  description: string;
  image?: string;
  aboutType: "Movie" | "TVSeries";
  aboutName: string;
}): JsonLdEntity {
  return {
    "@type": "CollectionPage",
    "@id": `${SITE_ORIGIN}/film/${input.slug}`,
    url: `${SITE_ORIGIN}/film/${input.slug}`,
    name: input.name,
    description: input.description,
    ...(input.image?.trim() ? { image: input.image.trim() } : {}),
    about: { "@type": input.aboutType, name: input.aboutName },
    isPartOf: { "@id": websiteId() },
  };
}

/**
 * VisualArtwork for a valid poster. Creator is a stable Person reference by
 * artist-page @id, omitted entirely when the artist is unknown.
 */
export function visualArtworkEntity(
  poster: Poster,
  resolveImage: (poster: Poster) => string = getPosterSeoImageUrl,
): JsonLdEntity {
  const isShow = poster.mediaType === "show";
  const canonical = `${SITE_ORIGIN}/poster/${poster.id}`;
  const artist =
    poster.artists && poster.artists.length > 0
      ? poster.artists
          .map((a) => a.name)
          .find((n) => isKnown(n))
          ?.trim()
      : isKnown(poster.artist)
        ? poster.artist.trim()
        : undefined;
  const image = resolveImage(poster).trim();
  return {
    "@type": "VisualArtwork",
    "@id": canonical,
    url: canonical,
    name: poster.title,
    ...(poster.note?.trim() ? { description: poster.note.trim() } : {}),
    ...(image ? { image } : {}),
    artform: "Poster",
    ...(poster.genre.length > 0 ? { genre: [...poster.genre] } : {}),
    ...(poster.year > 0 ? { dateCreated: String(poster.year) } : {}),
    ...(artist
      ? {
          creator: {
            "@type": "Person",
            "@id": `${SITE_ORIGIN}/artist/${slugifyArtist(artist)}`,
            name: artist,
            url: `${SITE_ORIGIN}/artist/${slugifyArtist(artist)}`,
          },
        }
      : {}),
    about: {
      "@type": isShow ? "TVSeries" : "Movie",
      name: poster.title,
    },
    isPartOf: { "@id": websiteId() },
  };
}

/**
 * Person identity for a valid artist page. Only the stable identity —
 * full artwork entities live on poster pages and reference this @id.
 */
export function personEntity(name: string, slug: string, image?: string): JsonLdEntity {
  const url = `${SITE_ORIGIN}/artist/${slug}`;
  return {
    "@type": "Person",
    "@id": url,
    url,
    name,
    ...(image?.trim() ? { image: image.trim() } : { image: SITE_DEFAULT_IMAGE }),
    isPartOf: { "@id": websiteId() },
  };
}

/**
 * Entities for an artist page: stable Person identity when the slug
 * resolves to a real artist, plus a Home → Artist breadcrumb.
 */
export function artistPageEntities(
  posters: readonly Poster[] | undefined,
  slug: string,
  resolveImage: (poster: Poster) => string = getPosterSeoImageUrl,
): JsonLdEntity[] {
  const { name, matchingPoster } = resolveArtist(posters, slug);
  const entities: JsonLdEntity[] = [];
  if (matchingPoster && isKnown(name)) {
    entities.push(personEntity(name, slug, resolveImage(matchingPoster)));
  }
  entities.push(
    breadcrumbEntity([
      { name: "Home", url: SITE_ORIGIN },
      { name: "Artists", url: `${SITE_ORIGIN}/artists` },
      { name, url: `${SITE_ORIGIN}/artist/${slug}` },
    ]),
  );
  return entities;
}

/**
 * Entities for a valid poster page: artwork plus breadcrumb.
 * When the poster links to an eligible film landing page, the film appears
 * as the middle crumb, mirroring the visible breadcrumb trail.
 */
export function posterPageEntities(
  poster: Poster,
  film?: { slug: string; title: string } | null,
  resolveImage: (poster: Poster) => string = getPosterSeoImageUrl,
): JsonLdEntity[] {
  return [
    visualArtworkEntity(poster, resolveImage),
    breadcrumbEntity(
      film
        ? [
            { name: "Home", url: SITE_ORIGIN },
            { name: film.title, url: `${SITE_ORIGIN}/film/${film.slug}` },
            { name: poster.title, url: `${SITE_ORIGIN}/poster/${poster.id}` },
          ]
        : [
            { name: "Home", url: SITE_ORIGIN },
            { name: poster.title, url: `${SITE_ORIGIN}/poster/${poster.id}` },
          ],
    ),
  ];
}

/** Wrap entities in a single script:ld+json tag using a @graph. */
export function jsonLdScriptTag(entities: JsonLdEntity[]): SeoMetaTag {
  return {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@graph": entities,
    },
  };
}

/**
 * Attach page entities to a head object as one JSON-LD script block.
 * Empty entity lists leave the head untouched, so noindex pages that
 * never pass entities stay free of structured data.
 */
export function withJsonLd(head: SeoHead, entities: JsonLdEntity[]): SeoHead {
  if (entities.length === 0) return head;
  return { ...head, meta: [...head.meta, jsonLdScriptTag(entities)] };
}
