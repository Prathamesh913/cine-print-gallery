import { BlobClient } from "./client";
import type { UploadImageInput, UploadImageResult } from "./types";
import { SUPPORTED_CONTENT_TYPES } from "./types";

const PATH_PREFIX = "cineprint/raindrop";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export class ImageUploadError extends Error {}

export function blobPathnameFor(raindropId: string, contentType: string): string | null {
  const extension = EXTENSION_BY_CONTENT_TYPE[contentType];

  if (!extension || !raindropId) {
    return null;
  }

  return `${PATH_PREFIX}/${raindropId}.${extension}`;
}

export function validateImageInput(input: UploadImageInput): string | null {
  if (!input.raindropId) {
    return "raindropId is required";
  }

  if (!input.buffer || input.buffer.length === 0) {
    return "buffer must be a non-empty image buffer";
  }

  if (
    !SUPPORTED_CONTENT_TYPES.includes(input.contentType as (typeof SUPPORTED_CONTENT_TYPES)[number])
  ) {
    return `unsupported content type: ${input.contentType}`;
  }

  return null;
}

export class ImageUploader {
  constructor(private readonly client: BlobClient) {}

  async uploadImage(input: UploadImageInput): Promise<UploadImageResult> {
    const validationError = validateImageInput(input);

    if (validationError) {
      throw new ImageUploadError(validationError);
    }

    const pathname = input.pathname || blobPathnameFor(input.raindropId, input.contentType);

    if (!pathname) {
      throw new ImageUploadError("could not derive a blob pathname");
    }

    return this.client.put(pathname, input.buffer, input.contentType);
  }
}
