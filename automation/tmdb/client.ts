import type { MediaType } from "./types";

export interface TMDBSearchResult {
  id: number;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  media_type?: string;
  popularity?: number;
  vote_count?: number;
}

export interface TMDBSearchResponse {
  page: number;
  results: TMDBSearchResult[];
  total_results: number;
}

export interface TMDBGenre {
  id: number;
  name: string;
}

export interface TMDbMovieDetails {
  id: number;
  genres?: TMDBGenre[];
  imdb_id?: string | null;
}

export interface TMDbTvDetails {
  id: number;
  genres?: TMDBGenre[];
}

export interface TMDbExternalIds {
  id: number;
  imdb_id?: string | null;
}

export interface TMDBDetails {
  genres: string[];
  imdbId: string | null;
}

export interface TMDBClient {
  searchMedia(query: {
    title: string;
    year: number;
    mediaType: MediaType;
  }): Promise<TMDBSearchResult[]>;

  getDetails(mediaType: MediaType, id: number): Promise<TMDBDetails>;
}

export class TMDBError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TMDBError";
  }
}

export class TMDBAuthError extends TMDBError {}
export class TMDBRateLimitError extends TMDBError {}
export class TMDBTimeoutError extends TMDBError {}
export class TMDBNetworkError extends TMDBError {}
export class TMDBHttpError extends TMDBError {}

export interface TMDBApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export const TMDB_API_BASE_URL = "https://api.themoviedb.org/3";

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof DOMException && err.name === "AbortError") ||
    (err instanceof Error && err.name === "AbortError")
  );
}

export class TMDBApiClient implements TMDBClient {
  constructor(private readonly options: TMDBApiClientOptions) {}

  async searchMedia(query: {
    title: string;
    year: number;
    mediaType: MediaType;
  }): Promise<TMDBSearchResult[]> {
    if (query.mediaType === "movie") {
      const data = await this.request<TMDBSearchResponse>("/search/movie", {
        query: query.title,
        year: query.year,
      });
      return data.results ?? [];
    }

    const data = await this.request<TMDBSearchResponse>("/search/tv", {
      query: query.title,
      first_air_date_year: query.year,
    });
    return data.results ?? [];
  }

  async getDetails(mediaType: MediaType, id: number): Promise<TMDBDetails> {
    if (mediaType === "movie") {
      const details = await this.request<TMDbMovieDetails>(`/movie/${id}`, {});
      return {
        genres: details.genres?.map((g) => g.name) ?? [],
        imdbId: details.imdb_id ?? null,
      };
    }

    const details = await this.request<TMDbTvDetails>(`/tv/${id}`, {});
    const external = await this.request<TMDbExternalIds>(`/tv/${id}/external_ids`, {});
    return {
      genres: details.genres?.map((g) => g.name) ?? [],
      imdbId: external.imdb_id ?? null,
    };
  }

  private async request<T>(path: string, params: Record<string, string | number>): Promise<T> {
    const {
      apiKey,
      baseUrl = TMDB_API_BASE_URL,
      timeoutMs = 10_000,
      fetchImpl = fetch,
    } = this.options;

    const url = new URL(`${baseUrl}${path}`);
    url.searchParams.set("api_key", apiKey);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, String(value));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetchImpl(url.toString(), {
        method: "GET",
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
    } catch (err) {
      if (isAbortError(err)) {
        throw new TMDBTimeoutError(`TMDB request timed out after ${timeoutMs}ms`);
      }
      throw new TMDBNetworkError("TMDB network request failed", err);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new TMDBAuthError(`TMDB API key rejected (HTTP ${response.status})`);
    }
    if (response.status === 429) {
      throw new TMDBRateLimitError("TMDB API rate limit exceeded (HTTP 429)");
    }
    if (!response.ok) {
      throw new TMDBHttpError(`TMDB API request failed (HTTP ${response.status})`);
    }

    return (await response.json()) as T;
  }
}
