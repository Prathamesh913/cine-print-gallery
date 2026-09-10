import dotenv from "dotenv";

export interface BlobCredentials {
  oidcToken: string;
  storeId: string;
  readWriteToken: string;
}

export function loadBlobEnv() {
  dotenv.config({ path: ".env" });
  dotenv.config({ path: ".env.local" });
  dotenv.config({ path: ".env.vercel" });
}

export function getBlobCredentials(): BlobCredentials {
  loadBlobEnv();
  return {
    oidcToken: process.env.VERCEL_OIDC_TOKEN?.trim() ?? "",
    storeId: process.env.BLOB_STORE_ID?.trim() ?? "",
    readWriteToken: process.env.BLOB_READ_WRITE_TOKEN?.trim() ?? "",
  };
}
