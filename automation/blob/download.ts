import { SUPPORTED_CONTENT_TYPES } from "./types";

export interface DownloadedImage {
  buffer: Buffer;
  contentType: string;
}

export interface DownloadOptions {
  authToken?: string;
}

export class ImageDownloadError extends Error {}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const GIF_SIGNATURE = Buffer.from("GIF8");

function hasImageSignature(buffer: Buffer, contentType: string): boolean {
  if (contentType === "image/png") {
    return buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  }
  if (contentType === "image/jpeg") {
    return buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE);
  }
  if (contentType === "image/gif") {
    return buffer.subarray(0, GIF_SIGNATURE.length).equals(GIF_SIGNATURE);
  }
  if (contentType === "image/webp") {
    return (
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

export function raindropFileDownloadUrl(url: string): string | null {
  const match = /^https:\/\/api\.raindrop\.io\/v2\/raindrop\/(\d+)\/file/.exec(url);

  return match ? `https://api.raindrop.io/rest/v1/raindrop/${match[1]}/file` : null;
}

export function raindropIdFromUrl(url: string): string | null {
  const match = /\/raindrop\/(\d+)/.exec(url);

  return match ? match[1] : null;
}

export async function downloadImage(
  url: string,
  options: DownloadOptions = {},
): Promise<DownloadedImage> {
  const downloadUrl = raindropFileDownloadUrl(url) ?? url;

  const response = await fetch(downloadUrl, {
    headers: options.authToken ? { Authorization: `Bearer ${options.authToken}` } : undefined,
  });

  if (!response.ok) {
    throw new ImageDownloadError(`image download failed (${response.status})`);
  }

  const contentType = (response.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();

  if (!SUPPORTED_CONTENT_TYPES.includes(contentType as (typeof SUPPORTED_CONTENT_TYPES)[number])) {
    throw new ImageDownloadError(`unsupported content type: ${contentType}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (buffer.length === 0) {
    throw new ImageDownloadError("image response body is empty");
  }

  if (!hasImageSignature(buffer, contentType)) {
    throw new ImageDownloadError("image response body does not match its content type");
  }

  return { buffer, contentType };
}
