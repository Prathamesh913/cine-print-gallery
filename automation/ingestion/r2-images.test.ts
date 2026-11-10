import { describe, expect, it, vi } from "vitest";
import type { R2Store } from "../migration/types";
import { R2ConflictError, R2UploadError } from "../migration/r2";
import { planR2Keys, R2ImagePublisher } from "./r2-images";

const OPTIMIZER = { name: "sharp", version: "0.35.3", libvipsVersion: "8.18.3" };
const POSTER_ID = "artwork-123";
const SOURCE_SHA = "a".repeat(64);

function image() {
  return {
    original: {
      buffer: Buffer.from("original"),
      contentType: "image/png",
      sha256: SOURCE_SHA,
      sizeBytes: 8,
      extension: "png",
    },
    optimized: {
      buffer: Buffer.from("webp"),
      contentType: "image/webp" as const,
      sha256: "b".repeat(64),
      sizeBytes: 4,
    },
  };
}

function fakeStore(overrides: Partial<R2Store> = {}) {
  const store = {
    head: vi.fn(async () => null),
    put: vi.fn(async () => undefined),
    verify: vi.fn(async () => ({ ok: true, metadata: null, reason: null })),
    verifyOrigin: vi.fn(async () => ({
      ok: true,
      exists: true,
      checksumOk: true,
      metadataOk: true,
      sizeOk: true,
      metadata: null,
      sha256: SOURCE_SHA,
      sizeBytes: 8,
      reason: null,
    })),
    publicVerify: vi.fn(async () => ({
      ok: true,
      status: 200,
      contentType: "image/png",
      contentLength: 8,
      cacheControl: "public, max-age=31536000, immutable",
      sha256: SOURCE_SHA,
      reason: null,
    })),
    ...overrides,
  } as unknown as R2Store;

  return store;
}

function publisher(store: R2Store) {
  return new R2ImagePublisher({
    store,
    optimizer: OPTIMIZER,
    now: () => new Date("2026-11-10T00:00:00.000Z"),
  });
}

describe("R2 image publisher", () => {
  it("plans deterministic versioned keys", () => {
    const keys = planR2Keys(POSTER_ID, image(), OPTIMIZER);
    expect(keys.originalKey).toBe(`cineprint/versions/original/${POSTER_ID}/${SOURCE_SHA}.png`);
    expect(keys.optimizedKey).toBe(
      `cineprint/versions/optimized/${POSTER_ID}/${SOURCE_SHA}-sharp-0.35.3-libvips-8.18.3-w800-q80.webp`,
    );
    expect(keys.originalUrl).toBe(`https://images.cineprint.click/${keys.originalKey}`);
  });

  it("uploads the original and optimized objects and verifies both", async () => {
    const store = fakeStore();
    const refs = await publisher(store).publish(POSTER_ID, image(), "123");

    expect(store.put).toHaveBeenCalledTimes(2);
    expect(store.verifyOrigin).toHaveBeenCalledTimes(2);
    expect(store.publicVerify).toHaveBeenCalledTimes(2);
    expect(refs.original.sha256).toBe(SOURCE_SHA);
    expect(refs.optimized.contentType).toBe("image/webp");
    expect(refs.verifiedAt).toBe("2026-11-10T00:00:00.000Z");
  });

  it("reuses and re-verifies existing objects instead of overwriting them", async () => {
    const store = fakeStore({
      head: vi.fn(async () => ({
        key: "x",
        size: 8,
        contentType: "image/png",
        cacheControl: null,
        checksumSha256: null,
        metadataSha256: SOURCE_SHA,
        etag: null,
      })),
    } as unknown as Partial<R2Store>);

    const refs = await publisher(store).publish(POSTER_ID, image(), "123");
    expect(store.put).not.toHaveBeenCalled();
    expect(store.verify).toHaveBeenCalledTimes(2);
    expect(refs.original.key).toContain("/versions/original/");
  });

  it("rejects an existing object whose bytes do not match", async () => {
    const store = fakeStore({
      head: vi.fn(async () => ({
        key: "x",
        size: 8,
        contentType: "image/png",
        cacheControl: null,
        checksumSha256: null,
        metadataSha256: SOURCE_SHA,
        etag: null,
      })),
      verify: vi.fn(async () => ({ ok: false, metadata: null, reason: "checksum mismatch" })),
    } as unknown as Partial<R2Store>);

    await expect(publisher(store).publish(POSTER_ID, image(), "123")).rejects.toBeInstanceOf(
      R2UploadError,
    );
    expect(store.put).not.toHaveBeenCalled();
  });

  it("fails when origin integrity verification fails", async () => {
    const store = fakeStore({
      verifyOrigin: vi.fn(async () => ({
        ok: false,
        exists: true,
        checksumOk: false,
        metadataOk: false,
        sizeOk: false,
        metadata: null,
        sha256: null,
        sizeBytes: null,
        reason: "checksum mismatch",
      })),
    } as unknown as Partial<R2Store>);

    await expect(publisher(store).publish(POSTER_ID, image(), "123")).rejects.toThrow(
      "origin verification failed",
    );
  });

  it("fails when the public CDN does not serve the object", async () => {
    const store = fakeStore({
      publicVerify: vi.fn(async () => ({
        ok: false,
        status: 404,
        contentType: null,
        contentLength: null,
        cacheControl: null,
        sha256: null,
        reason: "Public URL returned HTTP 404",
      })),
    } as unknown as Partial<R2Store>);

    await expect(publisher(store).publish(POSTER_ID, image(), "123")).rejects.toThrow(
      "public verification failed",
    );
  });

  it("recovers an ambiguous upload by verifying the object", async () => {
    const store = fakeStore({
      put: vi.fn(async () => {
        throw new R2UploadError("socket hang up", true);
      }),
    } as unknown as Partial<R2Store>);

    const refs = await publisher(store).publish(POSTER_ID, image(), "123");
    expect(refs.original.key).toContain("/versions/original/");
    expect(store.verifyOrigin).toHaveBeenCalledTimes(2);
  });

  it("resolves an If-None-Match conflict by verifying the existing object", async () => {
    const store = fakeStore({
      put: vi.fn(async () => {
        throw new R2ConflictError("exists");
      }),
    } as unknown as Partial<R2Store>);

    const refs = await publisher(store).publish(POSTER_ID, image(), "123");
    expect(refs.original.url).toContain(POSTER_ID);
  });
});
