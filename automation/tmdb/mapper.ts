import type { MediaType, TMDBMetadata } from "./types";

export function slugifyTitle(title: string, year: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug}-${year}`;
}

export function libraryNameFor(mediaType: MediaType): "Movies" | "TV Shows" {
  return mediaType === "movie" ? "Movies" : "TV Shows";
}

export interface MapMetadataInput {
  draftTitle: string;
  draftYear: number;
  mediaType: MediaType;
  tmdbId: number;
  imdbId: string;
  genres: string[];
}

export function mapToMetadata(input: MapMetadataInput): TMDBMetadata {
  return {
    id: input.tmdbId,
    imdbId: input.imdbId,
    genres: input.genres,
    slug: slugifyTitle(input.draftTitle, input.draftYear),
    libraryName: libraryNameFor(input.mediaType),
  };
}
