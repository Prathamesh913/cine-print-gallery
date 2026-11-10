/**
 * Dynamic R2 image references for posters created after the one-time migration.
 *
 * The migration catalogue is served from the generated runtime map. New posters
 * cannot require a rebuild, so their verified image references live on the
 * Firestore poster document (`r2Image`) and are consumed by the same resolver
 * after the generated map.
 *
 * This module is intentionally pure and dependency-free: the browser bundle, the
 * automation pipeline and tests all share the exact same validation.
 */

export const R2_IMAGE_HOST = "images.cineprint.click";
export const R2_PUBLIC_BASE_URL = `https://${R2_IMAGE_HOST}`;

export const VERSIONED_ORIGINAL_PREFIX = "cineprint/versions/original/";
export const VERSIONED_OPTIMIZED_PREFIX = "cineprint/versions/optimized/";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const POSTER_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const ORIGINAL_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface R2ImageObjectReference {
  key: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
}

export interface R2ImageReference {
  /** Pre-migration Blob identity, when one exists. New posters have none. */
  blobImageUrl?: string;
  /** Full source SHA-256 used to derive the versioned object keys. */
  sourceSha256?: string;
  original: R2ImageObjectReference;
  optimized: R2ImageObjectReference;
  verifiedAt: string;
}

export type R2ImageReferenceValidation =
  { ok: true; value: R2ImageReference } | { ok: false; reason: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parsePublicUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== R2_IMAGE_HOST) return null;
    if (url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function validateObject(
  raw: unknown,
  role: "original" | "optimized",
  posterId: string,
): { ok: true; value: R2ImageObjectReference } | { ok: false; reason: string } {
  if (!isObject(raw)) return { ok: false, reason: `${role} must be an object` };

  const { key, url, sha256, sizeBytes, contentType } = raw;

  if (typeof key !== "string" || key.trim() === "") {
    return { ok: false, reason: `${role}.key must be a non-empty string` };
  }
  if (key.startsWith("/") || key.includes("..") || key.includes("?") || key.includes("#")) {
    return { ok: false, reason: `${role}.key is not a safe object key` };
  }

  const expectedPrefix =
    role === "original" ? VERSIONED_ORIGINAL_PREFIX : VERSIONED_OPTIMIZED_PREFIX;
  if (!key.startsWith(`${expectedPrefix}${posterId}/`)) {
    return {
      ok: false,
      reason: `${role}.key must live under ${expectedPrefix}${posterId}/`,
    };
  }
  if (role === "optimized" && !key.endsWith(".webp")) {
    return { ok: false, reason: "optimized.key must end with .webp" };
  }

  if (typeof sha256 !== "string" || !SHA256_PATTERN.test(sha256)) {
    return { ok: false, reason: `${role}.sha256 must be a lowercase SHA-256 hex digest` };
  }
  if (!isPositiveInteger(sizeBytes)) {
    return { ok: false, reason: `${role}.sizeBytes must be a positive integer` };
  }
  if (typeof contentType !== "string" || contentType.trim() === "") {
    return { ok: false, reason: `${role}.contentType must be a non-empty string` };
  }
  if (role === "original" && !ORIGINAL_CONTENT_TYPES.has(contentType)) {
    return { ok: false, reason: `original.contentType is unsupported: ${contentType}` };
  }
  if (role === "optimized" && contentType !== "image/webp") {
    return { ok: false, reason: "optimized.contentType must be image/webp" };
  }

  const parsed = parsePublicUrl(url);
  if (!parsed) {
    return { ok: false, reason: `${role}.url must be HTTPS on ${R2_IMAGE_HOST}` };
  }
  if (parsed.pathname !== `/${key}`) {
    return { ok: false, reason: `${role}.url path does not match its key` };
  }
  if (url !== `${R2_PUBLIC_BASE_URL}/${key}`) {
    return { ok: false, reason: `${role}.url does not match the configured R2 base URL` };
  }

  return {
    ok: true,
    value: {
      key,
      url: url as string,
      sha256,
      sizeBytes,
      contentType,
    },
  };
}

/**
 * Validates an untrusted `r2Image` value. When `posterId` is supplied, both keys
 * must belong to that identity so a record can never reference another poster's
 * bytes.
 */
export function validateR2ImageReference(
  raw: unknown,
  posterId?: string,
): R2ImageReferenceValidation {
  if (!isObject(raw)) return { ok: false, reason: "r2Image must be an object" };

  const originalRaw = raw.original;
  const optimizedRaw = raw.optimized;

  if (!isObject(originalRaw)) return { ok: false, reason: "r2Image.original is required" };
  if (!isObject(optimizedRaw)) return { ok: false, reason: "r2Image.optimized is required" };

  const keyPosterId = posterIdFromKey(originalRaw.key);
  if (!keyPosterId) {
    return { ok: false, reason: "r2Image.original.key is not a versioned poster key" };
  }
  if (posterId !== undefined && keyPosterId !== posterId) {
    return {
      ok: false,
      reason: `r2Image.original.key belongs to ${keyPosterId}, not ${posterId}`,
    };
  }

  const original = validateObject(originalRaw, "original", keyPosterId);
  if (!original.ok) return original;
  const optimized = validateObject(optimizedRaw, "optimized", keyPosterId);
  if (!optimized.ok) return optimized;

  if (!isIsoTimestamp(raw.verifiedAt)) {
    return { ok: false, reason: "r2Image.verifiedAt must be a valid ISO timestamp" };
  }

  if (raw.sourceSha256 !== undefined) {
    if (typeof raw.sourceSha256 !== "string" || !SHA256_PATTERN.test(raw.sourceSha256)) {
      return { ok: false, reason: "r2Image.sourceSha256 must be a lowercase SHA-256 hex digest" };
    }
    if (raw.sourceSha256 !== original.value.sha256) {
      return { ok: false, reason: "r2Image.sourceSha256 must equal original.sha256" };
    }
    if (!optimized.value.key.includes(raw.sourceSha256)) {
      return { ok: false, reason: "r2Image.optimized.key is not derived from sourceSha256" };
    }
  }

  if (raw.blobImageUrl !== undefined) {
    if (typeof raw.blobImageUrl !== "string" || raw.blobImageUrl.trim() === "") {
      return { ok: false, reason: "r2Image.blobImageUrl must be a non-empty string when present" };
    }
  }

  return {
    ok: true,
    value: {
      ...(raw.blobImageUrl ? { blobImageUrl: raw.blobImageUrl as string } : {}),
      ...(raw.sourceSha256 ? { sourceSha256: raw.sourceSha256 as string } : {}),
      original: original.value,
      optimized: optimized.value,
      verifiedAt: raw.verifiedAt,
    },
  };
}

/** Extracts the poster ID segment from a versioned object key. */
export function posterIdFromKey(key: unknown): string | null {
  if (typeof key !== "string") return null;
  const prefix = key.startsWith(VERSIONED_ORIGINAL_PREFIX)
    ? VERSIONED_ORIGINAL_PREFIX
    : VERSIONED_OPTIMIZED_PREFIX;
  if (!key.startsWith(prefix)) return null;
  const posterId = key.slice(prefix.length).split("/")[0];
  return posterId && POSTER_ID_PATTERN.test(posterId) ? posterId : null;
}

/** True only for a fully valid reference belonging to this poster. */
export function isTrustedR2ImageReference(raw: unknown, posterId: string): raw is R2ImageReference {
  const result = validateR2ImageReference(raw, posterId);
  return result.ok;
}
