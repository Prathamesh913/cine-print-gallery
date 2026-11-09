import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { sha256Hex } from "./checksum";
import { MigrationEngine } from "./engine";
import type { Approvals } from "./manifest";
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
    background: { r: 1, g: 2, b: 3, alpha: 1 },
  },
})
  .png()
  .toBuffer();
const PNG_SHA = sha256Hex(PNG);
const WEBP = Buffer.from("reconciled-webp");
const WEBP_SHA = sha256Hex(WEBP);

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cineprint-reconcile-test-"));
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
    existingOriginalObject: {
      path: null,
      exists: false,
      sizeBytes: null,
      mimeType: null,
    },
    existingOptimizedObject: {
      path: null,
      exists: false,
      sizeBytes: null,
      mimeType: null,
    },
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

class ReconcileR2 implements R2Store {
  readonly objects = new Map<string, { body: Buffer; contentType: string; sha256: string }>();
  putCalls = 0;
  behavior: "ok" | "store-then-throw" | "throw" | "conflict" = "ok";
  readBackThrows = false;
  readBackMismatch = false;
  throwCount = 0;
  putDelayMs = 0;

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
    this.putCalls += 1;
    if (this.putDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.putDelayMs));
    }
    if (this.behavior === "conflict") {
      throw new R2ConflictError("simulated 412");
    }
    if (this.behavior === "throw") {
      if (this.throwCount > 0) {
        this.throwCount -= 1;
        throw new R2UploadError("simulated lost response");
      }
    }
    if (this.behavior === "store-then-throw") {
      this.seed(
        options.key,
        this.readBackMismatch ? Buffer.from("different bytes") : options.body,
        options.contentType,
      );
      throw new R2UploadError("simulated lost response after write");
    }
    this.seed(options.key, options.body, options.contentType);
  }

  async verifyOrigin(
    key: string,
    expected: { sha256: string; sizeBytes: number; contentType: string; cacheControl: string },
  ) {
    if (this.readBackThrows && this.putCalls > 0) {
      throw new R2UploadError("simulated read-back network failure");
    }
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
    const checksumOk = object.sha256 === expected.sha256;
    const sizeOk = object.body.length === expected.sizeBytes;
    const metadataOk =
      object.contentType.split(";")[0].trim().toLowerCase() ===
      expected.contentType.split(";")[0].trim().toLowerCase();
    return {
      ok: checksumOk && sizeOk && metadataOk,
      exists: true,
      checksumOk,
      metadataOk,
      sizeOk,
      metadata: await this.head(key),
      sha256: object.sha256,
      sizeBytes: object.body.length,
      reason: checksumOk ? null : "checksum mismatch",
    };
  }

  async verify(
    key: string,
    expected: { sha256: string; sizeBytes: number; contentType: string; cacheControl: string },
  ): Promise<R2Verification> {
    const object = this.objects.get(key);
    if (!object) return { ok: false, metadata: null, reason: "not found" };
    return {
      ok: object.sha256 === expected.sha256 && object.body.length === expected.sizeBytes,
      metadata: await this.head(key),
      reason: null,
    };
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

function engineWith(r2: R2Store): MigrationEngine {
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
  const approvals: Approvals = {
    path: path.join(tempDir, "approvals.json"),
    exists: false,
    approved: new Set(),
  };
  return new MigrationEngine({
    manifest: makeManifest(entry),
    stateStore,
    downloader,
    optimizer,
    r2,
    approvals,
    execute: true,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 2,
    publicRetryAttempts: 1,
    logger: () => undefined,
  });
}

describe("F17 — ambiguous upload reconciliation", () => {
  it("accepts a lost response when read-back matches exactly", async () => {
    const r2 = new ReconcileR2();
    r2.behavior = "store-then-throw";
    const result = await engineWith(r2).run([makeEntry()]);
    expect(result[0].state).toBe("VERIFIED");
    expect(r2.putCalls).toBe(2);
    expect(result[0].original?.uploaded).toBe(true);
    expect(result[0].original?.alreadyVerified).toBe(true);
  });

  it("fails closed when read-back differs after an ambiguous upload", async () => {
    const r2 = new ReconcileR2();
    r2.behavior = "store-then-throw";
    r2.readBackMismatch = true;
    const result = await engineWith(r2).run([makeEntry()]);
    expect(result[0].state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(1);
  });

  it("stops safely when read-back is unavailable", async () => {
    const r2 = new ReconcileR2();
    r2.behavior = "store-then-throw";
    r2.readBackThrows = true;
    const result = await engineWith(r2).run([makeEntry()]);
    expect(result[0].state).toBe("FAILED");
    expect(result[0].message).toMatch(/could not be established/);
    expect(r2.putCalls).toBe(1);
  });

  it("treats a 412 with matching bytes as already verified", async () => {
    const r2 = new ReconcileR2();
    r2.behavior = "conflict";
    r2.seed("cineprint/versions/original/poster-1/aaaa.png", PNG, "image/png");
    const result = await engineWith(r2).run([makeEntry()]);
    // The original is accepted, then the optimized upload still conflicts.
    expect(result[0].state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(1);
  });

  it("treats a 412 with different bytes as a hard conflict", async () => {
    const r2 = new ReconcileR2();
    r2.behavior = "conflict";
    r2.seed("cineprint/versions/original/poster-1/aaaa.png", Buffer.from("other"), "image/png");
    const result = await engineWith(r2).run([makeEntry()]);
    expect(result[0].state).toBe("CONFLICT");
    expect(r2.putCalls).toBe(0);
  });

  it("holds the state lock until every worker settles", async () => {
    const r2 = new ReconcileR2();
    r2.putDelayMs = 25;
    const engine = engineWith(r2);
    const lockPath = path.join(tempDir, "state.json.lock");
    const running = engine.run([makeEntry()]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fs.existsSync(lockPath)).toBe(true);
    await running;
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it("retries only after read-back proves the object absent", async () => {
    const r2 = new ReconcileR2();
    r2.behavior = "throw";
    r2.throwCount = 1;
    const result = await engineWith(r2).run([makeEntry()]);
    expect(result[0].state).toBe("VERIFIED");
    expect(r2.putCalls).toBe(3);
  });
});
