export const SUPPORTED_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type SupportedContentType = (typeof SUPPORTED_CONTENT_TYPES)[number];

export interface UploadImageInput {
  buffer: Buffer;
  raindropId: string;
  contentType: string;
  pathname?: string;
}

export interface UploadImageResult {
  url: string;
  pathname: string;
}
