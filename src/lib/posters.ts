import type { R2ImageReference } from "./r2-image-reference";

export type PosterStyle = string;
export type PosterGenre = string;

export interface ArtistInfo {
  name: string;
  url?: string;
}

export interface Poster {
  id: string;
  title: string;
  year: number;
  artists?: ArtistInfo[];
  artist: string;
  artistUrl?: string;
  source: string;
  sourceUrl: string;
  image: string;
  style: PosterStyle;
  genre: PosterGenre[];
  tags: string[];
  note?: string;
  mediaType?: string;
  tmdbId?: string;
  imdbId?: string;
  seasonNumber?: number;
  collectionName?: string;
  posterImageUrl?: string;
  backgroundUrl?: string;
  libraryNames?: string[];
  slug?: string;
  /**
   * Verified R2 image references for posters created after the one-time
   * migration. Existing posters are served from the generated runtime map.
   */
  r2Image?: R2ImageReference;
  /**
   * True when Firestore supplied an `r2Image` value that failed validation.
   * The resolver must fail closed rather than treating this as "no mapping".
   */
  r2ImageInvalid?: boolean;
}

export function slugifyArtist(name: string): string {
  if (!name || typeof name !== "string") return "unknown";
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
  return slug || "unknown";
}

/** True for real artist names; false for missing/blank/"unknown" placeholders. */
export function isKnownArtistName(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim() !== "" && value.trim().toLowerCase() !== "unknown"
  );
}
