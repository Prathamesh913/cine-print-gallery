import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { sha256Hex } from "./checksum";
import { buildCanaryPlan } from "./canary";
import { buildDryRunReport } from "./dry-run-report";
import { MigrationEngine } from "./engine";
import {
  loadApprovals,
  loadFirestoreSnapshot,
  loadManifest,
  manifestHash,
  validateAgainstSnapshot,
  validateManifest,
} from "./manifest";
import type { Approvals } from "./manifest";
import { MigrationOptimizer } from "./optimize";
import {
  normalizeCacheControl,
  R2_CACHE_CONTROL,
  R2ConflictError,
  R2StoreImpl,
  R2UploadError,
} from "./r2";
import { MigrationStateStore, MigrationLockError } from "./state";
import {
  redactSecrets,
  SourceChangedError,
  SourceDownloader,
  SourceUnavailableError,
  SourceValidationError,
} from "./source";
import type {
  ManifestEntry,
  MigrationStateName,
  OptimizerLike,
  PosterManifest,
  R2ObjectMetadata,
  R2PutOptions,
  R2Store,
  R2Verification,
  PublicVerification,
  SourceDownload,
  SourceDownloaderLike,
} from "./types";

const PNG = await sharp({
  create: {
    width: 1,
    height: 1,
    channels: 4,
    background: { r: 12, g: 34, b: 56, alpha: 1 },
  },
})
  .png()
  .toBuffer();
const PNG_SHA = sha256Hex(PNG);

let tempDir: string;

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cineprint-migration-test-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  const id = overrides.cineprintPosterId ?? "poster-1";
  const isArtwork = id.startsWith("artwork-");
  const raindropId = overrides.raindropId ?? "111";
  const originalR2Key = isArtwork
    ? `cineprint/raindrop/${raindropId}.png`
    : `cineprint/external/${id}.png`;
  const optimizedR2Key = isArtwork
    ? `cineprint/optimized/${raindropId}.webp`
    : `cineprint/optimized/external/${id}.webp`;

  return {
    cineprintPosterId: id,
    notionPageId: `page-${id}`,
    notionTitle: `Title ${id}`,
    notionDerivedId: id,
    identityReconciled: true,
    raindropId,
    raindropCollectionId: 65021430,
    raindropBookmarkTitle: null,
    raindropBookmarkTags: [],
    sourcePageUrl: null,
    sourceProvider: "pbs-twimg",
    sourceImageUrl: `https://pbs.twimg.com/media/${id}?format=png`,
    sourceAvailability: "available",
    sourceHttpStatus: 200,
    sourceMimeType: "image/png",
    sourceDimensions: { width: 1, height: 1 },
    sourceSizeBytes: PNG.length,
    sourceSha256: PNG_SHA,
    sourceMatchesExistingOriginal: true,
    sourceExistingOriginalSizeDelta: 0,
    currentImageUrl: `https://example.public.blob.vercel-storage.com/${originalR2Key}`,
    currentImageProvider: "vercel-blob",
    currentImageObjectKey: originalR2Key,
    originalR2Key,
    optimizedR2Key,
    existingOriginalObject: {
      path: originalR2Key,
      exists: true,
      sizeBytes: PNG.length,
      mimeType: "image/png",
    },
    existingOptimizedObject: {
      path: optimizedR2Key,
      exists: false,
      sizeBytes: null,
      mimeType: null,
    },
    optimizedAction: "regenerate",
    optimizedCurrentlyUnused: false,
    identityMatchMethod: "test",
    identityConfidence: "high",
    migrationStatus: "READY_TO_COPY",
    verificationNotes: "test entry",
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

function makeApprovals(approved: string[] = []): Approvals {
  return {
    path: path.join(tempDir, "approvals.json"),
    exists: approved.length > 0,
    approved: new Set(approved),
  };
}

class FakeR2 implements R2Store {
  readonly objects = new Map<
    string,
    {
      body: Buffer;
      contentType: string | null;
      cacheControl: string | null;
      sha256: string;
      size: number;
    }
  >();
  putCalls = 0;
  putFailures = 0;
  putConflict = false;
  putPermanentFailure = false;
  publicCalls = 0;
  publicFailures = 0;
  publicStatus: number | null = null;
  publicMismatch = false;
  onPut?: (key: string) => Promise<void> | void;
  onPublicVerify?: (url: string) => Promise<void> | void;

  seed(
    key: string,
    body: Buffer,
    contentType: string | null,
    sha256 = sha256Hex(body),
    cacheControl: string | null = R2_CACHE_CONTROL,
  ): void {
    this.objects.set(key, {
      body,
      contentType,
      cacheControl,
      sha256,
      size: body.length,
    });
  }

  async head(key: string): Promise<R2ObjectMetadata | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      key,
      size: object.size,
      contentType: object.contentType,
      cacheControl: object.cacheControl,
      checksumSha256: Buffer.from(object.sha256, "hex").toString("base64"),
      metadataSha256: object.sha256,
      etag: null,
    };
  }

  async put(options: R2PutOptions): Promise<void> {
    this.putCalls += 1;
    await this.onPut?.(options.key);
    if (this.putConflict) {
      throw new R2ConflictError("simulated 412 precondition failed");
    }
    if (this.putPermanentFailure) {
      throw new R2UploadError("simulated permanent upload failure", false);
    }
    if (this.putFailures > 0) {
      this.putFailures -= 1;
      throw new R2UploadError("simulated R2 upload failure");
    }
    this.objects.set(options.key, {
      body: options.body,
      contentType: options.contentType,
      cacheControl: options.cacheControl,
      sha256: options.sha256,
      size: options.body.length,
    });
  }

  async verifyOrigin(
    key: string,
    expected: {
      sha256: string;
      sizeBytes: number;
      contentType: string;
      cacheControl: string;
    },
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

    const actualContentType = object.contentType
      ? object.contentType.split(";")[0].trim().toLowerCase()
      : null;
    const expectedContentType = expected.contentType.split(";")[0].trim().toLowerCase();
    const checksumOk = object.sha256 === expected.sha256.toLowerCase();
    const sizeOk = object.size === expected.sizeBytes;
    const metadataOk =
      actualContentType === expectedContentType &&
      normalizeCacheControl(object.cacheControl) ===
        normalizeCacheControl(expected.cacheControl);

    return {
      ok: checksumOk && sizeOk && metadataOk,
      exists: true,
      checksumOk,
      metadataOk,
      sizeOk,
      metadata: await this.head(key),
      sha256: object.sha256,
      sizeBytes: object.size,
      reason: !sizeOk
        ? "size mismatch"
        : !checksumOk
          ? "checksum mismatch"
          : actualContentType !== expectedContentType
            ? "Content-Type mismatch"
            : normalizeCacheControl(object.cacheControl) !==
                normalizeCacheControl(expected.cacheControl)
              ? "Cache-Control mismatch"
              : null,
    };
  }

  async verify(
    key: string,
    expected: {
      sha256: string;
      sizeBytes: number;
      contentType: string;
      cacheControl: string;
    },
  ): Promise<R2Verification> {
    const object = this.objects.get(key);
    if (!object) return { ok: false, metadata: null, reason: "not found" };
    const actualContentType = object.contentType
      ? object.contentType.split(";")[0].trim().toLowerCase()
      : null;
    const expectedContentType = expected.contentType.split(";")[0].trim().toLowerCase();
    const ok =
      object.sha256 === expected.sha256 &&
      object.size === expected.sizeBytes &&
      actualContentType === expectedContentType &&
      normalizeCacheControl(object.cacheControl) ===
        normalizeCacheControl(expected.cacheControl);
    return {
      ok,
      metadata: await this.head(key),
      reason: ok ? null : "mismatch",
    };
  }

  async publicVerify(
    url: string,
    expected?: { sha256: string; sizeBytes: number; contentType: string },
  ): Promise<PublicVerification> {
    this.publicCalls += 1;
    await this.onPublicVerify?.(url);
    if (this.publicStatus !== null) {
      return {
        ok: false,
        status: this.publicStatus,
        contentType: null,
        contentLength: null,
        sha256: null,
        reason: `simulated public HTTP ${this.publicStatus}`,
      };
    }
    if (this.publicFailures > 0) {
      this.publicFailures -= 1;
      return {
        ok: false,
        status: 503,
        contentType: null,
        contentLength: null,
        sha256: null,
        reason: "simulated public verification failure",
      };
    }

    const key = new URL(url).pathname.replace(/^\//, "");
    const object = this.objects.get(key);
    if (!object) {
      return {
        ok: false,
        status: 404,
        contentType: null,
        contentLength: null,
        sha256: null,
        reason: "not found",
      };
    }
    if (expected) {
      if (this.publicMismatch) {
        return {
          ok: false,
          status: 200,
          contentType: object.contentType,
          contentLength: object.size,
          sha256: object.sha256,
          reason: "public bytes mismatch",
        };
      }
      const actualContentType = object.contentType
        ? object.contentType.split(";")[0].trim().toLowerCase()
        : null;
      const expectedContentType = expected.contentType.split(";")[0].trim().toLowerCase();
      const ok =
        object.sha256 === expected.sha256 &&
        object.size === expected.sizeBytes &&
        actualContentType === expectedContentType;
      return {
        ok,
        status: 200,
        contentType: object.contentType,
        contentLength: object.size,
        sha256: object.sha256,
        reason: ok ? null : "mismatch",
      };
    }
    return {
      ok: true,
      status: 200,
      contentType: object.contentType,
      contentLength: object.size,
      sha256: null,
      reason: null,
    };
  }
}

class FakeDownloader implements SourceDownloaderLike {
  downloadCalls = 0;
  failures = 0;
  onDownload?: (entry: ManifestEntry) => Promise<void> | void;

  async download(entry: ManifestEntry): Promise<SourceDownload> {
    this.downloadCalls += 1;
    await this.onDownload?.(entry);
    if (this.failures > 0) {
      this.failures -= 1;
      throw new SourceUnavailableError("simulated source failure");
    }
    return {
      buffer: PNG,
      sha256: entry.sourceSha256 ?? PNG_SHA,
      mimeType: entry.sourceMimeType ?? "image/png",
      dimensions: entry.sourceDimensions ?? { width: 1, height: 1 },
      sizeBytes: entry.sourceSizeBytes ?? PNG.length,
      finalUrl: entry.sourceImageUrl ?? "https://pbs.twimg.com/media/test",
    };
  }
}

class FakeOptimizer implements OptimizerLike {
  fail = false;

  async optimize(buffer: Buffer) {
    if (this.fail) throw new Error("simulated optimization failure");
    const out = await sharp(buffer).webp({ quality: 80 }).toBuffer();
    const metadata = await sharp(out).metadata();
    return {
      buffer: out,
      contentType: "image/webp" as const,
      width: metadata.width ?? 1,
      height: metadata.height ?? 1,
      sourceWidth: 1,
      sourceHeight: 1,
      sha256: sha256Hex(out),
      sizeBytes: out.length,
    };
  }
}

function makeStateStore(hash = "test-manifest-hash"): MigrationStateStore {
  return new MigrationStateStore({
    statePath: path.join(tempDir, "migration-state.json"),
    manifestHash: hash,
  });
}

function validVerifiedStateEntry(
  entry: ManifestEntry,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const now = new Date().toISOString();
  const optimized = Buffer.from("optimized-bytes");
  return {
    posterId: entry.cineprintPosterId,
    state: "VERIFIED",
    attempts: 0,
    lastError: null,
    updatedAt: now,
    sourceSha256: entry.sourceSha256,
    originalSha256: entry.sourceSha256,
    optimizedSha256: sha256Hex(optimized),
    originalKey: entry.originalR2Key,
    optimizedKey: entry.optimizedR2Key,
    originalSizeBytes: entry.sourceSizeBytes,
    optimizedSizeBytes: optimized.length,
    originalDimensions: entry.sourceDimensions,
    optimizedDimensions: { width: 1, height: 1 },
    originalUploaded: true,
    optimizedUploaded: true,
    verifiedAt: now,
    ...overrides,
  };
}

function writeRawState(entry: Record<string, unknown>): MigrationStateStore {
  const now = new Date().toISOString();
  const statePath = path.join(tempDir, "migration-state.json");
  fs.writeFileSync(
    statePath,
    JSON.stringify(
      {
        schemaVersion: 1,
        manifestHash: "test-manifest-hash",
        createdAt: now,
        updatedAt: now,
        entries: { [String(entry.posterId)]: entry },
      },
      null,
      2,
    ),
    "utf8",
  );
  return new MigrationStateStore({ statePath, manifestHash: "test-manifest-hash" });
}

function makeEngine(input: {
  entries: ManifestEntry[];
  r2?: R2Store;
  downloader?: SourceDownloaderLike;
  optimizer?: OptimizerLike;
  approvals?: Approvals;
  execute?: boolean;
  stateStore?: MigrationStateStore;
  concurrency?: number;
  publicRetryAttempts?: number;
  publicRetryBaseDelayMs?: number;
  publicRetryMaxDelayMs?: number;
}): MigrationEngine {
  return new MigrationEngine({
    manifest: makeManifest(input.entries),
    stateStore: input.stateStore ?? makeStateStore(),
    downloader: input.downloader ?? new FakeDownloader(),
    optimizer: input.optimizer ?? new FakeOptimizer(),
    r2: input.r2 ?? new FakeR2(),
    approvals: input.approvals ?? makeApprovals(),
    execute: input.execute ?? true,
    concurrency: input.concurrency ?? 1,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
    publicRetryAttempts: input.publicRetryAttempts ?? 3,
    publicRetryBaseDelayMs: input.publicRetryBaseDelayMs ?? 1,
    publicRetryMaxDelayMs: input.publicRetryMaxDelayMs ?? 2,
    publicBaseUrl: "https://images.cineprint.click",
    logger: () => undefined,
  });
}

describe("Phase 1 manifest validation", () => {
  it("accepts the real 63-entry manifest and Firestore snapshot", () => {
    const manifest = loadManifest(path.resolve("migration/poster-manifest.json"));
    const validation = validateManifest(manifest);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
    expect(manifest.entries).toHaveLength(63);

    const snapshot = loadFirestoreSnapshot(path.resolve("migration/firestore-identities.json"));
    const snapshotValidation = validateAgainstSnapshot(manifest, snapshot);
    expect(snapshotValidation.ok).toBe(true);
    expect(snapshotValidation.errors).toEqual([]);
  });

  it("rejects duplicate R2 keys and invalid checksums", () => {
    const first = makeEntry({ cineprintPosterId: "one" });
    const second = makeEntry({
      cineprintPosterId: "two",
      originalR2Key: first.originalR2Key,
      currentImageObjectKey: first.originalR2Key,
      sourceSha256: "not-a-sha",
    });
    const validation = validateManifest(makeManifest([first, second]), { expectedCount: 2 });
    expect(validation.ok).toBe(false);
    expect(validation.errors.join("\n")).toContain("Duplicate originalR2Key");
    expect(validation.errors.join("\n")).toContain("sourceSha256");
  });

  it("requires explicit approval only for non-high-confidence entries", () => {
    const approvalsPath = path.join(tempDir, "approvals.json");
    const manifest = makeManifest([
      makeEntry({ cineprintPosterId: "high", identityConfidence: "high" }),
      makeEntry({ cineprintPosterId: "medium", identityConfidence: "medium" }),
    ]);

    expect(loadApprovals(approvalsPath, manifest).approved.size).toBe(0);

    fs.writeFileSync(
      approvalsPath,
      JSON.stringify({ approved: ["medium"] }, null, 2),
      "utf8",
    );
    expect(loadApprovals(approvalsPath, manifest).approved.has("medium")).toBe(true);

    fs.writeFileSync(
      approvalsPath,
      JSON.stringify({ approved: ["high"] }, null, 2),
      "utf8",
    );
    expect(() => loadApprovals(approvalsPath, manifest)).toThrow(/high-confidence/);
  });
});

function fakeFetch(
  body: Buffer | string,
  init: { status?: number; contentType?: string; location?: string } = {},
): typeof fetch {
  return (async () =>
    new Response(body as unknown as BodyInit, {
      status: init.status ?? 200,
      headers: {
        ...(init.contentType ? { "content-type": init.contentType } : {}),
        ...(init.location ? { location: init.location } : {}),
      },
    })) as unknown as typeof fetch;
}

describe("source download and validation", () => {
  it("downloads a valid source and matches the manifest checksum", async () => {
    const entry = makeEntry();
    const downloader = new SourceDownloader({
      raindropToken: "test-token",
      fetchImpl: fakeFetch(PNG, { contentType: "image/png" }),
    });
    const result = await downloader.download(entry);
    expect(result.sha256).toBe(PNG_SHA);
    expect(result.sizeBytes).toBe(PNG.length);
    expect(result.mimeType).toBe("image/png");
    expect(result.dimensions).toEqual({ width: 1, height: 1 });
  });

  it("stops with SourceChangedError when the checksum differs", async () => {
    const entry = makeEntry({ sourceSha256: "0".repeat(64) });
    const downloader = new SourceDownloader({
      raindropToken: "test-token",
      fetchImpl: fakeFetch(PNG, { contentType: "image/png" }),
    });
    await expect(downloader.download(entry)).rejects.toBeInstanceOf(SourceChangedError);
  });

  it("rejects unexpected MIME types", async () => {
    const entry = makeEntry();
    const downloader = new SourceDownloader({
      raindropToken: "test-token",
      fetchImpl: fakeFetch("<html>not an image</html>", { contentType: "text/html" }),
    });
    await expect(downloader.download(entry)).rejects.toBeInstanceOf(SourceValidationError);
  });

  it("rejects undecodable image bodies", async () => {
    const entry = makeEntry();
    const downloader = new SourceDownloader({
      raindropToken: "test-token",
      fetchImpl: fakeFetch("not an image", { contentType: "image/png" }),
    });
    await expect(downloader.download(entry)).rejects.toBeInstanceOf(SourceValidationError);
  });

  it("reports Raindrop authentication failures without leaking the token", async () => {
    const entry = makeEntry({
      sourceProvider: "raindrop-file",
      sourceImageUrl: "https://api.raindrop.io/rest/v1/raindrop/111/file",
    });
    const downloader = new SourceDownloader({
      raindropToken: "super-secret-token",
      fetchImpl: fakeFetch("denied", { status: 401, contentType: "text/plain" }),
    });
    try {
      await downloader.download(entry);
      throw new Error("expected download to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(SourceUnavailableError);
      expect(String((error as Error).message)).not.toContain("super-secret-token");
    }
  });

  it("reports external HTTP failures", async () => {
    const entry = makeEntry();
    const downloader = new SourceDownloader({
      raindropToken: "test-token",
      fetchImpl: fakeFetch("upstream error", { status: 500, contentType: "text/plain" }),
    });
    await expect(downloader.download(entry)).rejects.toBeInstanceOf(SourceUnavailableError);
  });

  it("rejects redirects to arbitrary hosts", async () => {
    const entry = makeEntry();
    const downloader = new SourceDownloader({
      raindropToken: "test-token",
      fetchImpl: fakeFetch("", {
        status: 302,
        location: "https://evil.example/steal",
      }),
    });
    await expect(downloader.download(entry)).rejects.toBeInstanceOf(SourceValidationError);
  });
});

describe("migration engine", () => {
  it("never uploads during a dry-run", async () => {
    const r2 = new FakeR2();
    const entry = makeEntry();
    const engine = makeEngine({ entries: [entry], r2, execute: false });
    const inspections = await engine.inspectAll();
    expect(inspections).toHaveLength(1);
    expect(inspections[0].originalStatus).toBe("MISSING");
    expect(r2.putCalls).toBe(0);

    const results = await engine.run();
    expect(results).toEqual([]);
    expect(r2.putCalls).toBe(0);
  });

  it("marks an existing object with a matching checksum as verified without re-uploading", async () => {
    const r2 = new FakeR2();
    const entry = makeEntry();
    const optimizer = new FakeOptimizer();
    const optimized = await optimizer.optimize(PNG);
    r2.seed(entry.originalR2Key!, PNG, "image/png", PNG_SHA);
    r2.seed(entry.optimizedR2Key!, optimized.buffer, "image/webp", optimized.sha256);

    const engine = makeEngine({ entries: [entry], r2, optimizer, execute: true });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("VERIFIED");
    expect(r2.putCalls).toBe(0);
  });

  it("marks an existing object with a conflicting checksum as CONFLICT and does not overwrite", async () => {
    const r2 = new FakeR2();
    const entry = makeEntry();
    r2.seed(entry.originalR2Key!, PNG, "image/png", "f".repeat(64));

    const engine = makeEngine({ entries: [entry], r2, execute: true });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(0);
  });

  it("marks an existing object without checksum metadata as CONFLICT", async () => {
    const r2 = new FakeR2();
    const entry = makeEntry();
    r2.seed(entry.originalR2Key!, PNG, "image/png", PNG_SHA);
    const original = r2.objects.get(entry.originalR2Key!)!;
    r2.objects.set(entry.originalR2Key!, { ...original, sha256: "" });

    const engine = makeEngine({ entries: [entry], r2, execute: true });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(0);
  });

  it("marks upload failures as FAILED after bounded retries", async () => {
    const r2 = new FakeR2();
    r2.putFailures = 3;
    const entry = makeEntry();
    const engine = makeEngine({ entries: [entry], r2, execute: true });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("FAILED");
    expect(r2.putCalls).toBe(3);
  });

  it("maps a 412 conditional write to CONFLICT without retrying", async () => {
    const r2 = new FakeR2();
    r2.putConflict = true;
    const entry = makeEntry();
    const engine = makeEngine({ entries: [entry], r2, execute: true });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(1);
    expect(result.message).not.toMatch(/3 attempt/i);
  });

  it("does not retry a permanent upload error", async () => {
    const r2 = new FakeR2();
    r2.putPermanentFailure = true;
    const entry = makeEntry();
    const engine = makeEngine({ entries: [entry], r2, execute: true });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("FAILED");
    expect(r2.putCalls).toBe(1);
    expect(result.message).toMatch(/1 attempt/i);
  });

  it("resumes after a source failure and verifies on the second run", async () => {
    const downloader = new FakeDownloader();
    downloader.failures = 3;
    const entry = makeEntry();
    const stateStore = makeStateStore();
    const engine = makeEngine({ entries: [entry], downloader, stateStore, execute: true });

    const first = await engine.migrateEntry(entry);
    expect(first.state).toBe("SOURCE_UNAVAILABLE");
    expect(stateStore.get(entry.cineprintPosterId)?.state).toBe("SOURCE_UNAVAILABLE");

    const second = await engine.migrateEntry(entry);
    expect(second.state).toBe("VERIFIED");
    expect(downloader.downloadCalls).toBe(4);
  });

  it("skips a verified entry on subsequent runs", async () => {
    const downloader = new FakeDownloader();
    const entry = makeEntry();
    const stateStore = makeStateStore();
    const engine = makeEngine({ entries: [entry], downloader, stateStore, execute: true });

    const first = await engine.migrateEntry(entry);
    expect(first.state).toBe("VERIFIED");
    const callsAfterFirst = downloader.downloadCalls;

    const second = await engine.migrateEntry(entry);
    expect(second.state).toBe("VERIFIED");
    expect(downloader.downloadCalls).toBe(callsAfterFirst);
  });

  it("blocks medium-confidence entries until approved", async () => {
    const entry = makeEntry({
      cineprintPosterId: "medium-entry",
      identityConfidence: "medium",
    });
    const downloader = new FakeDownloader();
    const r2 = new FakeR2();
    const engine = makeEngine({
      entries: [entry],
      downloader,
      r2,
      approvals: makeApprovals(),
      execute: true,
    });

    const blocked = await engine.migrateEntry(entry);
    expect(blocked.state).toBe("READY_WITH_REVIEW");
    expect(downloader.downloadCalls).toBe(0);
    expect(r2.putCalls).toBe(0);

    const approvedEngine = makeEngine({
      entries: [entry],
      downloader: new FakeDownloader(),
      r2: new FakeR2(),
      approvals: makeApprovals([entry.cineprintPosterId]),
      execute: true,
    });
    const approved = await approvedEngine.migrateEntry(entry);
    expect(approved.state).toBe("VERIFIED");
  });

  it("marks optimization failures as FAILED without uploading", async () => {
    const optimizer = new FakeOptimizer();
    optimizer.fail = true;
    const r2 = new FakeR2();
    const entry = makeEntry();
    const engine = makeEngine({ entries: [entry], r2, optimizer, execute: true });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("FAILED");
    expect(r2.putCalls).toBe(0);
  });

  it("run with a selected subset processes only that subset", async () => {
    const entries = [
      makeEntry({ cineprintPosterId: "subset-a" }),
      makeEntry({ cineprintPosterId: "subset-b" }),
      makeEntry({ cineprintPosterId: "subset-c" }),
    ];
    const r2 = new FakeR2();
    const downloader = new FakeDownloader();
    const engine = makeEngine({
      entries,
      r2,
      downloader,
      execute: true,
      concurrency: 2,
    });

    const results = await engine.run([entries[0], entries[2]]);
    expect(results).toHaveLength(2);
    expect(results.map((result) => result.posterId)).toEqual(["subset-a", "subset-c"]);
    expect(downloader.downloadCalls).toBe(2);
    expect(r2.putCalls).toBe(4);
    expect(r2.objects.size).toBe(4);
  });

  it("supports concurrent migration without duplicate uploads", async () => {
    const entries = [
      makeEntry({ cineprintPosterId: "one" }),
      makeEntry({ cineprintPosterId: "two" }),
      makeEntry({ cineprintPosterId: "three" }),
    ];
    const r2 = new FakeR2();
    const stateStore = makeStateStore();
    const engine = makeEngine({
      entries,
      r2,
      stateStore,
      execute: true,
      concurrency: 3,
    });
    const results = await engine.run(entries);
    expect(results.every((result) => result.state === "VERIFIED")).toBe(true);
    expect(r2.putCalls).toBe(6);
    expect(new Set(r2.objects.keys()).size).toBe(6);
  });
});

describe("F4 — origin and CDN verification", () => {
  it("rejects an origin checksum mismatch without uploading", async () => {
    const entry = makeEntry({ cineprintPosterId: "f4-origin-checksum" });
    const optimizer = new FakeOptimizer();
    const optimized = await optimizer.optimize(PNG);
    const r2 = new FakeR2();
    r2.seed(entry.originalR2Key!, PNG, "image/png", "f".repeat(64));
    r2.seed(entry.optimizedR2Key!, optimized.buffer, "image/webp", optimized.sha256);
    const engine = makeEngine({ entries: [entry], r2, optimizer, execute: true });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(0);
  });

  it("rejects origin metadata mismatch without uploading", async () => {
    const entry = makeEntry({ cineprintPosterId: "f4-origin-metadata" });
    const optimizer = new FakeOptimizer();
    const optimized = await optimizer.optimize(PNG);
    const r2 = new FakeR2();
    r2.seed(entry.originalR2Key!, PNG, "image/png", PNG_SHA, "public, max-age=0");
    r2.seed(entry.optimizedR2Key!, optimized.buffer, "image/webp", optimized.sha256);
    const engine = makeEngine({ entries: [entry], r2, optimizer, execute: true });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(0);
  });

  it("verifies origin and CDN successfully for existing objects", async () => {
    const entry = makeEntry({ cineprintPosterId: "f4-success" });
    const optimizer = new FakeOptimizer();
    const optimized = await optimizer.optimize(PNG);
    const r2 = new FakeR2();
    r2.seed(entry.originalR2Key!, PNG, "image/png", PNG_SHA);
    r2.seed(entry.optimizedR2Key!, optimized.buffer, "image/webp", optimized.sha256);
    const engine = makeEngine({ entries: [entry], r2, optimizer, execute: true });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("VERIFIED");
    expect(r2.putCalls).toBe(0);
  });

  it("retries a temporary CDN failure and then succeeds", async () => {
    const entry = makeEntry({ cineprintPosterId: "f4-cdn-retry" });
    const r2 = new FakeR2();
    r2.publicFailures = 1;
    const engine = makeEngine({
      entries: [entry],
      r2,
      execute: true,
      publicRetryAttempts: 2,
    });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("VERIFIED");
    expect(r2.putCalls).toBe(2);
  });

  it("fails after CDN retry exhaustion", async () => {
    const entry = makeEntry({ cineprintPosterId: "f4-cdn-permanent" });
    const r2 = new FakeR2();
    r2.publicFailures = 10;
    const engine = makeEngine({
      entries: [entry],
      r2,
      execute: true,
      publicRetryAttempts: 2,
    });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("FAILED");
    expect(result.message).toContain("public verification");
    expect(r2.putCalls).toBe(2);
  });

  it("does not retry a permanent CDN failure", async () => {
    const entry = makeEntry({ cineprintPosterId: "f4-cdn-permanent-403" });
    const r2 = new FakeR2();
    r2.publicStatus = 403;
    const engine = makeEngine({
      entries: [entry],
      r2,
      execute: true,
      publicRetryAttempts: 3,
    });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("FAILED");
    expect(r2.publicCalls).toBe(1);
    expect(r2.putCalls).toBe(2);
  });

  it("fails when public bytes are incorrect despite successful origin verification", async () => {
    const entry = makeEntry({ cineprintPosterId: "f4-public-mismatch" });
    const optimizer = new FakeOptimizer();
    const optimized = await optimizer.optimize(PNG);
    const r2 = new FakeR2();
    r2.seed(entry.originalR2Key!, PNG, "image/png", PNG_SHA);
    r2.seed(entry.optimizedR2Key!, optimized.buffer, "image/webp", optimized.sha256);
    r2.publicMismatch = true;
    const engine = makeEngine({
      entries: [entry],
      r2,
      optimizer,
      execute: true,
      publicRetryAttempts: 2,
    });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("FAILED");
    expect(r2.putCalls).toBe(0);
  });
});

describe("F1 — VERIFIED state revalidation", () => {
  it("re-verifies a valid previously verified entry without re-downloading", async () => {
    const entry = makeEntry({ cineprintPosterId: "verified-valid" });
    const optimized = Buffer.from("optimized-bytes");
    const stateStore = writeRawState(validVerifiedStateEntry(entry));
    const r2 = new FakeR2();
    r2.seed(entry.originalR2Key!, PNG, "image/png", PNG_SHA);
    r2.seed(entry.optimizedR2Key!, optimized, "image/webp", sha256Hex(optimized));
    const downloader = new FakeDownloader();
    const engine = makeEngine({ entries: [entry], r2, downloader, stateStore, execute: true });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("VERIFIED");
    expect(result.message).toBe("Re-verified existing state");
    expect(downloader.downloadCalls).toBe(0);
    expect(r2.putCalls).toBe(0);
  });

  it("fails safely when VERIFIED state is missing required fields", async () => {
    const entry = makeEntry({ cineprintPosterId: "verified-missing-fields" });
    const stateStore = writeRawState({
      posterId: entry.cineprintPosterId,
      state: "VERIFIED",
    });
    const downloader = new FakeDownloader();
    const r2 = new FakeR2();
    const engine = makeEngine({ entries: [entry], r2, downloader, stateStore, execute: true });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("FAILED");
    expect(result.message).toContain("Invalid VERIFIED state");
    expect(downloader.downloadCalls).toBe(0);
    expect(r2.putCalls).toBe(0);
  });

  it("fails safely when the persisted checksum is incorrect", async () => {
    const entry = makeEntry({ cineprintPosterId: "verified-wrong-checksum" });
    const stateStore = writeRawState(
      validVerifiedStateEntry(entry, { originalSha256: "f".repeat(64) }),
    );
    const downloader = new FakeDownloader();
    const r2 = new FakeR2();
    const engine = makeEngine({ entries: [entry], r2, downloader, stateStore, execute: true });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("FAILED");
    expect(result.message).toContain("originalSha256");
    expect(downloader.downloadCalls).toBe(0);
    expect(r2.putCalls).toBe(0);
  });

  it("fails as CONFLICT when a previously verified R2 object is missing", async () => {
    const entry = makeEntry({ cineprintPosterId: "verified-missing-object" });
    const stateStore = writeRawState(validVerifiedStateEntry(entry));
    const r2 = new FakeR2();
    const engine = makeEngine({ entries: [entry], r2, execute: true, stateStore });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(0);
  });

  it("fails as FAILED when public delivery verification fails", async () => {
    const entry = makeEntry({ cineprintPosterId: "verified-public-failure" });
    const optimized = Buffer.from("optimized-bytes");
    const stateStore = writeRawState(validVerifiedStateEntry(entry));
    const r2 = new FakeR2();
    r2.seed(entry.originalR2Key!, PNG, "image/png", PNG_SHA);
    r2.seed(entry.optimizedR2Key!, optimized, "image/webp", sha256Hex(optimized));
    r2.publicFailures = 1;
    const engine = makeEngine({
      entries: [entry],
      r2,
      execute: true,
      stateStore,
      publicRetryAttempts: 1,
    });

    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("FAILED");
    expect(result.message).toContain("public verification");
    expect(r2.putCalls).toBe(0);
  });
});

let metadataTestCounter = 0;

describe("F3 — existing object metadata validation", () => {
  async function runWithMetadata(input: {
    originalContentType: string | null;
    originalCacheControl: string | null;
    optimizedContentType: string | null;
    optimizedCacheControl: string | null;
  }) {
    const entry = makeEntry({ cineprintPosterId: `metadata-${++metadataTestCounter}` });
    const optimizer = new FakeOptimizer();
    const optimized = await optimizer.optimize(PNG);
    const r2 = new FakeR2();
    r2.seed(
      entry.originalR2Key!,
      PNG,
      input.originalContentType,
      PNG_SHA,
      input.originalCacheControl,
    );
    r2.seed(
      entry.optimizedR2Key!,
      optimized.buffer,
      input.optimizedContentType,
      optimized.sha256,
      input.optimizedCacheControl,
    );
    const engine = makeEngine({ entries: [entry], r2, optimizer, execute: true });
    return { entry, engine, r2 };
  }

  it("rejects a missing original Content-Type", async () => {
    const { entry, engine, r2 } = await runWithMetadata({
      originalContentType: null,
      originalCacheControl: R2_CACHE_CONTROL,
      optimizedContentType: "image/webp",
      optimizedCacheControl: R2_CACHE_CONTROL,
    });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("CONFLICT");
    expect(result.message).toContain("Content-Type");
    expect(r2.putCalls).toBe(0);
  });

  it("rejects an incorrect original Content-Type", async () => {
    const { entry, engine, r2 } = await runWithMetadata({
      originalContentType: "image/jpeg",
      originalCacheControl: R2_CACHE_CONTROL,
      optimizedContentType: "image/webp",
      optimizedCacheControl: R2_CACHE_CONTROL,
    });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(0);
  });

  it("rejects a missing original Cache-Control", async () => {
    const { entry, engine, r2 } = await runWithMetadata({
      originalContentType: "image/png",
      originalCacheControl: null,
      optimizedContentType: "image/webp",
      optimizedCacheControl: R2_CACHE_CONTROL,
    });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("CONFLICT");
    expect(result.message).toContain("Cache-Control");
    expect(r2.putCalls).toBe(0);
  });

  it("rejects an incorrect original Cache-Control", async () => {
    const { entry, engine, r2 } = await runWithMetadata({
      originalContentType: "image/png",
      originalCacheControl: "public, max-age=0",
      optimizedContentType: "image/webp",
      optimizedCacheControl: R2_CACHE_CONTROL,
    });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(0);
  });

  it("rejects incorrect optimized metadata even when the original is correct", async () => {
    const { entry, engine, r2 } = await runWithMetadata({
      originalContentType: "image/png",
      originalCacheControl: R2_CACHE_CONTROL,
      optimizedContentType: null,
      optimizedCacheControl: R2_CACHE_CONTROL,
    });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(0);
  });

  it("accepts correct checksum and metadata for both variants", async () => {
    const { entry, engine, r2 } = await runWithMetadata({
      originalContentType: "image/png",
      originalCacheControl: R2_CACHE_CONTROL,
      optimizedContentType: "image/webp",
      optimizedCacheControl: R2_CACHE_CONTROL,
    });
    const result = await engine.migrateEntry(entry);
    expect(result.state).toBe("VERIFIED");
    expect(r2.putCalls).toBe(0);
  });
});

describe("F7 — verification without trusted state", () => {
  it("reports optimized checksum as unavailable when state is missing", async () => {
    const entry = makeEntry({ cineprintPosterId: "f7-missing-state" });
    const optimized = Buffer.from("optimized-bytes");
    const r2 = new FakeR2();
    r2.seed(entry.originalR2Key!, PNG, "image/png", PNG_SHA);
    r2.seed(entry.optimizedR2Key!, optimized, "image/webp", sha256Hex(optimized));
    const engine = makeEngine({ entries: [entry], r2, execute: false });

    const result = await engine.verifyEntry(entry);
    expect(result.optimized.expectedChecksumAvailable).toBe(false);
    expect(result.optimized.originChecksumVerified).toBe(false);
    expect(result.optimized.checksumVerified).toBe(false);
    expect(result.optimized.publicResponds).toBe(true);
    expect(result.optimized.publicChecksumVerified).toBe(false);
    expect(result.optimized.reason).toContain("UNVERIFIED");
    expect(r2.putCalls).toBe(0);
  });

  it("does not trust malformed VERIFIED state for optimized checksums", async () => {
    const entry = makeEntry({ cineprintPosterId: "f7-malformed-state" });
    const optimized = Buffer.from("optimized-bytes");
    const stateStore = writeRawState(
      validVerifiedStateEntry(entry, { optimizedSizeBytes: 0 }),
    );
    const r2 = new FakeR2();
    r2.seed(entry.originalR2Key!, PNG, "image/png", PNG_SHA);
    r2.seed(entry.optimizedR2Key!, optimized, "image/webp", sha256Hex(optimized));
    const engine = makeEngine({ entries: [entry], r2, execute: false, stateStore });

    const result = await engine.verifyEntry(entry);
    expect(result.optimized.expectedChecksumAvailable).toBe(false);
    expect(result.optimized.originChecksumVerified).toBe(false);
    expect(result.optimized.publicChecksumVerified).toBe(false);
    expect(r2.putCalls).toBe(0);
  });

  it("verifies optimized checksums when state is valid", async () => {
    const entry = makeEntry({ cineprintPosterId: "f7-valid-state" });
    const optimized = Buffer.from("optimized-bytes");
    const stateStore = writeRawState(validVerifiedStateEntry(entry));
    const r2 = new FakeR2();
    r2.seed(entry.originalR2Key!, PNG, "image/png", PNG_SHA);
    r2.seed(entry.optimizedR2Key!, optimized, "image/webp", sha256Hex(optimized));
    const engine = makeEngine({ entries: [entry], r2, execute: false, stateStore });

    const result = await engine.verifyEntry(entry);
    expect(result.optimized.expectedChecksumAvailable).toBe(true);
    expect(result.optimized.originChecksumVerified).toBe(true);
    expect(result.optimized.publicChecksumVerified).toBe(true);
    expect(result.optimized.checksumVerified).toBe(true);
    expect(result.optimized.reason).toBeNull();
    expect(r2.putCalls).toBe(0);
  });
});

describe("canary and approvals", () => {
  it("does not execute a canary without explicit execution", async () => {
    const downloader = new FakeDownloader();
    const r2 = new FakeR2();
    const entry = makeEntry({ cineprintPosterId: "canary-one" });
    const engine = makeEngine({
      entries: [entry],
      downloader,
      r2,
      execute: false,
    });
    const result = await engine.canary([entry.cineprintPosterId]);
    expect(result.plan).toHaveLength(1);
    expect(result.results).toEqual([]);
    expect(downloader.downloadCalls).toBe(0);
    expect(r2.putCalls).toBe(0);
  });

  it("rejects a medium-confidence canary entry even when it is approved", async () => {
    const entry = makeEntry({
      cineprintPosterId: "medium-canary",
      identityConfidence: "medium",
    });
    const downloader = new FakeDownloader();
    const r2 = new FakeR2();
    const engine = makeEngine({
      entries: [entry],
      approvals: makeApprovals(["medium-canary"]),
      downloader,
      r2,
      execute: true,
    });
    await expect(engine.canary([entry.cineprintPosterId])).rejects.toThrow(/high-confidence/);
    expect(downloader.downloadCalls).toBe(0);
    expect(r2.putCalls).toBe(0);
  });

  it("executes only the selected canary entries", async () => {
    const entries = [
      makeEntry({ cineprintPosterId: "canary-a" }),
      makeEntry({ cineprintPosterId: "canary-b" }),
      makeEntry({ cineprintPosterId: "canary-c" }),
    ];
    const r2 = new FakeR2();
    const downloader = new FakeDownloader();
    const engine = makeEngine({
      entries,
      r2,
      downloader,
      execute: true,
      concurrency: 2,
    });

    const result = await engine.canary(["canary-a", "canary-c"]);
    expect(result.plan.map((item) => item.posterId)).toEqual(["canary-a", "canary-c"]);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((item) => item.state === "VERIFIED")).toBe(true);
    expect(downloader.downloadCalls).toBe(2);
    expect(r2.putCalls).toBe(4);
    expect(r2.objects.size).toBe(4);
  });

  it("selects one Raindrop, one pbs and one artwork by default", () => {
    const entries = [
      makeEntry({ cineprintPosterId: "raindrop-1", sourceProvider: "raindrop-file" }),
      makeEntry({ cineprintPosterId: "pbs-1", sourceProvider: "pbs-twimg" }),
      makeEntry({
        cineprintPosterId: "artwork-1",
        raindropId: "222",
        sourceProvider: "pbs-twimg",
        optimizedAction: "regenerate",
      }),
      makeEntry({ cineprintPosterId: "medium-1", identityConfidence: "medium" }),
    ];
    const plan = buildCanaryPlan(makeManifest(entries), makeApprovals());
    expect(plan.map((item) => item.posterId)).toEqual(["raindrop-1", "pbs-1", "artwork-1"]);
    expect(plan.some((item) => item.identityConfidence !== "high")).toBe(false);
  });

  it("never appends an approved medium-confidence entry to the default canary", () => {
    const entries = [
      makeEntry({ cineprintPosterId: "raindrop-1", sourceProvider: "raindrop-file" }),
      makeEntry({ cineprintPosterId: "pbs-1", sourceProvider: "pbs-twimg" }),
      makeEntry({
        cineprintPosterId: "artwork-1",
        raindropId: "222",
        sourceProvider: "pbs-twimg",
        optimizedAction: "regenerate",
      }),
      makeEntry({ cineprintPosterId: "medium-1", identityConfidence: "medium" }),
    ];
    const plan = buildCanaryPlan(makeManifest(entries), makeApprovals(["medium-1"]));
    expect(plan.map((item) => item.posterId)).toEqual(["raindrop-1", "pbs-1", "artwork-1"]);
    expect(plan.map((item) => item.posterId)).not.toContain("medium-1");
  });

  it("ignores an approvals file containing a medium-confidence entry for default canary", () => {
    const entries = [
      makeEntry({ cineprintPosterId: "raindrop-1", sourceProvider: "raindrop-file" }),
      makeEntry({ cineprintPosterId: "pbs-1", sourceProvider: "pbs-twimg" }),
      makeEntry({
        cineprintPosterId: "artwork-1",
        raindropId: "222",
        sourceProvider: "pbs-twimg",
        optimizedAction: "regenerate",
      }),
      makeEntry({ cineprintPosterId: "medium-1", identityConfidence: "medium" }),
    ];
    const manifest = makeManifest(entries);
    const approvalsPath = path.join(tempDir, "medium-approvals.json");
    fs.writeFileSync(approvalsPath, JSON.stringify({ approved: ["medium-1"] }, null, 2), "utf8");
    const approvals = loadApprovals(approvalsPath, manifest);

    expect(approvals.approved.has("medium-1")).toBe(true);
    const plan = buildCanaryPlan(manifest, approvals);
    expect(plan.map((item) => item.posterId)).toEqual(["raindrop-1", "pbs-1", "artwork-1"]);

    expect(() =>
      buildCanaryPlan(manifest, approvals, { requestedPosterIds: ["medium-1"] }),
    ).toThrow(/high-confidence/);
  });

  it("rejects unknown and duplicate explicit canary IDs", () => {
    const entries = [
      makeEntry({ cineprintPosterId: "raindrop-1", sourceProvider: "raindrop-file" }),
    ];
    const manifest = makeManifest(entries);
    expect(() => buildCanaryPlan(manifest, makeApprovals(), {
      requestedPosterIds: ["missing-1"],
    })).toThrow(/Unknown canary poster ID/);
    expect(() => buildCanaryPlan(manifest, makeApprovals(), {
      requestedPosterIds: ["raindrop-1", "raindrop-1"],
    })).toThrow(/Duplicate canary poster ID/);
  });
});

describe("state, locks and safety", () => {
  it("persists state atomically and reloads it", async () => {
    const stateStore = makeStateStore();
    stateStore.update("poster-1", {
      state: "SOURCE_VERIFIED",
      sourceSha256: PNG_SHA,
      incrementAttempts: true,
    });
    await stateStore.save();

    const reloaded = new MigrationStateStore({
      statePath: path.join(tempDir, "migration-state.json"),
      manifestHash: "test-manifest-hash",
    });
    const entry = reloaded.get("poster-1");
    expect(entry?.state).toBe("SOURCE_VERIFIED");
    expect(entry?.attempts).toBe(1);
    expect(entry?.sourceSha256).toBe(PNG_SHA);
  });

  it("prevents concurrent migration runs with a lock", () => {
    const first = makeStateStore();
    const second = makeStateStore();
    first.acquireLock();
    try {
      expect(() => second.acquireLock()).toThrow(MigrationLockError);
    } finally {
      first.releaseLock();
    }
    expect(() => {
      second.acquireLock();
      second.releaseLock();
    }).not.toThrow();
  });

  it("rejects a state file created for a different manifest", async () => {
    const first = makeStateStore("hash-a");
    first.update("poster-1", { state: "PENDING" });
    await first.save();
    const second = makeStateStore("hash-b");
    expect(() => second.load()).toThrow(/different manifest/);
  });

  it("redacts bearer tokens and token query parameters", () => {
    const redacted = redactSecrets(
      "Authorization: Bearer super-secret-token https://example.com/x?token=abc123&access_token=def456",
    );
    expect(redacted).not.toContain("super-secret-token");
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("def456");
    expect(redacted).toContain("[REDACTED]");
  });

  it("builds a dry-run report without uploading", async () => {
    const entries = [
      makeEntry({ cineprintPosterId: "one" }),
      makeEntry({ cineprintPosterId: "two" }),
    ];
    const r2 = new FakeR2();
    const report = await buildDryRunReport({
      manifest: makeManifest(entries),
      r2,
      approvals: makeApprovals(),
    });
    expect(report.totals.posters).toBe(2);
    expect(report.totals.expectedR2Objects).toBe(4);
    expect(report.totals.missingObjects).toBe(4);
    expect(report.totals.conflictingObjects).toBe(0);
    expect(r2.putCalls).toBe(0);
  });
});

describe("fatal worker lifecycle", () => {
  it("waits for an in-flight upload and stops scheduling new work after a fatal failure", async () => {
    const r2 = new FakeR2();
    const downloader = new FakeDownloader();
    const stateStore = makeStateStore();
    const lockPath = path.join(tempDir, "migration-state.json.lock");
    const bPutStarted = deferred();
    const bPutRelease = deferred();
    const aFailed = deferred();

    r2.onPut = async (key) => {
      if (key.includes("/b.")) {
        bPutStarted.resolve();
        await bPutRelease.promise;
      }
    };

    const entries = [
      makeEntry({ cineprintPosterId: "a" }),
      makeEntry({ cineprintPosterId: "b" }),
      makeEntry({ cineprintPosterId: "c" }),
    ];
    const engine = makeEngine({
      entries,
      r2,
      downloader,
      stateStore,
      execute: true,
      concurrency: 2,
    });
    const originalMigrate = engine.migrateEntry.bind(engine);
    engine.migrateEntry = async (entry) => {
      if (entry.cineprintPosterId === "a") {
        aFailed.resolve();
        throw new Error("simulated fatal worker");
      }
      return originalMigrate(entry);
    };

    const run = engine.run(entries);
    await Promise.all([aFailed.promise, bPutStarted.promise]);

    expect(fs.existsSync(lockPath)).toBe(true);
    expect(downloader.downloadCalls).toBe(1);

    bPutRelease.resolve();
    await expect(run).rejects.toThrow(/simulated fatal worker/);

    expect(fs.existsSync(lockPath)).toBe(false);
    expect(stateStore.get("a")).toBeUndefined();
    expect(stateStore.get("b")?.state).toBe("VERIFIED");
    expect(stateStore.get("c")).toBeUndefined();
    expect(() => {
      stateStore.acquireLock();
      stateStore.releaseLock();
    }).not.toThrow();
  });

  it("waits for an in-flight verification before releasing the lock", async () => {
    const r2 = new FakeR2();
    const downloader = new FakeDownloader();
    const stateStore = makeStateStore();
    const lockPath = path.join(tempDir, "migration-state.json.lock");
    const bVerifyStarted = deferred();
    const bVerifyRelease = deferred();
    const aFailed = deferred();

    r2.onPublicVerify = async (url) => {
      if (url.includes("/b.")) {
        bVerifyStarted.resolve();
        await bVerifyRelease.promise;
      }
    };

    const entries = [
      makeEntry({ cineprintPosterId: "a" }),
      makeEntry({ cineprintPosterId: "b" }),
      makeEntry({ cineprintPosterId: "c" }),
    ];
    const engine = makeEngine({
      entries,
      r2,
      downloader,
      stateStore,
      execute: true,
      concurrency: 2,
    });
    const originalMigrate = engine.migrateEntry.bind(engine);
    engine.migrateEntry = async (entry) => {
      if (entry.cineprintPosterId === "a") {
        aFailed.resolve();
        throw new Error("simulated fatal worker");
      }
      return originalMigrate(entry);
    };

    const run = engine.run(entries);
    await Promise.all([aFailed.promise, bVerifyStarted.promise]);

    expect(fs.existsSync(lockPath)).toBe(true);
    expect(downloader.downloadCalls).toBe(1);

    bVerifyRelease.resolve();
    await expect(run).rejects.toThrow(/simulated fatal worker/);

    expect(fs.existsSync(lockPath)).toBe(false);
    expect(stateStore.get("b")?.state).toBe("VERIFIED");
    expect(stateStore.get("c")).toBeUndefined();
  });

  it("propagates a state-save failure and still releases the lock", async () => {
    const stateStore = makeStateStore();
    const lockPath = path.join(tempDir, "migration-state.json.lock");
    const originalSave = stateStore.save.bind(stateStore);
    let saves = 0;
    stateStore.save = async () => {
      saves += 1;
      if (saves === 1) {
        throw new Error("simulated disk full");
      }
      await originalSave();
    };

    const entry = makeEntry({ cineprintPosterId: "save-failure" });
    const engine = makeEngine({
      entries: [entry],
      stateStore,
      execute: true,
    });

    await expect(engine.run([entry])).rejects.toThrow(/simulated disk full/);
    expect(fs.existsSync(lockPath)).toBe(false);
  });
});
