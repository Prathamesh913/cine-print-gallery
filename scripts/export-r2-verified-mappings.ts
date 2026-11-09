import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSha256Hex } from "../automation/migration/checksum";
import { manifestHash } from "../automation/migration/manifest";
import type {
  ManifestEntry,
  MigrationState,
  MigrationStateEntry,
  PosterManifest,
} from "../automation/migration/types";

export const R2_PUBLIC_BASE_URL = "https://images.cineprint.click";
export const EXPECTED_R2_HOST = "images.cineprint.click";
export const BLOB_HOST_SUFFIX = ".public.blob.vercel-storage.com";

const SUPPORTED_ORIGINAL_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const ORIGINAL_KEY_PREFIXES = ["cineprint/raindrop/", "cineprint/external/"];
const OPTIMIZED_KEY_PREFIX = "cineprint/optimized/";

export interface R2ResolverAllowlist {
  schemaVersion: number;
  posters: string[];
}

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

export interface ExportR2ImageMapOptions {
  manifestPath: string;
  statePath: string;
  allowlistPath: string;
  publicBaseUrl?: string;
  now?: () => Date;
}

export interface ExportR2ImageMapResult {
  map: R2ImageMapFile;
  content: string;
}

function readJson<T>(filePath: string, label: string): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch (error) {
    throw new Error(
      `Unable to read ${label} at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error(`Public base URL must use HTTPS: ${value}`);
  }
  if (url.hostname !== EXPECTED_R2_HOST) {
    throw new Error(
      `Public base URL host must be ${EXPECTED_R2_HOST}, found ${url.hostname}`,
    );
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

function assertKeyShape(key: string, kind: "original" | "optimized"): void {
  if (key.startsWith("/") || key.includes("..") || key.includes("?") || key.includes("#")) {
    throw new Error(`R2 ${kind} key is not a safe object key: ${key}`);
  }
  if (kind === "original") {
    if (!ORIGINAL_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
      throw new Error(`R2 original key must use cineprint/raindrop/ or cineprint/external/: ${key}`);
    }
    return;
  }
  if (!key.startsWith(OPTIMIZED_KEY_PREFIX)) {
    throw new Error(`R2 optimized key must use cineprint/optimized/: ${key}`);
  }
  if (!key.endsWith(".webp")) {
    throw new Error(`R2 optimized key must end with .webp: ${key}`);
  }
}

function assertOriginalKeyMatchesMime(key: string, mimeType: string): void {
  const extension = key.split(".").pop()?.toLowerCase();
  const allowed = extensionForMime(mimeType);
  if (!extension || !allowed.includes(extension)) {
    throw new Error(
      `Original key extension .${extension ?? "(none)"} does not match Content-Type ${mimeType}`,
    );
  }
}

function assertBlobImageUrl(blobImageUrl: string, originalKey: string): void {
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
  if (url.pathname !== `/${originalKey}`) {
    throw new Error(
      `Blob image URL path ${url.pathname} does not match original key /${originalKey}`,
    );
  }
  if (url.search || url.hash) {
    throw new Error("Blob image URL must not contain a query or hash");
  }
}

function buildPublicUrl(publicBaseUrl: string, key: string): string {
  return `${publicBaseUrl}/${key}`;
}

function assertPublicUrl(urlValue: string, publicBaseUrl: string, key: string): void {
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
  const expected = buildPublicUrl(publicBaseUrl, key);
  if (urlValue !== expected) {
    throw new Error(`R2 public URL does not match the configured base URL: ${urlValue}`);
  }
}

function validateAllowlist(raw: unknown, manifest: PosterManifest): R2ResolverAllowlist {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("R2 resolver allowlist must be an object");
  }
  const candidate = raw as { schemaVersion?: unknown; posters?: unknown };
  if (candidate.schemaVersion !== 1) {
    throw new Error(`Unsupported R2 resolver allowlist schemaVersion: ${String(candidate.schemaVersion)}`);
  }
  if (!Array.isArray(candidate.posters) || candidate.posters.length === 0) {
    throw new Error("R2 resolver allowlist posters must be a non-empty array");
  }

  const known = new Set(manifest.entries.map((entry) => entry.cineprintPosterId));
  const seen = new Set<string>();
  const posters: string[] = [];
  const errors: string[] = [];

  for (const value of candidate.posters) {
    if (typeof value !== "string" || !value.trim()) {
      errors.push("Allowlist contains a non-string or empty poster ID");
      continue;
    }
    const id = value.trim();
    if (seen.has(id)) {
      errors.push(`Allowlist contains duplicate poster ID: ${id}`);
      continue;
    }
    seen.add(id);
    if (!known.has(id)) {
      errors.push(`Allowlist references unknown poster ID: ${id}`);
      continue;
    }
    const entry = manifest.entries.find((candidateEntry) => candidateEntry.cineprintPosterId === id);
    if (entry?.identityConfidence !== "high") {
      errors.push(
        `Allowlist poster ${id} is not high-confidence (found ${entry?.identityConfidence ?? "missing"})`,
      );
      continue;
    }
    posters.push(id);
  }

  if (errors.length > 0) {
    throw new Error(`R2 resolver allowlist validation failed:\n- ${errors.join("\n- ")}`);
  }

  return { schemaVersion: 1, posters: [...posters].sort() };
}

function buildEntry(
  entry: ManifestEntry,
  stateEntry: MigrationStateEntry | undefined,
  publicBaseUrl: string,
): R2ImageMapEntry {
  const id = entry.cineprintPosterId;

  if (entry.identityConfidence !== "high") {
    throw new Error(`identityConfidence must be high, found ${entry.identityConfidence}`);
  }
  if (entry.sourceAvailability !== "available") {
    throw new Error(`sourceAvailability must be available, found ${entry.sourceAvailability}`);
  }
  if (entry.migrationStatus !== "READY_TO_COPY") {
    throw new Error(`migrationStatus must be READY_TO_COPY, found ${entry.migrationStatus}`);
  }
  if (!stateEntry) {
    throw new Error("migration state entry is missing");
  }
  if (stateEntry.posterId !== id) {
    throw new Error(`migration state posterId ${stateEntry.posterId} does not match ${id}`);
  }
  if (stateEntry.state !== "VERIFIED") {
    throw new Error(`migration state must be VERIFIED, found ${stateEntry.state}`);
  }

  assertNonEmptyString(entry.originalR2Key, "manifest originalR2Key");
  assertNonEmptyString(entry.optimizedR2Key, "manifest optimizedR2Key");
  assertNonEmptyString(entry.sourceSha256, "manifest sourceSha256");
  assertNonEmptyString(entry.sourceMimeType, "manifest sourceMimeType");
  assertNonEmptyString(entry.currentImageUrl, "manifest currentImageUrl");
  assertPositiveInteger(entry.sourceSizeBytes, "manifest sourceSizeBytes");

  if (entry.currentImageProvider !== "vercel-blob") {
    throw new Error(`currentImageProvider must be vercel-blob, found ${entry.currentImageProvider}`);
  }
  if (entry.currentImageObjectKey !== entry.originalR2Key) {
    throw new Error(
      `currentImageObjectKey ${entry.currentImageObjectKey ?? "(missing)"} does not match originalR2Key ${entry.originalR2Key}`,
    );
  }
  if (!SUPPORTED_ORIGINAL_CONTENT_TYPES.has(entry.sourceMimeType)) {
    throw new Error(`unsupported original Content-Type: ${entry.sourceMimeType}`);
  }
  if (!isSha256Hex(entry.sourceSha256)) {
    throw new Error("manifest sourceSha256 is not a valid SHA-256 hex digest");
  }

  assertKeyShape(entry.originalR2Key, "original");
  assertKeyShape(entry.optimizedR2Key, "optimized");
  assertOriginalKeyMatchesMime(entry.originalR2Key, entry.sourceMimeType);
  assertBlobImageUrl(entry.currentImageUrl, entry.originalR2Key);

  if (stateEntry.sourceSha256 !== entry.sourceSha256) {
    throw new Error("state sourceSha256 does not match the manifest");
  }
  if (stateEntry.originalSha256 !== entry.sourceSha256) {
    throw new Error("state originalSha256 does not match the manifest sourceSha256");
  }
  if (stateEntry.originalKey !== entry.originalR2Key) {
    throw new Error("state originalKey does not match the manifest originalR2Key");
  }
  if (stateEntry.optimizedKey !== entry.optimizedR2Key) {
    throw new Error("state optimizedKey does not match the manifest optimizedR2Key");
  }
  if (stateEntry.originalSizeBytes !== entry.sourceSizeBytes) {
    throw new Error("state originalSizeBytes does not match the manifest sourceSizeBytes");
  }
  if (stateEntry.originalUploaded !== true) {
    throw new Error("state originalUploaded must be true");
  }
  if (stateEntry.optimizedUploaded !== true) {
    throw new Error("state optimizedUploaded must be true");
  }
  const optimizedSha256 = stateEntry.optimizedSha256;
  if (typeof optimizedSha256 !== "string" || !isSha256Hex(optimizedSha256)) {
    throw new Error("state optimizedSha256 is missing or invalid");
  }
  assertPositiveInteger(stateEntry.optimizedSizeBytes, "state optimizedSizeBytes");
  assertIsoTimestamp(stateEntry.verifiedAt, "state verifiedAt");

  const originalUrl = buildPublicUrl(publicBaseUrl, entry.originalR2Key);
  const optimizedUrl = buildPublicUrl(publicBaseUrl, entry.optimizedR2Key);
  assertPublicUrl(originalUrl, publicBaseUrl, entry.originalR2Key);
  assertPublicUrl(optimizedUrl, publicBaseUrl, entry.optimizedR2Key);

  return {
    posterId: id,
    blobImageUrl: entry.currentImageUrl,
    original: {
      key: entry.originalR2Key,
      url: originalUrl,
      sha256: entry.sourceSha256.toLowerCase(),
      sizeBytes: entry.sourceSizeBytes,
      contentType: entry.sourceMimeType,
    },
    optimized: {
      key: entry.optimizedR2Key,
      url: optimizedUrl,
      sha256: optimizedSha256.toLowerCase(),
      sizeBytes: stateEntry.optimizedSizeBytes,
      contentType: "image/webp",
    },
    verifiedAt: stateEntry.verifiedAt,
  };
}

export function buildR2ImageMap(options: ExportR2ImageMapOptions): ExportR2ImageMapResult {
  const publicBaseUrl = normalizeBaseUrl(options.publicBaseUrl ?? R2_PUBLIC_BASE_URL);
  const manifest = readJson<PosterManifest>(options.manifestPath, "poster manifest");
  const state = readJson<MigrationState>(options.statePath, "migration state");
  const allowlistRaw = readJson<unknown>(options.allowlistPath, "R2 resolver allowlist");

  if (!manifest || !Array.isArray(manifest.entries)) {
    throw new Error("Poster manifest entries must be an array");
  }
  if (!state || state.schemaVersion !== 1) {
    throw new Error(`Unsupported migration state schemaVersion: ${String(state?.schemaVersion)}`);
  }
  if (!state.entries || typeof state.entries !== "object" || Array.isArray(state.entries)) {
    throw new Error("Migration state entries must be an object keyed by poster ID");
  }

  const expectedManifestHash = manifestHash(manifest);
  if (state.manifestHash !== expectedManifestHash) {
    throw new Error(
      `Migration state manifestHash ${state.manifestHash} does not match manifest ${expectedManifestHash}`,
    );
  }

  const allowlist = validateAllowlist(allowlistRaw, manifest);
  const manifestById = new Map(
    manifest.entries.map((entry) => [entry.cineprintPosterId, entry]),
  );

  const errors: string[] = [];
  const entries: Record<string, R2ImageMapEntry> = {};

  for (const id of allowlist.posters) {
    const entry = manifestById.get(id);
    if (!entry) {
      errors.push(`${id}: not found in the manifest`);
      continue;
    }
    try {
      entries[id] = buildEntry(entry, state.entries[id], publicBaseUrl);
    } catch (error) {
      errors.push(`${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`R2 image map export failed:\n- ${errors.join("\n- ")}`);
  }

  const sortedEntries: Record<string, R2ImageMapEntry> = {};
  for (const id of Object.keys(entries).sort()) {
    sortedEntries[id] = entries[id];
  }

  const map: R2ImageMapFile = {
    schemaVersion: 1,
    manifestHash: expectedManifestHash,
    publicBaseUrl,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    entries: sortedEntries,
  };

  return { map, content: `${JSON.stringify(map, null, 2)}\n` };
}

export function writeR2ImageMap(content: string, outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.tmp`;
  fs.writeFileSync(tempPath, content, "utf8");
  fs.renameSync(tempPath, outPath);
}

function parseArgs(argv: string[]): {
  manifestPath: string;
  statePath: string;
  allowlistPath: string;
  outPath: string;
} {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  let manifestPath = path.join(root, "migration", "poster-manifest.json");
  let statePath = path.join(root, "migration", "migration-state.json");
  let allowlistPath = path.join(root, "migration", "r2-resolver-allowlist.json");
  let outPath = path.join(root, "migration", "r2-image-map.json");

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    switch (arg) {
      case "--manifest":
        manifestPath = path.resolve(next());
        break;
      case "--state":
        statePath = path.resolve(next());
        break;
      case "--allowlist":
        allowlistPath = path.resolve(next());
        break;
      case "--out":
        outPath = path.resolve(next());
        break;
      case "--help":
      case "-h":
        console.log(
          "Usage: tsx scripts/export-r2-verified-mappings.ts [--manifest PATH] [--state PATH] [--allowlist PATH] [--out PATH]",
        );
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return { manifestPath, statePath, allowlistPath, outPath };
}

const isMain =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = buildR2ImageMap(args);
    writeR2ImageMap(result.content, args.outPath);
    const ids = Object.keys(result.map.entries);
    console.log(`R2 image map exported: ${ids.length} poster(s)`);
    for (const id of ids) {
      console.log(`  ${id}`);
    }
    console.log(`  output: ${args.outPath}`);
  } catch (error) {
    console.error(
      `R2 image map export failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
