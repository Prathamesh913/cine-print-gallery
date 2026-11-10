import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ImagePreparationError, prepareImage } from "./image";
import type { DownloadedSourceImage } from "./download";

const PNG = fs.readFileSync(path.resolve(__dirname, "../blob/fixtures/test-image.png"));
const OPTIMIZER = { name: "sharp", version: "0.35.3", libvipsVersion: "8.18.3" };

function downloaded(buffer = PNG): DownloadedSourceImage {
  return {
    buffer,
    contentType: "image/png",
    finalUrl: "https://example.com/a.png",
    sha256: "a".repeat(64),
    sizeBytes: buffer.length,
  };
}

describe("image preparation", () => {
  it("produces a WebP optimized asset and hashes both variants", async () => {
    const prepared = await prepareImage(downloaded(), { optimizer: OPTIMIZER });

    expect(prepared.original.sha256).toBe("a".repeat(64));
    expect(prepared.original.extension).toBe("png");
    expect(prepared.optimized.contentType).toBe("image/webp");
    expect(prepared.optimized.buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(prepared.optimized.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(prepared.sourceWidth).toBeGreaterThan(0);
    expect(prepared.sourceHeight).toBeGreaterThan(0);
  });

  it("rejects a buffer that cannot be decoded", async () => {
    await expect(
      prepareImage(
        {
          ...downloaded(Buffer.from("not an image at all")),
          contentType: "image/png",
        },
        { optimizer: OPTIMIZER },
      ),
    ).rejects.toBeInstanceOf(ImagePreparationError);
  });

  it("rejects an empty buffer", async () => {
    await expect(
      prepareImage(
        {
          ...downloaded(Buffer.alloc(0)),
          sha256: "a".repeat(64),
          sizeBytes: 0,
        },
        { optimizer: OPTIMIZER },
      ),
    ).rejects.toBeInstanceOf(ImagePreparationError);
  });
});
