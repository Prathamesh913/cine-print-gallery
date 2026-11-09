import { isSha256Hex } from "./checksum";
import { manifestHash } from "./manifest";
import { LEGACY_CANARY_KEYS, type OptimizerIdentity } from "./versioning";
import { validateArtifactManifest, type ArtifactManifestFile } from "./artifacts";
import type { ManifestEntry, MigrationState, MigrationStateEntry, PosterManifest } from "./types";

export const R2_PUBLIC_BASE_URL = "https://images.cineprint.click";
export const EXPECTED_R2_HOST = "images.cineprint.click";
export const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

export const DEFAULT_R2_BROWSER_IMAGES_ENABLED = true;
export const DEFAULT_R2_SEO_IMAGES_ENABLED = true;

const SUPPORTED_ORIGINAL_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const LEGACY_ORIGINAL_KEY_PREFIXES = ["cineprint/raindrop/", "cineprint/external/"];
const VERSIONED_ORIGINAL_KEY_PREFIX = "cineprint/versions/original/";
const LEGACY_OPTIMIZED_KEY_PREFIX = "cineprint/optimized/";
const VERSIONED_OPTIMIZED_KEY_PREFIX = "cineprint/versions/optimized/";

export interface R2MappedObject {
  key: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
}

export interface R2ImageMapEntry {
  posterId: string;
  blobImageUrl: string;
  original: R2MappedObject;
  optimized: R2MappedObject;
  verifiedAt: string;
}

export interface R2ImageMapFile {
  schemaVersion: 1;
  manifestHash: string;
  publicBaseUrl: string;
  generatedAt: string;
  entries: Record<string, R2ImageMapEntry>;
}

export interface R2ResolverAllowlist {
  schemaVersion: number;
  posters: string[];
}

export interface RuntimeActivationOptions {
  browserEnabled?: boolean;
  seoEnabled?: boolean;
}

export interface VersionedRuntimeMapInput {
  manifest: PosterManifest;
  artifacts: ArtifactManifestFile;
  batchStates: Array<{ label: string; state: MigrationState }>;
  canaryMap: R2ImageMapFile;
  publicBaseUrl?: string;
  generatedAt?: string;
}

export interface VersionedRuntimeMapResult {
  map: R2ImageMapFile;
  allowlist: R2ResolverAllowlist;
  mapContent: string;
  allowlistContent: string;
}

export function normalizePublicBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`Public base URL must use HTTPS: ${value}`);
  }
  if (url.hostname !== EXPECTED_R2_HOST) {
    throw new Error(`Public base URL host must be ${EXPECTED_R2_HOST}, found ${url.hostname}`);
  }
  if (url.search || url.hash) {
    throw new Error("Public base URL must not contain a query or hash");
  }
  return url.origin;
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertIsoTimestamp(value: unknown, label: string): asserts value is string {
  assertNonEmptyString(value, label);
  if (!Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be a valid ISO timestamp`);
  }
}

function extensionForMime(mimeType: string): string[] {
  switch (mimeType) {
    case "image/jpeg":
      return ["jpg", "jpeg"];
    case "image/png":
      return ["png"];
    case "image/webp":
      return ["webp"];
    case "image/gif":
      return ["gif"];
    default:
      return [];
  }
}

export function assertSafeR2Key(key: string, kind: "original" | "optimized"): void {
  if (key.startsWith("/") || key.includes("..") || key.includes("?") || key.includes("#")) {
    throw new Error(`R2 ${kind} key is not a safe object key: ${key}`);
  }
  if (kind === "original") {
    if (
      !LEGACY_ORIGINAL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)) &&
      !key.startsWith(VERSIONED_ORIGINAL_KEY_PREFIX)
    ) {
      throw new Error(`R2 original key must use a legacy or versioned original prefix: ${key}`);
    }
    return;
  }
  if (
    !key.startsWith(LEGACY_OPTIMIZED_KEY_PREFIX) &&
    !key.startsWith(VERSIONED_OPTIMIZED_KEY_PREFIX)
  ) {
    throw new Error(`R2 optimized key must use a legacy or versioned optimized prefix: ${key}`);
  }
  if (!key.endsWith(".webp")) {
    throw new Error(`R2 optimized key must end with .webp: ${key}`);
  }
}

export function assertBlobImageUrl(blobImageUrl: string, originalKey: string): void {
  let url: URL;
  try {
    url = new URL(blobImageUrl);
  } catch {
    throw new Error(`Blob image URL is invalid: ${blobImageUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`Blob image URL must use HTTPS: ${blobImageUrl}`);
  }
  if (!url.hostname.endsWith(BLOB_HOST_SUFFIX)) {
    throw new Error(`Blob image URL host is not a Vercel Blob host: ${url.hostname}`);
  }
  if (url.search || url.hash) {
    throw new Error("Blob image URL must not contain a query or hash");
  }
  // Versioned originals are new R2 keys; the Blob image is the pre-migration
  // source identity and intentionally has a different path.
  if (originalKey.startsWith(VERSIONED_ORIGINAL_KEY_PREFIX)) return;
  if (url.pathname !== `/${originalKey}`) {
    throw new Error(
      `Blob image URL path ${url.pathname} does not match original key /${originalKey}`,
    );
  }
}

export function assertPublicUrl(urlValue: string, key: string, baseUrl: string): void {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new Error(`R2 public URL is invalid: ${urlValue}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`R2 public URL must use HTTPS: ${urlValue}`);
  }
  if (url.hostname !== EXPECTED_R2_HOST) {
    throw new Error(`R2 public URL host must be ${EXPECTED_R2_HOST}: ${url.hostname}`);
  }
  if (url.pathname !== `/${key}`) {
    throw new Error(`R2 public URL path ${url.pathname} does not match key /${key}`);
  }
  if (url.search || url.hash) {
    throw new Error("R2 public URL must not contain a query or hash");
  }
  if (urlValue !== `${baseUrl}/${key}`) {
    throw new Error(`R2 public URL does not match the configured base URL: ${urlValue}`);
  }
}

export function validateAllowlist(raw: unknown): R2ResolverAllowlist {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("R2 resolver allowlist must be an object");
  }
  const candidate = raw as { schemaVersion?: unknown; posters?: unknown };
  if (candidate.schemaVersion !== 1) {
    throw new Error(
      `Unsupported R2 resolver allowlist schemaVersion: ${String(candidate.schemaVersion)}`,
    );
  }
  if (!Array.isArray(candidate.posters) || candidate.posters.length === 0) {
    throw new Error("R2 resolver allowlist posters must be a non-empty array");
  }
  const seen = new Set<string>();
  const posters: string[] = [];
  for (const value of candidate.posters) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error("R2 resolver allowlist contains a non-string or empty poster ID");
    }
    const id = value.trim();
    if (seen.has(id)) {
      throw new Error(`R2 resolver allowlist contains duplicate poster ID: ${id}`);
    }
    seen.add(id);
    posters.push(id);
  }
  return { schemaVersion: 1, posters: posters.sort() };
}

export function validateR2ImageMap(map: R2ImageMapFile): void {
  if (!map || map.schemaVersion !== 1) {
    throw new Error(`Unsupported R2 image map schemaVersion: ${String(map?.schemaVersion)}`);
  }
  if (!isSha256Hex(map.manifestHash)) {
    throw new Error("R2 image map manifestHash is not a valid SHA-256 hex digest");
  }
  assertIsoTimestamp(map.generatedAt, "R2 image map generatedAt");

  let base: URL;
  try {
    base = new URL(map.publicBaseUrl);
  } catch {
    throw new Error(`R2 image map publicBaseUrl is invalid: ${map.publicBaseUrl}`);
  }
  if (base.protocol !== "https:" || base.hostname !== EXPECTED_R2_HOST) {
    throw new Error(
      `R2 image map publicBaseUrl must be https://${EXPECTED_R2_HOST}, found ${map.publicBaseUrl}`,
    );
  }
  if (base.search || base.hash) {
    throw new Error("R2 image map publicBaseUrl must not contain a query or hash");
  }
  if (!map.entries || typeof map.entries !== "object" || Array.isArray(map.entries)) {
    throw new Error("R2 image map entries must be an object keyed by poster ID");
  }

  for (const [id, entry] of Object.entries(map.entries)) {
    if (entry.posterId !== id) {
      throw new Error(`R2 image map entry key ${id} does not match posterId ${entry.posterId}`);
    }
    assertNonEmptyString(entry.blobImageUrl, `${id}.blobImageUrl`);
    assertIsoTimestamp(entry.verifiedAt, `${id}.verifiedAt`);

    assertNonEmptyString(entry.original?.key, `${id}.original.key`);
    assertNonEmptyString(entry.original?.url, `${id}.original.url`);
    assertNonEmptyString(entry.original?.contentType, `${id}.original.contentType`);
    assertPositiveInteger(entry.original?.sizeBytes, `${id}.original.sizeBytes`);
    if (!isSha256Hex(entry.original?.sha256)) {
      throw new Error(`${id}.original.sha256 is not a valid SHA-256 hex digest`);
    }
    if (!SUPPORTED_ORIGINAL_CONTENT_TYPES.has(entry.original.contentType)) {
      throw new Error(`${id}.original.contentType is unsupported: ${entry.original.contentType}`);
    }
    assertSafeR2Key(entry.original.key, "original");
    assertBlobImageUrl(entry.blobImageUrl, entry.original.key);
    assertPublicUrl(entry.original.url, entry.original.key, map.publicBaseUrl);

    assertNonEmptyString(entry.optimized?.key, `${id}.optimized.key`);
    assertNonEmptyString(entry.optimized?.url, `${id}.optimized.url`);
    assertNonEmptyString(entry.optimized?.contentType, `${id}.optimized.contentType`);
    assertPositiveInteger(entry.optimized?.sizeBytes, `${id}.optimized.sizeBytes`);
    if (!isSha256Hex(entry.optimized?.sha256)) {
      throw new Error(`${id}.optimized.sha256 is not a valid SHA-256 hex digest`);
    }
    if (entry.optimized.contentType !== "image/webp") {
      throw new Error(`${id}.optimized.contentType must be image/webp`);
    }
    assertSafeR2Key(entry.optimized.key, "optimized");
    assertPublicUrl(entry.optimized.url, entry.optimized.key, map.publicBaseUrl);
  }
}

export function buildRuntimeMapSource(
  map: R2ImageMapFile,
  allowlist: R2ResolverAllowlist,
  activation: RuntimeActivationOptions = {},
): string {
  validateR2ImageMap(map);

  const browserEnabled = activation.browserEnabled ?? DEFAULT_R2_BROWSER_IMAGES_ENABLED;
  const seoEnabled = activation.seoEnabled ?? DEFAULT_R2_SEO_IMAGES_ENABLED;

  const mapIds = Object.keys(map.entries).sort();
  const allowlistIds = [...allowlist.posters].sort();
  if (
    mapIds.length !== allowlistIds.length ||
    mapIds.some((id, index) => id !== allowlistIds[index])
  ) {
    throw new Error(
      `R2 image map entries must exactly match the resolver allowlist. Map: [${mapIds.join(", ")}], allowlist: [${allowlistIds.join(", ")}]`,
    );
  }

  const lines: string[] = [
    "// GENERATED FILE — DO NOT EDIT BY HAND.",
    "// Source: migration/r2-image-map.json",
    `// Manifest hash: ${map.manifestHash}`,
    "// Generated by scripts/generate-r2-image-map.ts.",
    "//",
    "// Browser and SEO R2 activation are independent and both disabled by default.",
    "// Enabling either requires a reviewed change to DEFAULT_R2_BROWSER_IMAGES_ENABLED",
    "// or DEFAULT_R2_SEO_IMAGES_ENABLED in scripts/generate-r2-image-map.ts,",
    "// regeneration of this file, and the separate Phase 4.2 activation review.",
    "// `--check` will fail on manual edits.",
    "",
    `export const R2_BROWSER_IMAGES_ENABLED = ${browserEnabled ? "true" : "false"};`,
    `export const R2_SEO_IMAGES_ENABLED = ${seoEnabled ? "true" : "false"};`,
    "",
    "export interface R2ImageMapEntry {",
    "  blobImageUrl: string;",
    "  originalUrl: string;",
    "  optimizedUrl: string | null;",
    "  originalKey: string;",
    "  optimizedKey: string | null;",
    "  verifiedAt: string;",
    "}",
    "",
    "export const R2_IMAGE_MAP: Readonly<Record<string, R2ImageMapEntry>> = {",
  ];

  for (const id of mapIds) {
    const entry = map.entries[id];
    lines.push(`  ${JSON.stringify(id)}: {`);
    lines.push(`    blobImageUrl: ${JSON.stringify(entry.blobImageUrl)},`);
    lines.push(`    originalUrl: ${JSON.stringify(entry.original.url)},`);
    lines.push(`    optimizedUrl: ${JSON.stringify(entry.optimized.url)},`);
    lines.push(`    originalKey: ${JSON.stringify(entry.original.key)},`);
    lines.push(`    optimizedKey: ${JSON.stringify(entry.optimized.key)},`);
    lines.push(`    verifiedAt: ${JSON.stringify(entry.verifiedAt)},`);
    lines.push("  },");
  }

  lines.push("};", "");
  return lines.join("\n");
}

function artifactByRole(
  artifacts: ArtifactManifestFile,
  posterId: string,
  role: "original" | "optimized",
) {
  const matches = artifacts.artifacts.filter(
    (artifact) => artifact.posterId === posterId && artifact.role === role,
  );
  if (matches.length !== 1) {
    throw new Error(`${posterId} has ${matches.length} ${role} artifacts, expected 1`);
  }
  return matches[0];
}

function buildMigratedEntry(
  manifest: PosterManifest,
  artifacts: ArtifactManifestFile,
  state: MigrationStateEntry,
  publicBaseUrl: string,
): R2ImageMapEntry {
  const posterId = state.posterId;
  const manifestEntry = manifest.entries.find((entry) => entry.cineprintPosterId === posterId);
  if (!manifestEntry) throw new Error(`${posterId} is missing from the manifest`);
  if (manifestEntry.identityConfidence !== "high") {
    throw new Error(`${posterId} is not high-confidence`);
  }
  if (state.state !== "VERIFIED") {
    throw new Error(`${posterId} state is ${state.state}, not VERIFIED`);
  }
  if (state.originalUploaded !== true || state.optimizedUploaded !== true) {
    throw new Error(`${posterId} has an unuploaded object`);
  }
  const verifiedAt = state.verifiedAt;
  assertIsoTimestamp(verifiedAt, `${posterId}.verifiedAt`);

  const original = artifactByRole(artifacts, posterId, "original");
  const optimized = artifactByRole(artifacts, posterId, "optimized");
  const sourceSha = manifestEntry.sourceSha256?.toLowerCase();
  if (!sourceSha || !isSha256Hex(sourceSha)) {
    throw new Error(`${posterId} has no valid manifest source SHA-256`);
  }
  if (state.sourceSha256 !== sourceSha || state.originalSha256 !== sourceSha) {
    throw new Error(`${posterId} source/original SHA-256 does not match the manifest`);
  }
  if (original.artifactSha256 !== sourceSha || original.sourceSha256 !== sourceSha) {
    throw new Error(`${posterId} original artifact hash does not match the manifest`);
  }
  if (state.originalKey !== original.r2Key || state.optimizedKey !== optimized.r2Key) {
    throw new Error(`${posterId} state keys do not match the artifact manifest`);
  }
  if (state.optimizedSha256 !== optimized.artifactSha256) {
    throw new Error(`${posterId} optimized SHA-256 does not match the artifact manifest`);
  }
  if (state.originalSizeBytes !== original.sizeBytes) {
    throw new Error(`${posterId} original size does not match the artifact manifest`);
  }
  if (state.optimizedSizeBytes !== optimized.sizeBytes) {
    throw new Error(`${posterId} optimized size does not match the artifact manifest`);
  }
  if (optimized.mimeType !== "image/webp") {
    throw new Error(`${posterId} optimized artifact is not WebP`);
  }
  assertNonEmptyString(manifestEntry.currentImageUrl, `${posterId}.currentImageUrl`);
  assertBlobImageUrl(manifestEntry.currentImageUrl, original.r2Key);
  assertSafeR2Key(original.r2Key, "original");
  assertSafeR2Key(optimized.r2Key, "optimized");

  const originalUrl = `${publicBaseUrl}/${original.r2Key}`;
  const optimizedUrl = `${publicBaseUrl}/${optimized.r2Key}`;
  assertPublicUrl(originalUrl, original.r2Key, publicBaseUrl);
  assertPublicUrl(optimizedUrl, optimized.r2Key, publicBaseUrl);

  return {
    posterId,
    blobImageUrl: manifestEntry.currentImageUrl,
    original: {
      key: original.r2Key,
      url: originalUrl,
      sha256: original.artifactSha256,
      sizeBytes: original.sizeBytes,
      contentType: original.mimeType,
    },
    optimized: {
      key: optimized.r2Key,
      url: optimizedUrl,
      sha256: optimized.artifactSha256,
      sizeBytes: optimized.sizeBytes,
      contentType: "image/webp",
    },
    verifiedAt,
  };
}

export function buildVersionedRuntimeMap(
  input: VersionedRuntimeMapInput,
): VersionedRuntimeMapResult {
  const publicBaseUrl = normalizePublicBaseUrl(input.publicBaseUrl ?? R2_PUBLIC_BASE_URL);
  const artifactErrors = validateArtifactManifest(input.artifacts, input.manifest);
  if (artifactErrors.length > 0) {
    throw new Error(`Artifact manifest is invalid:\n- ${artifactErrors.join("\n- ")}`);
  }
  if (!input.artifacts.complete) throw new Error("Artifact manifest is incomplete");
  if (input.artifacts.failures.length > 0) {
    throw new Error(`Artifact manifest contains ${input.artifacts.failures.length} failures`);
  }
  if (input.batchStates.length === 0) throw new Error("No batch states supplied");
  validateR2ImageMap(input.canaryMap);

  const expectedIds = [
    ...new Set(
      input.artifacts.artifacts
        .filter((artifact) => artifact.role === "optimized")
        .map((artifact) => artifact.posterId),
    ),
  ].sort();
  if (expectedIds.length !== 58) {
    throw new Error(`Expected 58 migrated posters, found ${expectedIds.length}`);
  }
  const expectedSet = new Set(expectedIds);
  const canaryIds = Object.keys(LEGACY_CANARY_KEYS).sort();
  if (canaryIds.length !== 3) throw new Error("Expected exactly three canary IDs");

  const expectedManifestHash = manifestHash(input.manifest);
  const stateEntries = new Map<string, MigrationStateEntry>();
  for (const batch of input.batchStates) {
    if (batch.state.schemaVersion !== 1) {
      throw new Error(`${batch.label}: unsupported state schemaVersion`);
    }
    if (batch.state.manifestHash !== expectedManifestHash) {
      throw new Error(`${batch.label}: manifestHash does not match the manifest`);
    }
    for (const [posterId, entry] of Object.entries(batch.state.entries)) {
      if (stateEntries.has(posterId)) {
        throw new Error(`Duplicate poster state across batches: ${posterId}`);
      }
      stateEntries.set(posterId, entry);
    }
  }
  if (stateEntries.size !== expectedIds.length) {
    throw new Error(
      `Expected ${expectedIds.length} batch state entries, found ${stateEntries.size}`,
    );
  }
  for (const posterId of expectedIds) {
    if (!stateEntries.has(posterId)) {
      throw new Error(`Missing batch state for ${posterId}`);
    }
  }
  for (const posterId of stateEntries.keys()) {
    if (!expectedSet.has(posterId)) {
      throw new Error(`Unexpected batch state poster: ${posterId}`);
    }
  }

  const migratedEntries: Record<string, R2ImageMapEntry> = {};
  for (const posterId of expectedIds) {
    migratedEntries[posterId] = buildMigratedEntry(
      input.manifest,
      input.artifacts,
      stateEntries.get(posterId)!,
      publicBaseUrl,
    );
  }

  const canaryEntries: Record<string, R2ImageMapEntry> = {};
  for (const posterId of canaryIds) {
    const entry = input.canaryMap.entries[posterId];
    if (!entry) throw new Error(`Existing canary map entry is missing: ${posterId}`);
    canaryEntries[posterId] = entry;
  }
  // The existing map may already contain migrated entries from a prior run.
  // Only the three pinned canary entries are reused; all migrated entries are
  // rebuilt from the verified batch evidence.

  const allEntries: Record<string, R2ImageMapEntry> = {};
  for (const posterId of [...expectedIds, ...canaryIds].sort()) {
    const entry = migratedEntries[posterId] ?? canaryEntries[posterId];
    if (!entry) throw new Error(`Missing runtime map entry for ${posterId}`);
    allEntries[posterId] = entry;
  }
  const allowlist: R2ResolverAllowlist = {
    schemaVersion: 1,
    posters: Object.keys(allEntries).sort(),
  };
  const map: R2ImageMapFile = {
    schemaVersion: 1,
    manifestHash: expectedManifestHash,
    publicBaseUrl,
    generatedAt: input.generatedAt ?? input.artifacts.generatedAt,
    entries: allEntries,
  };
  validateR2ImageMap(map);
  const mapContent = `${JSON.stringify(map, null, 2)}\n`;
  const allowlistContent = `${JSON.stringify(allowlist, null, 2)}\n`;
  return { map, allowlist, mapContent, allowlistContent };
}
