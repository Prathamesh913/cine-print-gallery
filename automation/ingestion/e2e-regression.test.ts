import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { downloadSourceImage } from "./download";
import { prepareImage } from "./image";
import { R2ImagePublisher } from "./r2-images";
import { NotionDraftSync } from "../notion/sync";
import type { NotionClient } from "../notion/client";
import { InMemoryJobStore } from "./state";
import { runIngestion } from "./runner";
import { createLogger, createMemoryLoggerSink } from "./logger";
import { InMemoryPosterCatalog } from "./poster-catalog";
import { runPublishingSync } from "./publish";
import type { NotionPageLike } from "./notion-pages";
import type { CinePrintDraft } from "../shared/cineprint-draft";
import type { R2Store } from "../migration/types";

const PNG = fs.readFileSync(path.resolve(__dirname, "../blob/fixtures/test-image.png"));
const OPTIMIZER = { name: "sharp", version: "0.35.3", libvipsVersion: "8.18.3" };
const NOW = new Date("2026-11-10T12:00:00.000Z");
const BOOKMARK = {
  _id: 123,
  tags: ["movie:BlacKkKlansman|2018", "artist:Eileen Steinbach"],
  link: "https://api.raindrop.io/v2/raindrop/123/file?type=image/png",
  note: "https://example.com/source",
  lastUpdate: "2026-11-10T00:00:00.000Z",
};

function richText(value: string) {
  return { type: "rich_text", rich_text: [{ plain_text: value }] };
}
function title(value: string) {
  return { type: "title", title: [{ plain_text: value }] };
}
function url(value: string) {
  return { type: "url", url: value };
}
function select(value: string) {
  return { type: "select", select: { name: value } };
}
function status(value: string) {
  return { type: "status", status: { name: value } };
}
function numberValue(value: number) {
  return { type: "number", number: value };
}
function multiSelect(values: string[]) {
  return { type: "multi_select", multi_select: values.map((name) => ({ name })) };
}

function page(image: string, pageStatus?: string): NotionPageLike {
  const properties: Record<string, unknown> = {
    Name: title("BlacKkKlansman"),
    Year: numberValue(2018),
    "Media Type": select("movie"),
    Genre: multiSelect(["Crime", "Drama"]),
    "IMDb ID": richText("tt7349662"),
    "TMDB ID": richText("487558"),
    "Library Names": multiSelect(["Movies"]),
    Slug: richText("blackkklansman-2018"),
    Artist: richText("Eileen Steinbach"),
    "Image URL": url(image),
    "Source URL": url("https://example.com/source"),
    "Raindrop ID": richText("123"),
    "CinePrint Poster ID": richText("artwork-123"),
  };
  if (pageStatus !== undefined) properties.Status = status(pageStatus);
  return { id: "page-1", properties };
}

function source(pages: NotionPageLike[]) {
  return {
    listPages: async () => pages,
    listIdentityRecords: async () => [],
  };
}

function notionClient() {
  let stored: { id: string; properties: Record<string, unknown> } | null = null;
  const createPage = vi.fn(async (properties: Record<string, unknown>) => {
    stored = { id: "notion-page-1", properties };
    return "notion-page-1";
  });
  const updatePage = vi.fn(async (pageId: string, properties: Record<string, unknown>) => {
    stored = { id: pageId, properties: { ...(stored?.properties ?? {}), ...properties } };
  });
  const client: NotionClient = {
    findByRaindropId: vi.fn(async () => stored),
    createPage,
    updatePage,
  };
  return { client, createPage, updatePage };
}

function r2Store() {
  const objects = new Map<string, { size: number; sha256: string; contentType: string }>();
  const put = vi.fn(
    async (options: { key: string; body: Buffer; contentType: string; sha256: string }) => {
      objects.set(options.key, {
        size: options.body.length,
        sha256: options.sha256,
        contentType: options.contentType,
      });
    },
  );
  const store = {
    head: vi.fn(async (key: string) => objects.get(key) ?? null),
    put,
    verify: vi.fn(async (key: string) => ({
      ok: objects.has(key),
      metadata: null,
      reason: objects.has(key) ? null : "missing",
    })),
    verifyOrigin: vi.fn(async () => ({
      ok: true,
      exists: true,
      checksumOk: true,
      metadataOk: true,
      sizeOk: true,
      metadata: null,
      sha256: null,
      sizeBytes: null,
      reason: null,
    })),
    publicVerify: vi.fn(async () => ({
      ok: true,
      status: 200,
      contentType: "image/png",
      contentLength: 1,
      cacheControl: "public, max-age=31536000, immutable",
      sha256: null,
      reason: null,
    })),
    objects,
  } as unknown as R2Store & { objects: Map<string, unknown>; put: typeof put };
  return store;
}

function logger() {
  const sink = createMemoryLoggerSink();
  return createLogger({
    runId: "e2e",
    mode: "ingest",
    dryRun: false,
    stream: sink.stream,
    now: () => NOW,
  });
}

describe("end-to-end regression: bookmark -> redirect -> R2 -> Notion -> publish -> retry", () => {
  it("runs the full mocked pipeline without credential leakage or duplicate writes", async () => {
    const requests: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({ url: String(input), authorization: headers.get("authorization") });
      if (requests.length === 1) {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/poster.png" },
        });
      }
      return new Response(new Uint8Array(PNG), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": String(PNG.length) },
      });
    });

    const store = r2Store();
    const notion = notionClient();
    const jobs = new InMemoryJobStore();
    const publisher = new R2ImagePublisher({
      store,
      optimizer: OPTIMIZER,
      logger: logger(),
      now: () => NOW,
    });

    const deps = {
      jobStore: jobs,
      enrich: async (draft: CinePrintDraft) => ({
        ...draft,
        status: "enriched" as const,
        tmdb: {
          id: 487558,
          imdbId: "tt7349662",
          genres: ["Crime", "Drama"],
          slug: "blackkklansman-2018",
          libraryName: "Movies" as const,
        },
      }),
      download: (sourceUrl: string) =>
        downloadSourceImage(sourceUrl, {
          authToken: "raindrop-secret",
          fetchImpl: fetchImpl as unknown as typeof fetch,
        }),
      prepare: (downloaded: Parameters<typeof prepareImage>[0]) =>
        prepareImage(downloaded, { optimizer: OPTIMIZER }),
      r2: { publish: publisher.publish.bind(publisher) },
      optimizer: OPTIMIZER,
      drafts: new NotionDraftSync(notion.client),
      logger: logger(),
      now: () => NOW,
      concurrency: 1,
      maxAttempts: 3,
      retryDelayMs: 60_000,
      batchLimit: 10,
    };

    const ingestion = await runIngestion(deps, {
      bookmarks: [BOOKMARK],
      dryRun: false,
      runId: "e2e-ingest",
      startedAt: NOW,
    });

    expect(ingestion.counts).toMatchObject({
      newCandidates: 1,
      tmdbMatches: 1,
      uploadsVerified: 1,
      notionDraftsCreated: 1,
      failed: 0,
    });
    expect(requests[0].authorization).toBe("Bearer raindrop-secret");
    expect(requests[1].authorization).toBeNull();
    expect(store.put).toHaveBeenCalledTimes(2);
    expect(notion.createPage).toHaveBeenCalledTimes(1);

    const job = await jobs.get("artwork-123");
    expect(job?.stage).toBe("notion_draft_created");
    const image = job?.images?.original.url;
    expect(image).toContain(
      "https://images.cineprint.click/cineprint/versions/original/artwork-123/",
    );

    // Simulate a crash after R2 verification but before Notion creation. Retry
    // must reuse the image objects and update the existing draft.
    await jobs.save({ ...job!, stage: "image_verified", notionPageId: null });
    const retry = await runIngestion(deps, {
      bookmarks: [BOOKMARK],
      dryRun: false,
      runId: "e2e-retry",
      startedAt: NOW,
    });
    expect(retry.counts.failed).toBe(0);
    expect(store.put).toHaveBeenCalledTimes(2);
    expect(notion.createPage).toHaveBeenCalledTimes(1);
    expect(notion.updatePage).toHaveBeenCalled();

    const catalog = new InMemoryPosterCatalog();
    const publishOnce = (pageStatus?: string) =>
      runPublishingSync(
        {
          source: source([page(image!, pageStatus)]),
          catalog,
          jobs,
          logger: logger(),
          now: () => NOW,
        },
        { runId: `publish-${pageStatus ?? "blank"}`, dryRun: false },
      );

    const published = await publishOnce("Published");
    expect(published.counts.firestoreRecordsCreated).toBe(1);
    expect((await catalog.get("artwork-123"))?.data.r2Image).toBeDefined();

    const blank = await publishOnce();
    expect(blank.counts.firestoreRecordsUpdated).toBe(0);
    expect(blank.counts.needsReview).toBe(1);
    expect((await catalog.get("artwork-123"))?.data.status).toBe("published");

    const unpublished = await publishOnce("Draft");
    expect(unpublished.counts.firestoreRecordsUpdated).toBe(1);
    expect((await catalog.get("artwork-123"))?.data.status).toBe("draft");

    const republished = await publishOnce("Published");
    expect(republished.counts.firestoreRecordsUpdated).toBe(1);
    expect((await catalog.get("artwork-123"))?.data.status).toBe("published");
  });
});
