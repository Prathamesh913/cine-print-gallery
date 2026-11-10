import { describe, expect, it, vi } from "vitest";
import { TMDBEnrichmentService } from "./service";
import type { CinePrintDraft } from "../shared/cineprint-draft";

function draft(): CinePrintDraft {
  return {
    raindropId: "123",
    title: "BlacKkKlansman",
    year: 2018,
    mediaType: "movie",
    artists: ["Eileen Steinbach"],
    imageUrl: "https://example.com/a.png",
    sourceUrl: "https://example.com/source",
    posterId: "artwork-123",
  };
}

function service(fetchImpl: typeof fetch) {
  return new TMDBEnrichmentService({
    apiKey: "test-key",
    fetchImpl,
    logger: { log: () => undefined, error: () => undefined },
  });
}

function details(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("reviewed TMDB identity", () => {
  it("enriches with the exact reviewed ID instead of searching again", async () => {
    const fetchImpl = vi.fn(async () =>
      details({ id: 999, imdb_id: "tt0000999", genres: [{ id: 18, name: "Drama" }] }),
    );

    const outcome = await service(fetchImpl as unknown as typeof fetch).enrichDraftWithTmdbId(
      draft(),
      999,
    );

    expect(outcome.status).toBe("enriched");
    expect(outcome.tmdb?.id).toBe(999);
    expect(outcome.tmdb?.imdbId).toBe("tt0000999");
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/movie/999");
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain("/search/");
  });

  it("requires review when the reviewed identity has no IMDb ID", async () => {
    const fetchImpl = vi.fn(async () => details({ id: 999, imdb_id: null, genres: [] }));
    const outcome = await service(fetchImpl as unknown as typeof fetch).enrichDraftWithTmdbId(
      draft(),
      999,
    );

    expect(outcome.status).toBe("needs_review");
    expect(outcome.reason).toContain("IMDb");
  });

  it("fails the draft when TMDB is unavailable", async () => {
    const fetchImpl = vi.fn(async () => details({}, 500));
    const outcome = await service(fetchImpl as unknown as typeof fetch).enrichDraftWithTmdbId(
      draft(),
      999,
    );

    expect(outcome.status).toBe("failed");
    expect(outcome.reason).toContain("500");
  });

  it("rejects an invalid reviewed ID without calling TMDB", async () => {
    const fetchImpl = vi.fn();
    const outcome = await service(fetchImpl as unknown as typeof fetch).enrichDraftWithTmdbId(
      draft(),
      0,
    );

    expect(outcome.status).toBe("needs_review");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
