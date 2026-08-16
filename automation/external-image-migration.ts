import path from "path";
import { fileURLToPath } from "url";
import { Client } from "@notionhq/client";
import { initAdmin, imageUrlsFromProp } from "../scripts/sync-notion-to-firestore.js";
import { BlobClient } from "./blob/client";
import { downloadImage } from "./blob/download";
import { getBlobCredentials } from "./blob/env";
import { optimizeImage, isWebpBuffer } from "./blob/optimize";
import { externalPathsFor } from "./external-image-audit";
import { auditExternalRecords, isPbsImageUrl, type ExternalRecord } from "./external-image-audit";

export const EXTERNAL_TARGET_IDS = [
  "bugonia",
  "cure-1997",
  "everything-everywhere-all-at-once",
  "frankenstein-2025",
  "her",
  "lady-vengeance",
  "midsommar",
  "mother-2009",
  "mother-2017",
  "mullholland-drive",
  "obsession-2025",
  "parasite",
  "project-hail-mary",
  "stranger-things-2",
  "tenet",
  "the-mummy-1999",
  "the-shape-of-water",
  "the-substance-2",
  "the-way-of-seeing-life",
] as const;

export interface PageWriter {
  retrievePage(pageId: string): Promise<{ properties: Record<string, unknown> }>;
  updatePage(pageId: string, properties: Record<string, unknown>): Promise<void>;
}

export function isExternalBlobUrlFor(documentId: string, url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.hostname.endsWith(".public.blob.vercel-storage.com") &&
      parsed.pathname.startsWith(`/cineprint/external/${documentId}.`)
    );
  } catch {
    return false;
  }
}

export function buildExternalImageProperty(prop: unknown, urls: string[]) {
  if ((prop as { type?: string } | null)?.type === "rich_text") {
    return { rich_text: [{ text: { content: urls.join("\n") } }] };
  }
  return { url: urls.join(", ") };
}

export function replaceExternalUrlAt(
  urls: string[],
  position: number,
  oldUrl: string,
  newUrl: string,
) {
  const next = [...urls];
  if (next[position] === oldUrl) next[position] = newUrl;
  return next;
}

async function verifyPublicImage(url: string, expectedType: string) {
  const image = await downloadImage(url);
  if (image.contentType !== expectedType) {
    throw new Error(`unexpected public image type: ${image.contentType}`);
  }
  return image;
}

async function ensureOriginal(
  blob: BlobClient,
  doc: ExternalRecord,
  image: Awaited<ReturnType<typeof downloadImage>>,
  dryRun: boolean,
) {
  const paths = externalPathsFor(doc.id, image.contentType);
  if (!paths) throw new Error(`unsupported source content type: ${image.contentType}`);

  const existing = await blob.head(paths.original);
  if (existing) {
    await verifyPublicImage(existing.url, image.contentType);
    return { url: existing.url, pathname: paths.original, action: "REUSED" as const };
  }

  if (dryRun) {
    const base = new URL(doc.image);
    return {
      url: `${base.protocol}//${base.host}/${paths.original}`,
      pathname: paths.original,
      action: "UPLOAD" as const,
    };
  }

  const uploaded = await blob.put(paths.original, image.buffer, image.contentType);
  await verifyPublicImage(uploaded.url, image.contentType);
  return { url: uploaded.url, pathname: paths.original, action: "UPLOAD" as const };
}

async function ensureOptimized(
  blob: BlobClient,
  doc: ExternalRecord,
  image: Buffer,
  contentType: string,
  dryRun: boolean,
) {
  const paths = externalPathsFor(doc.id, contentType);
  if (!paths) throw new Error("could not derive optimized path");
  const existing = await blob.head(paths.optimized);

  if (existing) {
    const verified = await verifyPublicImage(existing.url, "image/webp");
    if (!isWebpBuffer(verified.buffer)) throw new Error("existing optimized asset is not WebP");
    return { url: existing.url, pathname: paths.optimized, action: "REUSED" as const };
  }

  const optimized = await optimizeImage(image);
  if (dryRun) {
    const base = new URL(doc.image);
    return {
      url: `${base.protocol}//${base.host}/${paths.optimized}`,
      pathname: paths.optimized,
      action: "UPLOAD" as const,
    };
  }

  const uploaded = await blob.put(paths.optimized, optimized.buffer, optimized.contentType);
  const verified = await verifyPublicImage(uploaded.url, "image/webp");
  if (!isWebpBuffer(verified.buffer)) throw new Error("uploaded optimized asset is not WebP");
  return { url: uploaded.url, pathname: paths.optimized, action: "UPLOAD" as const };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = initAdmin();
  const snap = await db.collection("posters").get();
  const targetSet = new Set(EXTERNAL_TARGET_IDS);
  const docs = snap.docs
    .filter((doc) => targetSet.has(doc.id))
    .map((doc) => {
      const data = doc.data();
      return {
        id: doc.id,
        title: String(data.title ?? "Untitled"),
        year: typeof data.year === "number" ? data.year : null,
        mediaType: data.mediaType ?? null,
        slug: data.slug ?? null,
        tmdbId: data.tmdbId ?? null,
        notionPageId: data.notionPageId ?? null,
        image: String(data.image ?? ""),
        posterImageUrl: data.posterImageUrl ?? null,
        status: data.status ?? null,
      } satisfies ExternalRecord;
    });

  if (docs.length !== EXTERNAL_TARGET_IDS.length) {
    throw new Error(
      `expected ${EXTERNAL_TARGET_IDS.length} target documents, found ${docs.length}`,
    );
  }

  const notion = new Client({ auth: process.env.NOTION_KEY ?? "" });
  const { oidcToken, storeId } = getBlobCredentials();
  const blob = new BlobClient({ oidcToken, storeId });
  const pages: PageWriter = {
    retrievePage: async (pageId) => {
      const page = await notion.pages.retrieve({ page_id: pageId });
      return { properties: (page as { properties: Record<string, unknown> }).properties };
    },
    updatePage: async (pageId, properties) => {
      await notion.pages.update({ page_id: pageId, properties });
    },
  };

  const audited = await auditExternalRecords(docs, {
    download: (url) => downloadImage(url),
    inspect: async (buffer) => {
      const sharp = (await import("sharp")).default;
      const metadata = await sharp(buffer).metadata();
      return {
        width: metadata.width ?? 0,
        height: metadata.height ?? 0,
        format: metadata.format ?? "unknown",
      };
    },
    retrievePage: pages.retrievePage,
    head: (pathname) => blob.head(pathname),
  });

  if (audited.some((entry) => entry.status !== "SAFE")) {
    throw new Error("audit did not produce 19 safe mappings; refusing to write");
  }

  const replacementByPage = new Map<string, typeof audited>();
  for (const entry of audited) {
    if (!replacementByPage.has(entry.notionPageId!)) replacementByPage.set(entry.notionPageId!, []);
    replacementByPage.get(entry.notionPageId!)!.push(entry);
  }

  const pageResults: Array<{ pageId: string; action: string; reason?: string }> = [];
  let originalUploaded = 0;
  let originalReused = 0;
  let optimizedUploaded = 0;
  let optimizedReused = 0;

  for (const [pageId, entries] of replacementByPage) {
    try {
      const currentPage = await pages.retrievePage(pageId);
      const currentUrls = imageUrlsFromProp(currentPage.properties["Image URL"]);
      const auditedUrls = entries[0].notionImageUrls;
      if (currentUrls.length !== auditedUrls.length)
        throw new Error("STALE AUDIT: URL count changed");
      if (entries.some((entry) => currentUrls[entry.imagePosition!] !== entry.image)) {
        throw new Error("STALE AUDIT: target URL changed");
      }

      const replacements = new Map<number, string>();
      for (const entry of entries) {
        const image = await downloadImage(entry.image);
        const original = await ensureOriginal(blob, entry, image, dryRun);
        const optimized = await ensureOptimized(
          blob,
          entry,
          image.buffer,
          image.contentType,
          dryRun,
        );
        replacements.set(entry.imagePosition!, original.url);
        if (original.action === "UPLOAD") originalUploaded += 1;
        else originalReused += 1;
        if (optimized.action === "UPLOAD") optimizedUploaded += 1;
        else optimizedReused += 1;
      }

      const after = [...currentUrls];
      for (const [position, url] of replacements) after[position] = url;
      const changed = after.some((url, index) => url !== currentUrls[index]);

      if (!changed) {
        pageResults.push({ pageId, action: "ALREADY MIGRATED" });
        continue;
      }

      if (!dryRun) {
        await pages.updatePage(pageId, {
          "Image URL": buildExternalImageProperty(currentPage.properties["Image URL"], after),
        });
        const verifiedPage = await pages.retrievePage(pageId);
        const verifiedUrls = imageUrlsFromProp(verifiedPage.properties["Image URL"]);
        if (
          verifiedUrls.length !== currentUrls.length ||
          verifiedUrls.some((url, index) => url !== after[index])
        ) {
          throw new Error("post-write Notion verification failed");
        }
      }

      pageResults.push({ pageId, action: dryRun ? "WOULD UPDATE" : "UPDATED" });
    } catch (error) {
      pageResults.push({
        pageId,
        action: "FAILED",
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  console.log(`Mode: ${dryRun ? "dry-run (no writes)" : "live"}`);
  console.log(`Target records: ${docs.length}`);
  console.log(`Pages: ${replacementByPage.size}`);
  for (const result of pageResults) {
    console.log(`${result.action}: ${result.pageId}${result.reason ? ` — ${result.reason}` : ""}`);
  }
  console.log(`Original Blob uploaded: ${originalUploaded}`);
  console.log(`Original Blob reused: ${originalReused}`);
  console.log(`Optimized Blob uploaded: ${optimizedUploaded}`);
  console.log(`Optimized Blob reused: ${optimizedReused}`);
  console.log(`Notion pages updated: ${pageResults.filter((r) => r.action === "UPDATED").length}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(
      `External migration failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
