import { describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  DEFAULT_OPTIMIZE_WIDTH,
  DEFAULT_WEBP_QUALITY,
  ImageOptimizationError,
  isWebpBuffer,
  optimizeImage,
} from "./blob/optimize";
import { optimizedPathFor, optimizedUrlFor } from "./blob/optimized-path";
import { optimizeOne } from "./optimize-images";

async function makePng(width = 1200, height = 1800, alpha = 1) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 220, g: 40, b: 80, alpha },
    },
  })
    .png()
    .toBuffer();
}

async function makeJpeg() {
  return sharp({
    create: {
      width: 1400,
      height: 1850,
      channels: 3,
      background: { r: 30, g: 40, b: 60 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

describe("optimizeImage", () => {
  it("converts PNG to WebP", async () => {
    const result = await optimizeImage(await makePng());
    expect(result.contentType).toBe("image/webp");
    expect(isWebpBuffer(result.buffer)).toBe(true);
  });

  it("converts JPEG to WebP", async () => {
    const result = await optimizeImage(await makeJpeg());
    expect(result.contentType).toBe("image/webp");
    expect(isWebpBuffer(result.buffer)).toBe(true);
  });

  it("uses the configured 800px default and preserves aspect ratio", async () => {
    const result = await optimizeImage(await makePng());
    expect(result.width).toBe(DEFAULT_OPTIMIZE_WIDTH);
    expect(result.height).toBe(1200);
  });

  it("does not upscale a smaller image", async () => {
    const result = await optimizeImage(await makePng(400, 600));
    expect(result.width).toBe(400);
    expect(result.height).toBe(600);
  });

  it("preserves transparency", async () => {
    const result = await optimizeImage(await makePng(400, 600, 0));
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.hasAlpha).toBe(true);
  });

  it("accepts the selected default WebP quality", async () => {
    const result = await optimizeImage(await makePng(), {
      maxWidth: DEFAULT_OPTIMIZE_WIDTH,
      quality: DEFAULT_WEBP_QUALITY,
    });
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("rejects invalid image bytes safely", async () => {
    await expect(optimizeImage(Buffer.from("not an image"))).rejects.toThrow(
      ImageOptimizationError,
    );
  });
});

describe("optimized Blob paths", () => {
  const original =
    "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1779301125.png";

  it("uses the Raindrop ID path for automated records", () => {
    expect(optimizedPathFor("artwork-1812274995", original)).toBe(
      "cineprint/optimized/1779301125.webp",
    );
    expect(optimizedUrlFor("artwork-1812274995", original)).toBe(
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/1779301125.webp",
    );
  });

  it("uses the Firebase document ID path for legacy records", () => {
    expect(optimizedPathFor("backrooms-1", original)).toBe(
      "cineprint/optimized/legacy/backrooms-1.webp",
    );
  });

  it("does not derive paths for Twitter or malformed URLs", () => {
    expect(optimizedPathFor("her", "https://pbs.twimg.com/media/example.jpg")).toBeNull();
    expect(optimizedPathFor("her", "not-a-url")).toBeNull();
  });
});

describe("optimizeOne Blob behavior", () => {
  it("uploads a missing optimized asset and verifies the public WebP", async () => {
    const original = await makePng();
    const optimized = await optimizeImage(original);
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      const body = url.includes("optimized") ? optimized.buffer : original;
      return new Response(body, {
        status: 200,
        headers: { "content-type": url.includes("optimized") ? "image/webp" : "image/png" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = {
      head: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue({
        url: "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/legacy/backrooms-1.webp",
        pathname: "cineprint/optimized/legacy/backrooms-1.webp",
      }),
    };

    const result = await optimizeOne(client, {
      id: "backrooms-1",
      image:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1779301125.png",
    });

    expect(result.kind).toBe("uploaded");
    expect(client.put).toHaveBeenCalledTimes(1);
    expect(client.put.mock.calls[0][0]).toBe("cineprint/optimized/legacy/backrooms-1.webp");
  });

  it("reuses an existing optimized asset", async () => {
    const original = await makePng();
    const optimized = await optimizeImage(original);
    const optimizedUrl =
      "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/optimized/legacy/backrooms-1.webp";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        const body = url === optimizedUrl ? optimized.buffer : original;
        return new Response(body, {
          status: 200,
          headers: { "content-type": url === optimizedUrl ? "image/webp" : "image/png" },
        });
      }),
    );
    const client = {
      head: vi.fn().mockResolvedValue({
        url: optimizedUrl,
        pathname: "cineprint/optimized/legacy/backrooms-1.webp",
      }),
      put: vi.fn(),
    };

    const result = await optimizeOne(client, {
      id: "backrooms-1",
      image:
        "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1779301125.png",
    });

    expect(result.kind).toBe("reused");
    expect(client.put).not.toHaveBeenCalled();
  });

  it("supports dry-run without uploading", async () => {
    const original = await makePng();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(original, { status: 200, headers: { "content-type": "image/png" } }),
        ),
    );
    const client = { head: vi.fn().mockResolvedValue(null), put: vi.fn() };

    const result = await optimizeOne(
      client,
      {
        id: "backrooms-1",
        image:
          "https://csfzm0ozakaiii5u.public.blob.vercel-storage.com/cineprint/raindrop/1779301125.png",
      },
      { dryRun: true },
    );

    expect(result.kind).toBe("would-upload");
    expect(client.put).not.toHaveBeenCalled();
  });
});
