import path from "path";
import { fileURLToPath } from "url";
import { initAdmin } from "../scripts/sync-notion-to-firestore.js";
import { BlobClient } from "./blob/client";
import { downloadImage } from "./blob/download";
import { getBlobCredentials } from "./blob/env";
import {
  optimizeImage,
  DEFAULT_OPTIMIZE_WIDTH,
  DEFAULT_WEBP_QUALITY,
  isWebpBuffer,
} from "./blob/optimize";
import { optimizedPathFor, optimizedUrlFor } from "./blob/optimized-path";

const dryRun = process.argv.includes("--dry-run");

export interface BlobPoster {
  id: string;
  image: string;
}

export type OptimizeOutcome =
  | {
      kind: "uploaded" | "reused" | "would-upload";
      id: string;
      path: string;
      url: string;
      originalBytes: number;
      optimizedBytes: number;
      width: number;
      height: number;
    }
  | { kind: "failed"; id: string; reason: string };

async function verifyOptimizedUrl(url: string, expectedWidth: number, expectedHeight: number) {
  const downloaded = await downloadImage(url);
  if (downloaded.contentType !== "image/webp" || !isWebpBuffer(downloaded.buffer)) {
    throw new Error("optimized URL did not return a valid WebP");
  }

  const metadata = await import("sharp").then(({ default: sharp }) =>
    sharp(downloaded.buffer).metadata(),
  );
  if (metadata.width !== expectedWidth || metadata.height !== expectedHeight) {
    throw new Error(
      `optimized dimensions mismatch (expected ${expectedWidth}x${expectedHeight}, got ${metadata.width}x${metadata.height})`,
    );
  }

  return { bytes: downloaded.buffer.length, width: metadata.width, height: metadata.height };
}

export async function optimizeOne(
  client: Pick<BlobClient, "head" | "put">,
  poster: BlobPoster,
  options: { dryRun?: boolean } = {},
): Promise<OptimizeOutcome> {
  const path = optimizedPathFor(poster.id, poster.image);

  if (!path) {
    return { kind: "failed", id: poster.id, reason: "unsupported Blob pathname" };
  }

  try {
    const original = await downloadImage(poster.image);
    const optimized = await optimizeImage(original.buffer, {
      maxWidth: DEFAULT_OPTIMIZE_WIDTH,
      quality: DEFAULT_WEBP_QUALITY,
    });
    const existing = await client.head(path);

    if (existing) {
      const verified = await verifyOptimizedUrl(existing.url, optimized.width, optimized.height);
      return {
        kind: "reused",
        id: poster.id,
        path,
        url: existing.url,
        originalBytes: original.buffer.length,
        optimizedBytes: verified.bytes,
        width: verified.width,
        height: verified.height,
      };
    }

    if (options.dryRun ?? dryRun) {
      const url = optimizedUrlFor(poster.id, poster.image);
      if (!url) {
        return { kind: "failed", id: poster.id, reason: "could not derive optimized URL" };
      }
      return {
        kind: "would-upload",
        id: poster.id,
        path,
        url,
        originalBytes: original.buffer.length,
        optimizedBytes: optimized.buffer.length,
        width: optimized.width,
        height: optimized.height,
      };
    }

    const uploaded = await client.put(path, optimized.buffer, optimized.contentType);
    const verified = await verifyOptimizedUrl(uploaded.url, optimized.width, optimized.height);

    return {
      kind: "uploaded",
      id: poster.id,
      path,
      url: uploaded.url,
      originalBytes: original.buffer.length,
      optimizedBytes: verified.bytes,
      width: verified.width,
      height: verified.height,
    };
  } catch (error) {
    return {
      kind: "failed",
      id: poster.id,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function main() {
  const db = initAdmin();
  const snap = await db.collection("posters").get();
  const posters = snap.docs
    .map((doc) => ({ id: doc.id, image: String(doc.data().image ?? "") }))
    .filter((poster) => optimizedPathFor(poster.id, poster.image));
  const { oidcToken, storeId } = getBlobCredentials();
  const client = new BlobClient({ oidcToken, storeId });

  console.log(
    `${dryRun ? "Mode: dry-run (no Blob uploads, no Firebase writes)" : "Mode: live (Blob uploads only; no Firebase writes)"}`,
  );
  console.log(`Blob images selected: ${posters.length}`);
  console.log(
    `Settings: max width ${DEFAULT_OPTIMIZE_WIDTH}px, WebP quality ${DEFAULT_WEBP_QUALITY}`,
  );
  console.log("");

  const outcomes: OptimizeOutcome[] = [];
  for (const poster of posters) {
    const outcome = await optimizeOne(client, poster);
    outcomes.push(outcome);

    if (outcome.kind === "failed") {
      console.log(`✗ ${outcome.id}: ${outcome.reason}`);
      continue;
    }

    console.log(
      `✓ ${outcome.id} ${outcome.kind.toUpperCase()} ${outcome.path} ${(outcome.originalBytes / 1024 / 1024).toFixed(2)}MB → ${(outcome.optimizedBytes / 1024).toFixed(0)}KB ${outcome.width}x${outcome.height}`,
    );
  }

  const uploaded = outcomes.filter((outcome) => outcome.kind === "uploaded").length;
  const reused = outcomes.filter((outcome) => outcome.kind === "reused").length;
  const wouldUpload = outcomes.filter((outcome) => outcome.kind === "would-upload").length;
  const failed = outcomes.filter((outcome) => outcome.kind === "failed").length;
  const valid = outcomes.filter((outcome) => outcome.kind !== "failed");
  const originalBytes = valid.reduce((sum, outcome) => sum + outcome.originalBytes, 0);
  const optimizedBytes = valid.reduce((sum, outcome) => sum + outcome.optimizedBytes, 0);

  console.log("");
  console.log(
    `Summary: selected ${posters.length}, uploaded ${uploaded}, reused ${reused}, would-upload ${wouldUpload}, failed ${failed}`,
  );
  console.log(`Original total: ${(originalBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log(`Optimized total: ${(optimizedBytes / 1024 / 1024).toFixed(1)} MB`);
  if (originalBytes > 0) {
    console.log(
      `Reduction: ${(((originalBytes - optimizedBytes) / originalBytes) * 100).toFixed(1)}%`,
    );
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main().catch((error) => {
    console.error(`Optimization failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
