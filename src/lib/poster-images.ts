import type { Poster } from "./posters";
import { isPosterImageUnavailable } from "./poster-availability";
import { R2_IMAGE_MAP, type R2ImageMapEntry } from "./r2-image-map.generated";
import { validateR2ImageReference } from "./r2-image-reference";
import {
  R2_BROWSER_IMAGES_ENABLED,
  R2_DOWNLOADS_ENABLED,
  R2_SEO_IMAGES_ENABLED,
} from "./r2-image-activation";

export type PosterImagePurpose = "gallery" | "detail" | "original" | "download";

/** Local neutral asset used when a catalogue identity has no verified image. */
export const POSTER_UNAVAILABLE_URL = "/poster-unavailable.svg";
export const POSTER_UNAVAILABLE_ABSOLUTE_URL = "https://cineprint.click/poster-unavailable.svg";

const PUBLIC_BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const PUBLIC_R2_HOST = "images.cineprint.click";
const ORIGINAL_PATH_PATTERN = /^\/cineprint\/raindrop\/(\d+)\.[^/]+$/;

export interface PosterImageResolverOptions {
  /** Browser gallery/detail/original rendering. Disabled by default. */
  browserEnabled: boolean;
  /** SEO, Open Graph, JSON-LD and sitemap rendering. Disabled by default. */
  seoEnabled: boolean;
  /** Original-byte downloads. Disabled by default. */
  downloadsEnabled: boolean;
}

export interface PosterImageResolver {
  getOptimizedPosterImageUrl(poster: Poster): string | null;
  getPosterImageUrl(poster: Poster, purpose?: PosterImagePurpose): string;
  getPosterImageCandidates(poster: Poster, purpose?: PosterImagePurpose): string[];
  getPosterSeoImageUrl(poster: Poster): string;
  getPosterDownloadUrl(poster: Poster): string;
  getPosterImageFallbackUrl(poster: Poster): string;
}

type R2ImageMap = Readonly<Record<string, R2ImageMapEntry>>;

/**
 * Existing Blob optimized URL derivation. This is intentionally unchanged for
 * unmapped posters: legacy Raindrop posters use cineprint/optimized/legacy/ and
 * artwork-* posters use cineprint/optimized/<raindropId>. External posters are
 * not matched here and fall back to their original URL.
 */
function blobOptimizedUrl(poster: Poster): string | null {
  try {
    const original = new URL(poster.image);

    if (!original.hostname.endsWith(PUBLIC_BLOB_HOST_SUFFIX)) {
      return null;
    }

    const match = ORIGINAL_PATH_PATTERN.exec(original.pathname);
    if (!match) {
      return null;
    }

    const raindropId = match[1];
    const path = poster.id.startsWith("artwork-")
      ? `cineprint/optimized/${raindropId}.webp`
      : `cineprint/optimized/legacy/${poster.id}.webp`;

    return `${original.origin}/${path}`;
  } catch {
    return null;
  }
}

/**
 * A runtime mapping is usable only when it points at the verified public image
 * host over HTTPS. Malformed or unsupported entries are ignored instead of
 * being rendered as an empty or unrelated source.
 */
function isTrustedR2Url(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === PUBLIC_R2_HOST;
  } catch {
    return false;
  }
}

/**
 * Returns the exact mapping for this poster before URL validation. Used to
 * distinguish "no mapping" (legacy fallback) from "mapping exists but is
 * malformed" (fail closed, never fall back to Blob).
 */
function rawEntryFor(poster: Poster, map: R2ImageMap, enabled: boolean): R2ImageMapEntry | null {
  if (!enabled) return null;
  const entry = map[poster.id];
  if (!entry) return null;
  if (entry.blobImageUrl !== poster.image) return null;
  return entry;
}

type DynamicLookup =
  { kind: "none" } | { kind: "invalid" } | { kind: "entry"; entry: R2ImageMapEntry };

/**
 * Dynamic references are attached to posters created by the automation
 * pipeline. They are validated with the shared strict validator so a malformed
 * document can never render another poster's bytes or an untrusted host.
 */
function dynamicEntryFor(poster: Poster, enabled: boolean): DynamicLookup {
  // A supplied-but-invalid reference is a data-integrity signal. Fail closed
  // even when the relevant delivery switch is disabled so the record can never
  // silently fall back to an unverified Blob or raw image URL.
  if (poster.r2ImageInvalid) return { kind: "invalid" };
  if (!enabled || poster.r2Image === undefined) return { kind: "none" };

  const result = validateR2ImageReference(poster.r2Image, poster.id);
  if (!result.ok) return { kind: "invalid" };

  const reference = result.value;
  return {
    kind: "entry",
    entry: {
      blobImageUrl: reference.blobImageUrl ?? poster.image,
      originalUrl: reference.original.url,
      optimizedUrl: reference.optimized.url,
      originalKey: reference.original.key,
      optimizedKey: reference.optimized.key,
      verifiedAt: reference.verifiedAt,
    },
  };
}

type EntryLookup =
  { kind: "none" } | { kind: "invalid" } | { kind: "entry"; entry: R2ImageMapEntry };

/**
 * Static map first (existing catalogue), then a validated dynamic reference.
 * An invalid dynamic reference fails closed instead of silently using the raw
 * image URL or the legacy Blob path.
 */
function lookupEntryFor(poster: Poster, map: R2ImageMap, enabled: boolean): EntryLookup {
  const entry = rawEntryFor(poster, map, enabled);
  if (entry) return { kind: "entry", entry };
  return dynamicEntryFor(poster, enabled);
}

function uniqueUrls(urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

export function createPosterImageResolver(
  map: R2ImageMap,
  options: PosterImageResolverOptions,
): PosterImageResolver {
  const trustedEntry = (lookup: EntryLookup): R2ImageMapEntry | null => {
    if (lookup.kind !== "entry") return null;
    const entry = lookup.entry;
    if (!isTrustedR2Url(entry.originalUrl) || !isTrustedR2Url(entry.optimizedUrl)) {
      return null;
    }
    return entry;
  };
  const browserLookup = (poster: Poster) => lookupEntryFor(poster, map, options.browserEnabled);
  const seoLookup = (poster: Poster) => lookupEntryFor(poster, map, options.seoEnabled);
  const downloadLookup = (poster: Poster) => lookupEntryFor(poster, map, options.downloadsEnabled);
  const browserEntryFor = (poster: Poster) => trustedEntry(browserLookup(poster));
  const seoEntryFor = (poster: Poster) => trustedEntry(seoLookup(poster));
  const downloadUrlFor = (poster: Poster) => {
    const lookup = downloadLookup(poster);
    if (lookup.kind === "invalid") return "";
    return trustedEntry(lookup)?.originalUrl || poster.posterImageUrl || poster.image;
  };

  return {
    getOptimizedPosterImageUrl(poster: Poster): string | null {
      if (isPosterImageUnavailable(poster.id)) return null;
      const lookup = browserLookup(poster);
      if (lookup.kind === "invalid") return null;
      return trustedEntry(lookup)?.optimizedUrl ?? blobOptimizedUrl(poster);
    },

    getPosterImageUrl(poster: Poster, purpose: PosterImagePurpose = "gallery"): string {
      if (isPosterImageUnavailable(poster.id)) {
        return purpose === "download" ? "" : POSTER_UNAVAILABLE_URL;
      }
      if (purpose === "download") {
        return downloadUrlFor(poster);
      }

      const lookup = browserLookup(poster);
      if (lookup.kind === "invalid") {
        return POSTER_UNAVAILABLE_URL;
      }
      const entry = trustedEntry(lookup);
      if (purpose === "original") {
        return entry?.originalUrl ?? poster.image;
      }

      return entry?.optimizedUrl ?? entry?.originalUrl ?? blobOptimizedUrl(poster) ?? poster.image;
    },

    /**
     * Ordered, finite display candidates. Each URL is attempted at most once
     * by PosterImage. Verified mappings stay entirely on R2: the Blob original
     * is never used as a fallback for a mapped poster.
     */
    getPosterImageCandidates(poster: Poster, purpose: PosterImagePurpose = "gallery"): string[] {
      if (isPosterImageUnavailable(poster.id)) return [];
      if (purpose === "download") {
        return [downloadUrlFor(poster)];
      }

      const lookup = browserLookup(poster);
      if (lookup.kind === "invalid") return [];
      if (lookup.kind === "entry") {
        const entry = trustedEntry(lookup);
        // A mapped poster with malformed URLs fails closed to the neutral
        // placeholder instead of falling back to Blob or unrelated artwork.
        if (!entry) return [];
        if (purpose === "original") {
          return uniqueUrls([entry.originalUrl]);
        }
        return uniqueUrls([entry.optimizedUrl, entry.originalUrl]);
      }

      const primary = blobOptimizedUrl(poster);
      return uniqueUrls([primary, poster.image]);
    },

    /**
     * SEO, Open Graph, JSON-LD and sitemap images have an independent switch.
     * They remain on the existing Blob resolution unless SEO activation is
     * explicitly enabled in a later reviewed phase.
     */
    getPosterSeoImageUrl(poster: Poster): string {
      if (isPosterImageUnavailable(poster.id)) {
        return POSTER_UNAVAILABLE_ABSOLUTE_URL;
      }
      const lookup = seoLookup(poster);
      if (lookup.kind === "invalid") return POSTER_UNAVAILABLE_ABSOLUTE_URL;
      return seoEntryFor(poster)?.optimizedUrl ?? blobOptimizedUrl(poster) ?? poster.image;
    },

    /**
     * Downloads use the verified R2 original when enabled. Otherwise preserve
     * the existing posterImageUrl || image behavior. Intentionally unavailable
     * identities return no download URL rather than a Blob 403.
     */
    getPosterDownloadUrl(poster: Poster): string {
      if (isPosterImageUnavailable(poster.id)) return "";
      return downloadUrlFor(poster);
    },

    /**
     * Always return the original Blob URL. This keeps the existing <img>
     * fallback intact even when the primary image is served from R2.
     * Intentionally unavailable identities use the local neutral asset.
     */
    getPosterImageFallbackUrl(poster: Poster): string {
      if (isPosterImageUnavailable(poster.id)) return POSTER_UNAVAILABLE_URL;
      if (poster.r2ImageInvalid) return POSTER_UNAVAILABLE_URL;
      return poster.image;
    },
  };
}

const defaultResolver = createPosterImageResolver(R2_IMAGE_MAP, {
  browserEnabled: R2_BROWSER_IMAGES_ENABLED,
  seoEnabled: R2_SEO_IMAGES_ENABLED,
  downloadsEnabled: R2_DOWNLOADS_ENABLED,
});

export function getOptimizedPosterImageUrl(poster: Poster): string | null {
  return defaultResolver.getOptimizedPosterImageUrl(poster);
}

export function getPosterImageUrl(poster: Poster, purpose: PosterImagePurpose = "gallery"): string {
  return defaultResolver.getPosterImageUrl(poster, purpose);
}

export function getPosterImageCandidates(
  poster: Poster,
  purpose: PosterImagePurpose = "gallery",
): string[] {
  return defaultResolver.getPosterImageCandidates(poster, purpose);
}

export function getPosterSeoImageUrl(poster: Poster): string {
  return defaultResolver.getPosterSeoImageUrl(poster);
}

export function getPosterDownloadUrl(poster: Poster): string {
  return defaultResolver.getPosterDownloadUrl(poster);
}

export function getPosterImageFallbackUrl(poster: Poster): string {
  return defaultResolver.getPosterImageFallbackUrl(poster);
}
