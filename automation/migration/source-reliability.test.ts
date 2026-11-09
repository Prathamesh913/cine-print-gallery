import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOURCE_TIMEOUT_MS,
  MAX_SOURCE_TIMEOUT_MS,
  MIN_SOURCE_TIMEOUT_MS,
  SourceDownloader,
  SourceHttpStatusError,
  SourceTimeoutError,
  SourceValidationError,
  isRetryableSourceError,
  resolveSourceTimeoutMs,
  type SourceHttpClient,
  type SourceHttpResponse,
} from "./source";
import type { ManifestEntry } from "./types";

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
    sourceDimensions: { width: 1, height: 1 },
    sourceSizeBytes: null,
    sourceSha256: null,
    sourceMatchesExistingOriginal: null,
    sourceExistingOriginalSizeDelta: null,
    currentImageUrl: "https://example.com/current.png",
    currentImageProvider: "external",
    currentImageObjectKey: null,
    originalR2Key: null,
    optimizedR2Key: null,
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

function downloaderWith(client: SourceHttpClient, timeoutMs: number): SourceDownloader {
  return new SourceDownloader({
    raindropToken: "",
    httpClient: client,
    skipDnsResolution: true,
    timeoutMs,
  });
}

describe("F14 — configurable bounded source timeout", () => {
  it("defaults to the 120-second value justified by the audit", () => {
    expect(DEFAULT_SOURCE_TIMEOUT_MS).toBe(120_000);
    expect(resolveSourceTimeoutMs(undefined)).toBe(120_000);
    expect(resolveSourceTimeoutMs(120_000)).toBe(120_000);
  });

  it("rejects timeouts outside the supported bounds", () => {
    expect(() => resolveSourceTimeoutMs(MIN_SOURCE_TIMEOUT_MS - 1)).toThrow(SourceValidationError);
    expect(() => resolveSourceTimeoutMs(MAX_SOURCE_TIMEOUT_MS + 1)).toThrow(SourceValidationError);
    expect(() => resolveSourceTimeoutMs(Number.NaN)).toThrow(SourceValidationError);
    expect(() => resolveSourceTimeoutMs(1.5)).toThrow(SourceValidationError);
  });
});

describe("F14 — real cancellation on timeout", () => {
  it("aborts a request that never returns", async () => {
    let destroyed = 0;
    const client: SourceHttpClient = {
      request(_url, options): Promise<SourceHttpResponse> {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener(
            "abort",
            () => {
              destroyed += 1;
              reject(new SourceTimeoutError("aborted by test"));
            },
            { once: true },
          );
        });
      },
    };

    await expect(downloaderWith(client, 25).download(makeEntry())).rejects.toBeInstanceOf(
      SourceTimeoutError,
    );
    expect(destroyed).toBe(1);
  });

  it("aborts a stalled body read and destroys the response", async () => {
    let destroyed = 0;
    const client: SourceHttpClient = {
      async request(): Promise<SourceHttpResponse> {
        let rejectBody!: (error: Error) => void;
        const body: AsyncIterable<Buffer> = {
          [Symbol.asyncIterator]() {
            return {
              next: () =>
                new Promise<IteratorResult<Buffer>>((_resolve, reject) => {
                  rejectBody = reject;
                }),
            };
          },
        };
        return {
          status: 200,
          headers: { "content-type": "image/png" },
          body,
          finalUrl: "https://pbs.twimg.com/media/test",
          destroy: () => {
            destroyed += 1;
            rejectBody?.(new Error("response destroyed"));
          },
        };
      },
    };

    await expect(downloaderWith(client, 25).download(makeEntry())).rejects.toBeInstanceOf(
      SourceTimeoutError,
    );
    expect(destroyed).toBeGreaterThan(0);
  });

  it("settles without leaving the download pending after a timeout", async () => {
    const client: SourceHttpClient = {
      request(_url, options): Promise<SourceHttpResponse> {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        });
      },
    };

    const started = Date.now();
    await expect(downloaderWith(client, 20).download(makeEntry())).rejects.toBeInstanceOf(
      SourceTimeoutError,
    );
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

describe("F14 — retry classification", () => {
  it("marks permanent 4xx responses as non-retryable", () => {
    for (const status of [400, 401, 403, 404, 410, 422]) {
      expect(isRetryableSourceError(new SourceHttpStatusError("x", status, false))).toBe(false);
    }
  });

  it("marks transient 408/425/429/5xx responses as retryable", () => {
    for (const status of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryableSourceError(new SourceHttpStatusError("x", status, true))).toBe(true);
    }
  });

  it("never retries checksum changes or validation failures", () => {
    expect(isRetryableSourceError(new SourceValidationError("bad"))).toBe(false);
    expect(isRetryableSourceError(new SourceTimeoutError("slow"))).toBe(true);
  });
});
