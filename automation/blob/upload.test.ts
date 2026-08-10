import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  del: vi.fn(),
  head: vi.fn(),
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}));

import { del, head, put, BlobNotFoundError } from "@vercel/blob";
import { BlobClient } from "./client";
import { ImageUploader, blobPathnameFor, ImageUploadError } from "./upload";
import type { UploadImageInput } from "./types";

const mockPut = put as unknown as ReturnType<typeof vi.fn>;
const mockDel = del as unknown as ReturnType<typeof vi.fn>;
const mockHead = head as unknown as ReturnType<typeof vi.fn>;

function makeUploader() {
  const client = new BlobClient({
    oidcToken: "test-oidc-token",
    storeId: "test-store-id",
  });
  return new ImageUploader(client);
}

function bufferOf(content: string) {
  return Buffer.from(content, "utf8");
}

function input(overrides: Partial<UploadImageInput> = {}): UploadImageInput {
  return {
    buffer: bufferOf("fake-jpeg-bytes"),
    raindropId: "1812274995",
    contentType: "image/jpeg",
    ...overrides,
  };
}

describe("blobPathnameFor", () => {
  it("uses the cineprint/raindrop convention with the content-type extension", () => {
    expect(blobPathnameFor("1812274995", "image/jpeg")).toBe("cineprint/raindrop/1812274995.jpg");
    expect(blobPathnameFor("1812274995", "image/png")).toBe("cineprint/raindrop/1812274995.png");
    expect(blobPathnameFor("1812274995", "image/webp")).toBe("cineprint/raindrop/1812274995.webp");
    expect(blobPathnameFor("1812274995", "image/gif")).toBe("cineprint/raindrop/1812274995.gif");
  });

  it("is deterministic for the same raindrop ID and content type", () => {
    const first = blobPathnameFor("1812274995", "image/png");
    const second = blobPathnameFor("1812274995", "image/png");
    expect(first).toBe(second);
    expect(first).toBe("cineprint/raindrop/1812274995.png");
  });

  it("returns null for unsupported content types", () => {
    expect(blobPathnameFor("1812274995", "text/html")).toBeNull();
  });
});

describe("ImageUploader", () => {
  beforeEach(() => {
    mockPut.mockReset();
    mockDel.mockReset();
    mockHead.mockReset();
  });

  it("uploads a valid JPEG with a public URL and the jpg pathname", async () => {
    mockPut.mockResolvedValue({
      url: "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.jpg",
      pathname: "cineprint/raindrop/1812274995.jpg",
    });
    const uploader = makeUploader();
    const imageInput = input();

    const result = await uploader.uploadImage(imageInput);

    expect(result.url).toBe(
      "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.jpg",
    );
    expect(result.pathname).toBe("cineprint/raindrop/1812274995.jpg");
    expect(mockPut).toHaveBeenCalledTimes(1);
    const [pathname, body, options] = mockPut.mock.calls[0];
    expect(pathname).toBe("cineprint/raindrop/1812274995.jpg");
    expect(body).toBe(imageInput.buffer);
    expect(options).toMatchObject({
      access: "public",
      contentType: "image/jpeg",
      oidcToken: "test-oidc-token",
      storeId: "test-store-id",
    });
  });

  it("uploads a valid PNG", async () => {
    mockPut.mockResolvedValue({
      url: "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.png",
      pathname: "cineprint/raindrop/1812274995.png",
    });
    const uploader = makeUploader();

    const result = await uploader.uploadImage(
      input({ contentType: "image/png", buffer: bufferOf("fake-png-bytes") }),
    );

    expect(result.pathname).toBe("cineprint/raindrop/1812274995.png");
    expect(mockPut.mock.calls[0][0]).toBe("cineprint/raindrop/1812274995.png");
    expect(mockPut.mock.calls[0][2]).toMatchObject({ contentType: "image/png" });
  });

  it("uploads a valid WebP", async () => {
    mockPut.mockResolvedValue({
      url: "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.webp",
      pathname: "cineprint/raindrop/1812274995.webp",
    });
    const uploader = makeUploader();

    const result = await uploader.uploadImage(
      input({ contentType: "image/webp", buffer: bufferOf("fake-webp-bytes") }),
    );

    expect(result.pathname).toBe("cineprint/raindrop/1812274995.webp");
    expect(mockPut.mock.calls[0][2]).toMatchObject({ contentType: "image/webp" });
  });

  it("rejects an empty buffer", async () => {
    const uploader = makeUploader();

    await expect(uploader.uploadImage(input({ buffer: Buffer.alloc(0) }))).rejects.toThrow(
      ImageUploadError,
    );
    await expect(uploader.uploadImage(input({ buffer: Buffer.alloc(0) }))).rejects.toThrow(
      "buffer must be a non-empty image buffer",
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("rejects an unsupported content type", async () => {
    const uploader = makeUploader();

    await expect(uploader.uploadImage(input({ contentType: "text/html" }))).rejects.toThrow(
      "unsupported content type: text/html",
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("rejects an empty raindrop ID", async () => {
    const uploader = makeUploader();

    await expect(uploader.uploadImage(input({ raindropId: "" }))).rejects.toThrow(
      "raindropId is required",
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("uploads to the same pathname for the same raindrop ID twice", async () => {
    mockPut.mockResolvedValue({
      url: "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.png",
      pathname: "cineprint/raindrop/1812274995.png",
    });
    const uploader = makeUploader();

    await uploader.uploadImage(input({ contentType: "image/png" }));
    await uploader.uploadImage(input({ contentType: "image/png" }));

    expect(mockPut).toHaveBeenCalledTimes(2);
    expect(mockPut.mock.calls[0][0]).toBe(mockPut.mock.calls[1][0]);
    expect(mockPut.mock.calls[0][0]).toBe("cineprint/raindrop/1812274995.png");
  });

  it("requires OIDC credentials and fails without them", () => {
    expect(() => new BlobClient({ oidcToken: "", storeId: "s" })).toThrow(
      "VERCEL_OIDC_TOKEN is required",
    );
    expect(() => new BlobClient({ oidcToken: "t", storeId: "" })).toThrow(
      "BLOB_STORE_ID is required",
    );
  });

  it("deletes through the official SDK for explicit cleanup", async () => {
    const client = new BlobClient({
      oidcToken: "test-oidc-token",
      storeId: "test-store-id",
    });

    await client.delete("cineprint/test/blob-test.png");

    expect(mockDel).toHaveBeenCalledWith("cineprint/test/blob-test.png", {
      oidcToken: "test-oidc-token",
      storeId: "test-store-id",
    });
  });

  it("returns the existing blob when head finds it", async () => {
    mockHead.mockResolvedValue({
      url: "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.png",
      pathname: "cineprint/raindrop/1812274995.png",
    });
    const client = new BlobClient({
      oidcToken: "test-oidc-token",
      storeId: "test-store-id",
    });

    const result = await client.head("cineprint/raindrop/1812274995.png");

    expect(result).toEqual({
      url: "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.png",
      pathname: "cineprint/raindrop/1812274995.png",
    });
    expect(mockHead).toHaveBeenCalledWith("cineprint/raindrop/1812274995.png", {
      oidcToken: "test-oidc-token",
      storeId: "test-store-id",
    });
  });

  it("returns null when the blob does not exist", async () => {
    mockHead.mockRejectedValue(new BlobNotFoundError("not found"));
    const client = new BlobClient({
      oidcToken: "test-oidc-token",
      storeId: "test-store-id",
    });

    const result = await client.head("cineprint/raindrop/1812274995.png");

    expect(result).toBeNull();
  });
});
