import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { sha256Hex } from "./checksum";
import { createCliObserver, runObservedBatch, withObserver } from "./command-runner";
import { MigrationEngine } from "./engine";
import { AuditLog } from "./audit";
import { createEvent } from "./events";
import { computeRunSummary, evaluateThresholds } from "./health";
import { LogSinkError, StructuredLogger } from "./logger";
import { RunObserver } from "./observer";
import { R2_CACHE_CONTROL, R2ConflictError } from "./r2";
import { redactString } from "./redaction";
import { MigrationStateStore } from "./state";
import { SourceUnavailableError } from "./source";
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
    background: { r: 4, g: 5, b: 6, alpha: 1 },
  },
})
  .png()
  .toBuffer();
const PNG_SHA = sha256Hex(PNG);
const WEBP = Buffer.from("cli-smoke-webp");
const WEBP_SHA = sha256Hex(WEBP);
const RUN = "run-cli-smoke-1";
const BATCH = "batch-cli-smoke";

let tempDir: string;
let auditPath: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cineprint-cli-smoke-"));
  auditPath = path.join(tempDir, "audit.jsonl");
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
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
    ...overrides,
  };
}

function makeManifest(entries: ManifestEntry[]): PosterManifest {
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
    entries,
  };
}

class SmokeR2 implements R2Store {
  readonly objects = new Map<string, { body: Buffer; contentType: string; sha256: string }>();
  onPut?: () => Promise<void>;

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
    await this.onPut?.();
    if (options.key.includes("conflict")) throw new R2ConflictError("conflict");
    this.objects.set(options.key, {
      body: options.body,
      contentType: options.contentType,
      sha256: options.sha256,
    });
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

function makeEngine(input: {
  observer?: RunObserver;
  r2: R2Store;
  entry: ManifestEntry;
  downloader?: SourceDownloaderLike;
}): MigrationEngine {
  const stateStore = new MigrationStateStore({
    statePath: path.join(tempDir, `state-${cryptoRandom()}.json`),
    manifestHash: "test-hash",
  });
  const downloader: SourceDownloaderLike = input.downloader ?? {
    async download(): Promise<SourceDownload> {
      return {
        buffer: PNG,
        sha256: PNG_SHA,
        mimeType: "image/png",
        dimensions: { width: 4, height: 4 },
        sizeBytes: PNG.length,
        finalUrl: "https://pbs.twimg.com/media/test",
        httpStatus: 200,
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
    manifest: makeManifest([input.entry]),
    stateStore,
    downloader,
    optimizer,
    r2: input.r2,
    approvals: {
      path: path.join(tempDir, "approvals.json"),
      exists: false,
      approved: new Set(),
    },
    execute: true,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
    publicRetryAttempts: 1,
    eventSink: input.observer,
    logger: () => undefined,
  });
}

function cryptoRandom(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe("F25 — CLI observability smoke path", () => {
  it("runs the CLI observer path and persists run/poster/object events", async () => {
    const logFile = path.join(tempDir, "run.log.jsonl");
    const observer = createCliObserver({
      flags: { runId: RUN, batchId: BATCH, auditPath, logFile },
      plannedPosterIds: ["poster-1"],
      evidence: "live_migration",
      rootDirectory: tempDir,
    });
    const r2 = new SmokeR2();
    let lockHeld = false;
    let putStarted = false;
    r2.onPut = async () => {
      putStarted = true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    };
    const engine = makeEngine({ observer, r2, entry: makeEntry() });

    const results = await withObserver(observer, async () => {
      const promise = runObservedBatch({
        observer,
        withLock: async (operation) => {
          lockHeld = true;
          try {
            return await operation();
          } finally {
            lockHeld = false;
          }
        },
        execute: () => engine.run([makeEntry()]),
      });
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(lockHeld).toBe(true);
      expect(putStarted).toBe(true);
      const result = await promise;
      const summary = observer.summary({ results: result });
      expect(summary.complete).toBe(true);
      expect(summary.liveSuccess).toBe(true);
      expect(summary.verifiedObjects).toBe(2);
      expect(lockHeld).toBe(false);
      return result;
    });

    expect(results[0].state).toBe("VERIFIED");
    const eventTypes = observer.audit.readAll().events.map((event) => event.type);
    expect(eventTypes).toEqual(
      expect.arrayContaining([
        "lock.acquired",
        "run.started",
        "batch.started",
        "poster.started",
        "source.download.started",
        "source.download.completed",
        "optimization.started",
        "optimization.completed",
        "r2.upload.started",
        "r2.upload.completed",
        "origin.verification.completed",
        "cdn.verification.completed",
        "poster.verified",
        "state.checkpoint.written",
        "run.completed",
        "lock.released",
      ]),
    );
    const logLines = fs.readFileSync(logFile, "utf8").trim().split("\n");
    expect(logLines.length).toBeGreaterThan(0);
    expect(JSON.parse(logLines[0]).runId).toBe(RUN);
  });

  it("cannot report full success when a selected poster is unavailable", async () => {
    const observer = createCliObserver({
      flags: { runId: `${RUN}-skip`, batchId: BATCH, auditPath, logFile: null },
      plannedPosterIds: ["poster-1"],
      evidence: "live_migration",
      rootDirectory: tempDir,
    });
    const entry = makeEntry({
      sourceAvailability: "unavailable",
      migrationStatus: "SOURCE_UNAVAILABLE",
    });
    const engine = makeEngine({ observer, r2: new SmokeR2(), entry });
    const results = await withObserver(observer, async () => {
      const result = await runObservedBatch({
        observer,
        withLock: (operation) => operation(),
        execute: () => engine.run([entry]),
      });
      const summary = observer.summary({ results: result });
      expect(summary.complete).toBe(false);
      expect(summary.liveSuccess).toBe(false);
      expect(summary.skippedPosters).toBe(1);
      return result;
    });
    expect(results[0].state).toBe("SOURCE_UNAVAILABLE");
  });

  it("retains the original source error when the logger also fails", async () => {
    const brokenLogger = new StructuredLogger({
      sinks: [
        {
          name: "broken",
          write(line: string) {
            if (line.includes("source.download.failed")) throw new Error("disk full");
          },
        },
      ],
    });
    const observer = new RunObserver({
      runId: `${RUN}-error`,
      batchId: BATCH,
      evidence: "live_migration",
      auditPath,
      plannedPosterIds: ["poster-1"],
      logger: brokenLogger,
    });
    const downloader: SourceDownloaderLike = {
      async download(): Promise<SourceDownload> {
        throw new SourceUnavailableError("source timed out");
      },
    };
    const engine = makeEngine({
      observer,
      r2: new SmokeR2(),
      entry: makeEntry(),
      downloader,
    });
    const results = await withObserver(observer, () =>
      runObservedBatch({
        observer,
        withLock: (operation) => operation(),
        execute: () => engine.run([makeEntry()]),
      }),
    );
    expect(results[0].state).toBe("SOURCE_UNAVAILABLE");
    expect(results[0].message).toContain("source timed out");
    expect(results[0].message).toContain("observability failure");
    expect(brokenLogger.isHealthy()).toBe(false);
  });

  it("does not count an upload acknowledgement as verification", () => {
    const summary = computeRunSummary({
      runId: RUN,
      evidence: "live_migration",
      plannedPosterIds: ["poster-1"],
      events: [
        createEvent({
          runId: RUN,
          evidence: "live_migration",
          type: "r2.upload.completed",
          outcome: "completed",
          posterId: "poster-1",
          variant: "original",
          metadata: { key: "object-original" },
        }),
      ],
    });
    expect(summary.uploadedObjects).toBe(1);
    expect(summary.verifiedObjects).toBe(0);
    expect(summary.complete).toBe(false);
    expect(summary.liveSuccess).toBe(false);
  });

  it("includes source HTTP 429 in the rate metric", () => {
    const events = [
      ...Array.from({ length: 100 }, (_, index) =>
        createEvent({
          runId: RUN,
          evidence: "live_migration",
          type: "source.download.completed",
          outcome: "completed",
          posterId: `ok-${index}`,
          httpStatus: 200,
        }),
      ),
      ...Array.from({ length: 6 }, (_, index) =>
        createEvent({
          runId: RUN,
          evidence: "live_migration",
          type: "source.download.completed",
          outcome: "completed",
          posterId: `limited-${index}`,
          httpStatus: 429,
        }),
      ),
    ];
    const decision = evaluateThresholds(events);
    expect(decision.metrics.http429).toBe(6);
    expect(decision.decision).toBe("pause");
  });

  it("rejects duplicate event IDs and keeps recovered partial history usable", () => {
    const log = AuditLog.open({ path: auditPath, runId: RUN });
    expect(() =>
      log.append({
        runId: RUN,
        type: "run.started",
        outcome: "started",
        evidence: "live_migration",
        eventId: "evt-not-deterministic",
      }),
    ).toThrow();
    log.close();

    const partialPath = path.join(tempDir, "partial.jsonl");
    const valid = createEvent({
      runId: RUN,
      type: "run.started",
      outcome: "started",
      evidence: "live_migration",
      sequence: 1,
    });
    fs.writeFileSync(partialPath, `${JSON.stringify(valid)}\n{"partial":`, "utf8");
    const observer = new RunObserver({
      runId: RUN,
      evidence: "live_migration",
      auditPath: partialPath,
      plannedPosterIds: ["poster-1"],
    });
    const summary = observer.summary({
      results: [{ posterId: "poster-1", state: "VERIFIED", message: "ok" }],
      stateEntries: {
        "poster-1": {
          posterId: "poster-1",
          state: "VERIFIED",
          attempts: 1,
          lastError: null,
          updatedAt: new Date().toISOString(),
          sourceSha256: null,
          originalSha256: null,
          optimizedSha256: null,
          originalKey: null,
          optimizedKey: null,
          originalSizeBytes: null,
          optimizedSizeBytes: null,
          originalDimensions: null,
          optimizedDimensions: null,
          originalUploaded: true,
          optimizedUploaded: true,
          verifiedAt: new Date().toISOString(),
        },
      },
    });
    expect(summary.resumeSafe).toBe(true);
    expect(summary.liveSuccess).toBe(true);
    observer.close();
  });

  it("redacts environment-style secrets while preserving poster identifiers", () => {
    const redacted = redactString(
      "NOTION_KEY=notion-secret poster=bugonia key=cineprint/external/bugonia.jpg",
    );
    expect(redacted).not.toContain("notion-secret");
    expect(redacted).toContain("bugonia");
    expect(redacted).toContain("cineprint/external/bugonia.jpg");
  });

  it("reports a sink failure instead of silently succeeding", () => {
    const logger = new StructuredLogger({
      sinks: [
        {
          name: "broken",
          write() {
            throw new Error("disk full");
          },
        },
      ],
    });
    expect(() =>
      logger.log({
        runId: RUN,
        type: "run.started",
        outcome: "started",
        evidence: "mock",
      }),
    ).toThrow(LogSinkError);
  });
});
