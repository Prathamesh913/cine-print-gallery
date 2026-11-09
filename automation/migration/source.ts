import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import sharp, { type Metadata } from "sharp";
import { SUPPORTED_CONTENT_TYPES } from "../blob/types";
import { sha256Hex } from "./checksum";
import type { ManifestEntry, SourceDownload, SourceDownloaderLike } from "./types";

export class SourceError extends Error {}
export class SourceUnavailableError extends SourceError {}
export class SourceValidationError extends SourceError {}
export class SourceChangedError extends SourceError {}
/** A source timeout. Always transient and retryable. */
export class SourceTimeoutError extends SourceUnavailableError {}
/** A conclusive HTTP response; `retryable` distinguishes transient from permanent. */
export class SourceHttpStatusError extends SourceUnavailableError {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export const MAX_SOURCE_BYTES = 30 * 1024 * 1024;
export const DEFAULT_SOURCE_TIMEOUT_MS = 120_000;
export const MAX_SOURCE_TIMEOUT_MS = 600_000;
export const MIN_SOURCE_TIMEOUT_MS = 1;
const DEFAULT_MAX_REDIRECTS = 3;

export function resolveSourceTimeoutMs(value: number | undefined): number {
  if (value === undefined) return DEFAULT_SOURCE_TIMEOUT_MS;
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new SourceValidationError("Source timeout must be an integer number of milliseconds");
  }
  if (value < MIN_SOURCE_TIMEOUT_MS || value > MAX_SOURCE_TIMEOUT_MS) {
    throw new SourceValidationError(
      `Source timeout must be between ${MIN_SOURCE_TIMEOUT_MS} and ${MAX_SOURCE_TIMEOUT_MS} ms`,
    );
  }
  return value;
}

export function isRetryableSourceError(error: unknown): boolean {
  if (error instanceof SourceChangedError || error instanceof SourceValidationError) {
    return false;
  }
  if (error instanceof SourceHttpStatusError) return error.retryable;
  if (error instanceof SourceTimeoutError) return true;
  if (error instanceof SourceUnavailableError) return true;
  return false;
}

const ALLOWED_HOSTS: Record<string, Set<string>> = {
  "raindrop-file": new Set(["api.raindrop.io", "up.raindrop.io"]),
  "pbs-twimg": new Set(["pbs.twimg.com"]),
};

const SUPPORTED_MIME = new Set<string>(SUPPORTED_CONTENT_TYPES);

export interface PinnedAddress {
  address: string;
  family: number;
}

export type LookupImpl = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export interface SourceHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: AsyncIterable<Buffer>;
  finalUrl: string;
  destroy: () => void;
}

export interface SourceHttpClient {
  request(
    url: URL,
    options: {
      headers: Record<string, string>;
      timeoutMs: number;
      pinnedAddress?: PinnedAddress;
      /** Aborts the request and its response stream. */
      signal?: AbortSignal;
    },
  ): Promise<SourceHttpResponse>;
}

export interface SourceDownloaderOptions {
  raindropToken: string;
  httpClient?: SourceHttpClient;
  /** Test-only fetch adapter. Production uses PinnedHttpsClient. */
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupImpl;
  skipDnsResolution?: boolean;
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
}

export function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return "(invalid-url)";
  }
}

export function redactSecrets(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(authorization\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]")
    .replace(/([?&](?:token|access_token|authorization|secret|key)=)[^&\s]+/gi, "$1[REDACTED]");
}

export function assertSafeSourceUrl(urlValue: string, provider: string): URL {
  let url: URL;
  try {
    url = new URL(urlValue);
  } catch {
    throw new SourceValidationError("Source URL is not a valid URL");
  }

  if (url.protocol !== "https:") {
    throw new SourceValidationError("Source URL must use HTTPS");
  }
  if (url.username || url.password) {
    throw new SourceValidationError("Source URL must not contain embedded credentials");
  }

  const allowed = ALLOWED_HOSTS[provider];
  if (!allowed || !allowed.has(url.hostname)) {
    throw new SourceValidationError(
      `Source host is not allowlisted for ${provider}: ${url.hostname}`,
    );
  }

  return url;
}

function parseIPv4(address: string): number[] | null {
  if (!net.isIPv4(address)) return null;
  return address.split(".").map((part) => Number(part));
}

function isPublicIPv4(address: string): boolean {
  const octets = parseIPv4(address);
  if (!octets) return false;
  const [a, b, c] = octets;

  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

export function parseIPv6(address: string): number[] | null {
  let value = address.trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1);
  }
  const zoneIndex = value.indexOf("%");
  if (zoneIndex !== -1) value = value.slice(0, zoneIndex);
  if (!net.isIPv6(value)) return null;

  // Convert a trailing IPv4 literal to two IPv6 groups.
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    const ipv4 = parseIPv4(value.slice(lastColon + 1));
    if (!ipv4) return null;
    value = `${value.slice(0, lastColon + 1)}${((ipv4[0] << 8) | ipv4[1]).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (halves.length === 2 && missing < 1) return null;

  const groups = [...left, ...Array.from({ length: missing }, () => "0"), ...right].map((group) =>
    Number.parseInt(group, 16),
  );

  if (
    groups.length !== 8 ||
    groups.some((group) => !Number.isInteger(group) || group < 0 || group > 0xffff)
  ) {
    return null;
  }
  return groups;
}

function ipv4FromGroups(high: number, low: number): string {
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

export function isPublicAddress(address: string): boolean {
  if (net.isIPv4(address)) return isPublicIPv4(address);
  if (!net.isIPv6(address)) return false;

  const groups = parseIPv6(address);
  if (!groups) return false;

  const allZero = groups.every((group) => group === 0);
  if (allZero) return false;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) return false; // ::1

  const first = groups[0];
  if ((first & 0xfe00) === 0xfc00) return false; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return false; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return false; // ff00::/8 multicast
  if (first === 0x2001 && groups[1] === 0x0db8) return false; // documentation
  if (first === 0x2001 && groups[1] === 0x0000) return false; // Teredo
  if (first === 0x2001 && (groups[1] & 0xfff0) === 0x0010) return false; // ORCHID
  if (first === 0x2001 && groups[1] === 0x0002) return false; // benchmarking
  if (first === 0x2001 && (groups[1] & 0xfff0) === 0x0020) return false; // ORCHIDv2
  if (first === 0x2002) return false; // 6to4

  // IPv4-mapped ::ffff:0:0/96
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  ) {
    return isPublicIPv4(ipv4FromGroups(groups[6], groups[7]));
  }

  // NAT64 64:ff9b::/96
  if (
    groups[0] === 0x0064 &&
    groups[1] === 0xff9b &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0
  ) {
    return isPublicIPv4(ipv4FromGroups(groups[6], groups[7]));
  }

  // Conservative: only allow global unicast 2000::/3.
  return (first & 0xe000) === 0x2000;
}

async function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw new SourceTimeoutError("Source download timed out or was aborted");
  }
  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(new SourceTimeoutError("Source download timed out or was aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function defaultLookup(
  hostname: string,
): Promise<Array<{ address: string; family: number }>> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((result) => ({ address: result.address, family: result.family }));
}

export async function resolveAndValidateSourceUrl(
  urlValue: string,
  provider: string,
  lookupImpl: LookupImpl = defaultLookup,
): Promise<{ url: URL; pinned: PinnedAddress }> {
  const url = assertSafeSourceUrl(urlValue, provider);
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookupImpl(url.hostname);
  } catch (error) {
    throw new SourceUnavailableError(
      `DNS resolution failed for ${url.hostname}: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
    );
  }

  if (addresses.length === 0) {
    throw new SourceUnavailableError(`DNS returned no addresses for ${url.hostname}`);
  }
  for (const address of addresses) {
    if (!isPublicAddress(address.address)) {
      throw new SourceValidationError(
        `DNS for ${url.hostname} resolved to a non-public address: ${address.address}`,
      );
    }
  }

  // Prefer a validated public IPv4 address when DNS returns IPv6 first.
  // Some execution environments have no working IPv6 route; every answer is
  // still validated before one is pinned.
  const pinned = addresses.find((address) => address.family === 4) ?? addresses[0];
  return {
    url,
    pinned: { address: pinned.address, family: pinned.family },
  };
}

export function createPinnedLookup(
  address: string,
  family: number,
): https.RequestOptions["lookup"] {
  return ((
    _hostname: string,
    options: { all?: boolean },
    callback: (...args: unknown[]) => void,
  ) => {
    if (options?.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  }) as https.RequestOptions["lookup"];
}

export function headersForUrl(
  url: URL,
  provider: string,
  raindropToken: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": "CinePrint-Migration/1.0",
    Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1",
  };
  if (provider === "raindrop-file" && url.hostname === "api.raindrop.io" && raindropToken) {
    headers.Authorization = `Bearer ${raindropToken}`;
  }
  return headers;
}

export function buildHttpsRequestOptions(
  url: URL,
  headers: Record<string, string>,
  pinned: PinnedAddress,
): https.RequestOptions {
  return {
    protocol: "https:",
    hostname: url.hostname,
    port: url.port ? Number(url.port) : 443,
    path: `${url.pathname}${url.search}`,
    method: "GET",
    headers: { Host: url.hostname, ...headers },
    servername: url.hostname,
    lookup: createPinnedLookup(pinned.address, pinned.family),
    // Intentionally do not set rejectUnauthorized: false.
  };
}

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    normalized[key.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  }
  return normalized;
}

class PinnedHttpsClient implements SourceHttpClient {
  async request(
    url: URL,
    options: {
      headers: Record<string, string>;
      timeoutMs: number;
      pinnedAddress?: PinnedAddress;
      signal?: AbortSignal;
    },
  ): Promise<SourceHttpResponse> {
    if (!options.pinnedAddress) {
      throw new SourceValidationError("A pinned DNS address is required for HTTPS source requests");
    }
    if (options.signal?.aborted) {
      throw new SourceTimeoutError("Source request was aborted before it started");
    }

    const requestOptions = buildHttpsRequestOptions(url, options.headers, options.pinnedAddress);

    return new Promise<SourceHttpResponse>((resolve, reject) => {
      let settled = false;
      let responseStream: import("node:http").IncomingMessage | null = null;
      let onAbort: () => void = () => undefined;
      const cleanup = () => {
        options.signal?.removeEventListener("abort", onAbort);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        responseStream?.destroy();
        reject(error);
      };

      const request = https.request(requestOptions, (response) => {
        responseStream = response;
        if (settled) {
          response.destroy();
          return;
        }
        settled = true;
        cleanup();
        resolve({
          status: response.statusCode ?? 0,
          headers: normalizeHeaders(response.headers),
          body: response,
          finalUrl: url.toString(),
          destroy: () => response.destroy(),
        });
      });

      request.setTimeout(options.timeoutMs, () => {
        const error = new SourceTimeoutError(
          `Source request timed out after ${options.timeoutMs}ms`,
        );
        request.destroy(error);
        fail(error);
      });
      onAbort = () => {
        const error = new SourceTimeoutError("Source request timed out or was aborted");
        request.destroy(error);
        fail(error);
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      request.on("error", (error) => {
        if (error instanceof SourceTimeoutError) {
          fail(error);
          return;
        }
        fail(
          new SourceUnavailableError(
            `Source request failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
          ),
        );
      });
      request.end();
    });
  }
}

async function* webStreamToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
  onDone?: () => void,
): AsyncIterable<Buffer> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      if (value) yield Buffer.from(value);
    }
  } finally {
    reader.releaseLock();
    onDone?.();
  }
}

class FetchSourceHttpClient implements SourceHttpClient {
  constructor(private readonly fetchImpl: typeof fetch) {}

  async request(
    url: URL,
    options: {
      headers: Record<string, string>;
      timeoutMs: number;
      pinnedAddress?: PinnedAddress;
      signal?: AbortSignal;
    },
  ): Promise<SourceHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new SourceTimeoutError(`Source request timed out after ${options.timeoutMs}ms`),
      );
    }, options.timeoutMs);
    const forwardAbort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", forwardAbort, { once: true });

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: "GET",
        headers: options.headers,
        redirect: "manual",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", forwardAbort);
      if (controller.signal.aborted || options.signal?.aborted) {
        throw new SourceTimeoutError("Source request timed out or was aborted");
      }
      throw new SourceUnavailableError(
        `Source request failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
      );
    }

    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", forwardAbort);
    };
    const destroy = () => {
      cleanup();
      controller.abort();
      void response.body?.cancel().catch(() => undefined);
    };

    const body = response.body
      ? webStreamToAsyncIterable(response.body, cleanup)
      : (async function* () {})();
    if (!response.body) cleanup();

    return {
      status: response.status,
      headers: normalizeHeaders(
        Object.fromEntries(response.headers.entries()) as Record<string, string>,
      ),
      body,
      finalUrl: url.toString(),
      destroy,
    };
  }
}

export async function readResponseWithLimit(
  response: SourceHttpResponse,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  if (signal?.aborted) {
    response.destroy();
    throw new SourceTimeoutError("Source body read was aborted before it started");
  }

  const declaredLength = Number(response.headers["content-length"] ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    response.destroy();
    throw new SourceValidationError(
      `Source Content-Length ${declaredLength} exceeds the ${maxBytes} byte limit`,
    );
  }

  const chunks: Buffer[] = [];
  let total = 0;
  const onAbort = () => {
    response.destroy();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    for await (const chunk of response.body) {
      if (signal?.aborted) {
        response.destroy();
        throw new SourceTimeoutError("Source body read timed out or was aborted");
      }
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buffer.length;
      if (total > maxBytes) {
        response.destroy();
        throw new SourceValidationError(`Source body exceeds the ${maxBytes} byte streaming limit`);
      }
      chunks.push(buffer);
    }
  } catch (error) {
    response.destroy();
    if (signal?.aborted) {
      throw new SourceTimeoutError("Source body read timed out or was aborted");
    }
    if (error instanceof SourceError) throw error;
    throw new SourceUnavailableError(
      `Source body read failed: ${redactSecrets(error instanceof Error ? error.message : String(error))}`,
    );
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }

  return Buffer.concat(chunks, total);
}

function mimeFromSharpFormat(format: string | undefined): string | null {
  if (!format) return null;
  if (format === "jpg") return "image/jpeg";
  return `image/${format}`;
}

export class SourceDownloader implements SourceDownloaderLike {
  private readonly raindropToken: string;
  private readonly httpClient: SourceHttpClient;
  private readonly lookupImpl: LookupImpl;
  private readonly skipDnsResolution: boolean;
  private readonly maxBytes: number;
  private readonly timeoutMs: number;
  private readonly maxRedirects: number;

  constructor(options: SourceDownloaderOptions) {
    this.raindropToken = options.raindropToken;
    this.lookupImpl = options.lookupImpl ?? defaultLookup;
    this.skipDnsResolution = options.skipDnsResolution ?? Boolean(options.fetchImpl);
    this.maxBytes = options.maxBytes ?? MAX_SOURCE_BYTES;
    this.timeoutMs = resolveSourceTimeoutMs(options.timeoutMs);
    this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

    if (options.httpClient) {
      this.httpClient = options.httpClient;
    } else if (options.fetchImpl) {
      this.httpClient = new FetchSourceHttpClient(options.fetchImpl);
    } else {
      this.httpClient = new PinnedHttpsClient();
    }
  }

  async download(entry: ManifestEntry): Promise<SourceDownload> {
    if (!entry.sourceImageUrl) {
      throw new SourceValidationError("Manifest entry has no sourceImageUrl");
    }
    if (entry.sourceProvider !== "raindrop-file" && entry.sourceProvider !== "pbs-twimg") {
      throw new SourceValidationError(`Unsupported source provider: ${entry.sourceProvider}`);
    }

    const current = assertSafeSourceUrl(entry.sourceImageUrl, entry.sourceProvider);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(
        new SourceTimeoutError(`Source download timed out after ${this.timeoutMs}ms`),
      );
    }, this.timeoutMs);
    try {
      return await this.downloadWithSignal(entry, current, controller.signal);
    } finally {
      clearTimeout(timer);
    }
  }

  private async downloadWithSignal(
    entry: ManifestEntry,
    initialUrl: URL,
    signal: AbortSignal,
  ): Promise<SourceDownload> {
    let current = initialUrl;
    let redirects = 0;

    while (true) {
      if (signal.aborted) {
        throw new SourceTimeoutError("Source download timed out or was aborted");
      }
      let pinnedAddress: PinnedAddress | undefined;
      if (!this.skipDnsResolution) {
        const resolved = await raceWithAbort(
          resolveAndValidateSourceUrl(current.toString(), entry.sourceProvider, this.lookupImpl),
          signal,
        );
        pinnedAddress = resolved.pinned;
      }

      let response: SourceHttpResponse;
      try {
        response = await this.httpClient.request(current, {
          headers: headersForUrl(current, entry.sourceProvider, this.raindropToken),
          timeoutMs: this.timeoutMs,
          pinnedAddress,
          signal,
        });
      } catch (error) {
        if (signal.aborted) {
          throw new SourceTimeoutError("Source download timed out or was aborted");
        }
        throw error;
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location;
        if (!location) {
          response.destroy();
          throw new SourceUnavailableError(
            `Source returned HTTP ${response.status} without a Location header`,
          );
        }
        if (redirects >= this.maxRedirects) {
          response.destroy();
          throw new SourceUnavailableError("Source exceeded the maximum redirect count");
        }
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          response.destroy();
          throw new SourceUnavailableError("Source returned an invalid redirect Location");
        }
        assertSafeSourceUrl(next.toString(), entry.sourceProvider);
        response.destroy();
        current = next;
        redirects += 1;
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        response.destroy();
        throw new SourceHttpStatusError(
          entry.sourceProvider === "raindrop-file"
            ? `Raindrop authentication failed (HTTP ${response.status})`
            : `External source denied access (HTTP ${response.status})`,
          response.status,
          false,
        );
      }
      if (response.status < 200 || response.status >= 300) {
        response.destroy();
        const retryable =
          response.status === 408 ||
          response.status === 425 ||
          response.status === 429 ||
          response.status >= 500;
        throw new SourceHttpStatusError(
          `Source returned HTTP ${response.status}`,
          response.status,
          retryable,
        );
      }

      const headerMime = (response.headers["content-type"] ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      if (headerMime && !headerMime.startsWith("image/")) {
        response.destroy();
        throw new SourceValidationError(`Unexpected source Content-Type: ${headerMime}`);
      }

      const buffer = await readResponseWithLimit(response, this.maxBytes, signal);
      if (buffer.length === 0) {
        throw new SourceValidationError("Source response body is empty");
      }

      let metadata: Metadata;
      try {
        metadata = await sharp(buffer).metadata();
      } catch (error) {
        throw new SourceValidationError(
          `Source is not a decodable image: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!metadata.width || !metadata.height) {
        throw new SourceValidationError("Source image dimensions are unavailable");
      }

      const detectedMime = headerMime.startsWith("image/")
        ? headerMime
        : mimeFromSharpFormat(metadata.format);
      if (!detectedMime || !SUPPORTED_MIME.has(detectedMime)) {
        throw new SourceValidationError(
          `Unsupported source MIME type: ${detectedMime ?? "unknown"}`,
        );
      }
      const formatMime = mimeFromSharpFormat(metadata.format);
      if (formatMime && detectedMime !== formatMime) {
        throw new SourceValidationError(
          `Source Content-Type ${detectedMime} does not match decoded format ${formatMime}`,
        );
      }

      const sha256 = sha256Hex(buffer);
      if (entry.sourceSha256 && sha256 !== entry.sourceSha256) {
        throw new SourceChangedError(
          `Source checksum changed: expected ${entry.sourceSha256}, received ${sha256}`,
        );
      }
      if (entry.sourceMimeType && detectedMime !== entry.sourceMimeType) {
        throw new SourceChangedError(
          `Source MIME changed: expected ${entry.sourceMimeType}, received ${detectedMime}`,
        );
      }
      if (entry.sourceSizeBytes !== null && buffer.length !== entry.sourceSizeBytes) {
        throw new SourceChangedError(
          `Source size changed: expected ${entry.sourceSizeBytes}, received ${buffer.length}`,
        );
      }
      if (
        entry.sourceDimensions &&
        (metadata.width !== entry.sourceDimensions.width ||
          metadata.height !== entry.sourceDimensions.height)
      ) {
        throw new SourceChangedError(
          `Source dimensions changed: expected ${entry.sourceDimensions.width}x${entry.sourceDimensions.height}, received ${metadata.width}x${metadata.height}`,
        );
      }

      return {
        buffer,
        sha256,
        mimeType: detectedMime,
        dimensions: { width: metadata.width, height: metadata.height },
        sizeBytes: buffer.length,
        finalUrl: current.toString(),
        httpStatus: response.status,
      };
    }
  }
}
