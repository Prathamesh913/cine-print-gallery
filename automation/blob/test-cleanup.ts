import { BlobClient } from "./client";
import { getBlobCredentials } from "./env";

const TEST_PATHNAME = "cineprint/test/blob-test.png";

async function main() {
  const { oidcToken, storeId } = getBlobCredentials();

  if (!oidcToken) {
    console.error("VERCEL_OIDC_TOKEN is missing");
    process.exitCode = 1;
    return;
  }

  if (!storeId) {
    console.error("BLOB_STORE_ID is missing");
    process.exitCode = 1;
    return;
  }

  await new BlobClient({ oidcToken, storeId }).delete(TEST_PATHNAME);

  console.log("✓ Blob test object deleted");
  console.log("");
  console.log("Pathname:");
  console.log(TEST_PATHNAME);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Blob cleanup failed: ${message}`);
  process.exitCode = 1;
});
