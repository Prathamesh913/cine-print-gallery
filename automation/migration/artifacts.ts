import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { sha256Hex } from "./checksum";
import {
  DEFAULT_VERSIONED_QUALITY,
  DEFAULT_VERSIONED_WIDTH,
  LEGACY_CANARY_KEYS,
  optimizedVersionKey,
  optimizerSlug,
  originalVersionKey,
  type OptimizedArtifactMetadata,
  type OptimizerIdentity,
} from "./versioning";
import type { ManifestEntry, PosterManifest } from "./types";

export class ArtifactError extends Error {}

export interface ArtifactTransformation {
  width: number;
  quality: number;
  format: "webp";
}

export interface OriginalArtifactRecord {
  posterId: string;
  role: "original";
  sourceProvider: "raindrop-file" | "pbs-twimg";
  sourceVerified: true;
  sourceSha256: string;
  artifactSha256: string;
  sizeBytes: number;
  width: number;
  height: number;
  mimeType: string;
  localPath: string;
  r2Key: string;
}

export interface OptimizedArtifactRecord {
  posterId: string;
  role: "optimized";
  sourceProvider: "raindrop-file" | "pbs-twimg";
  sourceVerified: true;
  sourceSha256: string;
  artifactSha256: string;
  sizeBytes: number;
  width: number;
  height: number;
  mimeType: "image/webp";
  optimizer: OptimizerIdentity & { slug: string };
  transformation: ArtifactTransformation;
  localPath: string;
  r2Key: string;
}

export type ArtifactRecord = OriginalArtifactRecord | OptimizedArtifactRecord;

export interface ArtifactFailure {
  posterId: string;
  stage: "source" | "optimization" | "validation";
  reason: string;
}

export interface ArtifactManifestFile {
  schemaVersion: 1;
  generatedAt: string;
  complete: boolean;
  optimizer: OptimizerIdentity;
  optimizerSlug: string;
  transformation: ArtifactTransformation & {
    withoutEnlargement: boolean;
    rotate: "exif";
  };
  counts: {
    posters: number;
    artifacts: number;
    originals: number;
    optimized: number;
    uniqueKeys: number;
    failures: number;
  };
  artifacts: ArtifactRecord[];
  failures: ArtifactFailure[];
}

export interface FirstBatchPlanObject {
  posterId: string;
  role: "original" | "optimized";
  r2Key: string;
  expectedSha256: string;
  sizeBytes: number;
  localPath: string;
}

export interface FirstBatchPlan {
  schemaVersion: 1;
  generatedAt: string;
  posterIds: string[];
  objects: FirstBatchPlanObject[];
}

const CANARY_IDS = new Set(Object.keys(LEGACY_CANARY_KEYS));
const MEDIUM_IDS = new Set(["stranger-things-2", "the-substance-2"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/i;

export function eligibleEntries(manifest: PosterManifest): ManifestEntry[] {
  return manifest.entries.filter(
    (entry) =>
      entry.identityConfidence === "high" &&
      !CANARY_IDS.has(entry.cineprintPosterId) &&
      !MEDIUM_IDS.has(entry.cineprintPosterId),
  );
}

export function eligiblePosterIds(manifest: PosterManifest): string[] {
  return eligibleEntries(manifest).map((entry) => entry.cineprintPosterId);
}

export function artifactManifestPath(root = process.cwd()): string {
  return path.join(root, "migration", "optimized-artifacts.json");
}

export function firstBatchPlanPath(root = process.cwd()): string {
  return path.join(root, "migration", "first-batch-plan.json");
}

export function loadArtifactManifest(filePath = artifactManifestPath()): ArtifactManifestFile {
  if (!fs.existsSync(filePath)) {
    throw new ArtifactError(`Optimized artifact manifest is missing: ${filePath}`);
  }
  let parsed: ArtifactManifestFile;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as ArtifactManifestFile;
  } catch (error) {
    throw new ArtifactError(
      `Unable to parse optimized artifact manifest: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return parsed;
}

export function optimizedArtifactIndex(
  manifest: ArtifactManifestFile,
): Record<string, OptimizedArtifactMetadata> {
  const index: Record<string, OptimizedArtifactMetadata> = {};
  for (const artifact of manifest.artifacts) {
    if (artifact.role !== "optimized") continue;
    index[artifact.posterId] = {
      posterId: artifact.posterId,
      sourceSha256: artifact.sourceSha256,
      optimizedSha256: artifact.artifactSha256,
      optimizedBytes: artifact.sizeBytes,
      width: artifact.width,
      height: artifact.height,
      mimeType: artifact.mimeType,
      optimizer: {
        name: artifact.optimizer.name,
        version: artifact.optimizer.version,
        libvipsVersion: artifact.optimizer.libvipsVersion,
      },
      transformation: artifact.transformation,
    };
  }
  return index;
}

export function normalizeArtifactManifest(manifest: ArtifactManifestFile): ArtifactManifestFile {
  const artifacts = [...manifest.artifacts].sort((a, b) => {
    if (a.posterId !== b.posterId) return a.posterId.localeCompare(b.posterId);
    return a.role === b.role ? 0 : a.role === "original" ? -1 : 1;
  });
  const failures = [...manifest.failures].sort((a, b) => a.posterId.localeCompare(b.posterId));
  return {
    ...manifest,
    artifacts,
    failures,
    counts: {
      posters: new Set(artifacts.map((artifact) => artifact.posterId)).size,
      artifacts: artifacts.length,
      originals: artifacts.filter((artifact) => artifact.role === "original").length,
      optimized: artifacts.filter((artifact) => artifact.role === "optimized").length,
      uniqueKeys: new Set(artifacts.map((artifact) => artifact.r2Key)).size,
      failures: failures.length,
    },
  };
}

export function writeArtifactManifest(
  manifest: ArtifactManifestFile,
  filePath = artifactManifestPath(),
): void {
  const normalized = normalizeArtifactManifest(manifest);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

export function validateArtifactManifest(
  manifest: ArtifactManifestFile,
  posterManifest: PosterManifest,
): string[] {
  const errors: string[] = [];
  const expectedIds = eligiblePosterIds(posterManifest);
  const expectedSet = new Set(expectedIds);
  if (manifest.schemaVersion !== 1) errors.push("Unsupported artifact schemaVersion");
  if (!manifest.complete) errors.push("Artifact manifest is marked incomplete");
  if (manifest.failures.length > 0) {
    errors.push(`Artifact manifest contains ${manifest.failures.length} failure(s)`);
  }
  if (expectedIds.length !== 58) {
    errors.push(`Expected 58 eligible posters, found ${expectedIds.length}`);
  }
  if (manifest.artifacts.length !== 116) {
    errors.push(`Expected 116 artifacts, found ${manifest.artifacts.length}`);
  }
  const byPoster = new Map<string, ArtifactRecord[]>();
  const keys = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (!expectedSet.has(artifact.posterId)) {
      errors.push(`Artifact includes excluded poster ${artifact.posterId}`);
    }
    if (!SHA256_PATTERN.test(artifact.artifactSha256)) {
      errors.push(`${artifact.posterId}/${artifact.role} has an invalid artifact SHA-256`);
    }
    if (!Number.isInteger(artifact.sizeBytes) || artifact.sizeBytes <= 0) {
      errors.push(`${artifact.posterId}/${artifact.role} has an invalid size`);
    }
    if (
      !Number.isInteger(artifact.width) ||
      artifact.width <= 0 ||
      !Number.isInteger(artifact.height) ||
      artifact.height <= 0
    ) {
      errors.push(`${artifact.posterId}/${artifact.role} has invalid dimensions`);
    }
    if (!artifact.localPath) {
      errors.push(`${artifact.posterId}/${artifact.role} has no local path`);
    }
    if (artifact.sourceVerified !== true) {
      errors.push(`${artifact.posterId}/${artifact.role} source is not verified`);
    }
    if (keys.has(artifact.r2Key)) {
      errors.push(`Duplicate R2 key: ${artifact.r2Key}`);
    }
    keys.add(artifact.r2Key);
    const list = byPoster.get(artifact.posterId) ?? [];
    list.push(artifact);
    byPoster.set(artifact.posterId, list);
  }
  if (keys.size !== 116) errors.push(`Expected 116 unique keys, found ${keys.size}`);

  for (const posterId of expectedIds) {
    const entry = posterManifest.entries.find(
      (candidate) => candidate.cineprintPosterId === posterId,
    )!;
    const list = byPoster.get(posterId) ?? [];
    if (list.length !== 2) {
      errors.push(`${posterId} has ${list.length} artifacts, expected 2`);
      continue;
    }
    const original = list.find((artifact) => artifact.role === "original") as
      OriginalArtifactRecord | undefined;
    const optimized = list.find((artifact) => artifact.role === "optimized") as
      OptimizedArtifactRecord | undefined;
    if (!original || !optimized) {
      errors.push(`${posterId} is missing an original or optimized artifact`);
      continue;
    }
    const sourceSha = entry.sourceSha256?.toLowerCase();
    if (!sourceSha || !SHA256_PATTERN.test(sourceSha)) {
      errors.push(`${posterId} has no valid manifest source SHA-256`);
      continue;
    }
    if (original.sourceSha256 !== sourceSha || original.artifactSha256 !== sourceSha) {
      errors.push(`${posterId} original hash does not match the manifest source hash`);
    }
    if (original.sourceProvider !== entry.sourceProvider) {
      errors.push(`${posterId} original source provider does not match the manifest`);
    }
    if (optimized.sourceProvider !== entry.sourceProvider) {
      errors.push(`${posterId} optimized source provider does not match the manifest`);
    }
    if (optimized.sourceSha256 !== sourceSha) {
      errors.push(`${posterId} optimized source hash does not match the manifest`);
    }
    try {
      const expectedOriginalKey = originalVersionKey(
        posterId,
        sourceSha,
        entry.sourceMimeType === "image/jpeg" ? "jpg" : (entry.sourceMimeType?.split("/")[1] ?? ""),
      );
      if (original.r2Key !== expectedOriginalKey) {
        errors.push(`${posterId} original key does not match its identity`);
      }
    } catch (error) {
      errors.push(
        `${posterId} original key cannot be derived: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    try {
      const expectedOptimizedKey = optimizedVersionKey(
        posterId,
        optimized.artifactSha256,
        optimized.optimizer,
        optimized.transformation.width,
        optimized.transformation.quality,
      );
      if (optimized.r2Key !== expectedOptimizedKey) {
        errors.push(`${posterId} optimized key does not use the optimized artifact hash`);
      }
    } catch (error) {
      errors.push(
        `${posterId} optimized key cannot be derived: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (optimized.mimeType !== "image/webp") {
      errors.push(`${posterId} optimized MIME type is not image/webp`);
    }
    if (optimized.optimizer.slug !== optimizerSlug(optimized.optimizer)) {
      errors.push(`${posterId} optimizer slug is inconsistent`);
    }
    if (
      optimized.transformation.width !== DEFAULT_VERSIONED_WIDTH ||
      optimized.transformation.quality !== DEFAULT_VERSIONED_QUALITY
    ) {
      errors.push(`${posterId} optimizer settings differ from the canonical settings`);
    }
  }
  return errors;
}

export async function verifyArtifactFiles(
  manifest: ArtifactManifestFile,
  root = process.cwd(),
): Promise<string[]> {
  const errors: string[] = [];
  for (const artifact of manifest.artifacts) {
    const filePath = path.resolve(root, artifact.localPath);
    if (!fs.existsSync(filePath)) {
      errors.push(`${artifact.posterId}/${artifact.role} file is missing: ${artifact.localPath}`);
      continue;
    }
    const bytes = fs.readFileSync(filePath);
    const actualSha = sha256Hex(bytes);
    if (actualSha !== artifact.artifactSha256) {
      errors.push(`${artifact.posterId}/${artifact.role} file hash mismatch`);
    }
    if (bytes.length !== artifact.sizeBytes) {
      errors.push(`${artifact.posterId}/${artifact.role} file size mismatch`);
    }
    try {
      const metadata = await sharp(bytes).metadata();
      if (metadata.width !== artifact.width || metadata.height !== artifact.height) {
        errors.push(`${artifact.posterId}/${artifact.role} dimensions mismatch`);
      }
      if (artifact.role === "optimized" && metadata.format !== "webp") {
        errors.push(`${artifact.posterId}/${artifact.role} is not WebP`);
      }
    } catch (error) {
      errors.push(
        `${artifact.posterId}/${artifact.role} is not decodable: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return errors;
}

export function buildFirstBatchPlan(
  manifest: ArtifactManifestFile,
  posterManifest: PosterManifest,
  count = 5,
): FirstBatchPlan {
  const posterIds = eligiblePosterIds(posterManifest).slice(0, count);
  const objects: FirstBatchPlanObject[] = [];
  for (const posterId of posterIds) {
    const list = manifest.artifacts.filter((artifact) => artifact.posterId === posterId);
    if (list.length !== 2) {
      throw new ArtifactError(`${posterId} does not have exactly two artifacts`);
    }
    for (const role of ["original", "optimized"] as const) {
      const artifact = list.find((candidate) => candidate.role === role);
      if (!artifact) throw new ArtifactError(`${posterId} is missing its ${role} artifact`);
      objects.push({
        posterId,
        role,
        r2Key: artifact.r2Key,
        expectedSha256: artifact.artifactSha256,
        sizeBytes: artifact.sizeBytes,
        localPath: artifact.localPath,
      });
    }
  }
  if (objects.length !== count * 2) {
    throw new ArtifactError(`Expected ${count * 2} batch objects, found ${objects.length}`);
  }
  return {
    schemaVersion: 1,
    generatedAt: manifest.generatedAt,
    posterIds,
    objects,
  };
}
