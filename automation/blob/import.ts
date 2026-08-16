import { BlobClient } from "./client";
import { downloadImage } from "./download";
import { blobPathnameFor } from "./upload";

export type ImageSourceKind = "raindrop" | "external";

export type ImportImageStatus = "uploaded" | "reused" | "would-upload";

export interface ImportImageInput {
  raindropId: string;
  imageUrl: string;
  sourceKind: ImageSourceKind;
  raindropToken?: string;
}

export interface ImportImageResult {
  url: string;
  pathname: string;
  status: ImportImageStatus;
}

export interface ImportImageOptions {
  dryRun?: boolean;
}

export class ImageImportError extends Error {}

export class BlobImageImporter {
  constructor(private readonly client: BlobClient) {}

  async importImage(
    input: ImportImageInput,
    options: ImportImageOptions = {},
  ): Promise<ImportImageResult> {
    const downloaded = await downloadImage(input.imageUrl, {
      authToken: input.sourceKind === "raindrop" ? input.raindropToken : undefined,
    });

    const pathname = blobPathnameFor(input.raindropId, downloaded.contentType);

    if (!pathname) {
      throw new ImageImportError(`could not derive a blob pathname for ${downloaded.contentType}`);
    }

    const existing = await this.client.head(pathname);

    if (existing) {
      return { url: existing.url, pathname, status: "reused" };
    }

    if (options.dryRun) {
      return { url: input.imageUrl, pathname, status: "would-upload" };
    }

    const uploaded = await this.client.put(pathname, downloaded.buffer, downloaded.contentType);

    return { url: uploaded.url, pathname: uploaded.pathname, status: "uploaded" };
  }
}
