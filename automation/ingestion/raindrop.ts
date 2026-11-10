/**
 * Raindrop bookmark source with bounded paging, timeouts and rate-limit
 * handling.
 *
 * Only the designated collection is read. The API token is sent in the
 * Authorization header and is never logged or included in errors.
 */

import type { Logger } from "./logger";
import type { BookmarkInput } from "./validation";

export const RAINDROP_API_URL = "https://api.raindrop.io/rest/v1/raindrops";
export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_MAX_PAGES = 4;
export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_RETRIES = 3;

export class RaindropApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "RaindropApiError";
  }
}
export class RaindropAuthError extends RaindropApiError {}
export class RaindropRateLimitError extends RaindropApiError {}

export interface RaindropSourceOptions {
  accessToken: string;
  collectionId: string;
  pageSize?: number;
  maxPages?: number;
  timeoutMs?: number;
  retries?: number;
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
  logger?: Logger;
}

export interface RaindropFetchResult {
  bookmarks: BookmarkInput[];
  pagesFetched: number;
  totalCount: number | null;
  truncated: boolean;
}

interface RaindropResponse {
  items?: unknown;
  count?: unknown;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryAfterMs(headers: Headers): number | null {
  const value = headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0), 60) * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(Math.max(date - Date.now(), 0), 60_000);
  return null;
}

function assertPositiveInteger(value: number, label: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return value;
}

export async function fetchRaindropBookmarks(
  options: RaindropSourceOptions,
): Promise<RaindropFetchResult> {
  const pageSize = assertPositiveInteger(options.pageSize ?? DEFAULT_PAGE_SIZE, "pageSize");
  const maxPages = assertPositiveInteger(options.maxPages ?? DEFAULT_MAX_PAGES, "maxPages");
  const timeoutMs = assertPositiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, "timeoutMs");
  const retries = assertPositiveInteger(options.retries ?? DEFAULT_RETRIES, "retries");
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleepImpl ?? defaultSleep;

  if (!options.accessToken) throw new Error("RAINDROP_ACCESS_TOKEN is required");
  if (!options.collectionId) throw new Error("RAINDROP_COLLECTION_ID is required");

  const bookmarks: BookmarkInput[] = [];
  let totalCount: number | null = null;
  let pagesFetched = 0;
  let truncated = false;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(`${RAINDROP_API_URL}/${encodeURIComponent(options.collectionId)}`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("perpage", String(pageSize));
    url.searchParams.set("sort", "-created");

    let response: Response | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(new Error("Raindrop request timed out")),
        timeoutMs,
      );
      try {
        response = await fetchImpl(url, {
          headers: { Authorization: `Bearer ${options.accessToken}` },
          signal: controller.signal,
        });
        lastError = null;
      } catch (error) {
        lastError = error;
        response = null;
      } finally {
        clearTimeout(timer);
      }

      if (response) {
        if (response.status === 401 || response.status === 403) {
          throw new RaindropAuthError("Raindrop authentication failed", response.status, false);
        }
        if (response.status === 429) {
          if (attempt >= retries) {
            throw new RaindropRateLimitError("Raindrop rate limit exceeded", 429, true);
          }
          const delay = retryAfterMs(response.headers) ?? Math.min(1000 * 2 ** attempt, 30_000);
          options.logger?.warn("raindrop.rate_limited", {
            page,
            attempt: attempt + 1,
            delayMs: delay,
          });
          await sleep(delay);
          continue;
        }
        if (response.status >= 500) {
          lastError = new RaindropApiError(
            `Raindrop API returned ${response.status}`,
            response.status,
            true,
          );
          if (attempt >= retries) break;
          await sleep(Math.min(1000 * 2 ** attempt, 15_000));
          continue;
        }
        if (!response.ok) {
          throw new RaindropApiError(
            `Raindrop API request failed (${response.status})`,
            response.status,
            false,
          );
        }
        break;
      }

      if (attempt >= retries) break;
      options.logger?.warn("raindrop.request_retry", {
        page,
        attempt: attempt + 1,
        reason: lastError instanceof Error ? lastError.name : "network",
      });
      await sleep(Math.min(1000 * 2 ** attempt, 15_000));
    }

    if (!response) {
      throw new RaindropApiError(
        `Raindrop request failed after ${retries + 1} attempt(s)`,
        0,
        true,
      );
    }

    const text = await response.text();
    let data: RaindropResponse;
    try {
      data = JSON.parse(text) as RaindropResponse;
    } catch {
      throw new RaindropApiError("Raindrop API returned invalid JSON", response.status, true);
    }

    if (!Array.isArray(data.items)) {
      throw new RaindropApiError(
        "Raindrop API response did not contain an items array",
        response.status,
        true,
      );
    }

    pagesFetched += 1;
    if (typeof data.count === "number" && Number.isFinite(data.count)) {
      totalCount = data.count;
    }

    for (const item of data.items) {
      if (item && typeof item === "object") {
        bookmarks.push(item as BookmarkInput);
      }
    }

    if (data.items.length < pageSize) break;
    if (page === maxPages - 1) truncated = true;
  }

  return { bookmarks, pagesFetched, totalCount, truncated };
}
