import { describe, expect, it } from "vitest";
import type { CinePrintDraft } from "../shared/cineprint-draft";
import { TMDBEnrichmentService } from "./service";
import { buildCacheKey, InMemoryTMDBCache } from "./cache";
import { slugifyTitle, libraryNameFor, mapToMetadata } from "./mapper";
import {
  normalizeTitle,
  extractYear,
  matchesCriteria,
  rankCandidates,
  searchAndMatch,
} from "./search";
import type { TMDBApiClientOptions } from "./client";
import { TMDBApiClient } from "./client";

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeFetch(routes: Record<string, Handler>) {
  const calls: string[] = [];
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input.url;
    calls.push(url);
    const path = new URL(url).pathname.replace(/^\/3/, "");
    const handler = routes[path];
    if (!handler) return Promise.resolve(jsonResponse({ status_code: 404 }, 404));
    return Promise.resolve(handler(url, init));
  };
  return { impl, calls };
}

const silentLogger = { log: () => {}, error: () => {} };

function draft(overrides: Partial<CinePrintDraft>): CinePrintDraft {
  return {
    raindropId: "1",
    title: "Dune",
    year: 2021,
    mediaType: "movie",
    artists: ["James Jean"],
    imageUrl: "https://example.com/poster.png",
    sourceUrl: "https://example.com/post",
    ...overrides,
  };
}

function makeService(routes: Record<string, Handler>, extra?: Partial<TMDBApiClientOptions>) {
  const { impl, calls } = makeFetch(routes);
  const service = new TMDBEnrichmentService({
    apiKey: "test-api-key",
    fetchImpl: impl,
    logger: silentLogger,
    ...extra,
  });
  return { service, calls };
}

describe("cache", () => {
  it("builds movie and show cache keys with the year", () => {
    expect(buildCacheKey("movie", "BlacKkKlansman", 2018)).toBe("movie:BlacKkKlansman|2018");
    expect(buildCacheKey("show", "Severance", 2022)).toBe("show:Severance|2022");
  });

  it("in-memory cache stores and returns metadata", () => {
    const cache = new InMemoryTMDBCache();
    expect(cache.has("movie:Dune|2021")).toBe(false);
    cache.set("movie:Dune|2021", {
      id: 1,
      imdbId: "tt1",
      genres: [],
      slug: "dune-2021",
      libraryName: "Movies",
    });
    expect(cache.has("movie:Dune|2021")).toBe(true);
    expect(cache.get("movie:Dune|2021")?.id).toBe(1);
    expect(cache.size).toBe(1);
    expect(cache.get("missing")).toBeUndefined();
  });
});

describe("mapper", () => {
  it("slugifies titles lowercase and appends the year", () => {
    expect(slugifyTitle("BlacKkKlansman", 2018)).toBe("blackkklansman-2018");
    expect(slugifyTitle("Severance", 2022)).toBe("severance-2022");
    expect(slugifyTitle("Dune: Part Two", 2024)).toBe("dune-part-two-2024");
  });

  it("maps media type to library name", () => {
    expect(libraryNameFor("movie")).toBe("Movies");
    expect(libraryNameFor("show")).toBe("TV Shows");
  });

  it("maps an input to full TMDB metadata", () => {
    const metadata = mapToMetadata({
      draftTitle: "BlacKkKlansman",
      draftYear: 2018,
      mediaType: "movie",
      tmdbId: 487558,
      imdbId: "tt7349662",
      genres: ["Crime", "Drama", "Comedy"],
    });
    expect(metadata).toEqual({
      id: 487558,
      imdbId: "tt7349662",
      genres: ["Crime", "Drama", "Comedy"],
      slug: "blackkklansman-2018",
      libraryName: "Movies",
    });
  });
});

describe("search helpers", () => {
  it("normalizes titles for comparison", () => {
    expect(normalizeTitle("BlacKkKlansman")).toBe("blackkklansman");
    expect(normalizeTitle("  Star  Wars: The Force Awakens  ")).toBe("star wars the force awakens");
  });

  it("extracts the release year from movie and show results", () => {
    expect(extractYear({ id: 1, release_date: "2018-08-10" })).toBe(2018);
    expect(extractYear({ id: 2, first_air_date: "2022-02-18" })).toBe(2022);
    expect(extractYear({ id: 3 })).toBeNull();
  });

  it("requires media type, year and normalized title to match", () => {
    const d = draft({ title: "Dune", year: 2021, mediaType: "movie" });
    expect(matchesCriteria({ id: 1, title: "Dune", release_date: "2021-10-22" }, d)).toBe(true);
    expect(matchesCriteria({ id: 1, title: "Dune", release_date: "1984-12-14" }, d)).toBe(false);
    expect(matchesCriteria({ id: 1, title: "Dunes", release_date: "2021-10-22" }, d)).toBe(false);
    expect(
      matchesCriteria({ id: 1, title: "Dune", release_date: "2021-10-22", media_type: "tv" }, d),
    ).toBe(false);
  });

  it("ranks candidates by confidence then popularity", () => {
    const d = draft({ title: "Dune", year: 2021 });
    const ranked = rankCandidates(
      [
        { id: 1, title: "Dune", release_date: "2021-10-22", popularity: 1 },
        { id: 2, title: "Dune", release_date: "2021-10-22", popularity: 100 },
      ],
      d,
    );
    expect(ranked[0].id).toBe(2);
  });
});

describe("movie enrichment", () => {
  it("enriches a movie with full metadata from details", async () => {
    const { service, calls } = makeService({
      "/search/movie": () =>
        jsonResponse({
          total_results: 1,
          results: [
            {
              id: 487558,
              title: "BlacKkKlansman",
              release_date: "2018-08-10",
              popularity: 20,
              vote_count: 2000,
            },
          ],
        }),
      "/movie/487558": () =>
        jsonResponse({
          id: 487558,
          genres: [
            { id: 80, name: "Crime" },
            { id: 18, name: "Drama" },
            { id: 35, name: "Comedy" },
          ],
          imdb_id: "tt7349662",
        }),
    });

    const result = await service.enrichDraft(draft({ title: "BlacKkKlansman", year: 2018 }));

    expect(result.status).toBe("enriched");
    expect(result.tmdb).toEqual({
      id: 487558,
      imdbId: "tt7349662",
      genres: ["Crime", "Drama", "Comedy"],
      slug: "blackkklansman-2018",
      libraryName: "Movies",
    });
    expect(calls.filter((c) => c.includes("/search/movie"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("/movie/487558"))).toHaveLength(1);
  });

  it("searches movies with the year always included", async () => {
    let searchedUrl = "";
    const { service } = makeService({
      "/search/movie": (url) => {
        searchedUrl = url;
        return jsonResponse({ results: [] });
      },
    });
    await service.enrichDraft(draft({ title: "BlacKkKlansman", year: 2018 }));
    const query = new URL(searchedUrl).searchParams;
    expect(query.get("query")).toBe("BlacKkKlansman");
    expect(query.get("year")).toBe("2018");
    expect(query.get("api_key")).toBe("test-api-key");
  });
});

describe("TV show enrichment", () => {
  it("enriches a show using the TV search endpoint and external ids", async () => {
    const { service, calls } = makeService({
      "/search/tv": () =>
        jsonResponse({
          total_results: 1,
          results: [
            {
              id: 95396,
              name: "Severance",
              first_air_date: "2022-02-18",
              popularity: 100,
              vote_count: 3000,
            },
          ],
        }),
      "/tv/95396": () => jsonResponse({ id: 95396, genres: [{ id: 18, name: "Drama" }] }),
      "/tv/95396/external_ids": () => jsonResponse({ id: 95396, imdb_id: "tt11280740" }),
    });

    const result = await service.enrichDraft(
      draft({ title: "Severance", year: 2022, mediaType: "show" }),
    );

    expect(result.status).toBe("enriched");
    expect(result.tmdb).toEqual({
      id: 95396,
      imdbId: "tt11280740",
      genres: ["Drama"],
      slug: "severance-2022",
      libraryName: "TV Shows",
    });
    expect(calls.filter((c) => c.includes("/search/tv"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("/tv/95396/external_ids"))).toHaveLength(1);
  });

  it("searches TV with the first air date year included", async () => {
    let searchedUrl = "";
    const { service } = makeService({
      "/search/tv": (url) => {
        searchedUrl = url;
        return jsonResponse({ results: [] });
      },
    });
    await service.enrichDraft(draft({ title: "Severance", year: 2022, mediaType: "show" }));
    const query = new URL(searchedUrl).searchParams;
    expect(query.get("query")).toBe("Severance");
    expect(query.get("first_air_date_year")).toBe("2022");
  });
});

describe("duplicate movie in same batch", () => {
  it("enriches duplicates with a single API lookup", async () => {
    const { service, calls } = makeService({
      "/search/movie": () =>
        jsonResponse({
          results: [
            {
              id: 438631,
              title: "Dune",
              release_date: "2021-10-22",
              popularity: 90,
              vote_count: 8000,
            },
          ],
        }),
      "/movie/438631": () =>
        jsonResponse({
          id: 438631,
          genres: [{ id: 878, name: "Science Fiction" }],
          imdb_id: "tt1160419",
        }),
    });

    const drafts = [
      draft({ raindropId: "1", artists: ["James Jean"] }),
      draft({ raindropId: "2", artists: ["Matt Ferguson"] }),
      draft({ raindropId: "3", artists: ["Akiko Stehrenberger"] }),
    ];

    const results = await service.enrichDrafts(drafts);

    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.status).toBe("enriched");
      expect(result.tmdb?.id).toBe(438631);
    }
    expect(calls.filter((c) => c.includes("/search/movie"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("/movie/438631"))).toHaveLength(1);
  });
});

describe("remakes", () => {
  it("matches the draft year instead of the original", async () => {
    const { service } = makeService({
      "/search/movie": () =>
        jsonResponse({
          results: [
            { id: 1, title: "Dune", release_date: "1984-12-14", popularity: 30, vote_count: 1000 },
            { id: 2, title: "Dune", release_date: "2021-10-22", popularity: 90, vote_count: 8000 },
          ],
        }),
      "/movie/2": () => jsonResponse({ id: 2, genres: [], imdb_id: "tt1160419" }),
      "/movie/1": () => jsonResponse({ id: 1, genres: [], imdb_id: "tt0087182" }),
    });

    const modern = await service.enrichDraft(draft({ title: "Dune", year: 2021 }));
    expect(modern.status).toBe("enriched");
    expect(modern.tmdb?.id).toBe(2);

    const original = await service.enrichDraft(draft({ title: "Dune", year: 1984 }));
    expect(original.status).toBe("enriched");
    expect(original.tmdb?.id).toBe(1);
  });
});

describe("no result", () => {
  it("marks the draft as needs_review when nothing matches", async () => {
    const { service } = makeService({
      "/search/movie": () =>
        jsonResponse({ results: [{ id: 100, title: "Inception", release_date: "2010-07-16" }] }),
    });

    const result = await service.enrichDraft(draft({ title: "Inception", year: 2011 }));

    expect(result.status).toBe("needs_review");
    expect(result.tmdb).toBeUndefined();
    expect(result.reason).toContain("No TMDB match");
  });
});

describe("ambiguous result", () => {
  it("marks the draft as needs_review when multiple candidates match", async () => {
    const { service } = makeService({
      "/search/movie": () =>
        jsonResponse({
          results: [
            { id: 11, title: "The Match", release_date: "2018-05-01", popularity: 10 },
            { id: 12, title: "The Match", release_date: "2018-09-15", popularity: 20 },
          ],
        }),
    });

    const result = await service.enrichDraft(draft({ title: "The Match", year: 2018 }));

    expect(result.status).toBe("needs_review");
    expect(result.tmdb).toBeUndefined();
    expect(result.reason).toContain("Ambiguous");
  });
});

describe("invalid API key", () => {
  it("fails that draft but continues the batch", async () => {
    const { service } = makeService({
      "/search/movie": (url) => {
        const query = new URL(url).searchParams.get("query");
        if (query === "Bad") {
          return jsonResponse({ status_code: 7, status_message: "Invalid API key" }, 401);
        }
        return jsonResponse({ results: [{ id: 500, title: "Good", release_date: "2020-01-01" }] });
      },
      "/movie/500": () => jsonResponse({ id: 500, genres: [], imdb_id: "tt500" }),
    });

    const results = await service.enrichDrafts([
      draft({ raindropId: "bad", title: "Bad", year: 2020 }),
      draft({ raindropId: "good", title: "Good", year: 2020 }),
    ]);

    expect(results[0].status).toBe("failed");
    expect(results[0].reason).toContain("401");
    expect(results[1].status).toBe("enriched");
  });
});

describe("rate limiting", () => {
  it("fails the draft without terminating the batch", async () => {
    const { service } = makeService({
      "/search/movie": () => jsonResponse({ status_message: "rate limit" }, 429),
    });

    const results = await service.enrichDrafts([draft(), draft({ raindropId: "2" })]);

    for (const result of results) {
      expect(result.status).toBe("failed");
      expect(result.reason).toContain("429");
    }
  });
});

describe("network failure", () => {
  it("fails the draft with a network error", async () => {
    const { service } = makeService({
      "/search/movie": () => Promise.reject(new Error("socket hang up")),
    });

    const result = await service.enrichDraft(draft());

    expect(result.status).toBe("failed");
    expect(result.reason).toContain("network");
  });
});

describe("timeout", () => {
  it("fails the draft when the request times out", async () => {
    const neverResolves = (_input: string | URL | Request, init?: RequestInit): Promise<Response> =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      });

    const service = new TMDBEnrichmentService({
      apiKey: "test-api-key",
      fetchImpl: neverResolves,
      timeoutMs: 50,
      logger: silentLogger,
    });

    const result = await service.enrichDraft(draft());

    expect(result.status).toBe("failed");
    expect(result.reason).toMatch(/timed out/i);
  });
});

describe("cache hit / miss", () => {
  it("misses the cache on the first lookup and hits on the second", async () => {
    const { service, calls } = makeService({
      "/search/movie": () =>
        jsonResponse({ results: [{ id: 438631, title: "Dune", release_date: "2021-10-22" }] }),
      "/movie/438631": () => jsonResponse({ id: 438631, genres: [], imdb_id: "tt1160419" }),
    });

    const first = await service.enrichDraft(draft());
    expect(service.cache.has("movie:Dune|2021")).toBe(true);
    expect(calls.filter((c) => c.includes("/search/movie"))).toHaveLength(1);

    const second = await service.enrichDraft(draft({ raindropId: "2" }));
    expect(second.tmdb?.id).toBe(438631);
    expect(calls.filter((c) => c.includes("/search/movie"))).toHaveLength(1);
    expect(calls.filter((c) => c.includes("/movie/438631"))).toHaveLength(1);
  });

  it("logs MISS for a cache miss and HIT for a cache hit", async () => {
    const logs: string[] = [];
    const logger = { log: (m: string) => logs.push(m), error: () => {} };
    const { impl } = makeFetch({
      "/search/movie": () =>
        jsonResponse({ results: [{ id: 438631, title: "Dune", release_date: "2021-10-22" }] }),
      "/movie/438631": () => jsonResponse({ id: 438631, genres: [], imdb_id: "tt1160419" }),
    });
    const service = new TMDBEnrichmentService({
      apiKey: "test-api-key",
      fetchImpl: impl,
      logger,
    });

    await service.enrichDraft(draft());
    await service.enrichDraft(draft({ raindropId: "2" }));

    const missIndex = logs.indexOf("MISS");
    const hitIndex = logs.indexOf("HIT");
    expect(missIndex).toBeGreaterThan(-1);
    expect(hitIndex).toBeGreaterThan(missIndex);
  });
});

describe("searchAndMatch outcomes", () => {
  it("returns none when no candidate satisfies the criteria", async () => {
    const client = new TMDBApiClient({
      apiKey: "k",
      fetchImpl: makeFetch({
        "/search/movie": () =>
          jsonResponse({ results: [{ id: 1, title: "Other", release_date: "2010-01-01" }] }),
      }).impl,
    });
    const outcome = await searchAndMatch(client, draft({ title: "Dune", year: 2021 }));
    expect(outcome.status).toBe("none");
  });

  it("returns a match for a single candidate", async () => {
    const client = new TMDBApiClient({
      apiKey: "k",
      fetchImpl: makeFetch({
        "/search/movie": () =>
          jsonResponse({ results: [{ id: 2, title: "Dune", release_date: "2021-10-22" }] }),
      }).impl,
    });
    const outcome = await searchAndMatch(client, draft({ title: "Dune", year: 2021 }));
    expect(outcome.status).toBe("match");
    if (outcome.status === "match") {
      expect(outcome.match.candidate.id).toBe(2);
      expect(outcome.match.confidence).toBeGreaterThan(0);
    }
  });

  it("returns ambiguous for multiple matching candidates", async () => {
    const client = new TMDBApiClient({
      apiKey: "k",
      fetchImpl: makeFetch({
        "/search/movie": () =>
          jsonResponse({
            results: [
              { id: 1, title: "Dune", release_date: "2021-01-01" },
              { id: 2, title: "Dune", release_date: "2021-06-01" },
            ],
          }),
      }).impl,
    });
    const outcome = await searchAndMatch(client, draft({ title: "Dune", year: 2021 }));
    expect(outcome.status).toBe("ambiguous");
    if (outcome.status === "ambiguous") {
      expect(outcome.candidates).toHaveLength(2);
    }
  });
});
