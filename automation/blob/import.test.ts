import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(),
  del: vi.fn(),
  head: vi.fn(),
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}));

import { head, put, BlobNotFoundError } from "@vercel/blob";
import { BlobClient } from "./client";
import { BlobImageImporter } from "./import";
import type { ImportImageInput } from "./import";

const mockPut = put as unknown as ReturnType<typeof vi.fn>;
const mockHead = head as unknown as ReturnType<typeof vi.fn>;
const mockFetch = vi.fn();

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function pngBody() {
  return Buffer.concat([PNG_SIGNATURE, Buffer.from("fake-image-data")]);
}

function imageResponse(body: Buffer, contentType: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": contentType },
  });
}

function makeImporter() {
  const client = new BlobClient({
    oidcToken: "test-oidc-token",
    storeId: "test-store-id",
  });
  return new BlobImageImporter(client);
}

function raindropInput(overrides: Partial<ImportImageInput> = {}): ImportImageInput {
  return {
    raindropId: "1812274995",
    imageUrl: "https://api.raindrop.io/v2/raindrop/1812274995/file?type=image/png",
    sourceKind: "raindrop",
    raindropToken: "raindrop-secret-token",
    ...overrides,
  };
}

function externalInput(overrides: Partial<ImportImageInput> = {}): ImportImageInput {
  return {
    raindropId: "1813721087",
    imageUrl: "https://pbs.twimg.com/media/HJvh3p8WUAAyir?format=jpg&name=large",
    sourceKind: "external",
    ...overrides,
  };
}

const BLOB_URL = "https://public.blob.vercel-storage.com/cineprint/raindrop/1812274995.png";

describe("BlobImageImporter", () => {
  beforeEach(() => {
    mockPut.mockReset();
    mockHead.mockReset();
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  it("downloads a Raindrop-hosted file with the Raindrop token and uploads it", async () => {
    mockFetch.mockResolvedValue(imageResponse(pngBody(), "image/png"));
    mockHead.mockRejectedValue(new BlobNotFoundError("not found"));
    mockPut.mockResolvedValue({
      url: BLOB_URL,
      pathname: "cineprint/raindrop/1812274995.png",
    });
    const importer = makeImporter();

    const result = await importer.importImage(raindropInput());

    expect(result).toEqual({
      url: BLOB_URL,
      pathname: "cineprint/raindrop/1812274995.png",
      status: "uploaded",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://api.raindrop.io/rest/v1/raindrop/1812274995/file",
    );
    expect(mockFetch.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer raindrop-secret-token" },
    });
    expect(mockPut).toHaveBeenCalledWith(
      "cineprint/raindrop/1812274995.png",
      pngBody(),
      expect.objectContaining({ access: "public", contentType: "image/png" }),
    );
  });

  it("downloads an external image without the Raindrop token and uploads it", async () => {
    mockFetch.mockResolvedValue(imageResponse(pngBody(), "image/png"));
    mockHead.mockRejectedValue(new BlobNotFoundError("not found"));
    mockPut.mockResolvedValue({
      url: "https://public.blob.vercel-storage.com/cineprint/raindrop/1813721087.png",
      pathname: "cineprint/raindrop/1813721087.png",
    });
    const importer = makeImporter();

    const result = await importer.importImage(externalInput());

    expect(result.status).toBe("uploaded");
    expect(result.pathname).toBe("cineprint/raindrop/1813721087.png");
    expect(mockFetch.mock.calls[0][1]?.headers).toBeUndefined();
  });

  it("reuses the existing Blob object instead of uploading again", async () => {
    mockFetch.mockResolvedValue(imageResponse(pngBody(), "image/png"));
    mockHead.mockResolvedValue({ url: BLOB_URL, pathname: "cineprint/raindrop/1812274995.png" });
    const importer = makeImporter();

    const result = await importer.importImage(raindropInput());

    expect(result).toEqual({
      url: BLOB_URL,
      pathname: "cineprint/raindrop/1812274995.png",
      status: "reused",
    });
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("rejects an unsupported MIME type", async () => {
    mockFetch.mockResolvedValue(imageResponse(Buffer.from("hello"), "text/html"));
    const importer = makeImporter();

    await expect(importer.importImage(externalInput())).rejects.toThrow(
      "unsupported content type: text/html",
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("fails when the HTTP download fails", async () => {
    mockFetch.mockResolvedValue(imageResponse(Buffer.from("oops"), "image/png", 500));
    const importer = makeImporter();

    await expect(importer.importImage(externalInput())).rejects.toThrow(
      "image download failed (500)",
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("fails on an empty response body", async () => {
    mockFetch.mockResolvedValue(imageResponse(Buffer.alloc(0), "image/png"));
    const importer = makeImporter();

    await expect(importer.importImage(externalInput())).rejects.toThrow(
      "image response body is empty",
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("fails when an HTML body pretends to be an image", async () => {
    mockFetch.mockResolvedValue(
      imageResponse(Buffer.from("<html><body>login page</body></html>"), "image/png"),
    );
    const importer = makeImporter();

    await expect(importer.importImage(externalInput())).rejects.toThrow(
      "image response body does not match its content type",
    );
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("creates separate Blob objects for two posters of the same movie", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(imageResponse(pngBody(), "image/png")));
    mockHead.mockRejectedValue(new BlobNotFoundError("not found"));
    mockPut.mockImplementation((pathname: string) =>
      Promise.resolve({
        url: `https://public.blob.vercel-storage.com/${pathname}`,
        pathname,
      }),
    );
    const importer = makeImporter();

    const first = await importer.importImage(raindropInput({ raindropId: "1812274995" }));
    const second = await importer.importImage(raindropInput({ raindropId: "1812274996" }));

    expect(first.pathname).toBe("cineprint/raindrop/1812274995.png");
    expect(second.pathname).toBe("cineprint/raindrop/1812274996.png");
    expect(mockPut).toHaveBeenCalledTimes(2);
    expect(mockPut.mock.calls[0][0]).not.toBe(mockPut.mock.calls[1][0]);
  });

  it("creates only one Blob object when the same Raindrop ID is processed twice", async () => {
    mockFetch.mockImplementation(() => Promise.resolve(imageResponse(pngBody(), "image/png")));
    mockHead.mockRejectedValueOnce(new BlobNotFoundError("not found"));
    mockHead.mockResolvedValueOnce({
      url: BLOB_URL,
      pathname: "cineprint/raindrop/1812274995.png",
    });
    mockPut.mockResolvedValue({
      url: BLOB_URL,
      pathname: "cineprint/raindrop/1812274995.png",
    });
    const importer = makeImporter();

    const first = await importer.importImage(raindropInput());
    const second = await importer.importImage(raindropInput());

    expect(first.status).toBe("uploaded");
    expect(second.status).toBe("reused");
    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut.mock.calls[0][0]).toBe("cineprint/raindrop/1812274995.png");
  });

  it("rethrows Blob API failures instead of falling back to the source URL", async () => {
    mockFetch.mockResolvedValue(imageResponse(pngBody(), "image/png"));
    mockHead.mockRejectedValue(new BlobNotFoundError("not found"));
    mockPut.mockRejectedValue(new Error("Blob API is down"));
    const importer = makeImporter();

    await expect(importer.importImage(raindropInput())).rejects.toThrow("Blob API is down");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
