import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { sha256Hex } from "./checksum";
import { MigrationOptimizer } from "./optimize";
import {
  buildFirstBatchPlan,
  normalizeArtifactManifest,
  validateArtifactManifest,
  verifyArtifactFiles,
  type ArtifactManifestFile,
  type OptimizedArtifactRecord,
  type OriginalArtifactRecord,
} from "./artifacts";
import {
  DEFAULT_VERSIONED_QUALITY,
  DEFAULT_VERSIONED_WIDTH,
  optimizerSlug,
  originalVersionKey,
  optimizedVersionKey,
  type OptimizerIdentity,
} from "./versioning";
import type { ManifestEntry, PosterManifest } from "./types";

const OPTIMIZER: OptimizerIdentity = {
  name: "sharp",
  version: "0.35.3",
  libvipsVersion: "8.18.3",
};
const OPTIMIZER_SLUG = optimizerSlug(OPTIMIZER);
let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cineprint-artifacts-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function entry(index: number): ManifestEntry {
  const posterId = `poster-${index}`;
  return {
    cineprintPosterId: posterId,
    identityConfidence: "high",
    sourceProvider: "pbs-twimg",
    sourceAvailability: "available",
    sourceHttpStatus: 200,
    sourceMimeType: "image/png",
    sourceSizeBytes: 100,
    sourceSha256: sha256Hex(Buffer.from(`source:${posterId}`)),
    sourceImageUrl: `https://pbs.twimg.com/media/${posterId}?format=png`,
    sourceDimensions: { width: 10, height: 10 },
  } as unknown as ManifestEntry;
}

function posterManifest(count = 58): PosterManifest {
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
    entries: Array.from({ length: count }, (_, index) => entry(index)),
  };
}

function artifactManifest(count = 58): ArtifactManifestFile {
  const manifest = posterManifest(count);
  const artifacts: Array<OriginalArtifactRecord | OptimizedArtifactRecord> = [];
  for (const item of manifest.entries) {
    const sourceSha = item.sourceSha256!;
    const optimizedSha = sha256Hex(Buffer.from(`optimized:${item.cineprintPosterId}:${sourceSha}`));
    artifacts.push({
      posterId: item.cineprintPosterId,
      role: "original",
      sourceProvider: "pbs-twimg",
      sourceVerified: true,
      sourceSha256: sourceSha,
      artifactSha256: sourceSha,
      sizeBytes: 100,
      width: 10,
      height: 10,
      mimeType: "image/png",
      localPath: `migration/cache/sources/${item.cineprintPosterId}.png`,
      r2Key: originalVersionKey(item.cineprintPosterId, sourceSha, "png"),
    });
    artifacts.push({
      posterId: item.cineprintPosterId,
      role: "optimized",
      sourceProvider: "pbs-twimg",
      sourceVerified: true,
      sourceSha256: sourceSha,
      artifactSha256: optimizedSha,
      sizeBytes: 50,
      width: 8,
      height: 8,
      mimeType: "image/webp",
      optimizer: { ...OPTIMIZER, slug: OPTIMIZER_SLUG },
      transformation: {
        width: DEFAULT_VERSIONED_WIDTH,
        quality: DEFAULT_VERSIONED_QUALITY,
        format: "webp",
      },
      localPath: `migration/cache/optimized/${item.cineprintPosterId}.webp`,
      r2Key: optimizedVersionKey(
        item.cineprintPosterId,
        optimizedSha,
        OPTIMIZER,
        DEFAULT_VERSIONED_WIDTH,
        DEFAULT_VERSIONED_QUALITY,
      ),
    });
  }
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    complete: true,
    optimizer: OPTIMIZER,
    optimizerSlug: OPTIMIZER_SLUG,
    transformation: {
      width: DEFAULT_VERSIONED_WIDTH,
      quality: DEFAULT_VERSIONED_QUALITY,
      format: "webp",
      withoutEnlargement: true,
      rotate: "exif",
    },
    counts: {
      posters: count,
      artifacts: count * 2,
      originals: count,
      optimized: count,
      uniqueKeys: count * 2,
      failures: 0,
    },
    artifacts,
    failures: [],
  };
}

describe("F26 — artifact manifest validation", () => {
  it("accepts 58 posters / 116 artifacts with unique keys", () => {
    const manifest = artifactManifest();
    expect(validateArtifactManifest(manifest, posterManifest())).toEqual([]);
    expect(manifest.artifacts).toHaveLength(116);
    expect(new Set(manifest.artifacts.map((artifact) => artifact.r2Key)).size).toBe(116);
  });

  it("fails closed on a missing optimized artifact", () => {
    const manifest = artifactManifest();
    manifest.artifacts = manifest.artifacts.filter(
      (artifact) => !(artifact.posterId === "poster-0" && artifact.role === "optimized"),
    );
    const errors = validateArtifactManifest(manifest, posterManifest());
    expect(errors.join(" ")).toMatch(/poster-0 has 1 artifacts|Expected 116/);
  });

  it("fails closed on duplicate keys", () => {
    const manifest = artifactManifest();
    const optimized = manifest.artifacts.find((artifact) => artifact.role === "optimized")!;
    const other = manifest.artifacts.find(
      (artifact) => artifact.role === "optimized" && artifact.posterId !== optimized.posterId,
    )!;
    other.r2Key = optimized.r2Key;
    expect(validateArtifactManifest(manifest, posterManifest()).join(" ")).toMatch(
      /Duplicate R2 key/,
    );
  });

  it("fails closed when the optimized key uses the source hash", () => {
    const manifest = artifactManifest();
    const optimized = manifest.artifacts.find(
      (artifact) => artifact.role === "optimized",
    ) as OptimizedArtifactRecord;
    optimized.r2Key = optimizedVersionKey(
      optimized.posterId,
      optimized.sourceSha256,
      OPTIMIZER,
      DEFAULT_VERSIONED_WIDTH,
      DEFAULT_VERSIONED_QUALITY,
    );
    expect(validateArtifactManifest(manifest, posterManifest()).join(" ")).toMatch(
      /does not use the optimized artifact hash/,
    );
  });

  it("fails closed on source hash mismatch or invalid metadata", () => {
    const manifest = artifactManifest();
    const optimized = manifest.artifacts.find(
      (artifact) => artifact.role === "optimized",
    ) as OptimizedArtifactRecord;
    optimized.sourceSha256 = "0".repeat(64);
    optimized.artifactSha256 = "not-a-hash";
    const errors = validateArtifactManifest(manifest, posterManifest()).join(" ");
    expect(errors).toMatch(/invalid artifact SHA-256|optimized source hash/);
  });

  it("normalizes artifact order deterministically", () => {
    const manifest = artifactManifest();
    const reversed = { ...manifest, artifacts: [...manifest.artifacts].reverse() };
    expect(normalizeArtifactManifest(reversed).artifacts).toEqual(
      normalizeArtifactManifest(manifest).artifacts,
    );
  });
});

describe("F26 — deterministic optimization", () => {
  it("produces identical optimized hashes and keys for identical inputs", async () => {
    const source = await sharp({
      create: {
        width: 12,
        height: 12,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const optimizer = new MigrationOptimizer();
    const first = await optimizer.optimize(source);
    const second = await optimizer.optimize(source);
    expect(first.sha256).toBe(second.sha256);
    expect(first.buffer.equals(second.buffer)).toBe(true);
    expect(
      optimizedVersionKey(
        "poster-0",
        first.sha256,
        OPTIMIZER,
        DEFAULT_VERSIONED_WIDTH,
        DEFAULT_VERSIONED_QUALITY,
      ),
    ).toBe(
      optimizedVersionKey(
        "poster-0",
        second.sha256,
        OPTIMIZER,
        DEFAULT_VERSIONED_WIDTH,
        DEFAULT_VERSIONED_QUALITY,
      ),
    );
  });

  it("produces a different key when optimized bytes change", async () => {
    const source = await sharp({
      create: {
        width: 12,
        height: 12,
        channels: 4,
        background: { r: 10, g: 20, b: 30, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const first = await new MigrationOptimizer({ quality: 80 }).optimize(source);
    const second = await new MigrationOptimizer({ quality: 70 }).optimize(source);
    expect(first.sha256).not.toBe(second.sha256);
    expect(
      optimizedVersionKey(
        "poster-0",
        first.sha256,
        OPTIMIZER,
        DEFAULT_VERSIONED_WIDTH,
        DEFAULT_VERSIONED_QUALITY,
      ),
    ).not.toBe(
      optimizedVersionKey(
        "poster-0",
        second.sha256,
        OPTIMIZER,
        DEFAULT_VERSIONED_WIDTH,
        DEFAULT_VERSIONED_QUALITY,
      ),
    );
  });
});

describe("F26 — first batch plan", () => {
  it("selects exactly five posters and ten objects", () => {
    const plan = buildFirstBatchPlan(artifactManifest(), posterManifest(), 5);
    expect(plan.posterIds).toHaveLength(5);
    expect(plan.objects).toHaveLength(10);
    expect(plan.objects.filter((object) => object.role === "original")).toHaveLength(5);
    expect(plan.objects.filter((object) => object.role === "optimized")).toHaveLength(5);
    expect(new Set(plan.objects.map((object) => object.r2Key)).size).toBe(10);
  });
});

describe("F26 — local artifact file verification", () => {
  it("verifies source and optimized bytes and detects tampering", async () => {
    const source = await sharp({
      create: {
        width: 10,
        height: 10,
        channels: 4,
        background: { r: 1, g: 2, b: 3, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const optimized = await sharp(source).resize({ width: 8 }).webp({ quality: 80 }).toBuffer();
    const sourcePath = path.join(tempDir, "source.png");
    const optimizedPath = path.join(tempDir, "optimized.webp");
    fs.writeFileSync(sourcePath, source);
    fs.writeFileSync(optimizedPath, optimized);
    const sourceSha = sha256Hex(source);
    const optimizedSha = sha256Hex(optimized);
    const sourceMeta = await sharp(source).metadata();
    const optimizedMeta = await sharp(optimized).metadata();
    const manifest: ArtifactManifestFile = {
      ...artifactManifest(1),
      artifacts: [
        {
          posterId: "poster-0",
          role: "original",
          sourceProvider: "pbs-twimg",
          sourceVerified: true,
          sourceSha256: sourceSha,
          artifactSha256: sourceSha,
          sizeBytes: source.length,
          width: sourceMeta.width!,
          height: sourceMeta.height!,
          mimeType: "image/png",
          localPath: sourcePath,
          r2Key: originalVersionKey("poster-0", sourceSha, "png"),
        },
        {
          posterId: "poster-0",
          role: "optimized",
          sourceProvider: "pbs-twimg",
          sourceVerified: true,
          sourceSha256: sourceSha,
          artifactSha256: optimizedSha,
          sizeBytes: optimized.length,
          width: optimizedMeta.width!,
          height: optimizedMeta.height!,
          mimeType: "image/webp",
          optimizer: { ...OPTIMIZER, slug: OPTIMIZER_SLUG },
          transformation: {
            width: DEFAULT_VERSIONED_WIDTH,
            quality: DEFAULT_VERSIONED_QUALITY,
            format: "webp",
          },
          localPath: optimizedPath,
          r2Key: optimizedVersionKey(
            "poster-0",
            optimizedSha,
            OPTIMIZER,
            DEFAULT_VERSIONED_WIDTH,
            DEFAULT_VERSIONED_QUALITY,
          ),
        },
      ],
    };
    expect(await verifyArtifactFiles(manifest, "/")).toEqual([]);
    fs.writeFileSync(optimizedPath, Buffer.from("tampered"));
    expect((await verifyArtifactFiles(manifest, "/")).join(" ")).toMatch(
      /file hash mismatch|file size mismatch/,
    );
  });
});
