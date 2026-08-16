import type { Poster } from "./posters";

export type PosterImagePurpose = "gallery" | "detail" | "original" | "download";

const PUBLIC_BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";
const ORIGINAL_PATH_PATTERN = /^\/cineprint\/raindrop\/(\d+)\.[^/]+$/;

export function getOptimizedPosterImageUrl(poster: Poster): string | null {
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

export function getPosterImageUrl(poster: Poster, purpose: PosterImagePurpose = "gallery"): string {
  if (purpose === "original" || purpose === "download") {
    return poster.image;
  }

  return getOptimizedPosterImageUrl(poster) ?? poster.image;
}

export function getPosterImageFallbackUrl(poster: Poster): string {
  return getPosterImageUrl(poster, "original");
}
