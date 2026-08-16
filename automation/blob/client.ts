import { BlobNotFoundError, del, head, put } from "@vercel/blob";

export interface BlobClientOptions {
  oidcToken: string;
  storeId: string;
}

export interface BlobPutResult {
  url: string;
  pathname: string;
}

export class BlobAuthError extends Error {}

export class BlobClient {
  private readonly oidcToken: string;
  private readonly storeId: string;

  constructor(options: BlobClientOptions) {
    if (!options.oidcToken) {
      throw new BlobAuthError("VERCEL_OIDC_TOKEN is required");
    }
    if (!options.storeId) {
      throw new BlobAuthError("BLOB_STORE_ID is required");
    }
    this.oidcToken = options.oidcToken;
    this.storeId = options.storeId;
  }

  async put(pathname: string, buffer: Buffer, contentType: string): Promise<BlobPutResult> {
    const result = await put(pathname, buffer, {
      access: "public",
      contentType,
      oidcToken: this.oidcToken,
      storeId: this.storeId,
    });

    return { url: result.url, pathname: result.pathname };
  }

  async head(pathname: string): Promise<BlobPutResult | null> {
    try {
      const result = await head(pathname, {
        oidcToken: this.oidcToken,
        storeId: this.storeId,
      });

      return { url: result.url, pathname: result.pathname };
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async delete(pathnameOrUrl: string): Promise<void> {
    await del(pathnameOrUrl, {
      oidcToken: this.oidcToken,
      storeId: this.storeId,
    });
  }
}
