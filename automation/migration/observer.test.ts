import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { sha256Hex } from "./checksum";
import { MigrationEngine } from "./engine";
import { MemorySink } from "./logger";
import { RunObserver } from "./observer";
import { R2_CACHE_CONTROL, R2ConflictError, R2UploadError } from "./r2";
import { MigrationStateStore } from "./state";
import type {
  ManifestEntry,
  OptimizedImage,
  OptimizerLike,
  PosterManifest,
  PublicVerification,
  R2ObjectMetadata,
  R2PutOptions,
  R2Store,
  R2Verification,
  SourceDownload,
  SourceDownloaderLike,
} from "./types";

const PNG = await sharp({
  create: {
    width: 4,
    height: 4,
    channels: 4,
    background: { r: 9, g: 8, b: 7, alpha: 1 },
  },
})
  .png()
  .toBuffer();
const PNG_SHA = sha256Hex(PNG);
const WEBP = Buffer.from("observer-webp");
const WEBP_SHA = sha256Hex(WEBP);
const RUN = "run-observer-test-1";

let tempDir: string;
let auditPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cineprint-observer-"));
  auditPath = path.join(tempDir, "audit.jsonl");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeEntry(): ManifestEntry {
  return {
    cineprintPosterId: "poster-1",
    notionPageId: "page-1",
    notionTitle: "Poster",
    notionDerivedId: "poster-1",
    identityReconciled: true,
    raindropId: "111",
    raindropCollectionId: null,
    raindropBookmarkTitle: null,
    raindropBookmarkTags: [],
    sourcePageUrl: null,
    sourceProvider: "pbs-twimg",
    sourceImageUrl: "https://pbs.twimg.com/media/test",
    sourceAvailability: "available",
    sourceHttpStatus: 200,
    sourceMimeType: "image/png",
    sourceDimensions: { width: 4, height: 4 },
    sourceSizeBytes: PNG.length,
    sourceSha256: PNG_SHA,
    sourceMatchesExistingOriginal: true,
    sourceExistingOriginalSizeDelta: 0,
    currentImageUrl: "https://example.com/current.png",
    currentImageProvider: "vercel-blob",
    currentImageObjectKey: "cineprint/external/poster-1.png",
    originalR2Key: "cineprint/versions/original/poster-1/aaaa.png",
    optimizedR2Key: "cineprint/versions/optimized/poster-1/aaaa.webp",
    existingOriginalObject: { path: null, exists: false, sizeBytes: null, mimeType: null },
    existingOptimizedObject: { path: null, exists: false, sizeBytes: null, mimeType: null },
    optimizedAction: "regenerate",
    optimizedCurrentlyUnused: false,
    identityMatchMethod: "test",
    identityConfidence: "high",
    migrationStatus: "READY_TO_COPY",
    verificationNotes: "",
  };
}

function makeManifest(entry: ManifestEntry): PosterManifest {
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    baselineCommit: "test",
    sourceCommit: "test",
    counts: {},
    coverage: {},
    sourceProviders: {},
    identityMethods: {},
    migrationStatusCounts: {},
    duplicates: {},
    ambiguities: [],
    multiImagePages: [],
    optimized: {},
    entries: [entry],
  };
}

class FakeR2 implements R2Store {
  readonly objects = new Map<string, { body: Buffer; contentType: string; sha256: string }>();

  seed(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, { body, contentType, sha256: sha256Hex(body) });
  }

  async head(key: string): Promise<R2ObjectMetadata | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      key,
      size: object.body.length,
      contentType: object.contentType,
      cacheControl: R2_CACHE_CONTROL,
      checksumSha256: Buffer.from(object.sha256, "hex").toString("base64"),
      metadataSha256: object.sha256,
      etag: null,
    };
  }

  async put(options: R2PutOptions): Promise<void> {
    if (options.key.includes("conflict")) throw new R2ConflictError("conflict");
    if (options.key.includes("ambiguous")) throw new R2UploadError("ambiguous");
    this.seed(options.key, options.body, options.contentType);
  }

  async verifyOrigin(
    key: string,
    expected: { sha256: string; sizeBytes: number; contentType: string },
  ) {
    const object = this.objects.get(key);
    if (!object) {
      return {
        ok: false,
        exists: false,
        checksumOk: false,
        metadataOk: false,
        sizeOk: false,
        metadata: null,
        sha256: null,
        sizeBytes: null,
        reason: "not found",
      };
    }
    const ok =
      object.sha256 === expected.sha256 &&
      object.body.length === expected.sizeBytes &&
      object.contentType === expected.contentType;
    return {
      ok,
      exists: true,
      checksumOk: object.sha256 === expected.sha256,
      metadataOk: object.contentType === expected.contentType,
      sizeOk: object.body.length === expected.sizeBytes,
      metadata: await this.head(key),
      sha256: object.sha256,
      sizeBytes: object.body.length,
      reason: ok ? null : "mismatch",
    };
  }

  async verify(): Promise<R2Verification> {
    return { ok: true, metadata: null, reason: null };
  }

  async publicVerify(): Promise<PublicVerification> {
    return {
      ok: true,
      status: 200,
      contentType: "image/webp",
      contentLength: WEBP.length,
      sha256: WEBP_SHA,
      reason: null,
    };
  }
}

function makeEngine(observer: RunObserver, r2: R2Store): MigrationEngine {
  const entry = makeEntry();
  const stateStore = new MigrationStateStore({
    statePath: path.join(tempDir, "state.json"),
    manifestHash: "test-hash",
  });
  const downloader: SourceDownloaderLike = {
    async download(): Promise<SourceDownload> {
      return {
        buffer: PNG,
        sha256: PNG_SHA,
        mimeType: "image/png",
        dimensions: { width: 4, height: 4 },
        sizeBytes: PNG.length,
        finalUrl: "https://pbs.twimg.com/media/test",
      };
    },
  };
  const optimizer: OptimizerLike = {
    async optimize(): Promise<OptimizedImage> {
      return {
        buffer: WEBP,
        contentType: "image/webp",
        width: 4,
        height: 4,
        sourceWidth: 4,
        sourceHeight: 4,
        sha256: WEBP_SHA,
        sizeBytes: WEBP.length,
      };
    },
  };
  return new MigrationEngine({
    manifest: makeManifest(entry),
    stateStore,
    downloader,
    optimizer,
    r2,
    approvals: {
      path: path.join(tempDir, "approvals.json"),
      exists: false,
      approved: new Set(),
    },
    execute: true,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
    publicRetryAttempts: 1,
    eventSink: observer,
    logger: () => undefined,
  });
}

describe("F24 — run observer integration", () => {
  it("writes audit and log events for a complete poster and never claims live success for mock runs", async () => {
    const sink = new MemorySink();
    const observer = new RunObserver({
      runId: RUN,
      batchId: "batch-1",
      evidence: "mock",
      auditPath,
      plannedPosterIds: ["poster-1"],
      logSinks: [sink],
    });
    const r2 = new FakeR2();
    const engine = makeEngine(observer, r2);
    const results = await engine.run([makeEntry()]);

    expect(results[0].state).toBe("VERIFIED");
    const types = observer.audit.readAll().events.map((event) => event.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "run.started",
        "batch.started",
        "poster.started",
        "source.download.started",
        "source.download.completed",
        "optimization.started",
        "optimization.completed",
        "r2.upload.started",
        "r2.upload.completed",
        "origin.verification.started",
        "origin.verification.completed",
        "cdn.verification.started",
        "cdn.verification.completed",
        "poster.verified",
        "state.checkpoint.written",
        "run.completed",
      ]),
    );
    expect(sink.lines.length).toBe(observer.audit.readAll().events.length);

    const summary = observer.summary({
      results,
      stateEntries: {},
      startedAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(summary.evidence).toBe("mock");
    expect(summary.verifiedPosters).toBe(1);
    expect(summary.liveSuccess).toBe(false);
    observer.close();
  });

  it("retains the run ID and sequence across a resume", () => {
    const first = new RunObserver({
      runId: RUN,
      evidence: "mock",
      auditPath,
      plannedPosterIds: ["poster-1"],
      logSinks: [new MemorySink()],
    });
    first.record({ type: "run.started", outcome: "started", operation: "run" });
    first.close();

    const resumed = new RunObserver({
      runId: RUN,
      evidence: "mock",
      auditPath,
      plannedPosterIds: ["poster-1"],
      logSinks: [new MemorySink()],
    });
    const event = resumed.record({
      type: "operator.resume",
      outcome: "resumed",
      operation: "resume",
    });
    expect(event.runId).toBe(RUN);
    expect(event.sequence).toBe(2);
    expect(resumed.audit.readAll().events).toHaveLength(2);
    resumed.close();
  });

  it("prevents new poster work once the controller pauses", () => {
    const observer = new RunObserver({
      runId: RUN,
      evidence: "mock",
      auditPath,
      plannedPosterIds: ["poster-1"],
      logSinks: [new MemorySink()],
    });
    observer.controller.pause("operator review");
    expect(() => observer.beginPoster("poster-1")).toThrow();
    observer.close();
  });

  it("fails a run when the audit sink cannot be written", async () => {
    const observer = new RunObserver({
      runId: RUN,
      evidence: "mock",
      auditPath,
      plannedPosterIds: ["poster-1"],
      logSinks: [new MemorySink()],
    });
    // Break the audit file descriptor to simulate a disk failure.
    (observer.audit as unknown as { fd: number }).fd = -1;
    const engine = makeEngine(observer, new FakeR2());
    await expect(engine.run([makeEntry()])).rejects.toThrow();
    expect(() => observer.close()).toThrow();
  });
});
