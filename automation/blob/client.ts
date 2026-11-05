import { BlobNotFoundError, del, head, put } from "@vercel/blob";

export interface BlobClientOptions {
  oidcToken?: string;
  storeId?: string;
  readWriteToken?: string;
}

export interface BlobPutResult {
  url: string;
  pathname: string;
}

export class BlobAuthError extends Error {}

type BlobAuth = { token: string } | { oidcToken: string; storeId: string };

export class BlobClient {
  private readonly auth: BlobAuth;

  constructor(options: BlobClientOptions) {
    const readWriteToken = options.readWriteToken?.trim();
    const oidcToken = options.oidcToken?.trim();
    const storeId = options.storeId?.trim();

    if (readWriteToken) {
      this.auth = { token: readWriteToken };
    } else {
      if (!oidcToken) {
        throw new BlobAuthError("VERCEL_OIDC_TOKEN is required");
      }
      if (!storeId) {
        throw new BlobAuthError("BLOB_STORE_ID is required");
      }
      this.auth = { oidcToken, storeId };
    }
  }

  private commandOptions(): BlobAuth {
    return this.auth;
  }

  async put(pathname: string, buffer: Buffer, contentType: string): Promise<BlobPutResult> {
    const result = await put(pathname, buffer, {
      access: "public",
      contentType,
      // Explicit long cache for new uploads. Applies only to objects written
      // after this change. Staleness note: pathnames are deterministic, not
      // content-addressed, so replacing artwork at the same path serves stale
      // bytes until TTL expiry. Replacements must mint a versioned path.
      cacheControlMaxAge: 31536000,
      // Preserve the deterministic pathname contract. The SDK default is
      // suffix-free, but pin it so a server default flip cannot silently fork
      // URLs and break head() dedup.
      addRandomSuffix: false,
      ...this.commandOptions(),
    });

    return { url: result.url, pathname: result.pathname };
  }

  async head(pathname: string): Promise<BlobPutResult | null> {
    try {
      const result = await head(pathname, this.commandOptions());

      return { url: result.url, pathname: result.pathname };
    } catch (error) {
      if (error instanceof BlobNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async delete(pathnameOrUrl: string): Promise<void> {
    await del(pathnameOrUrl, this.commandOptions());
  }
}
