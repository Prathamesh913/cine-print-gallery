import { describe, expect, it, vi } from "vitest";
import {
  downloadExtension,
  imageExtensionFromDataUrl,
  imageExtensionFromUrl,
} from "../src/lib/download-image";
import { fetchImageDataUrl } from "../src/lib/image-data-url";

describe("download file extensions", () => {
  it("derives extensions from image URLs", () => {
    expect(imageExtensionFromUrl("https://images.cineprint.click/a.png")).toBe("png");
    expect(imageExtensionFromUrl("https://images.cineprint.click/a.jpeg")).toBe("jpg");
    expect(imageExtensionFromUrl("https://images.cineprint.click/a.webp")).toBe("webp");
    expect(imageExtensionFromUrl("https://images.cineprint.click/a.gif")).toBe("gif");
    expect(imageExtensionFromUrl("https://images.cineprint.click/a.jpg")).toBe("jpg");
  });

  it("falls back to the data URI content type", () => {
    expect(imageExtensionFromUrl("https://images.cineprint.click/no-extension")).toBeNull();
    expect(imageExtensionFromDataUrl("data:image/png;base64,AAAA")).toBe("png");
    expect(imageExtensionFromDataUrl("data:image/jpeg;base64,AAAA")).toBe("jpg");
    expect(downloadExtension("https://images.cineprint.click/no-extension", "data:image/webp;base64,AAAA")).toBe("webp");
    expect(downloadExtension("https://images.cineprint.click/no-extension")).toBe("jpg");
  });
});

describe("fetchImageDataUrl", () => {
  it("returns a data URI for a valid image response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(Buffer.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    const result = await fetchImageDataUrl(
      "https://images.cineprint.click/cineprint/raindrop/1528361110.png",
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.startsWith("data:image/png;base64,")).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an HTML error page with a 200 status", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("<html>blocked</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    await expect(
      fetchImageDataUrl("https://images.cineprint.click/a.png", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/Unexpected image content type/);
  });

  it("rejects a failed HTTP response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("blocked", { status: 403, headers: { "content-type": "text/plain" } }),
    );
    await expect(
      fetchImageDataUrl("https://images.cineprint.click/a.png", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/HTTP 403/);
  });

  it("rejects private hosts and unsupported protocols", async () => {
    await expect(fetchImageDataUrl("http://127.0.0.1/a.png")).rejects.toThrow(
      /Invalid request host/,
    );
    await expect(fetchImageDataUrl("file:///tmp/a.png")).rejects.toThrow(/Invalid protocol/);
  });

  it("rejects an empty image response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(Buffer.alloc(0), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    await expect(
      fetchImageDataUrl("https://images.cineprint.click/a.png", fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/empty/);
  });
});
