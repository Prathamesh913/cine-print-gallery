import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { base64ToHex, sha256Hex } from "./checksum";
import { isRetryableHttpStatus } from "./retry";
import { redactSecrets } from "./source";
import type {
  PublicVerification,
  R2ObjectMetadata,
  R2OriginVerification,
  R2PutOptions,
  R2Store,
  R2Verification,
} from "./types";

export const R2_CACHE_CONTROL = "public, max-age=31536000, immutable";
export const R2_MAX_VERIFY_BYTES = 30 * 1024 * 1024;
export const R2_PUBLIC_VERIFY_TIMEOUT_MS = 30_000;

export class R2Error extends Error {}
export class R2ConflictError extends R2Error {}
export class R2UploadError extends R2Error {
  constructor(
    message: string,
    readonly retryable = true,
  ) {
    super(message);
  }
}
export class R2VerificationError extends R2Error {}
/** A request that could not be concluded either way (timeout, abort, network). */
export class R2InconclusiveError extends R2Error {}
/** An upload whose outcome could not be established by bounded read-back. */
export class R2UploadUnknownError extends R2Error {}

export interface R2StoreOptions {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
  client?: S3Client;
  /** Bound for a single public CDN verification request. */
  publicVerifyTimeoutMs?: number;
  /** Hard cap for any single origin/public body read. */
  maxVerifyBytes?: number;
}

export interface R2Env {
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_PUBLIC_BASE_URL?: string;
}

function requireEnvValue(env: R2Env, name: keyof R2Env): string {
  const value = env[name]?.trim();
  if (!value) throw new R2Error(`Missing required environment variable: ${name}`);
  return value;
}

function isNotFoundError(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate?.$metadata?.httpStatusCode === 404 ||
    candidate?.name === "NotFound" ||
    candidate?.name === "NoSuchKey" ||
    candidate?.Code === "NoSuchKey"
  );
}

function isPreconditionFailed(error: unknown): boolean {
  const candidate = error as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    candidate?.$metadata?.httpStatusCode === 412 ||
    candidate?.name === "PreconditionFailed" ||
    candidate?.Code === "PreconditionFailed"
  );
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return redactSecrets(message);
}

function isAbortOrTimeoutError(error: unknown): boolean {
  const candidate = error as { name?: string; message?: string; code?: string };
  const name = candidate?.name ?? "";
  const message = (candidate?.message ?? "").toLowerCase();
  return (
    name === "AbortError" ||
    name === "TimeoutError" ||
    name === "RequestTimeout" ||
    name === "RequestTimeoutException" ||
    candidate?.code === "ABORT_ERR" ||
    candidate?.code === "ETIMEDOUT" ||
    message.includes("aborted") ||
    message.includes("timed out") ||
    message.includes("timeout")
  );
}

function extractUserMetadata(
  metadata: Record<string, string> | undefined,
): Record<string, string> | null {
  if (!metadata) return null;
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    normalized[key.toLowerCase()] = value;
  }
  return Object.keys(normalized).length > 0 ? normalized : null;
}

async function readBodyWithLimit(body: unknown, maxBytes: number): Promise<Buffer> {
  const iterable = body as AsyncIterable<Uint8Array> | null;
  if (iterable && typeof iterable[Symbol.asyncIterator] === "function") {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of iterable) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        throw new R2VerificationError(
          `Object body exceeds the ${maxBytes} byte verification limit`,
        );
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  }

  // Fallback for SDK adapters that only expose transformToByteArray. This is
  // bounded after the fact, not while streaming; the Node S3 SDK exposes an
  // async iterable, so the streaming path above is the production path.
  const transformer = body as { transformToByteArray?: () => Promise<Uint8Array> } | null;
  if (transformer && typeof transformer.transformToByteArray === "function") {
    const bytes = Buffer.from(await transformer.transformToByteArray());
    if (bytes.length > maxBytes) {
      throw new R2VerificationError(`Object body exceeds the ${maxBytes} byte verification limit`);
    }
    return bytes;
  }

  throw new R2VerificationError("Object body is not readable");
}

async function readWebStreamWithLimit(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const buffer = Buffer.from(value);
      total += buffer.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new R2VerificationError(
          `Public body exceeds the ${maxBytes} byte verification limit`,
        );
      }
      chunks.push(buffer);
    }
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}

function normalizeContentType(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.split(";")[0].trim().toLowerCase();
}

export function normalizeCacheControl(value: string | null | undefined): string | null {
  if (!value) return null;
  const directives = value
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .filter(Boolean)
    .sort();
  return directives.length > 0 ? directives.join(", ") : null;
}

export function validateObjectMetadata(
  metadata: R2ObjectMetadata | null,
  expected: {
    contentType: string;
    cacheControl: string;
    /** Exact user-metadata keys and values that must be present. */
    userMetadata?: Record<string, string>;
  },
): { ok: boolean; reason: string | null } {
  if (!metadata) {
    return { ok: false, reason: "Object not found" };
  }

  const actualContentType = normalizeContentType(metadata.contentType);
  const expectedContentType = normalizeContentType(expected.contentType);
  if (!actualContentType) {
    return { ok: false, reason: "Object has no Content-Type" };
  }
  if (actualContentType !== expectedContentType) {
    return {
      ok: false,
      reason: `Content-Type mismatch: expected ${expected.contentType}, found ${actualContentType}`,
    };
  }

  const actualCacheControl = normalizeCacheControl(metadata.cacheControl);
  const expectedCacheControl = normalizeCacheControl(expected.cacheControl);
  if (!actualCacheControl) {
    return { ok: false, reason: "Object has no Cache-Control" };
  }
  if (actualCacheControl !== expectedCacheControl) {
    return {
      ok: false,
      reason: `Cache-Control mismatch: expected ${expected.cacheControl}, found ${metadata.cacheControl}`,
    };
  }

  if (expected.userMetadata) {
    const actualMetadata = metadata.userMetadata ?? {};
    for (const [key, value] of Object.entries(expected.userMetadata)) {
      const actual = actualMetadata[key.toLowerCase()];
      if (actual === undefined) {
        return { ok: false, reason: `Object is missing required metadata: ${key}` };
      }
      if (actual !== value) {
        return {
          ok: false,
          reason: `Object metadata mismatch for ${key}: expected ${value}, found ${actual}`,
        };
      }
    }
  }

  return { ok: true, reason: null };
}

export class R2StoreImpl implements R2Store {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly publicVerifyTimeoutMs: number;
  private readonly maxVerifyBytes: number;

  constructor(options: R2StoreOptions) {
    this.bucket = options.bucket;
    this.publicBaseUrl = options.publicBaseUrl.replace(/\/+$/, "");
    this.publicVerifyTimeoutMs = options.publicVerifyTimeoutMs ?? R2_PUBLIC_VERIFY_TIMEOUT_MS;
    this.maxVerifyBytes = options.maxVerifyBytes ?? R2_MAX_VERIFY_BYTES;
    if (!Number.isFinite(this.publicVerifyTimeoutMs) || this.publicVerifyTimeoutMs <= 0) {
      throw new R2Error("publicVerifyTimeoutMs must be a positive number");
    }
    if (!Number.isFinite(this.maxVerifyBytes) || this.maxVerifyBytes <= 0) {
      throw new R2Error("maxVerifyBytes must be a positive number");
    }
    this.client =
      options.client ??
      new S3Client({
        region: "auto",
        endpoint: `https://${options.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: options.accessKeyId,
          secretAccessKey: options.secretAccessKey,
        },
      });
  }

  async head(
    key: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<R2ObjectMetadata | null> {
    const sendOptions = options.signal ? { abortSignal: options.signal } : undefined;
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
          ChecksumMode: "ENABLED",
        }),
        sendOptions,
      );
      return {
        key,
        size: result.ContentLength ?? 0,
        contentType: normalizeContentType(result.ContentType),
        cacheControl: result.CacheControl ?? null,
        checksumSha256: result.ChecksumSHA256 ?? null,
        metadataSha256: result.Metadata?.sha256 ?? result.Metadata?.SHA256 ?? null,
        userMetadata: extractUserMetadata(result.Metadata),
        etag: result.ETag ?? null,
      };
    } catch (error) {
      if (isNotFoundError(error)) return null;
      if (isAbortOrTimeoutError(error)) {
        throw new R2InconclusiveError(
          `R2 HeadObject was inconclusive for ${key}: ${sanitizeError(error)}`,
        );
      }

      // Some S3-compatible implementations reject the checksum mode header.
      // Retry without it and rely on the sha256 object metadata instead.
      try {
        const result = await this.client.send(
          new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
          sendOptions,
        );
        return {
          key,
          size: result.ContentLength ?? 0,
          contentType: normalizeContentType(result.ContentType),
          cacheControl: result.CacheControl ?? null,
          checksumSha256: result.ChecksumSHA256 ?? null,
          metadataSha256: result.Metadata?.sha256 ?? result.Metadata?.SHA256 ?? null,
          userMetadata: extractUserMetadata(result.Metadata),
          etag: result.ETag ?? null,
        };
      } catch (fallbackError) {
        if (isAbortOrTimeoutError(fallbackError)) {
          throw new R2InconclusiveError(
            `R2 HeadObject was inconclusive for ${key}: ${sanitizeError(fallbackError)}`,
          );
        }
        throw new R2Error(`R2 HeadObject failed for ${key}: ${sanitizeError(fallbackError)}`);
      }
    }
  }

  async verifyOrigin(
    key: string,
    expected: {
      sha256: string;
      sizeBytes: number;
      contentType: string;
      cacheControl: string;
      userMetadata?: Record<string, string>;
    },
  ): Promise<R2OriginVerification> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      if (!result.Body) {
        return {
          ok: false,
          exists: true,
          checksumOk: false,
          metadataOk: false,
          sizeOk: false,
          metadata: null,
          sha256: null,
          sizeBytes: null,
          reason: "Object body is empty",
        };
      }

      const declaredLength = result.ContentLength;
      const declaredTooLarge =
        typeof declaredLength === "number" && declaredLength > expected.sizeBytes;
      if (declaredTooLarge) {
        (result.Body as { destroy?: () => void }).destroy?.();
        return {
          ok: false,
          exists: true,
          checksumOk: false,
          metadataOk: false,
          sizeOk: false,
          metadata: {
            key,
            size: declaredLength,
            contentType: normalizeContentType(result.ContentType),
            cacheControl: result.CacheControl ?? null,
            checksumSha256: result.ChecksumSHA256 ?? null,
            metadataSha256: result.Metadata?.sha256 ?? result.Metadata?.SHA256 ?? null,
            userMetadata: extractUserMetadata(result.Metadata),
            etag: result.ETag ?? null,
          },
          sha256: null,
          sizeBytes: declaredLength,
          reason: `Object Content-Length ${declaredLength} exceeds the expected ${expected.sizeBytes} bytes`,
        };
      }

      let bytes: Buffer;
      try {
        bytes = await readBodyWithLimit(result.Body, expected.sizeBytes);
      } catch (error) {
        return {
          ok: false,
          exists: true,
          checksumOk: false,
          metadataOk: false,
          sizeOk: false,
          metadata: {
            key,
            size: declaredLength ?? 0,
            contentType: normalizeContentType(result.ContentType),
            cacheControl: result.CacheControl ?? null,
            checksumSha256: result.ChecksumSHA256 ?? null,
            metadataSha256: result.Metadata?.sha256 ?? result.Metadata?.SHA256 ?? null,
            userMetadata: extractUserMetadata(result.Metadata),
            etag: result.ETag ?? null,
          },
          sha256: null,
          sizeBytes: declaredLength ?? null,
          reason: error instanceof Error ? error.message : String(error),
        };
      }
      const metadata: R2ObjectMetadata = {
        key,
        size: result.ContentLength ?? bytes.length,
        contentType: normalizeContentType(result.ContentType),
        cacheControl: result.CacheControl ?? null,
        checksumSha256: result.ChecksumSHA256 ?? null,
        metadataSha256: result.Metadata?.sha256 ?? result.Metadata?.SHA256 ?? null,
        userMetadata: extractUserMetadata(result.Metadata),
        etag: result.ETag ?? null,
      };

      const sha256 = sha256Hex(bytes);
      const sizeOk = bytes.length === expected.sizeBytes && metadata.size === expected.sizeBytes;
      const checksumOk = sha256 === expected.sha256.toLowerCase();
      const metadataValidation = validateObjectMetadata(metadata, expected);

      let reason: string | null = null;
      if (!sizeOk) {
        reason = `Size mismatch: expected ${expected.sizeBytes}, found ${bytes.length}`;
      } else if (!checksumOk) {
        reason = `Origin checksum mismatch: expected ${expected.sha256}, found ${sha256}`;
      } else if (!metadataValidation.ok) {
        reason = metadataValidation.reason;
      }

      return {
        ok: sizeOk && checksumOk && metadataValidation.ok,
        exists: true,
        checksumOk,
        metadataOk: metadataValidation.ok,
        sizeOk,
        metadata,
        sha256,
        sizeBytes: bytes.length,
        reason,
      };
    } catch (error) {
      if (isNotFoundError(error)) {
        return {
          ok: false,
          exists: false,
          checksumOk: false,
          metadataOk: false,
          sizeOk: false,
          metadata: null,
          sha256: null,
          sizeBytes: null,
          reason: "Object not found",
        };
      }
      throw new R2Error(`R2 GetObject failed for ${key}: ${sanitizeError(error)}`);
    }
  }

  async put(options: R2PutOptions): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: options.key,
      Body: options.body,
      ContentType: options.contentType,
      CacheControl: options.cacheControl,
      Metadata: options.metadata,
      // Cloudflare R2 documents atomic If-None-Match support for PutObject.
      // This is a second line of defense behind the migration-wide lock.
      IfNoneMatch: "*",
    });

    try {
      await this.client.send(command);
    } catch (error) {
      if (isPreconditionFailed(error)) {
        throw new R2ConflictError(
          `R2 PutObject refused to overwrite existing object ${options.key}`,
        );
      }
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode;
      const retryable = typeof status === "number" ? isRetryableHttpStatus(status) : true;
      throw new R2UploadError(
        `R2 PutObject failed for ${options.key}: ${sanitizeError(error)}`,
        retryable,
      );
    }
  }

  async verify(
    key: string,
    expected: {
      sha256: string;
      sizeBytes: number;
      contentType: string;
      cacheControl: string;
      userMetadata?: Record<string, string>;
    },
  ): Promise<R2Verification> {
    const metadata = await this.head(key);
    if (!metadata) {
      return { ok: false, metadata: null, reason: "Object not found" };
    }

    if (metadata.size !== expected.sizeBytes) {
      return {
        ok: false,
        metadata,
        reason: `Size mismatch: expected ${expected.sizeBytes}, found ${metadata.size}`,
      };
    }

    const actualChecksum = metadata.metadataSha256
      ? metadata.metadataSha256.toLowerCase()
      : metadata.checksumSha256
        ? base64ToHex(metadata.checksumSha256)
        : null;

    if (!actualChecksum) {
      return {
        ok: false,
        metadata,
        reason: "Object has no SHA-256 metadata; refusing to treat it as verified",
      };
    }
    if (actualChecksum !== expected.sha256.toLowerCase()) {
      return {
        ok: false,
        metadata,
        reason: `Checksum mismatch: expected ${expected.sha256}, found ${actualChecksum}`,
      };
    }

    const metadataValidation = validateObjectMetadata(metadata, expected);
    if (!metadataValidation.ok) {
      return { ok: false, metadata, reason: metadataValidation.reason };
    }

    return { ok: true, metadata, reason: null };
  }

  async publicVerify(
    url: string,
    expected?: {
      sha256: string;
      sizeBytes: number;
      contentType: string;
      cacheControl?: string;
    },
  ): Promise<PublicVerification> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return {
        ok: false,
        status: 0,
        contentType: null,
        contentLength: null,
        cacheControl: null,
        sha256: null,
        reason: "Public URL is invalid",
      };
    }

    const base = new URL(this.publicBaseUrl);
    if (parsed.protocol !== "https:" || parsed.hostname !== base.hostname) {
      return {
        ok: false,
        status: 0,
        contentType: null,
        contentLength: null,
        cacheControl: null,
        sha256: null,
        reason: `Public URL host must be ${base.hostname}`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error("Public verification timed out"));
    }, this.publicVerifyTimeoutMs);
    const maxBytes = expected
      ? Math.min(this.maxVerifyBytes, expected.sizeBytes)
      : this.maxVerifyBytes;

    try {
      const response = await fetch(parsed.toString(), {
        method: expected ? "GET" : "HEAD",
        redirect: "manual",
        signal: controller.signal,
      });
      const contentType = normalizeContentType(response.headers.get("content-type"));
      const cacheControl = response.headers.get("cache-control");
      const rawContentLength = response.headers.get("content-length");
      const parsedLength =
        rawContentLength === null || rawContentLength.trim() === ""
          ? null
          : Number(rawContentLength);
      const contentLength =
        parsedLength !== null && Number.isFinite(parsedLength) ? parsedLength : null;

      if (response.status !== 200) {
        await response.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          status: response.status,
          contentType,
          contentLength,
          cacheControl,
          sha256: null,
          reason: `Public URL returned HTTP ${response.status}`,
        };
      }

      if (contentLength !== null && contentLength > maxBytes) {
        await response.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          status: response.status,
          contentType,
          contentLength,
          cacheControl,
          sha256: null,
          reason: `Public Content-Length ${contentLength} exceeds the ${maxBytes} byte limit`,
        };
      }

      if (expected && contentLength !== null && contentLength !== expected.sizeBytes) {
        await response.body?.cancel().catch(() => undefined);
        return {
          ok: false,
          status: response.status,
          contentType,
          contentLength,
          cacheControl,
          sha256: null,
          reason: `Public size mismatch: expected ${expected.sizeBytes}, found ${contentLength}`,
        };
      }

      if (expected) {
        if (!contentType || contentType !== normalizeContentType(expected.contentType)) {
          await response.body?.cancel().catch(() => undefined);
          return {
            ok: false,
            status: response.status,
            contentType,
            contentLength,
            cacheControl,
            sha256: null,
            reason: `Public Content-Type mismatch: expected ${expected.contentType}, found ${contentType ?? "missing"}`,
          };
        }
        const expectedCacheControl = normalizeCacheControl(
          expected.cacheControl ?? R2_CACHE_CONTROL,
        );
        const actualCacheControl = normalizeCacheControl(cacheControl);
        if (!actualCacheControl) {
          await response.body?.cancel().catch(() => undefined);
          return {
            ok: false,
            status: response.status,
            contentType,
            contentLength,
            cacheControl,
            sha256: null,
            reason: "Public response has no Cache-Control header",
          };
        }
        if (actualCacheControl !== expectedCacheControl) {
          await response.body?.cancel().catch(() => undefined);
          return {
            ok: false,
            status: response.status,
            contentType,
            contentLength,
            cacheControl,
            sha256: null,
            reason: `Public Cache-Control mismatch: expected ${expected.cacheControl ?? R2_CACHE_CONTROL}, found ${cacheControl}`,
          };
        }

        if (!response.body) {
          return {
            ok: false,
            status: response.status,
            contentType,
            contentLength,
            cacheControl,
            sha256: null,
            reason: "Public response has no body",
          };
        }

        let buffer: Buffer;
        try {
          buffer = await readWebStreamWithLimit(response.body, maxBytes);
        } catch (error) {
          return {
            ok: false,
            status: response.status,
            contentType,
            contentLength,
            cacheControl,
            sha256: null,
            reason: sanitizeError(error),
          };
        }
        const sha256 = sha256Hex(buffer);
        if (buffer.length !== expected.sizeBytes) {
          return {
            ok: false,
            status: response.status,
            contentType,
            contentLength: buffer.length,
            cacheControl,
            sha256,
            reason: `Public size mismatch: expected ${expected.sizeBytes}, found ${buffer.length}`,
          };
        }
        if (sha256 !== expected.sha256.toLowerCase()) {
          return {
            ok: false,
            status: response.status,
            contentType,
            contentLength: buffer.length,
            cacheControl,
            sha256,
            reason: "Public checksum mismatch",
          };
        }
        return {
          ok: true,
          status: response.status,
          contentType,
          contentLength: buffer.length,
          cacheControl,
          sha256,
          reason: null,
        };
      }

      await response.body?.cancel().catch(() => undefined);
      return {
        ok: true,
        status: response.status,
        contentType,
        contentLength,
        cacheControl,
        sha256: null,
        reason: null,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        contentType: null,
        contentLength: null,
        cacheControl: null,
        sha256: null,
        reason: controller.signal.aborted
          ? `Public verification timed out after ${this.publicVerifyTimeoutMs}ms`
          : sanitizeError(error),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createR2StoreFromEnv(env: R2Env = process.env): R2StoreImpl {
  const accountId = requireEnvValue(env, "R2_ACCOUNT_ID");
  const accessKeyId = requireEnvValue(env, "R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnvValue(env, "R2_SECRET_ACCESS_KEY");
  const bucket = requireEnvValue(env, "R2_BUCKET_NAME");
  const publicBaseUrl = requireEnvValue(env, "R2_PUBLIC_BASE_URL");

  const parsed = new URL(publicBaseUrl);
  if (parsed.protocol !== "https:") {
    throw new R2Error("R2_PUBLIC_BASE_URL must use HTTPS");
  }
  if (parsed.hostname.endsWith(".r2.dev")) {
    throw new R2Error("The r2.dev development domain is not allowed; use the custom public domain");
  }
  if (parsed.hostname !== "images.cineprint.click") {
    throw new R2Error(
      `R2_PUBLIC_BASE_URL must use images.cineprint.click (found ${parsed.hostname})`,
    );
  }

  return new R2StoreImpl({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl,
  });
}
