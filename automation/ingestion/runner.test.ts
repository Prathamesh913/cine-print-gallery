import { describe, expect, it, vi } from "vitest";
import type { CinePrintDraft } from "../shared/cineprint-draft";
import type { EnrichedDraft } from "../tmdb/types";
import { ImageDownloadError } from "./download";
import { R2UploadError } from "../migration/r2";
import { NotionNetworkError } from "../notion/client";
import { createMemoryLoggerSink, createLogger } from "./logger";
import { runIngestion, mapWithConcurrency, type IngestionRunnerDeps } from "./runner";
import { InMemoryJobStore } from "./state";
import type { BookmarkInput } from "./validation";
import type { IngestionJob, IngestionImageReferences } from "./types";
import type { PreparedImage } from "./image";

const NOW = new Date("2026-11-10T12:00:00.000Z");
const SOURCE_TIME = "2026-11-01T00:00:00.000Z";

function bookmark(id = "123", overrides: Partial<BookmarkInput> = {}): BookmarkInput {
  return {
    _id: Number(id),
    tags: ["movie:BlacKkKlansman|2018", "artist:Eileen Steinbach"],
    link: `https://api.raindrop.io/v2/raindrop/${id}/file?type=image/png`,
    note: "https://example.com/source",
    lastUpdate: SOURCE_TIME,
    ...overrides,
  };
}

function enriched(draft: CinePrintDraft): EnrichedDraft {
  return {
    ...draft,
    status: "enriched",
    tmdb: {
      id: 487558,
      imdbId: "tt7349662",
      genres: ["Crime", "Drama"],
      slug: "blackkklansman-2018",
      libraryName: "Movies",
    },
  };
}

function imageRef(posterId: string, sha = "a".repeat(64)): IngestionImageReferences {
  return {
    sourceSha256: sha,
    original: {
      key: `cineprint/versions/original/${posterId}/${sha}.png`,
      url: `https://images.cineprint.click/cineprint/versions/original/${posterId}/${sha}.png`,
      sha256: sha,
      sizeBytes: 1000,
      contentType: "image/png",
    },
    optimized: {
      key: `cineprint/versions/optimized/${posterId}/${sha}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
      url: `https://images.cineprint.click/cineprint/versions/optimized/${posterId}/${sha}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
      sha256: "b".repeat(64),
      sizeBytes: 400,
      contentType: "image/webp",
    },
    verifiedAt: "2026-11-10T00:00:00.000Z",
  };
}

function prepared(): PreparedImage {
  return {
    original: {
      buffer: Buffer.from("original"),
      contentType: "image/png",
      sha256: "a".repeat(64),
      sizeBytes: 8,
      width: 1000,
      height: 1500,
      extension: "png",
    },
    optimized: {
      buffer: Buffer.from("webp"),
      contentType: "image/webp",
      sha256: "b".repeat(64),
      sizeBytes: 4,
      width: 800,
      height: 1200,
    },
    optimizer: { name: "sharp", version: "0.35.3", libvipsVersion: "8.18.3" },
    sourceWidth: 1000,
    sourceHeight: 1500,
  };
}

interface Harness {
  deps: IngestionRunnerDeps;
  jobStore: InMemoryJobStore;
  enrich: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  syncOne: ReturnType<typeof vi.fn>;
}

function harness(overrides: Partial<IngestionRunnerDeps> = {}): Harness {
  const sink = createMemoryLoggerSink();
  const jobStore = new InMemoryJobStore();
  const enrich = vi.fn(async (draft: CinePrintDraft) => enriched(draft));
  const download = vi.fn(async () => ({
    buffer: Buffer.from("original"),
    contentType: "image/png" as const,
    finalUrl: "https://example.com/a.png",
    sha256: "a".repeat(64),
    sizeBytes: 8,
  }));
  const publish = vi.fn(async (posterId: string) => imageRef(posterId));
  const syncOne = vi.fn(async (draft: EnrichedDraft) => ({
    kind: "created" as const,
    draft,
    pageId: `notion-${draft.posterId}`,
  }));

  const deps: IngestionRunnerDeps = {
    jobStore,
    enrich,
    download,
    prepare: async () => prepared(),
    r2: { publish },
    optimizer: { name: "sharp", version: "0.35.3", libvipsVersion: "8.18.3" },
    drafts: { syncOne },
    logger: createLogger({
      runId: "run-1",
      mode: "ingest",
      dryRun: false,
      stream: sink.stream,
      now: () => NOW,
    }),
    now: () => NOW,
    concurrency: 1,
    maxAttempts: 3,
    retryDelayMs: 60_000,
    batchLimit: 25,
    ...overrides,
  };

  return { deps, jobStore, enrich, download, publish, syncOne };
}

async function run(harness: Harness, bookmarks: BookmarkInput[], dryRun = false) {
  return runIngestion(harness.deps, { bookmarks, dryRun, runId: "run-1", startedAt: NOW });
}

function jobFor(posterId: string, overrides: Partial<IngestionJob> = {}): IngestionJob {
  return {
    schemaVersion: 1,
    posterId,
    raindropId: posterId.replace("artwork-", ""),
    sourceKey: `raindrop:${posterId.replace("artwork-", "")}`,
    stage: "image_verified",
    attempts: 1,
    lastError: "previous failure",
    retryable: true,
    nextAttemptAt: null,
    raindropUpdatedAt: SOURCE_TIME,
    title: "BlacKkKlansman",
    year: 2018,
    mediaType: "movie",
    artists: ["Eileen Steinbach"],
    sourceUrl: "https://example.com/source",
    sourceImageUrl: "https://api.raindrop.io/v2/raindrop/123/file",
    sourceImageSha256: "a".repeat(64),
    tmdbId: 487558,
    imdbId: "tt7349662",
    slug: "blackkklansman-2018",
    genres: ["Crime", "Drama"],
    libraryName: "Movies",
    images: imageRef(posterId),
    notionPageId: null,
    notionStatus: null,
    createdAt: SOURCE_TIME,
    updatedAt: SOURCE_TIME,
    ...overrides,
  };
}

describe("ingestion runner", () => {
  it("runs the full pipeline and checkpoints each poster", async () => {
    const h = harness();
    const summary = await run(h, [bookmark("123"), bookmark("456")]);

    expect(summary.counts).toMatchObject({
      bookmarksDiscovered: 2,
      alreadyProcessed: 0,
      newCandidates: 2,
      tmdbMatches: 2,
      needsReview: 0,
      uploadsVerified: 2,
      notionDraftsCreated: 2,
      failed: 0,
    });
    expect(h.publish).toHaveBeenCalledTimes(2);
    expect(h.syncOne).toHaveBeenCalledTimes(2);
    expect((await h.jobStore.get("artwork-123"))?.stage).toBe("notion_draft_created");
    expect((await h.jobStore.get("artwork-456"))?.stage).toBe("notion_draft_created");
  });

  it("is idempotent across repeated executions", async () => {
    const h = harness();
    await run(h, [bookmark("123")]);
    const summary = await run(h, [bookmark("123")]);

    expect(summary.counts.alreadyProcessed).toBe(1);
    expect(summary.counts.newCandidates).toBe(0);
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect(h.syncOne).toHaveBeenCalledTimes(1);
  });

  it("processes a changed source revision again without losing identity", async () => {
    const h = harness();
    await run(h, [bookmark("123")]);
    h.syncOne.mockResolvedValue({
      kind: "updated",
      draft: enriched({
        raindropId: "123",
        title: "BlacKkKlansman",
        year: 2018,
        mediaType: "movie",
        artists: ["Eileen Steinbach"],
        imageUrl: "x",
        sourceUrl: "https://example.com/source",
        posterId: "artwork-123",
      }),
      pageId: "notion-artwork-123",
      changed: true,
    });

    const summary = await run(h, [bookmark("123", { lastUpdate: "2026-11-05T00:00:00.000Z" })]);
    expect(summary.counts.notionDraftsUpdated).toBe(1);
    expect(h.syncOne).toHaveBeenCalledTimes(2);
  });

  it("reports missing metadata without creating a job", async () => {
    const h = harness();
    const summary = await run(h, [bookmark("123", { tags: [] })]);

    expect(summary.counts.failed).toBe(0);
    expect(summary.counts.needsReview).toBe(1);
    expect(summary.failures[0].stage).toBe("validating");
    expect(await h.jobStore.list()).toHaveLength(0);
  });

  it("holds ambiguous TMDB results for review", async () => {
    const h = harness();
    h.enrich.mockResolvedValue({
      ...bookmark("123"),
      posterId: "artwork-123",
      status: "needs_review",
      reason: "Ambiguous TMDB match: A (2018), B (2018)",
    });

    const summary = await run(h, [bookmark("123")]);
    expect(summary.counts.needsReview).toBe(1);
    expect((await h.jobStore.get("artwork-123"))?.stage).toBe("needs_review");
    expect(h.publish).not.toHaveBeenCalled();
  });

  it("resumes a persisted human decision instead of re-ranking", async () => {
    const h = harness();
    await h.jobStore.save(
      jobFor("artwork-123", {
        stage: "needs_review",
        images: null,
        tmdbId: null,
        imdbId: null,
        slug: null,
        reviewDecision: {
          posterId: "artwork-123",
          raindropId: "123",
          tmdbId: 999,
          decidedAt: SOURCE_TIME,
        },
      }),
    );

    const summary = await run(h, [bookmark("123")]);
    expect(summary.counts.notionDraftsCreated).toBe(1);
    expect(h.enrich).toHaveBeenCalledWith(
      expect.objectContaining({ posterId: "artwork-123" }),
      expect.objectContaining({ tmdbId: 999 }),
    );
  });

  it("records a TMDB failure as retryable", async () => {
    const h = harness();
    h.enrich.mockResolvedValue({
      ...bookmark("123"),
      posterId: "artwork-123",
      status: "failed",
      reason: "TMDB API request failed (HTTP 500)",
    });

    const summary = await run(h, [bookmark("123")]);
    expect(summary.counts.failed).toBe(1);
    const job = await h.jobStore.get("artwork-123");
    expect(job?.stage).toBe("failed");
    expect(job?.retryable).toBe(true);
  });

  it("records an image preparation failure without uploading", async () => {
    const h = harness({
      prepare: async () => {
        throw new Error("optimizer did not produce a valid WebP");
      },
    });

    const summary = await run(h, [bookmark("123")]);
    expect(summary.counts.failed).toBe(1);
    expect(h.publish).not.toHaveBeenCalled();
    expect((await h.jobStore.get("artwork-123"))?.stage).toBe("failed");
  });

  it("records a retryable download failure and retries it later", async () => {
    const h = harness();
    h.download.mockRejectedValue(new ImageDownloadError("HTTP 503", true));

    const summary = await run(h, [bookmark("123")]);
    expect(summary.counts.failed).toBe(1);
    const job = await h.jobStore.get("artwork-123");
    expect(job?.stage).toBe("failed");
    expect(job?.retryable).toBe(true);
    expect(job?.nextAttemptAt).toBe(new Date(NOW.getTime() + 60_000).toISOString());
  });

  it("does not retry a permanent image validation failure", async () => {
    const h = harness();
    h.download.mockRejectedValue(new ImageDownloadError("unsupported image content type"));

    await run(h, [bookmark("123")]);
    const job = await h.jobStore.get("artwork-123");
    expect(job?.retryable).toBe(false);
    expect(job?.nextAttemptAt).toBeNull();
  });

  it("recovers after an R2 failure without re-uploading a verified image", async () => {
    const h = harness();
    h.publish.mockRejectedValueOnce(new R2UploadError("R2 unavailable", true));

    const first = await run(h, [bookmark("123")]);
    expect(first.counts.failed).toBe(1);

    const failed = await h.jobStore.get("artwork-123");
    expect(failed?.stage).toBe("failed");

    // Simulate the upload having been verified before the state write failed.
    await h.jobStore.save({
      ...failed!,
      stage: "image_verified",
      images: imageRef("artwork-123"),
      retryable: false,
    });

    const second = await run(h, [bookmark("123")]);
    expect(second.counts.notionDraftsCreated).toBe(1);
    expect(h.publish).toHaveBeenCalledTimes(1);
    expect(h.download).toHaveBeenCalledTimes(1);
  });

  it("recovers a Notion failure by updating the existing draft", async () => {
    const h = harness();
    h.syncOne.mockRejectedValueOnce(new NotionNetworkError("network down"));

    const first = await run(h, [bookmark("123")]);
    expect(first.counts.failed).toBe(1);
    const failed = await h.jobStore.get("artwork-123");
    await h.jobStore.save({ ...failed!, nextAttemptAt: null });

    const second = await run(h, [bookmark("123")]);
    expect(second.counts.failed).toBe(0);
    expect(second.counts.notionDraftsCreated).toBe(1);
  });

  it("does not write anything in dry-run mode", async () => {
    const h = harness();
    const summary = await run(h, [bookmark("123")], true);

    expect(summary.counts.newCandidates).toBe(1);
    expect(summary.counts.uploadsVerified).toBe(0);
    expect(summary.counts.notionDraftsCreated).toBe(0);
    expect(h.jobStore.writes).toBe(0);
    expect(h.publish).not.toHaveBeenCalled();
    expect(h.syncOne).not.toHaveBeenCalled();
  });

  it("deduplicates repeated bookmarks in one payload", async () => {
    const h = harness();
    const summary = await run(h, [bookmark("123"), bookmark("123")]);

    expect(summary.counts.bookmarksDiscovered).toBe(2);
    expect(summary.counts.newCandidates).toBe(1);
    expect(h.syncOne).toHaveBeenCalledTimes(1);
  });

  it("resumes jobs that fell outside the fetched page window", async () => {
    const h = harness();
    await h.jobStore.save(jobFor("artwork-999"));

    const summary = await run(h, []);
    expect(summary.counts.newCandidates).toBe(1);
    expect(summary.counts.notionDraftsCreated).toBe(1);
    expect(h.syncOne).toHaveBeenCalledTimes(1);
  });

  it("bounds concurrency", async () => {
    let active = 0;
    let peak = 0;
    const values: number[] = [];

    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      values.push(value);
      active -= 1;
      return value;
    });

    expect(peak).toBeLessThanOrEqual(2);
    expect(values.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
