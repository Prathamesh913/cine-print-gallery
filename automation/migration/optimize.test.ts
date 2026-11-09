import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { optimizeImage } from "../blob/optimize";

const WIDTH = 20;
const HEIGHT = 40;

function makeRawHalfImage(): Buffer {
  const channels = 3;
  const raw = Buffer.alloc(WIDTH * HEIGHT * channels);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const index = (y * WIDTH + x) * channels;
      const isTop = y < HEIGHT / 2;
      raw[index] = isTop ? 255 : 0;
      raw[index + 1] = 0;
      raw[index + 2] = isTop ? 0 : 255;
    }
  }
  return raw;
}

async function makeJpeg(orientation: number): Promise<Buffer> {
  return sharp(makeRawHalfImage(), {
    raw: { width: WIDTH, height: HEIGHT, channels: 3 },
  })
    .jpeg({ quality: 100 })
    .withMetadata({ orientation })
    .toBuffer();
}

async function pixel(buffer: Buffer, x: number, y: number): Promise<[number, number, number]> {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const index = (y * info.width + x) * info.channels;
  return [data[index], data[index + 1], data[index + 2]];
}

function expectRed(pixelValue: [number, number, number]) {
  expect(pixelValue[0]).toBeGreaterThan(180);
  expect(pixelValue[2]).toBeLessThan(80);
}

function expectBlue(pixelValue: [number, number, number]) {
  expect(pixelValue[2]).toBeGreaterThan(180);
  expect(pixelValue[0]).toBeLessThan(80);
}

describe("F6 — EXIF orientation", () => {
  it("keeps orientation 1 unchanged", async () => {
    const output = await optimizeImage(await makeJpeg(1), { maxWidth: 100 });
    expect(output.width).toBe(WIDTH);
    expect(output.height).toBe(HEIGHT);
    expect(output.sourceWidth).toBe(WIDTH);
    expect(output.sourceHeight).toBe(HEIGHT);
    expectRed(await pixel(output.buffer, 2, 2));
    expectBlue(await pixel(output.buffer, 2, HEIGHT - 3));
  });

  it("rotates orientation 3 by 180 degrees", async () => {
    const output = await optimizeImage(await makeJpeg(3), { maxWidth: 100 });
    expect(output.width).toBe(WIDTH);
    expect(output.height).toBe(HEIGHT);
    expectBlue(await pixel(output.buffer, 2, 2));
    expectRed(await pixel(output.buffer, 2, HEIGHT - 3));
  });

  it("rotates orientation 6 by 90 degrees clockwise and swaps dimensions", async () => {
    const output = await optimizeImage(await makeJpeg(6), { maxWidth: 100 });
    expect(output.width).toBe(HEIGHT);
    expect(output.height).toBe(WIDTH);
    expect(output.sourceWidth).toBe(HEIGHT);
    expect(output.sourceHeight).toBe(WIDTH);
    expectBlue(await pixel(output.buffer, 2, 2));
    expectRed(await pixel(output.buffer, HEIGHT - 3, 2));
  });

  it("rotates orientation 8 by 90 degrees counter-clockwise and swaps dimensions", async () => {
    const output = await optimizeImage(await makeJpeg(8), { maxWidth: 100 });
    expect(output.width).toBe(HEIGHT);
    expect(output.height).toBe(WIDTH);
    expect(output.sourceWidth).toBe(HEIGHT);
    expect(output.sourceHeight).toBe(WIDTH);
    expectRed(await pixel(output.buffer, 2, 2));
    expectBlue(await pixel(output.buffer, HEIGHT - 3, 2));
  });
});
