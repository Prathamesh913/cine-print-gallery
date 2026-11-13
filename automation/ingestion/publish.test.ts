import { describe, expect, it, vi } from "vitest";
import type { IdentityRecord } from "../../scripts/poster-identity.js";
import type { NotionPageLike, NotionPageSource } from "./notion-pages";
import { InMemoryPosterCatalog, type PosterCatalog } from "./poster-catalog";
import { InMemoryJobStore } from "./state";
import { createJob } from "./state";
import { createMemoryLoggerSink, createLogger } from "./logger";
import { runPublishingSync } from "./publish";
import type { IngestionJob, IngestionImageReferences } from "./types";

const IMAGE =
  "https://images.cineprint.click/cineprint/versions/original/artwork-123/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png";

function title(value: string) {
  return { type: "title", title: [{ plain_text: value }] };
}
function richText(value: string) {
  return { type: "rich_text", rich_text: [{ plain_text: value }] };
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

interface PageOptions {
  id?: string;
  status?: string;
  posterId?: string | null;
  raindropId?: string | null;
  image?: string;
  images?: string[];
  title?: string;
}

function page(options: PageOptions = {}): NotionPageLike {
  const image = options.image ?? IMAGE;
  const images = options.images ?? [image];
  const properties: Record<string, unknown> = {
    Name: title(options.title ?? "BlacKkKlansman"),
    Year: numberValue(2018),
    "Media Type": select("movie"),
    Genre: multiSelect(["Crime", "Drama"]),
    "IMDb ID": richText("tt7349662"),
    "TMDB ID": richText("487558"),
    "Library Names": multiSelect(["Movies"]),
    Slug: richText("blackkklansman-2018"),
    Artist: richText("Eileen Steinbach"),
    "Image URL": url(images.join(", ")),
    "Source URL": url("https://example.com/source"),
    Status: status(options.status ?? "Published"),
  };
  if (options.posterId !== null) {
    properties["CinePrint Poster ID"] = richText(options.posterId ?? "artwork-123");
  }
  if (options.raindropId !== null) {
    properties["Raindrop ID"] = richText(options.raindropId ?? "123");
  }
  return { id: options.id ?? "page-1", properties };
}

function source(pages: NotionPageLike[], identities: IdentityRecord[] = []): NotionPageSource {
  return {
    listPages: vi.fn().mockResolvedValue(pages),
    listIdentityRecords: vi.fn().mockResolvedValue(identities),
  };
}

function logger() {
  const sink = createMemoryLoggerSink();
  return createLogger({ runId: "run-1", mode: "publish", dryRun: true, stream: sink.stream });
}

function imageRef(posterId = "artwork-123", sourceSha = "a".repeat(64)): IngestionImageReferences {
  return {
    sourceSha256: sourceSha,
    original: {
      key: `cineprint/versions/original/${posterId}/${sourceSha}.png`,
      url: `https://images.cineprint.click/cineprint/versions/original/${posterId}/${sourceSha}.png`,
      sha256: sourceSha,
      sizeBytes: 1000,
      contentType: "image/png",
    },
    optimized: {
      key: `cineprint/versions/optimized/${posterId}/${sourceSha}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
      url: `https://images.cineprint.click/cineprint/versions/optimized/${posterId}/${sourceSha}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
      sha256: "b".repeat(64),
      sizeBytes: 500,
      contentType: "image/webp",
    },
    verifiedAt: "2026-11-10T00:00:00.000Z",
  };
}

function job(overrides: Partial<IngestionJob> = {}): IngestionJob {
  const base = createJob({
    posterId: "artwork-123",
    raindropId: "123",
    sourceKey: "raindrop:123",
    raindropUpdatedAt: "2026-11-01T00:00:00.000Z",
    title: "BlacKkKlansman",
    year: 2018,
    mediaType: "movie",
    artists: ["Eileen Steinbach"],
    sourceUrl: "https://example.com/source",
    sourceImageUrl: "https://api.raindrop.io/v2/raindrop/123/file",
    now: new Date("2026-11-01T00:00:00.000Z"),
  });
  return { ...base, stage: "notion_draft_created", images: imageRef(), ...overrides };
}

function writes(catalog: PosterCatalog) {
  return (catalog as InMemoryPosterCatalog).writes;
}

async function run(options: {
  pages: NotionPageLike[];
  identities?: IdentityRecord[];
  catalog?: PosterCatalog;
  jobs?: IngestionJob[];
  dryRun?: boolean;
}) {
  const catalog = options.catalog ?? new InMemoryPosterCatalog();
  const jobs = new InMemoryJobStore(options.jobs ?? []);
  const summary = await runPublishingSync(
    {
      source: source(options.pages, options.identities),
      catalog,
      jobs,
      logger: logger(),
      now: () => new Date("2026-11-10T12:00:00.000Z"),
    },
    { runId: "run-1", dryRun: options.dryRun ?? false },
  );
  return { summary, catalog, jobs };
}

describe("publishing sync", () => {
  it("creates a published Firestore record with the dynamic R2 reference", async () => {
    const { summary, catalog, jobs } = await run({
      pages: [page()],
      jobs: [job()],
    });

    expect(summary.counts.firestoreRecordsCreated).toBe(1);
    expect(summary.counts.failed).toBe(0);
    const doc = await catalog.get("artwork-123");
    expect(doc?.data.status).toBe("published");
    expect(doc?.data.notionPageId).toBe("page-1");
    expect(doc?.data.source).toBe("Raindrop");
    expect((doc?.data.r2Image as IngestionImageReferences).optimized.url).toContain(
      "/versions/optimized/",
    );
    expect(await jobs.get("artwork-123")).toMatchObject({ stage: "firestore_synced" });
  });

  it("derives artwork-{raindropId} when no canonical property exists", async () => {
    const { summary, catalog } = await run({
      pages: [page({ posterId: null, raindropId: "999" })],
      jobs: [job({ posterId: "artwork-999", raindropId: "999", images: null })],
    });

    expect(summary.counts.firestoreRecordsCreated).toBe(1);
    expect(await catalog.get("artwork-999")).toBeTruthy();
  });

  it("excludes records that are not published", async () => {
    const { summary, catalog } = await run({
      pages: [page({ status: "Draft" })],
    });

    expect(summary.counts.publishedRecordsDiscovered).toBe(0);
    expect(summary.counts.firestoreRecordsCreated).toBe(0);
    expect(summary.counts.alreadySynchronized).toBe(0);
    expect(writes(catalog)).toHaveLength(0);
  });

  it("never publishes a Draft even when an ingestion job exists", async () => {
    const published = page();
    const draft = page({
      id: "page-2",
      posterId: "artwork-456",
      raindropId: "456",
      title: "Draft Poster",
      status: "Draft",
    });

    const { summary, catalog } = await run({
      pages: [published, draft],
      jobs: [job(), job({ posterId: "artwork-456", raindropId: "456", sourceKey: "raindrop:456" })],
    });

    // Only the Published page is eligible; the Draft page must not create or
    // update a Firestore document even though its ingestion job could authorize
    // a creation.
    expect(summary.counts.publishedRecordsDiscovered).toBe(1);
    expect(summary.counts.firestoreRecordsCreated).toBe(1);
    expect(await catalog.get("artwork-123")).toBeTruthy();
    expect(await catalog.get("artwork-456")).toBeNull();
    expect(writes(catalog)).toEqual([{ kind: "create", id: "artwork-123" }]);
  });

  it("keeps Published records eligible", async () => {
    const { summary, catalog } = await run({
      pages: [page({ status: "Published" })],
      jobs: [job()],
    });

    expect(summary.counts.publishedRecordsDiscovered).toBe(1);
    expect(summary.counts.firestoreRecordsCreated).toBe(1);
    expect((await catalog.get("artwork-123"))?.data.status).toBe("published");
  });

  it("down-syncs a record that is unpublished in Notion", async () => {
    const first = await run({ pages: [page()], jobs: [job()] });
    expect((await first.catalog.get("artwork-123"))?.data.status).toBe("published");

    const unpublished = await runPublishingSync(
      {
        source: source([page({ status: "Draft" })]),
        catalog: first.catalog,
        jobs: new InMemoryJobStore(),
        logger: logger(),
        now: () => new Date("2026-11-10T12:05:00.000Z"),
      },
      { runId: "run-2", dryRun: false },
    );

    expect(unpublished.counts.firestoreRecordsUpdated).toBe(1);
    expect((await first.catalog.get("artwork-123"))?.data.status).toBe("draft");

    const republished = await runPublishingSync(
      {
        source: source([page()]),
        catalog: first.catalog,
        jobs: new InMemoryJobStore(),
        logger: logger(),
        now: () => new Date("2026-11-10T12:10:00.000Z"),
      },
      { runId: "run-3", dryRun: false },
    );

    expect(republished.counts.firestoreRecordsUpdated).toBe(1);
    expect((await first.catalog.get("artwork-123"))?.data.status).toBe("published");
  });

  it("does not rewrite an already synchronized record", async () => {
    const first = await run({ pages: [page()], jobs: [job()] });
    expect(first.summary.counts.firestoreRecordsCreated).toBe(1);

    const second = await runPublishingSync(
      {
        source: source([page()]),
        catalog: first.catalog,
        jobs: first.jobs,
        logger: logger(),
        now: () => new Date("2026-11-10T12:05:00.000Z"),
      },
      { runId: "run-2", dryRun: false },
    );

    expect(second.counts.alreadySynchronized).toBe(1);
    expect(writes(first.catalog)).toHaveLength(1);
  });

  it("updates an existing record when its metadata changes", async () => {
    const first = await run({ pages: [page()], jobs: [job()] });
    const second = await runPublishingSync(
      {
        source: source([page({ title: "BlacKkKlansman (Updated)" })]),
        catalog: first.catalog,
        jobs: new InMemoryJobStore(),
        logger: logger(),
        now: () => new Date("2026-11-10T12:05:00.000Z"),
      },
      { runId: "run-2", dryRun: false },
    );

    expect(second.counts.firestoreRecordsUpdated).toBe(1);
    expect(writes(first.catalog).map((write) => write.kind)).toEqual(["create", "update"]);
  });

  it("rejects a new record with missing required metadata", async () => {
    const invalid = page();
    delete invalid.properties.Year;
    const { summary, catalog } = await run({ pages: [invalid], jobs: [job()] });

    expect(summary.counts.needsReview).toBe(1);
    expect(summary.counts.failed).toBe(0);
    expect(writes(catalog)).toHaveLength(0);
  });

  it("rejects a new record whose image is not served from R2", async () => {
    const { summary, catalog } = await run({
      pages: [page({ image: "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/a.png" })],
      jobs: [job()],
    });

    expect(summary.counts.needsReview).toBe(1);
    expect(summary.counts.failed).toBe(0);
    expect(writes(catalog)).toHaveLength(0);
  });

  it("keeps going after one record fails and recovers on the next run", async () => {
    const broken = page({ id: "page-broken", posterId: "artwork-111" });
    delete broken.properties.Year;
    const good = page({ id: "page-good", posterId: "artwork-222" });

    const first = await run({
      pages: [broken, good],
      jobs: [
        job({ posterId: "artwork-111", raindropId: "111", images: null }),
        job({ posterId: "artwork-222", raindropId: "222", images: null }),
      ],
    });
    expect(first.summary.counts.firestoreRecordsCreated).toBe(1);
    expect(first.summary.counts.needsReview).toBe(1);
    expect(first.summary.counts.failed).toBe(0);
    expect(await first.catalog.get("artwork-222")).toBeTruthy();

    const fixed = page({ id: "page-broken", posterId: "artwork-111" });
    const second = await runPublishingSync(
      {
        source: source([fixed]),
        catalog: first.catalog,
        jobs: new InMemoryJobStore([
          job({ posterId: "artwork-111", raindropId: "111", images: null }),
        ]),
        logger: logger(),
        now: () => new Date("2026-11-10T12:05:00.000Z"),
      },
      { runId: "run-2", dryRun: false },
    );
    expect(second.counts.firestoreRecordsCreated).toBe(1);
    expect(await first.catalog.get("artwork-111")).toBeTruthy();
  });

  it("does not overwrite a complete document from a partial Notion page", async () => {
    const first = await run({ pages: [page()], jobs: [job()] });
    const partial = page({ title: "Updated title" });
    delete partial.properties.Genre;

    const second = await runPublishingSync(
      {
        source: source([partial]),
        catalog: first.catalog,
        jobs: new InMemoryJobStore(),
        logger: logger(),
        now: () => new Date("2026-11-10T12:05:00.000Z"),
      },
      { runId: "run-2", dryRun: false },
    );

    expect(second.counts.needsReview).toBe(1);
    expect(second.counts.failed).toBe(0);
    expect(writes(first.catalog)).toHaveLength(1);
    expect((await first.catalog.get("artwork-123"))?.data.title).toBe("BlacKkKlansman");
  });

  it("fails closed when two pages claim the same poster identity", async () => {
    const { summary, catalog } = await run({
      pages: [
        page({ id: "page-a" }),
        page({
          id: "page-b",
          image: IMAGE.replace("/123/", "/123/").replace("artwork-123", "artwork-123"),
        }),
      ],
    });

    expect(summary.counts.failed).toBe(1);
    expect(writes(catalog)).toHaveLength(0);
  });

  it("reports a read-back mismatch instead of claiming success", async () => {
    const catalog = new InMemoryPosterCatalog();
    const failing: PosterCatalog = {
      get: vi.fn(async (id: string) => {
        const doc = await catalog.get(id);
        return doc ? { id, data: { ...doc.data, status: "draft" } } : null;
      }),
      listAll: () => catalog.listAll(),
      listByNotionPageId: (pageId) => catalog.listByNotionPageId(pageId),
      create: (id, data) => catalog.create(id, data),
      update: (id, data) => catalog.update(id, data),
    };

    const { summary } = await run({ pages: [page()], catalog: failing, jobs: [job()] });
    expect(summary.counts.failed).toBe(1);
  });

  it("resolves multi-image pages through active identity records", async () => {
    const secondImage =
      "https://images.cineprint.click/cineprint/versions/original/artwork-456/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png";
    const identities: IdentityRecord[] = [
      {
        identityRecordId: "identity-1",
        posterId: "artwork-123",
        groupingPageId: "page-multi",
        groupingPageIds: ["page-multi"],
        imageUrl: IMAGE,
        raindropId: "123",
        provider: "raindrop-file",
        sha256: null,
        revision: 1,
        status: "active",
      },
      {
        identityRecordId: "identity-2",
        posterId: "artwork-456",
        groupingPageId: "page-multi",
        groupingPageIds: ["page-multi"],
        imageUrl: secondImage,
        raindropId: "456",
        provider: "raindrop-file",
        sha256: null,
        revision: 1,
        status: "active",
      },
    ];

    const multi = page({
      id: "page-multi",
      posterId: null,
      raindropId: null,
      images: [IMAGE, secondImage],
    });
    const { summary, catalog } = await run({
      pages: [multi],
      identities,
      jobs: [
        job({ posterId: "artwork-123", raindropId: "123", images: null }),
        job({ posterId: "artwork-456", raindropId: "456", images: null }),
      ],
    });

    expect(summary.counts.firestoreRecordsCreated).toBe(2);
    expect(await catalog.get("artwork-123")).toBeTruthy();
    expect(await catalog.get("artwork-456")).toBeTruthy();
  });

  it("reports multi-image pages for review when no identity data source is configured", async () => {
    const secondImage =
      "https://images.cineprint.click/cineprint/versions/original/artwork-456/cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc.png";
    const multi = page({
      id: "page-multi",
      posterId: null,
      raindropId: null,
      images: [IMAGE, secondImage],
    });

    // The identities data source is optional; without it the sync must fail
    // closed instead of inventing an image-to-poster mapping.
    const { summary, catalog } = await run({ pages: [multi], identities: [] });

    expect(summary.counts.firestoreRecordsCreated).toBe(0);
    expect(summary.counts.needsReview).toBeGreaterThan(0);
    expect(summary.failures.some((failure) => /No identity record/.test(failure.reason))).toBe(
      true,
    );
    expect(writes(catalog)).toHaveLength(0);
  });

  it("reuses a legacy document already associated with the Notion page", async () => {
    const legacyImage =
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/999.png";
    const catalog = new InMemoryPosterCatalog([
      {
        id: "stranger-things-2",
        data: {
          notionPageId: "page-legacy",
          status: "published",
          image: legacyImage,
          title: "Old title",
          year: 2016,
          artist: "Someone",
          artists: [{ name: "Someone" }],
          slug: "stranger-things-2",
        },
      },
    ]);

    const legacyPage = page({
      id: "page-legacy",
      posterId: null,
      raindropId: "999",
      image: legacyImage,
      title: "Stranger Things",
    });

    const { summary } = await run({ pages: [legacyPage], catalog });

    expect(summary.counts.firestoreRecordsCreated).toBe(0);
    expect(summary.counts.firestoreRecordsUpdated).toBe(1);
    expect(await catalog.get("artwork-999")).toBeNull();
    expect((await catalog.get("stranger-things-2"))?.data.title).toBe("Stranger Things");
  });

  it("never writes in dry-run mode", async () => {
    const { summary, catalog, jobs } = await run({
      pages: [page()],
      jobs: [job()],
      dryRun: true,
    });

    expect(summary.counts.firestoreRecordsCreated).toBe(1);
    expect(writes(catalog)).toHaveLength(0);
    expect((await jobs.get("artwork-123"))?.stage).toBe("notion_draft_created");
  });
});

describe("Notion status safety", () => {
  const blobImage =
    "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/9001.png";

  function existing(id = "artwork-123", status = "published", pageId = "page-1") {
    return {
      id,
      data: {
        notionPageId: pageId,
        status,
        image: blobImage,
        title: "Existing",
        year: 2020,
        artist: "Someone",
        artists: [{ name: "Someone" }],
        slug: id,
      },
    };
  }

  it("preserves Published when Notion Status is blank", async () => {
    const catalog = new InMemoryPosterCatalog([existing()]);
    const blank = page();
    blank.properties.Status = select("   ");

    const { summary } = await run({ pages: [blank], catalog });

    expect(summary.counts.firestoreRecordsUpdated).toBe(0);
    expect(summary.counts.needsReview).toBe(1);
    expect((await catalog.get("artwork-123"))?.data.status).toBe("published");
  });

  it("preserves Published when the Status property is missing", async () => {
    const catalog = new InMemoryPosterCatalog([existing()]);
    const missing = page();
    delete missing.properties.Status;

    const { summary } = await run({ pages: [missing], catalog });

    expect(summary.counts.firestoreRecordsUpdated).toBe(0);
    expect(summary.counts.needsReview).toBe(1);
    expect((await catalog.get("artwork-123"))?.data.status).toBe("published");
  });

  it("preserves Draft when Notion Status is blank", async () => {
    const catalog = new InMemoryPosterCatalog([existing("artwork-123", "draft")]);
    const blank = page();
    blank.properties.Status = select("");

    await run({ pages: [blank], catalog });

    expect((await catalog.get("artwork-123"))?.data.status).toBe("draft");
  });

  it("applies an explicit unpublished transition", async () => {
    const catalog = new InMemoryPosterCatalog([existing()]);
    const unpublished = page({ status: "Unpublished" });

    const { summary } = await run({ pages: [unpublished], catalog });

    expect(summary.counts.firestoreRecordsUpdated).toBe(1);
    expect((await catalog.get("artwork-123"))?.data.status).toBe("draft");
  });

  it("rejects an unknown status without changing the record", async () => {
    const catalog = new InMemoryPosterCatalog([existing()]);
    const unknown = page({ status: "Pending" });

    const { summary } = await run({ pages: [unknown], catalog });

    expect(summary.counts.firestoreRecordsUpdated).toBe(0);
    expect(summary.counts.needsReview).toBe(1);
    expect((await catalog.get("artwork-123"))?.data.status).toBe("published");
  });

  it("does not let one malformed status block another valid transition", async () => {
    const catalog = new InMemoryPosterCatalog([
      existing("artwork-123", "published", "page-1"),
      existing("artwork-456", "published", "page-2"),
    ]);
    const malformed = page({ id: "page-1" });
    malformed.properties.Status = select("");
    const draft = page({
      id: "page-2",
      posterId: "artwork-456",
      raindropId: "456",
      status: "Draft",
    });

    const { summary } = await run({ pages: [malformed, draft], catalog });

    expect(summary.counts.needsReview).toBe(1);
    expect(summary.counts.firestoreRecordsUpdated).toBe(1);
    expect((await catalog.get("artwork-123"))?.data.status).toBe("published");
    expect((await catalog.get("artwork-456"))?.data.status).toBe("draft");
  });
});

describe("explicit creation path", () => {
  it("does not create a new catalogue document without an ingestion job", async () => {
    const { summary, catalog } = await run({ pages: [page()] });

    expect(summary.counts.needsReview).toBe(1);
    expect(summary.counts.firestoreRecordsCreated).toBe(0);
    expect(writes(catalog)).toHaveLength(0);
  });

  it("does not recreate a document deleted after synchronization", async () => {
    const { summary, catalog } = await run({
      pages: [page()],
      jobs: [job({ stage: "firestore_synced", notionPageId: "page-1" })],
    });

    expect(summary.counts.failed).toBe(1);
    expect(summary.counts.firestoreRecordsCreated).toBe(0);
    expect(writes(catalog)).toHaveLength(0);
    expect(await catalog.get("artwork-123")).toBeNull();
  });
});

describe("identity association safety", () => {
  it("refuses to update a document associated with another Notion page", async () => {
    const catalog = new InMemoryPosterCatalog([
      {
        id: "artwork-123",
        data: {
          notionPageId: "page-other",
          status: "published",
          image: "https://images.cineprint.click/a.png",
          title: "Other",
          year: 2020,
          artist: "Other",
          artists: [{ name: "Other" }],
          slug: "other",
        },
      },
    ]);

    const { summary } = await run({ pages: [page({ id: "page-1" })], catalog, jobs: [job()] });

    expect(summary.counts.failed).toBe(1);
    expect(writes(catalog)).toHaveLength(0);
    expect((await catalog.get("artwork-123"))?.data.title).toBe("Other");
  });
});

describe("missing status reporting", () => {
  it("reports a missing status even when no Firestore document is associated", async () => {
    const blank = page({ posterId: null, raindropId: null });
    delete blank.properties.Status;

    const { summary, catalog } = await run({ pages: [blank] });

    expect(summary.counts.needsReview).toBe(1);
    expect(writes(catalog)).toHaveLength(0);
  });
});

describe("configuration preflight", () => {
  it("validates Notion configuration before reading any record", async () => {
    const failing: NotionPageSource = {
      preflight: vi.fn().mockRejectedValue(new Error("NOTION_POSTER_DATA_SOURCE_ID is ambiguous")),
      listPages: vi.fn(),
      listIdentityRecords: vi.fn(),
    };

    await expect(
      runPublishingSync(
        {
          source: failing,
          catalog: new InMemoryPosterCatalog(),
          jobs: new InMemoryJobStore(),
          logger: logger(),
        },
        { runId: "run-1", dryRun: true },
      ),
    ).rejects.toThrow(/ambiguous/);
    expect(failing.listPages).not.toHaveBeenCalled();
    expect(failing.listIdentityRecords).not.toHaveBeenCalled();
  });
});

describe("dry-run state handling", () => {
  it("reports an already synchronized record without writing", async () => {
    const first = await run({ pages: [page()], jobs: [job()] });
    const writesAfterApply = writes(first.catalog).length;

    const dry = await runPublishingSync(
      {
        source: source([page()]),
        catalog: first.catalog,
        jobs: first.jobs,
        logger: logger(),
        stateSource: "firestore",
      },
      { runId: "run-2", dryRun: true },
    );

    expect(dry.counts.alreadySynchronized).toBe(1);
    expect(dry.counts.firestoreRecordsCreated).toBe(0);
    expect(dry.counts.firestoreRecordsUpdated).toBe(0);
    expect(dry.stateSource).toBe("firestore");
    expect(writes(first.catalog)).toHaveLength(writesAfterApply);
  });

  it("records when existing state was not read", async () => {
    const { summary } = await run({ pages: [page()] });
    expect(summary.stateSource).toBe("memory");
  });

  it("plans an unpublish in a dry run without touching Firestore", async () => {
    const first = await run({ pages: [page()], jobs: [job()] });
    const writesAfterApply = writes(first.catalog).length;

    const dry = await runPublishingSync(
      {
        source: source([page({ status: "Draft" })]),
        catalog: first.catalog,
        jobs: new InMemoryJobStore(),
        logger: logger(),
        stateSource: "firestore",
      },
      { runId: "run-2", dryRun: true },
    );

    expect(dry.counts.firestoreRecordsUpdated).toBe(1);
    expect((await first.catalog.get("artwork-123"))?.data.status).toBe("published");
    expect(writes(first.catalog)).toHaveLength(writesAfterApply);
  });
});
