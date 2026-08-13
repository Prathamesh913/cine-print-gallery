import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { Client } from "@notionhq/client";
import { initAdmin, imageUrlsFromProp } from "../scripts/sync-notion-to-firestore.js";
import { BlobClient } from "./blob/client";
import { downloadImage, type DownloadedImage } from "./blob/download";
import { getBlobCredentials } from "./blob/env";

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export interface ExternalRecord {
  id: string;
  title: string;
  year: number | null;
  mediaType: string | null;
  slug: string | null;
  tmdbId: string | null;
  notionPageId: string | null;
  image: string;
  posterImageUrl: string | null;
  status: string | null;
}

export interface ExternalAuditEntry extends ExternalRecord {
  finalUrl: string | null;
  contentType: string | null;
  bytes: number | null;
  width: number | null;
  height: number | null;
  format: string | null;
  aspectRatio: number | null;
  sourceUrlDuplicateIds: string[];
  identicalContentIds: string[];
  imagePosition: number | null;
  notionImageUrls: string[];
  notionPageTitle: string | null;
  hasOtherImages: boolean;
  originalPath: string | null;
  optimizedPath: string | null;
  originalBlobExists: boolean;
  optimizedBlobExists: boolean;
  proposedAction: "UPLOAD" | "REUSE" | "MANUAL REVIEW";
  status: "SAFE" | "MANUAL REVIEW";
  reason?: string;
  contentHash: string | null;
}

export function isPbsImageUrl(url: string): boolean {
  try {
    return new URL(url).hostname === "pbs.twimg.com";
  } catch {
    return false;
  }
}

export function externalPathsFor(documentId: string, contentType: string) {
  const extension = SUPPORTED_EXTENSIONS[contentType];
  if (!extension || !documentId) return null;
  return {
    original: `cineprint/external/${documentId}.${extension}`,
    optimized: `cineprint/optimized/external/${documentId}.webp`,
  };
}

export function exactUrlPositions(urls: string[], target: string): number[] {
  return urls.reduce<number[]>((positions, url, index) => {
    if (url === target) positions.push(index);
    return positions;
  }, []);
}

export function duplicateGroups(values: Array<{ key: string; id: string }>) {
  const grouped = new Map<string, string[]>();
  for (const value of values) {
    const ids = grouped.get(value.key) ?? [];
    ids.push(value.id);
    grouped.set(value.key, ids);
  }
  return [...grouped.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

export interface ExternalAuditServices {
  download(url: string): Promise<DownloadedImage>;
  inspect(buffer: Buffer): Promise<{ width: number; height: number; format: string }>;
  retrievePage(pageId: string): Promise<{ properties: Record<string, unknown> }>;
  head(pathname: string): Promise<{ url: string; pathname: string } | null>;
}

export async function auditExternalRecords(
  records: ExternalRecord[],
  services: ExternalAuditServices,
): Promise<ExternalAuditEntry[]> {
  const entries: ExternalAuditEntry[] = [];

  for (const record of records) {
    const base: ExternalAuditEntry = {
      ...record,
      finalUrl: null,
      contentType: null,
      bytes: null,
      width: null,
      height: null,
      format: null,
      aspectRatio: null,
      sourceUrlDuplicateIds: [],
      identicalContentIds: [],
      imagePosition: null,
      notionImageUrls: [],
      notionPageTitle: null,
      hasOtherImages: false,
      originalPath: null,
      optimizedPath: null,
      originalBlobExists: false,
      optimizedBlobExists: false,
      proposedAction: "MANUAL REVIEW",
      status: "MANUAL REVIEW",
      contentHash: null,
    };

    try {
      const downloaded = await services.download(record.image);
      const dimensions = await services.inspect(downloaded.buffer);
      base.finalUrl = downloaded.finalUrl;
      base.contentType = downloaded.contentType;
      base.bytes = downloaded.buffer.length;
      base.width = dimensions.width;
      base.height = dimensions.height;
      base.format = dimensions.format;
      base.aspectRatio = dimensions.height ? dimensions.width / dimensions.height : null;
      base.contentHash = crypto.createHash("sha256").update(downloaded.buffer).digest("hex");
      const paths = externalPathsFor(record.id, downloaded.contentType);

      if (!paths) {
        base.reason = `unsupported content type: ${downloaded.contentType}`;
        entries.push(base);
        continue;
      }

      base.originalPath = paths.original;
      base.optimizedPath = paths.optimized;
      const [originalBlob, optimizedBlob] = await Promise.all([
        services.head(paths.original),
        services.head(paths.optimized),
      ]);
      base.originalBlobExists = Boolean(originalBlob);
      base.optimizedBlobExists = Boolean(optimizedBlob);

      if (!record.notionPageId) {
        base.reason = "missing notionPageId";
        entries.push(base);
        continue;
      }

      let page: { properties: Record<string, unknown> };
      try {
        page = await services.retrievePage(record.notionPageId);
      } catch {
        base.reason = "Notion page not found";
        entries.push(base);
        continue;
      }
      const imageProperty = page.properties["Image URL"];
      base.notionImageUrls = imageUrlsFromProp(imageProperty);
      base.hasOtherImages = base.notionImageUrls.length > 1;
      const titleProperty = page.properties.Name as
        | { title?: Array<{ plain_text?: string }> }
        | undefined;
      base.notionPageTitle = titleProperty?.title?.[0]?.plain_text ?? null;
      const positions = exactUrlPositions(base.notionImageUrls, record.image);

      if (positions.length !== 1) {
        base.reason =
          positions.length === 0
            ? "target URL is missing from the Notion Image URL property"
            : "target URL appears more than once in the Notion Image URL property";
        entries.push(base);
        continue;
      }

      base.imagePosition = positions[0];
      base.proposedAction =
        base.optimizedBlobExists || base.originalBlobExists ? "REUSE" : "UPLOAD";
      base.status = "SAFE";
    } catch (error) {
      base.reason = error instanceof Error ? error.message : String(error);
    }

    entries.push(base);
  }

  const sourceDuplicates = duplicateGroups(
    entries.map((entry) => ({ key: entry.image, id: entry.id })),
  );
  const contentDuplicates = duplicateGroups(
    entries
      .filter((entry) => entry.contentHash)
      .map((entry) => ({ key: entry.contentHash!, id: entry.id })),
  );

  for (const entry of entries) {
    const sourceDuplicate = sourceDuplicates.find((group) => group.ids.includes(entry.id));
    const contentDuplicate = contentDuplicates.find((group) => group.ids.includes(entry.id));
    entry.sourceUrlDuplicateIds = sourceDuplicate?.ids.filter((id) => id !== entry.id) ?? [];
    entry.identicalContentIds = contentDuplicate?.ids.filter((id) => id !== entry.id) ?? [];

    if (entry.sourceUrlDuplicateIds.length || entry.identicalContentIds.length) {
      entry.status = "MANUAL REVIEW";
      entry.proposedAction = "MANUAL REVIEW";
      entry.reason =
        "same source URL or identical image content appears on another Firebase document";
    }
  }

  const pathDuplicates = duplicateGroups(
    entries
      .filter((entry) => entry.originalPath)
      .map((entry) => ({ key: entry.originalPath!, id: entry.id })),
  );
  for (const entry of entries) {
    if (pathDuplicates.some((group) => group.ids.includes(entry.id))) {
      entry.status = "MANUAL REVIEW";
      entry.proposedAction = "MANUAL REVIEW";
      entry.reason = "proposed Blob path is shared by multiple Firebase documents";
    }
  }

  return entries;
}

async function main() {
  const db = initAdmin();
  const snap = await db.collection("posters").get();
  const records = snap.docs
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
    })
    .filter((record) => isPbsImageUrl(record.image));

  const notion = new Client({ auth: process.env.NOTION_KEY ?? "" });
  const { oidcToken, storeId } = getBlobCredentials();
  const blob = new BlobClient({ oidcToken, storeId });
  const entries = await auditExternalRecords(records, {
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
    retrievePage: async (pageId) => {
      const page = await notion.pages.retrieve({ page_id: pageId });
      return { properties: (page as { properties: Record<string, unknown> }).properties };
    },
    head: (pathname) => blob.head(pathname),
  });

  const counts = {
    safe: entries.filter((entry) => entry.status === "SAFE").length,
    manual: entries.filter((entry) => entry.status === "MANUAL REVIEW").length,
    downloadFailures: entries.filter(
      (entry) =>
        entry.reason?.includes("image download") || entry.reason?.includes("unsupported content"),
    ).length,
  };
  const pages = new Map<string, ExternalAuditEntry[]>();
  for (const entry of entries) {
    if (!pages.has(entry.notionPageId ?? entry.id)) pages.set(entry.notionPageId ?? entry.id, []);
    pages.get(entry.notionPageId ?? entry.id)!.push(entry);
  }

  console.log("External Image Migration Audit");
  console.log("===============================");
  console.log("");
  console.log(`Total external posters: ${entries.length}`);
  console.log(`Safe: ${counts.safe}`);
  console.log(`Already migrated: ${entries.filter((entry) => entry.optimizedBlobExists).length}`);
  console.log(`Needs review: ${counts.manual}`);
  console.log(`Download failures: ${counts.downloadFailures}`);
  console.log(
    `Duplicate/conflict cases: ${entries.filter((entry) => entry.sourceUrlDuplicateIds.length || entry.identicalContentIds.length).length}`,
  );
  console.log("");

  for (const [pageId, group] of pages) {
    const pageTitle = group[0].notionPageTitle ?? group[0].title;
    console.log(`${pageTitle}`);
    console.log(`Page: ${pageId}`);
    for (const entry of group) {
      console.log(`  Firebase ID: ${entry.id}`);
      console.log(`  Title: ${entry.title}`);
      console.log(`  Year: ${entry.year ?? "N/A"}`);
      console.log(`  Media Type: ${entry.mediaType ?? "N/A"}`);
      console.log(`  Slug: ${entry.slug ?? "N/A"}`);
      console.log(`  TMDB ID: ${entry.tmdbId ?? "N/A"}`);
      console.log(`  Current URL: ${entry.image}`);
      console.log(`  Final URL: ${entry.finalUrl ?? "N/A"}`);
      console.log(
        `  URL position: ${entry.imagePosition === null ? "N/A" : entry.imagePosition + 1}`,
      );
      console.log(`  Other page images: ${entry.hasOtherImages ? "yes" : "no"}`);
      console.log(`  Format: ${entry.format ?? "N/A"}`);
      console.log(
        `  Size: ${entry.bytes === null ? "N/A" : `${entry.bytes} bytes (${(entry.bytes / 1024).toFixed(1)} KB)`}`,
      );
      console.log(`  Dimensions: ${entry.width ?? "N/A"}x${entry.height ?? "N/A"}`);
      console.log(`  Aspect ratio: ${entry.aspectRatio?.toFixed(4) ?? "N/A"}`);
      console.log(`  Original path: ${entry.originalPath ?? "N/A"}`);
      console.log(`  Optimized path: ${entry.optimizedPath ?? "N/A"}`);
      console.log(`  Original Blob exists: ${entry.originalBlobExists}`);
      console.log(`  Optimized Blob exists: ${entry.optimizedBlobExists}`);
      console.log(`  Action: ${entry.proposedAction}`);
      console.log(`  Status: ${entry.status}${entry.reason ? ` (${entry.reason})` : ""}`);
      if (entry.sourceUrlDuplicateIds.length)
        console.log(`  Shared URL with: ${entry.sourceUrlDuplicateIds.join(", ")}`);
      if (entry.identicalContentIds.length)
        console.log(`  Identical content with: ${entry.identicalContentIds.join(", ")}`);
      console.log("");
    }
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((error) => {
    console.error(
      `External audit failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
