import type { CinePrintDraft } from "../shared/cineprint-draft";

export type MediaType = CinePrintDraft["mediaType"];

export interface TMDBMetadata {
  id: number;
  imdbId: string;
  genres: string[];
  slug: string;
  libraryName: "Movies" | "TV Shows";
}

export type EnrichmentStatus = "parsed" | "enriched" | "needs_review" | "failed";

export interface EnrichmentOutcome {
  status: EnrichmentStatus;
  tmdb?: TMDBMetadata;
  reason?: string;
}

export interface EnrichedDraft extends CinePrintDraft, EnrichmentOutcome {}
