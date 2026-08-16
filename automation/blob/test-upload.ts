import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { BlobClient } from "./client";
import { getBlobCredentials } from "./env";
import { ImageUploader } from "./upload";

const TEST_PATHNAME = "cineprint/test/blob-test.png";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, "fixtures", "test-image.png");

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

async function verifyPublicAccess(url: string) {
  const response = await fetch(url);
  const contentType = response.headers.get("content-type") ?? "";
  const body = Buffer.from(await response.arrayBuffer());
  const isPng = body.subarray(0, 4).equals(PNG_SIGNATURE);

  return {
    ok: response.ok,
    contentType,
    isImage: contentType.startsWith("image/"),
    isHtml: contentType.includes("text/html"),
    hasContent: body.length > 0,
    isPng,
  };
}

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

  const buffer = fs.readFileSync(fixturePath);
  const uploader = new ImageUploader(new BlobClient({ oidcToken, storeId }));

  const result = await uploader.uploadImage({
    buffer,
    raindropId: "blob-test",
    contentType: "image/png",
    pathname: TEST_PATHNAME,
  });

  console.log("✓ Blob upload successful");
  console.log("");
  console.log("URL:");
  console.log(result.url);
  console.log("");
  console.log("Pathname:");
  console.log(result.pathname);
  console.log("");

  const check = await verifyPublicAccess(result.url);

  console.log("Public access check:");
  console.log(`- HTTP status: ${check.ok ? "OK" : "FAILED"}`);
  console.log(`- Content-Type: ${check.contentType}`);
  console.log(`- Is image: ${check.isImage}`);
  console.log(`- Is HTML: ${check.isHtml}`);
  console.log(`- Body bytes: ${check.hasContent ? "non-zero" : "EMPTY"}`);
  console.log(`- PNG signature: ${check.isPng ? "present" : "missing"}`);

  if (!check.ok || !check.isImage || check.isHtml || !check.hasContent || !check.isPng) {
    console.error("✗ Public access verification failed");
    process.exitCode = 1;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Blob upload test failed: ${message}`);
  process.exitCode = 1;
});
