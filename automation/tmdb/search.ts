import type { TMDBClient, TMDBSearchResult } from "./client";
import type { CinePrintDraft } from "../shared/cineprint-draft";

export function toTMDbMediaType(mediaType: "movie" | "show"): "movie" | "tv" {
  return mediaType === "show" ? "tv" : "movie";
}

export function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function extractYear(result: TMDBSearchResult): number | null {
  const date = result.release_date ?? result.first_air_date;
  if (!date) return null;
  const year = Number(date.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export function matchesCriteria(
  result: TMDBSearchResult,
  draft: Pick<CinePrintDraft, "title" | "year" | "mediaType">,
): boolean {
  if (result.media_type && result.media_type !== toTMDbMediaType(draft.mediaType)) return false;

  const year = extractYear(result);
  if (year === null || year !== draft.year) return false;

  const candidateTitle = result.title ?? result.name ?? "";
  return normalizeTitle(candidateTitle) === normalizeTitle(draft.title);
}

export function scoreCandidate(
  result: TMDBSearchResult,
  draft: Pick<CinePrintDraft, "title" | "year">,
): number {
  let score = 0;
  if (normalizeTitle(result.title ?? result.name ?? "") === normalizeTitle(draft.title)) {
    score += 0.6;
  }
  if (extractYear(result) === draft.year) {
    score += 0.3;
  }
  if ((result.vote_count ?? 0) > 50) {
    score += 0.05;
  }
  if ((result.popularity ?? 0) > 10) {
    score += 0.05;
  }
  return score;
}

export function rankCandidates(
  candidates: TMDBSearchResult[],
  draft: Pick<CinePrintDraft, "title" | "year">,
): TMDBSearchResult[] {
  return [...candidates].sort(
    (a, b) =>
      scoreCandidate(b, draft) - scoreCandidate(a, draft) ||
      (b.popularity ?? 0) - (a.popularity ?? 0),
  );
}

export interface SearchMatch {
  candidate: TMDBSearchResult;
  confidence: number;
}

export type SearchOutcome =
  | { status: "match"; match: SearchMatch }
  | { status: "none" }
  | { status: "ambiguous"; candidates: TMDBSearchResult[] };

export async function searchAndMatch(
  client: TMDBClient,
  draft: CinePrintDraft,
): Promise<SearchOutcome> {
  const results = await client.searchMedia({
    title: draft.title,
    year: draft.year,
    mediaType: draft.mediaType,
  });

  const candidates = results.filter((result) => matchesCriteria(result, draft));
  if (candidates.length === 0) return { status: "none" };

  const ranked = rankCandidates(candidates, draft);
  if (ranked.length === 1) {
    return {
      status: "match",
      match: { candidate: ranked[0], confidence: scoreCandidate(ranked[0], draft) },
    };
  }

  return { status: "ambiguous", candidates: ranked };
}
