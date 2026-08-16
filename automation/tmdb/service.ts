import type { CinePrintDraft } from "../shared/cineprint-draft";
import { TMDBApiClient, type TMDBClient } from "./client";
import { InMemoryTMDBCache, buildCacheKey, type TMDBCache } from "./cache";
import { extractYear, searchAndMatch } from "./search";
import { mapToMetadata } from "./mapper";
import type { EnrichedDraft, TMDBMetadata } from "./types";

export interface TMDBEnrichmentServiceOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  cache?: TMDBCache;
  logger?: Pick<Console, "log" | "error">;
}

export function getTMDBApiKey(): string {
  return process.env.TMDB_API_KEY?.trim() ?? "";
}

export function createTMDBEnrichmentService(
  options?: Omit<TMDBEnrichmentServiceOptions, "apiKey">,
): TMDBEnrichmentService {
  return new TMDBEnrichmentService({ ...options, apiKey: getTMDBApiKey() });
}

export class TMDBEnrichmentService {
  readonly cache: TMDBCache;
  private readonly client: TMDBClient;
  private readonly logger: Pick<Console, "log" | "error">;

  constructor(options: TMDBEnrichmentServiceOptions) {
    if (!options.apiKey) {
      throw new Error("TMDB_API_KEY is required");
    }
    this.logger = options.logger ?? console;
    this.cache = options.cache ?? new InMemoryTMDBCache();
    this.client = new TMDBApiClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
    });
  }

  async enrichDraft(draft: CinePrintDraft): Promise<EnrichedDraft> {
    const key = buildCacheKey(draft.mediaType, draft.title, draft.year);
    const cached = this.cache.get(key);
    if (cached) {
      this.printMatch(draft, cached, true);
      return { ...draft, status: "enriched", tmdb: cached };
    }

    try {
      const outcome = await searchAndMatch(this.client, draft);

      if (outcome.status === "none") {
        this.printReview(draft, "No TMDB match found");
        return { ...draft, status: "needs_review", reason: "No TMDB match found" };
      }

      if (outcome.status === "ambiguous") {
        const summary = outcome.candidates
          .map((c) => {
            const year = extractYear(c);
            return `${c.title ?? c.name ?? String(c.id)}${year !== null ? ` (${year})` : ""}`;
          })
          .join(", ");
        this.printReview(draft, `Ambiguous TMDB results: ${summary}`);
        return {
          ...draft,
          status: "needs_review",
          reason: `Ambiguous TMDB match: ${summary}`,
        };
      }

      const { candidate } = outcome.match;
      const details = await this.client.getDetails(draft.mediaType, candidate.id);

      if (!details.imdbId) {
        this.printReview(draft, "TMDB match found but IMDb ID unavailable");
        return {
          ...draft,
          status: "needs_review",
          reason: "TMDB match found but IMDb ID unavailable",
        };
      }

      const metadata = mapToMetadata({
        draftTitle: draft.title,
        draftYear: draft.year,
        mediaType: draft.mediaType,
        tmdbId: candidate.id,
        imdbId: details.imdbId,
        genres: details.genres,
      });

      this.cache.set(key, metadata);
      this.printMatch(draft, metadata, false);
      return { ...draft, status: "enriched", tmdb: metadata };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`✗ TMDB error for "${draft.title}": ${message}`);
      return { ...draft, status: "failed", reason: message };
    }
  }

  async enrichDrafts(drafts: CinePrintDraft[]): Promise<EnrichedDraft[]> {
    const results: EnrichedDraft[] = [];
    for (const draft of drafts) {
      results.push(await this.enrichDraft(draft));
    }
    return results;
  }

  private printMatch(draft: CinePrintDraft, metadata: TMDBMetadata, cacheHit: boolean): void {
    const log = this.logger.log.bind(this.logger);
    log("✓ TMDB Match");
    log("");
    log("Title");
    log(draft.title);
    if (cacheHit) {
      log("");
      log("Cache");
      log("HIT");
      log("");
      return;
    }
    log("");
    log("TMDB ID");
    log(String(metadata.id));
    log("");
    log("IMDb ID");
    log(metadata.imdbId);
    log("");
    log("Genres");
    for (const genre of metadata.genres) {
      log(genre);
    }
    log("");
    log("Library");
    log(metadata.libraryName);
    log("");
    log("Slug");
    log(metadata.slug);
    log("");
    log("Cache");
    log("MISS");
    log("");
  }

  private printReview(draft: CinePrintDraft, reason: string): void {
    const log = this.logger.log.bind(this.logger);
    log("⚠ Needs review");
    log("");
    log("Title");
    log(draft.title);
    log("");
    log("Reason");
    log(reason);
    log("");
  }
}
