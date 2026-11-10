/**
 * Bounded source-image download for automated ingestion.
 *
 * Stricter than the legacy Blob downloader: HTTPS only, credential-free URLs,
 * private/loopback host rejection, redirect cap, byte cap, timeout, content-type
 * allowlist and magic-byte validation.
 *
 * Known limitation: the request follows DNS through the platform resolver, so a
 * public hostname that resolves to a private address is not pinned here. The
 * migration downloader's DNS pinning remains available for its allowlisted
 * hosts; external poster URLs cannot be pinned without a custom HTTP agent.
 */

import { sha256Hex } from "../migration/checksum";

export const MAX_IMAGE_BYTES = 30 * 1024 * 1024;
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 60_000;
export const MAX_REDIRECTS = 3;

/** The only origin that may ever receive the Raindrop bearer token. */
export const RAINDROP_AUTH_HOST = "api.raindrop.io";
const ALLOWED_HTTPS_PORTS = new Set(["", "443"]);

export const SUPPORTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type SupportedImageType = (typeof SUPPORTED_IMAGE_TYPES)[number];

export class ImageDownloadError extends Error {
  constructor(
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ImageDownloadError";
  }
}

export interface DownloadedSourceImage {
  buffer: Buffer;
  contentType: SupportedImageType;
  finalUrl: string;
  sha256: string;
  sizeBytes: number;
}

export interface DownloadOptions {
  authToken?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
}

const PRIVATE_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /\.localhost$/i,
  /\.local$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
];

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

export function assertSafeImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageDownloadError("image URL is invalid");
  }
  if (url.protocol !== "https:") {
    throw new ImageDownloadError("image URL must use HTTPS");
  }
  if (!ALLOWED_HTTPS_PORTS.has(url.port)) {
    throw new ImageDownloadError("image URL must use the default HTTPS port");
  }
  if (url.username || url.password) {
    throw new ImageDownloadError("image URL must not contain credentials");
  }
  if (isPrivateHost(url.hostname)) {
    throw new ImageDownloadError("image URL host is not allowed");
  }
  return url;
}

export function isRaindropAuthOrigin(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    url.hostname === RAINDROP_AUTH_HOST &&
    ALLOWED_HTTPS_PORTS.has(url.port)
  );
}

/**
 * Authorization is derived from the destination of each individual request, not
 * from the caller's intent or the original URL. A redirect can therefore never
 * carry the Raindrop token to another origin.
 */
function headersForUrl(url: URL, authToken?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "image/*" };
  if (authToken && isRaindropAuthOrigin(url)) {
    headers.Authorization = `Bearer ${authToken}`;
  }
  return headers;
}

export function hasImageSignature(buffer: Buffer, contentType: string): boolean {
  if (buffer.length < 12) return false;
  switch (contentType) {
    case "image/png":
      return buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    case "image/jpeg":
      return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    case "image/gif":
      return buffer.subarray(0, 4).toString("ascii") === "GIF8";
    case "image/webp":
      return (
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP"
      );
    default:
      return false;
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    throw new ImageDownloadError("image response has no body", true);
  }

  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new ImageDownloadError(`image exceeds the ${maxBytes} byte limit`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}

export async function downloadSourceImage(
  rawUrl: string,
  options: DownloadOptions = {},
): Promise<DownloadedSourceImage> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? MAX_IMAGE_BYTES;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ImageDownloadError("download timeout must be a positive number");
  }
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new ImageDownloadError("download byte limit must be a positive number");
  }

  // Raindrop file endpoints are rewritten from the v2 display URL to the
  // authenticated REST v1 endpoint, exactly as the legacy importer does.
  const normalized = (() => {
    const match = /^https:\/\/api\.raindrop\.io\/v2\/raindrop\/(\d+)\/file/.exec(rawUrl);
    return match ? `https://api.raindrop.io/rest/v1/raindrop/${match[1]}/file` : rawUrl;
  })();

  let current = assertSafeImageUrl(normalized);
  let redirects = 0;

  while (true) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("image download timed out")),
      timeoutMs,
    );
    let response: Response;

    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: headersForUrl(current, options.authToken),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ImageDownloadError(
        controller.signal.aborted
          ? `image download timed out after ${timeoutMs}ms`
          : `image download failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) {
        throw new ImageDownloadError("image redirect has no location", false);
      }
      redirects += 1;
      if (redirects > maxRedirects) {
        throw new ImageDownloadError("image redirect limit exceeded");
      }
      current = assertSafeImageUrl(new URL(location, current).toString());
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageDownloadError(`image download failed (${response.status})`, true);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageDownloadError(`image download failed (${response.status})`, false);
    }

    const contentType = (response.headers.get("content-type") ?? "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (!(SUPPORTED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageDownloadError(`unsupported image content type: ${contentType || "(missing)"}`);
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new ImageDownloadError(`image exceeds the ${maxBytes} byte limit`);
    }

    const buffer = await readBoundedBody(response, maxBytes);
    if (buffer.length === 0) {
      throw new ImageDownloadError("image response body is empty", true);
    }
    if (!hasImageSignature(buffer, contentType)) {
      throw new ImageDownloadError("image body does not match its content type");
    }

    return {
      buffer,
      contentType: contentType as SupportedImageType,
      finalUrl: current.toString(),
      sha256: sha256Hex(buffer),
      sizeBytes: buffer.length,
    };
  }
}
