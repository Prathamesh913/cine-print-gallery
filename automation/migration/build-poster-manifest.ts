import "dotenv/config";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { Client as NotionClient } from "@notionhq/client";
import { initializeApp } from "firebase/app";
import { collection, getDocs, getFirestore } from "firebase/firestore";
import { head, list } from "@vercel/blob";
import { parsePage, computeConflicts } from "../../scripts/sync-notion-to-firestore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(ROOT, "migration");
const MANIFEST_PATH = path.join(OUT_DIR, "poster-manifest.json");
const REPORT_PATH = path.join(OUT_DIR, "poster-manifest-report.md");
const SNAPSHOT_PATH = path.join(OUT_DIR, "firestore-identities.json");

const RAINDROP_API = "https://api.raindrop.io/rest/v1";
const CONCURRENCY = 5;

type FirestoreDoc = {
  id: string;
  data: Record<string, unknown>;
};

type NotionPage = {
  id: string;
  properties: Record<string, unknown>;
};

type RaindropBookmark = {
  _id: number;
  title?: string;
  link?: string;
  note?: string;
  tags?: string[];
  file?: { type?: string; size?: number; name?: string };
  collectionId?: number;
  type?: string;
};

type ParsedPoster = {
  id: string;
  notionPageId: string;
  image: string;
  raindropId: string | null;
  title: string;
  status: string;
};

type SourceProvider = "raindrop-file" | "pbs-twimg" | "unknown";
type IdentityConfidence = "high" | "medium" | "low" | "none";

type ManifestEntry = {
  cineprintPosterId: string;
  notionPageId: string;
  notionTitle: string;
  notionDerivedId: string | null;
  identityReconciled: boolean;
  raindropId: string | null;
  raindropCollectionId: number | null;
  raindropBookmarkTitle: string | null;
  raindropBookmarkTags: string[];
  sourcePageUrl: string | null;
  sourceProvider: SourceProvider;
  sourceImageUrl: string | null;
  sourceAvailability: "available" | "unavailable" | "unknown";
  sourceHttpStatus: number | null;
  sourceMimeType: string | null;
  sourceDimensions: { width: number; height: number } | null;
  sourceSizeBytes: number | null;
  sourceSha256: string | null;
  sourceMatchesExistingOriginal: boolean | null;
  sourceExistingOriginalSizeDelta: number | null;
  currentImageUrl: string;
  currentImageProvider: "vercel-blob" | "external" | "unknown";
  currentImageObjectKey: string | null;
  originalR2Key: string | null;
  optimizedR2Key: string | null;
  existingOriginalObject: {
    path: string | null;
    exists: boolean;
    sizeBytes: number | null;
    mimeType: string | null;
  };
  existingOptimizedObject: {
    path: string | null;
    exists: boolean;
    sizeBytes: number | null;
    mimeType: string | null;
  };
  optimizedAction: "reuse-existing" | "regenerate";
  optimizedCurrentlyUnused: boolean;
  identityMatchMethod: string;
  identityConfidence: IdentityConfidence;
  migrationStatus:
    | "READY_TO_COPY"
    | "READY_WITH_REVIEW"
    | "SOURCE_UNAVAILABLE"
    | "INVALID_OR_MISSING";
  verificationNotes: string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extensionForMime(mime: string | null): string {
  switch ((mime ?? "").toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function raindropIdFromFileUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /\/v\d+\/raindrop\/(\d+)\/file/.exec(value);
  return match ? match[1] : null;
}

function pbsMediaId(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /pbs\.twimg\.com\/media\/([A-Za-z0-9_-]+)/.exec(value);
  return match ? match[1] : null;
}

function raindropIdFromBlobKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const url = parseUrl(value);
  if (!url) return null;
  const match = /^\/cineprint\/raindrop\/(\d+)\./.exec(url.pathname);
  return match ? match[1] : null;
}

function blobPathFromUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const url = parseUrl(value);
  if (!url) return null;
  if (!url.hostname.endsWith(".public.blob.vercel-storage.com")) return null;
  return url.pathname.replace(/^\//, "");
}

function providerForUrl(value: string | null | undefined): "vercel-blob" | "external" | "unknown" {
  const url = parseUrl(value ?? "");
  if (!url) return "unknown";
  if (url.hostname.endsWith(".public.blob.vercel-storage.com")) return "vercel-blob";
  if (url.protocol === "http:" || url.protocol === "https:") return "external";
  return "unknown";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(60_000),
        redirect: "follow",
      });
      if (response.status === 429 || response.status >= 500) {
        if (attempt < attempts) {
          await sleep(500 * attempt * attempt);
          continue;
        }
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(500 * attempt * attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function loadFirestoreDocs(): Promise<FirestoreDoc[]> {
  const app = initializeApp({
    apiKey: requireEnv("FIREBASE_API_KEY"),
    authDomain: requireEnv("FIREBASE_AUTH_DOMAIN"),
    projectId: requireEnv("FIREBASE_PROJECT_ID"),
    storageBucket: requireEnv("FIREBASE_STORAGE_BUCKET"),
    messagingSenderId: requireEnv("FIREBASE_MESSAGING_SENDER_ID"),
    appId: requireEnv("FIREBASE_APP_ID"),
  });
  const snap = await getDocs(collection(getFirestore(app), "posters"));
  return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }));
}

async function loadNotionPages(): Promise<{ pages: NotionPage[]; databaseId: string; dataSourceId: string }> {
  const notion = new NotionClient({ auth: requireEnv("NOTION_KEY") });
  const databaseId = requireEnv("NOTION_DATABASE_ID");
  const database = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = database.data_sources?.[0]?.id;
  if (!dataSourceId) throw new Error("Notion database has no data source");

  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.dataSources.query({
      data_source_id: dataSourceId,
      start_cursor: cursor,
      page_size: 100,
    });
    pages.push(
      ...response.results.map((page) => ({
        id: page.id,
        properties: (page as { properties: Record<string, unknown> }).properties,
      })),
    );
    cursor = response.has_more ? response.next_cursor ?? undefined : undefined;
  } while (cursor);

  return { pages, databaseId, dataSourceId };
}

async function loadRaindropBookmarks(): Promise<RaindropBookmark[]> {
  const token = requireEnv("RAINDROP_ACCESS_TOKEN");
  const bookmarks: RaindropBookmark[] = [];
  let page = 0;
  while (true) {
    const url = new URL(`${RAINDROP_API}/raindrops/0`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("perpage", "50");
    const response = await fetchWithRetry(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      throw new Error(`Raindrop list failed with HTTP ${response.status}`);
    }
    const json = (await response.json()) as { items?: RaindropBookmark[] };
    const items = json.items ?? [];
    bookmarks.push(...items);
    if (items.length < 50) break;
    page += 1;
  }
  return bookmarks;
}

async function loadBlobObjects(): Promise<Map<string, { size: number; mimeType: string | null }>> {
  const token = requireEnv("BLOB_READ_WRITE_TOKEN");
  const response = await list({ token, limit: 1000 });
  const map = new Map<string, { size: number; mimeType: string | null }>();
  for (const blob of response.blobs) {
    map.set(blob.pathname, { size: blob.size, mimeType: null });
  }

  const paths = [...map.keys()];
  let index = 0;
  async function worker() {
    while (index < paths.length) {
      const pathname = paths[index++];
      try {
        const metadata = await head(pathname, { token });
        map.set(pathname, {
          size: metadata.size,
          mimeType: metadata.contentType ?? null,
        });
      } catch {
        // Metadata failure does not invalidate the object's existence.
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return map;
}

function chooseSource(
  doc: FirestoreDoc,
  page: NotionPage | undefined,
  bookmarkById: Map<string, RaindropBookmark>,
  bookmarkByPbs: Map<string, RaindropBookmark>,
): {
  raindropId: string | null;
  bookmark: RaindropBookmark | null;
  method: string;
  confidence: IdentityConfidence;
  notes: string[];
} {
  const data = doc.data;
  const notes: string[] = [];
  const currentImage = String(data.image ?? "");
  const pageProps = page?.properties ?? {};
  const notionRidRaw = pageProps["Raindrop ID"];
  const notionRid =
    (notionRidRaw as { rich_text?: Array<{ plain_text?: string }> } | undefined)?.rich_text
      ?.map((part) => part.plain_text ?? "")
      .join("")
      .trim() || null;
  const posterUrl = String((pageProps["Poster Image URL"] as { url?: string } | undefined)?.url ?? "");
  const imageUrlProp = String((pageProps["Image URL"] as { url?: string } | undefined)?.url ?? "");
  const imageUrls = imageUrlProp.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
  const multiImage = imageUrls.length > 1;

  const firestoreRid = String(data.raindropId ?? data.artworkId ?? "").trim() || null;
  if (firestoreRid) {
    return {
      raindropId: firestoreRid,
      bookmark: bookmarkById.get(firestoreRid) ?? null,
      method: "firestore_raindrop_id",
      confidence: "high",
      notes,
    };
  }

  if (notionRid) {
    return {
      raindropId: notionRid,
      bookmark: bookmarkById.get(notionRid) ?? null,
      method: "notion_raindrop_id",
      confidence: "high",
      notes,
    };
  }

  if (!multiImage) {
    const posterRid = raindropIdFromFileUrl(posterUrl);
    if (posterRid) {
      return {
        raindropId: posterRid,
        bookmark: bookmarkById.get(posterRid) ?? null,
        method: "poster_image_raindrop",
        confidence: "high",
        notes: ["Matched via Notion Poster Image URL (Raindrop file URL)."],
      };
    }

    const mediaId = pbsMediaId(posterUrl);
    if (mediaId) {
      const bookmark = bookmarkByPbs.get(mediaId) ?? null;
      if (bookmark) {
        return {
          raindropId: String(bookmark._id),
          bookmark,
          method: "poster_image_pbs",
          confidence: "high",
          notes: ["Matched via Notion Poster Image URL (pbs media ID) to Raindrop bookmark link."],
        };
      }
      notes.push(`No Raindrop bookmark found for pbs media ID ${mediaId}.`);
    }

    const blobRid = raindropIdFromBlobKey(currentImage);
    if (blobRid) {
      return {
        raindropId: blobRid,
        bookmark: bookmarkById.get(blobRid) ?? null,
        method: "blob_path_raindrop",
        confidence: "high",
        notes: ["Matched via current Blob path /cineprint/raindrop/<id>.<ext>."],
      };
    }

    return { raindropId: null, bookmark: null, method: "unmatched", confidence: "none", notes };
  }

  const blobRid = raindropIdFromBlobKey(currentImage);
  if (blobRid) {
    return {
      raindropId: blobRid,
      bookmark: bookmarkById.get(blobRid) ?? null,
      method: "blob_path_raindrop_multi",
      confidence: "high",
      notes: ["Multi-image page; matched per-poster via current Blob path."],
    };
  }

  const mediaId = pbsMediaId(posterUrl);
  if (mediaId) {
    const bookmark = bookmarkByPbs.get(mediaId) ?? null;
    if (bookmark) {
      const posterTitle = String(data.title ?? "");
      const bookmarkTags = bookmark.tags ?? [];
      const mediaTag = bookmarkTags.find((tag) => /^(movie|show):/i.test(tag));
      const bookmarkTitle = mediaTag ? mediaTag.replace(/^(movie|show):/i, "").split("|")[0] : "";
      const titleMatches =
        Boolean(posterTitle) &&
        Boolean(bookmarkTitle) &&
        normalizeTitle(posterTitle) === normalizeTitle(bookmarkTitle);
      return {
        raindropId: String(bookmark._id),
        bookmark,
        method: "poster_image_pbs_multi_external",
        confidence: titleMatches ? "medium" : "low",
        notes: [
          "Multi-image page with an external image; matched via page-level Poster Image URL (pbs) and external Blob key.",
          titleMatches
            ? `Bookmark movie/show tag matches poster title "${posterTitle}".`
            : `Bookmark movie/show tag does not confirm poster title "${posterTitle}".`,
        ],
      };
    }
  }

  return {
    raindropId: null,
    bookmark: null,
    method: "unmatched",
    confidence: "none",
    notes: [...notes, "Multi-image external poster could not be matched to a Raindrop bookmark."],
  };
}

function deriveR2Keys(
  doc: FirestoreDoc,
  raindropId: string | null,
  sourceMime: string | null,
  sourceProvider: SourceProvider,
): { originalKey: string | null; optimizedKey: string | null; notes: string[] } {
  const notes: string[] = [];
  const currentImage = String(doc.data.image ?? "");
  const currentBlobKey = blobPathFromUrl(currentImage);
  const extension = extensionForMime(sourceMime);

  let originalKey: string | null = null;
  if (currentBlobKey && /^cineprint\/(raindrop|external)\//.test(currentBlobKey)) {
    originalKey = currentBlobKey;
  } else if (sourceProvider === "raindrop-file" && raindropId) {
    originalKey = `cineprint/raindrop/${raindropId}.${extension}`;
    notes.push("Original key derived from source MIME because the current image is not a recognized Blob key.");
  } else {
    originalKey = `cineprint/external/${doc.id}.${extension}`;
    notes.push("Original key derived as an external asset because no Raindrop file key is available.");
  }

  let optimizedKey: string | null = null;
  if (doc.id.startsWith("artwork-") && raindropId) {
    optimizedKey = `cineprint/optimized/${raindropId}.webp`;
  } else if (currentBlobKey?.startsWith("cineprint/external/") || sourceProvider === "pbs-twimg") {
    optimizedKey = `cineprint/optimized/external/${doc.id}.webp`;
  } else {
    optimizedKey = `cineprint/optimized/legacy/${doc.id}.webp`;
  }

  return { originalKey, optimizedKey, notes };
}

async function inspectSource(
  url: string,
  provider: SourceProvider,
  raindropToken: string,
): Promise<{
  availability: "available" | "unavailable" | "unknown";
  httpStatus: number | null;
  mimeType: string | null;
  dimensions: { width: number; height: number } | null;
  sizeBytes: number | null;
  sha256: string | null;
  error: string | null;
}> {
  try {
    const headers: Record<string, string> = {};
    if (provider === "raindrop-file") headers.Authorization = `Bearer ${raindropToken}`;
    if (provider === "pbs-twimg") headers["User-Agent"] = "Mozilla/5.0";

    const response = await fetchWithRetry(url, { headers });
    if (!response.ok) {
      return {
        availability: "unavailable",
        httpStatus: response.status,
        mimeType: null,
        dimensions: null,
        sizeBytes: null,
        sha256: null,
        error: `HTTP ${response.status}`,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return {
        availability: "unavailable",
        httpStatus: response.status,
        mimeType: null,
        dimensions: null,
        sizeBytes: 0,
        sha256: null,
        error: "Empty response body",
      };
    }

    const headerMime = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    let dimensions: { width: number; height: number } | null = null;
    let formatMime: string | null = null;
    try {
      const metadata = await sharp(buffer).metadata();
      if (metadata.width && metadata.height) {
        dimensions = { width: metadata.width, height: metadata.height };
      }
      if (metadata.format) {
        formatMime = `image/${metadata.format === "jpg" ? "jpeg" : metadata.format}`;
      }
    } catch {
      // Keep header MIME if sharp cannot parse the image.
    }

    return {
      availability: "available",
      httpStatus: response.status,
      mimeType: headerMime.startsWith("image/") ? headerMime : formatMime,
      dimensions,
      sizeBytes: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      error: null,
    };
  } catch (error) {
    return {
      availability: "unknown",
      httpStatus: null,
      mimeType: null,
      dimensions: null,
      sizeBytes: null,
      sha256: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function duplicateGroups(values: Array<{ key: string; id: string }>): Array<{ key: string; ids: string[] }> {
  const groups = new Map<string, string[]>();
  for (const value of values) {
    if (!value.key) continue;
    const ids = groups.get(value.key) ?? [];
    ids.push(value.id);
    groups.set(value.key, ids);
  }
  return [...groups.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, ids]) => ({ key, ids }));
}

async function main() {
  const startedAt = new Date().toISOString();
  const [firestoreDocs, notionData, raindropBookmarks, blobObjects] = await Promise.all([
    loadFirestoreDocs(),
    loadNotionPages(),
    loadRaindropBookmarks(),
    loadBlobObjects(),
  ]);

  console.log(`Firestore documents: ${firestoreDocs.length}`);
  console.log(`Notion pages: ${notionData.pages.length}`);
  console.log(`Raindrop bookmarks: ${raindropBookmarks.length}`);
  console.log(`Blob objects: ${blobObjects.size}`);

  const parsedPosters = notionData.pages.flatMap((page) => parsePage(page)) as ParsedPoster[];
  const { uniquePosters, conflicts } = computeConflicts(parsedPosters as never[]) as {
    uniquePosters: ParsedPoster[];
    conflicts: Array<{ id: string; notionPageIds: string[] }>;
  };

  const pagesById = new Map(notionData.pages.map((page) => [page.id, page]));
  const parsedById = new Map(uniquePosters.map((poster) => [poster.id, poster]));
  const bookmarkById = new Map(raindropBookmarks.map((bookmark) => [String(bookmark._id), bookmark]));
  const bookmarkByPbs = new Map<string, RaindropBookmark>();
  for (const bookmark of raindropBookmarks) {
    const mediaId = pbsMediaId(bookmark.link);
    if (mediaId) bookmarkByPbs.set(mediaId, bookmark);
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Notion generated ${conflicts.length} duplicate Firestore ID(s): ${conflicts
        .map((conflict) => conflict.id)
        .join(", ")}`,
    );
  }

  const firestoreIds = new Set(firestoreDocs.map((doc) => doc.id));
  const parsedIds = new Set(uniquePosters.map((poster) => poster.id));
  const missingFromNotion = [...firestoreIds].filter((id) => !parsedIds.has(id));
  const missingFromFirestore = [...parsedIds].filter((id) => !firestoreIds.has(id));
  if (missingFromNotion.length || missingFromFirestore.length) {
    throw new Error(
      `Firestore/Notion identity reconciliation failed. Missing from Notion: ${missingFromNotion.join(", ") || "none"}; missing from Firestore: ${missingFromFirestore.join(", ") || "none"}`,
    );
  }

  const raindropToken = requireEnv("RAINDROP_ACCESS_TOKEN");
  const entries: ManifestEntry[] = [];

  for (let index = 0; index < firestoreDocs.length; index++) {
    const doc = firestoreDocs[index];
    const notionPageId = String(doc.data.notionPageId ?? "").trim();
    const page = pagesById.get(notionPageId);
    if (!page) {
      throw new Error(`Firestore document ${doc.id} has no matching Notion page (${notionPageId})`);
    }

    const parsed = parsedById.get(doc.id) ?? null;
    const match = chooseSource(doc, page, bookmarkById, bookmarkByPbs);
    const bookmark = match.bookmark;
    const provider: SourceProvider = bookmark
      ? bookmark.file?.type
        ? "raindrop-file"
        : pbsMediaId(bookmark.link)
          ? "pbs-twimg"
          : "unknown"
      : "unknown";

    let sourceImageUrl: string | null = null;
    if (bookmark) {
      sourceImageUrl =
        provider === "raindrop-file"
          ? `${RAINDROP_API}/raindrop/${bookmark._id}/file`
          : provider === "pbs-twimg"
            ? bookmark.link ?? null
            : null;
    }

    const inspection = sourceImageUrl
      ? await inspectSource(sourceImageUrl, provider, raindropToken)
      : {
          availability: "unknown" as const,
          httpStatus: null,
          mimeType: null,
          dimensions: null,
          sizeBytes: null,
          sha256: null,
          error: "No source URL",
        };

    const keyDerivation = deriveR2Keys(doc, match.raindropId, inspection.mimeType, provider);
    const originalKey = keyDerivation.originalKey;
    const optimizedKey = keyDerivation.optimizedKey;
    const existingOriginal = originalKey ? blobObjects.get(originalKey) : undefined;
    const existingOptimized = optimizedKey ? blobObjects.get(optimizedKey) : undefined;
    const optimizedCurrentlyUnused =
      Boolean(optimizedKey?.startsWith("cineprint/optimized/external/")) &&
      Boolean(existingOptimized);

    const sourceMatchesExistingOriginal =
      inspection.sizeBytes !== null &&
      existingOriginal?.size !== undefined &&
      inspection.sizeBytes === existingOriginal.size &&
      (inspection.mimeType ?? "") === (existingOriginal.mimeType ?? "");
    const sourceExistingOriginalSizeDelta =
      inspection.sizeBytes !== null && existingOriginal?.size !== undefined
        ? inspection.sizeBytes - existingOriginal.size
        : null;

    const notes = [...match.notes, ...keyDerivation.notes];
    if (provider === "unknown") notes.push("Source provider could not be determined.");
    if (!bookmark) notes.push("No Raindrop bookmark matched.");
    if (inspection.error) notes.push(`Source inspection: ${inspection.error}.`);
    if (sourceMatchesExistingOriginal) {
      notes.push(
        `Source size and MIME match the existing Blob original exactly (${inspection.sizeBytes} bytes, ${inspection.mimeType}).`,
      );
    } else if (sourceExistingOriginalSizeDelta !== null) {
      notes.push(
        `Source size differs from the existing Blob original by ${sourceExistingOriginalSizeDelta} bytes.`,
      );
    }
    if (existingOptimized) {
      notes.push(`Optimized Blob object exists at ${optimizedKey}.`);
    } else if (optimizedKey) {
      notes.push(`Optimized Blob object is missing; regenerate from the source.`);
    }
    if (optimizedCurrentlyUnused) {
      notes.push("Optimized external object exists but the current resolver does not use it.");
    }
    if (parsed && parsed.notionPageId !== notionPageId) {
      notes.push(`Notion-derived page ID ${parsed.notionPageId} differs from Firestore notionPageId ${notionPageId}.`);
    }

    let identityConfidence = match.confidence;
    if (
      identityConfidence === "low" &&
      match.method === "poster_image_pbs_multi_external" &&
      sourceMatchesExistingOriginal
    ) {
      identityConfidence = "medium";
      notes.push(
        "Multi-image external match raised to medium confidence because the source size and MIME match the existing Blob original exactly.",
      );
    }

    let migrationStatus: ManifestEntry["migrationStatus"];
    if (inspection.availability !== "available" || !sourceImageUrl) {
      migrationStatus = "SOURCE_UNAVAILABLE";
    } else if (identityConfidence === "medium" || identityConfidence === "low") {
      migrationStatus = "READY_WITH_REVIEW";
    } else if (identityConfidence === "none" || !originalKey || !optimizedKey) {
      migrationStatus = "INVALID_OR_MISSING";
    } else {
      migrationStatus = "READY_TO_COPY";
    }

    entries.push({
      cineprintPosterId: doc.id,
      notionPageId,
      notionTitle: parsed?.title ?? String(doc.data.title ?? ""),
      notionDerivedId: parsed?.id ?? null,
      identityReconciled: parsed?.id === doc.id,
      raindropId: match.raindropId,
      raindropCollectionId: bookmark?.collectionId ?? null,
      raindropBookmarkTitle: bookmark?.title ?? null,
      raindropBookmarkTags: bookmark?.tags ?? [],
      sourcePageUrl: bookmark?.note?.trim() ? bookmark.note.trim() : null,
      sourceProvider: provider,
      sourceImageUrl,
      sourceAvailability: inspection.availability,
      sourceHttpStatus: inspection.httpStatus,
      sourceMimeType: inspection.mimeType,
      sourceDimensions: inspection.dimensions,
      sourceSizeBytes: inspection.sizeBytes,
      sourceSha256: inspection.sha256,
      sourceMatchesExistingOriginal,
      sourceExistingOriginalSizeDelta,
      currentImageUrl: String(doc.data.image ?? ""),
      currentImageProvider: providerForUrl(String(doc.data.image ?? "")),
      currentImageObjectKey: blobPathFromUrl(String(doc.data.image ?? "")),
      originalR2Key: originalKey,
      optimizedR2Key: optimizedKey,
      existingOriginalObject: {
        path: originalKey,
        exists: Boolean(existingOriginal),
        sizeBytes: existingOriginal?.size ?? null,
        mimeType: existingOriginal?.mimeType ?? null,
      },
      existingOptimizedObject: {
        path: optimizedKey,
        exists: Boolean(existingOptimized),
        sizeBytes: existingOptimized?.size ?? null,
        mimeType: existingOptimized?.mimeType ?? null,
      },
      optimizedAction: existingOptimized ? "reuse-existing" : "regenerate",
      optimizedCurrentlyUnused,
      identityMatchMethod: match.method,
      identityConfidence,
      migrationStatus,
      verificationNotes: notes.join(" "),
    });

    if ((index + 1) % 10 === 0) {
      console.log(`Inspected ${index + 1}/${firestoreDocs.length} posters`);
    }
  }

  entries.sort((a, b) => (a.cineprintPosterId < b.cineprintPosterId ? -1 : 1));

  const identityMethods: Record<string, number> = {};
  const sourceProviders = { "raindrop-file": 0, "pbs-twimg": 0, unknown: 0 };
  const confidenceCounts = { high: 0, medium: 0, low: 0, none: 0 };
  const statusCounts: Record<string, number> = {};
  for (const entry of entries) {
    identityMethods[entry.identityMatchMethod] = (identityMethods[entry.identityMatchMethod] ?? 0) + 1;
    sourceProviders[entry.sourceProvider] += 1;
    confidenceCounts[entry.identityConfidence] += 1;
    statusCounts[entry.migrationStatus] = (statusCounts[entry.migrationStatus] ?? 0) + 1;
  }

  const duplicateSourceUrls = duplicateGroups(
    entries.map((entry) => ({ key: entry.sourceImageUrl ?? "", id: entry.cineprintPosterId })),
  );
  const duplicateRaindropIds = duplicateGroups(
    entries.map((entry) => ({ key: entry.raindropId ?? "", id: entry.cineprintPosterId })),
  );
  const duplicateOriginalKeys = duplicateGroups(
    entries.map((entry) => ({ key: entry.originalR2Key ?? "", id: entry.cineprintPosterId })),
  );
  const duplicateOptimizedKeys = duplicateGroups(
    entries.map((entry) => ({ key: entry.optimizedR2Key ?? "", id: entry.cineprintPosterId })),
  );
  const duplicateCurrentImageUrls = duplicateGroups(
    entries.map((entry) => ({ key: entry.currentImageUrl, id: entry.cineprintPosterId })),
  );

  const multiImagePages = notionData.pages
    .map((page) => {
      const imageUrlProp = String((page.properties["Image URL"] as { url?: string } | undefined)?.url ?? "");
      const imageUrls = imageUrlProp.split(/[\n,]+/).map((value) => value.trim()).filter(Boolean);
      if (imageUrls.length <= 1) return null;
      const pagePosters = entries.filter((entry) => entry.notionPageId === page.id);
      const posterUrl = String((page.properties["Poster Image URL"] as { url?: string } | undefined)?.url ?? "");
      return {
        notionPageId: page.id,
        notionTitle: pagePosters[0]?.notionTitle ?? "",
        imageCount: imageUrls.length,
        posterIds: pagePosters.map((entry) => entry.cineprintPosterId),
        posterImageUrlProvider: pbsMediaId(posterUrl)
          ? "pbs-twimg"
          : raindropIdFromFileUrl(posterUrl)
            ? "raindrop-file"
            : posterUrl
              ? "other"
              : "none",
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  const optimizedMissing = entries.filter((entry) => entry.optimizedAction === "regenerate");
  const optimizedExisting = entries.filter((entry) => entry.optimizedAction === "reuse-existing");
  const unusedExternal = entries.filter((entry) => entry.optimizedCurrentlyUnused);
  const sourceSizeMatches = entries.filter((entry) => entry.sourceMatchesExistingOriginal === true);
  const sourceSizeMismatches = entries.filter((entry) => entry.sourceMatchesExistingOriginal === false);

  const ambiguities = entries
    .filter((entry) => entry.identityConfidence !== "high" || entry.migrationStatus !== "READY_TO_COPY")
    .map((entry) => ({
      cineprintPosterId: entry.cineprintPosterId,
      notionPageId: entry.notionPageId,
      raindropId: entry.raindropId,
      identityMatchMethod: entry.identityMatchMethod,
      identityConfidence: entry.identityConfidence,
      migrationStatus: entry.migrationStatus,
      reason: entry.verificationNotes,
    }));

  const sourceAvailable = entries.filter((entry) => entry.sourceAvailability === "available").length;
  const sourceUnavailable = entries.length - sourceAvailable;
  const identityCoverage = `${entries.filter((entry) => entry.identityReconciled).length}/${entries.length}`;
  const sourceCoverage = `${sourceAvailable}/${entries.length}`;

  const firestoreById = new Map(firestoreDocs.map((doc) => [doc.id, doc]));
  const manifestIds = entries.map((entry) => entry.cineprintPosterId);
  const firestoreIdsList = firestoreDocs.map((doc) => doc.id);
  const missingFromManifest = firestoreIdsList.filter((id) => !manifestIds.includes(id));
  const extraInManifest = manifestIds.filter((id) => !firestoreIdsList.includes(id));
  const notionPageIdMismatches = entries
    .filter((entry) => entry.notionPageId !== String(firestoreById.get(entry.cineprintPosterId)?.data.notionPageId ?? ""))
    .map((entry) => entry.cineprintPosterId);
  const currentImageUrlMismatches = entries
    .filter((entry) => entry.currentImageUrl !== String(firestoreById.get(entry.cineprintPosterId)?.data.image ?? ""))
    .map((entry) => entry.cineprintPosterId);
  const notionDerivedIdMismatches = entries
    .filter((entry) => entry.notionDerivedId !== entry.cineprintPosterId)
    .map((entry) => entry.cineprintPosterId);
  const dryRunValidation = {
    manifestEntries: entries.length,
    firestoreDocuments: firestoreDocs.length,
    idsMatch:
      missingFromManifest.length === 0 &&
      extraInManifest.length === 0 &&
      manifestIds.length === firestoreIdsList.length,
    missingFromManifest,
    extraInManifest,
    notionPageIdMismatches,
    currentImageUrlMismatches,
    notionDerivedIdMismatches,
    sourceAvailable,
    sourceUnavailable,
    optimizedExisting: entries.filter((entry) => entry.optimizedAction === "reuse-existing").length,
    optimizedMissing: entries.filter((entry) => entry.optimizedAction === "regenerate").length,
    checks: {
      exactly63Entries: entries.length === 63,
      exactly63FirestoreDocuments: firestoreDocs.length === 63,
      allFirestoreIdsPreserved: missingFromManifest.length === 0 && extraInManifest.length === 0,
      allNotionPageIdsMatch: notionPageIdMismatches.length === 0,
      allCurrentImageUrlsMatch: currentImageUrlMismatches.length === 0,
      allNotionDerivedIdsMatch: notionDerivedIdMismatches.length === 0,
      allSourcesAvailable: sourceAvailable === entries.length,
      allSourcesHaveSha256: entries.every((entry) => Boolean(entry.sourceSha256)),
      allSourcesHaveDimensions: entries.every((entry) => Boolean(entry.sourceDimensions)),
      allOriginalKeysPresent: entries.every((entry) => Boolean(entry.originalR2Key)),
      allOptimizedKeysPresent: entries.every((entry) => Boolean(entry.optimizedR2Key)),
      noDuplicateSourceUrls: duplicateSourceUrls.length === 0,
      noDuplicateRaindropIds: duplicateRaindropIds.length === 0,
    },
  };

  function optimizedKind(entry: ManifestEntry): "legacy" | "external" | "artwork" {
    if (entry.optimizedR2Key?.startsWith("cineprint/optimized/legacy/")) return "legacy";
    if (entry.optimizedR2Key?.startsWith("cineprint/optimized/external/")) return "external";
    return "artwork";
  }

  const optimizedByKind = { legacy: 0, external: 0, artwork: 0 };
  const optimizedExistingByKind = { legacy: 0, external: 0, artwork: 0 };
  const optimizedMissingByKind = { legacy: 0, external: 0, artwork: 0 };
  for (const entry of entries) {
    const kind = optimizedKind(entry);
    optimizedByKind[kind] += 1;
    if (entry.optimizedAction === "reuse-existing") optimizedExistingByKind[kind] += 1;
    else optimizedMissingByKind[kind] += 1;
  }

  const manifest = {
    schemaVersion: 1,
    generatedAt: startedAt,
    baselineCommit: "ec5401c",
    sourceCommit: execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim(),
    source: {
      firestoreCollection: "posters",
      notionDatabaseId: notionData.databaseId,
      notionDataSourceId: notionData.dataSourceId,
      raindropEndpoint: `${RAINDROP_API}/raindrops/0`,
      blobProvider: "vercel-blob",
    },
    target: {
      provider: "cloudflare-r2",
      bucket: "cineprint-posters",
      publicBaseUrl: "https://images.cineprint.click",
    },
    counts: {
      firestoreDocuments: firestoreDocs.length,
      notionPages: notionData.pages.length,
      notionPosters: uniquePosters.length,
      manifestEntries: entries.length,
      sourceAvailable,
      sourceUnavailable,
      highConfidence: confidenceCounts.high,
      mediumConfidence: confidenceCounts.medium,
      lowConfidence: confidenceCounts.low,
      noneConfidence: confidenceCounts.none,
      optimizedExisting: optimizedExisting.length,
      optimizedMissing: optimizedMissing.length,
      unusedExternalOptimized: unusedExternal.length,
      sourceSizeMatchesExistingOriginal: sourceSizeMatches.length,
      sourceSizeMismatchesExistingOriginal: sourceSizeMismatches.length,
    },
    coverage: {
      identity: identityCoverage,
      source: sourceCoverage,
      firestoreIdsPreserved: `${entries.filter((entry) => firestoreIds.has(entry.cineprintPosterId)).length}/${entries.length}`,
      optimized: `${optimizedExisting.length}/${entries.length} existing; ${optimizedMissing.length} regenerate`,
    },
    dryRunValidation,
    sourceProviders,
    identityMethods,
    migrationStatusCounts: statusCounts,
    duplicates: {
      sourceImageUrls: duplicateSourceUrls,
      raindropIds: duplicateRaindropIds,
      originalR2Keys: duplicateOriginalKeys,
      optimizedR2Keys: duplicateOptimizedKeys,
      currentImageUrls: duplicateCurrentImageUrls,
    },
    ambiguities,
    multiImagePages,
    optimized: {
      existing: optimizedExisting.length,
      missing: optimizedMissing.length,
      missingPosterIds: optimizedMissing.map((entry) => entry.cineprintPosterId),
      unusedExternalPosterIds: unusedExternal.map((entry) => entry.cineprintPosterId),
      byKind: optimizedByKind,
      existingByKind: optimizedExistingByKind,
      missingByKind: optimizedMissingByKind,
    },
    firestoreIdentitySnapshotFile: "migration/firestore-identities.json",
    entries,
  };

  const snapshot = {
    generatedAt: startedAt,
    sourceCommit: manifest.sourceCommit,
    count: firestoreDocs.length,
    documents: firestoreDocs
      .map((doc) => ({
        id: doc.id,
        notionPageId: String(doc.data.notionPageId ?? ""),
        raindropId: String(doc.data.raindropId ?? doc.data.artworkId ?? "").trim() || null,
        title: String(doc.data.title ?? ""),
        status: String(doc.data.status ?? ""),
        image: String(doc.data.image ?? ""),
        posterImageUrl: String(doc.data.posterImageUrl ?? ""),
      }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  fs.writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  fs.writeFileSync(
    path.join(OUT_DIR, "dry-run-validation.json"),
    `${JSON.stringify(dryRunValidation, null, 2)}\n`,
    "utf8",
  );

  const report = buildMarkdownReport(manifest);
  fs.writeFileSync(REPORT_PATH, report, "utf8");

  console.log("");
  console.log(`Manifest: ${MANIFEST_PATH}`);
  console.log(`Report:   ${REPORT_PATH}`);
  console.log(`Snapshot: ${SNAPSHOT_PATH}`);
  console.log(`Identity coverage: ${manifest.coverage.identity}`);
  console.log(`Source coverage:   ${manifest.coverage.source}`);
  console.log(`High confidence:   ${manifest.counts.highConfidence}`);
  console.log(`Medium confidence: ${manifest.counts.mediumConfidence}`);
  console.log(`Optimized existing:${manifest.counts.optimizedExisting}`);
  console.log(`Optimized missing: ${manifest.counts.optimizedMissing}`);
  console.log(`Duplicate source URLs: ${manifest.duplicates.sourceImageUrls.length}`);
  console.log(`Duplicate Raindrop IDs: ${manifest.duplicates.raindropIds.length}`);

  if (manifest.counts.manifestEntries !== 63) {
    throw new Error(`Expected 63 manifest entries, got ${manifest.counts.manifestEntries}`);
  }
  if (manifest.coverage.identity !== "63/63") {
    throw new Error(`Expected 63/63 identity coverage, got ${manifest.coverage.identity}`);
  }
  if (manifest.coverage.source !== "63/63") {
    throw new Error(`Expected 63/63 source coverage, got ${manifest.coverage.source}`);
  }
}

function buildMarkdownReport(manifest: {
  generatedAt: string;
  baselineCommit: string;
  sourceCommit: string;
  counts: Record<string, number>;
  coverage: Record<string, string>;
  dryRunValidation: {
    manifestEntries: number;
    firestoreDocuments: number;
    idsMatch: boolean;
    missingFromManifest: string[];
    extraInManifest: string[];
    notionPageIdMismatches: string[];
    currentImageUrlMismatches: string[];
    notionDerivedIdMismatches: string[];
    sourceAvailable: number;
    sourceUnavailable: number;
    optimizedExisting: number;
    optimizedMissing: number;
    checks: Record<string, boolean>;
  };
  sourceProviders: Record<string, number>;
  identityMethods: Record<string, number>;
  migrationStatusCounts: Record<string, number>;
  duplicates: Record<string, Array<{ key: string; ids: string[] }>>;
  ambiguities: Array<{
    cineprintPosterId: string;
    notionPageId: string;
    raindropId: string | null;
    identityMatchMethod: string;
    identityConfidence: string;
    migrationStatus: string;
    reason: string;
  }>;
  multiImagePages: Array<{
    notionPageId: string;
    notionTitle: string;
    imageCount: number;
    posterIds: string[];
    posterImageUrlProvider: string;
  }>;
  optimized: {
    existing: number;
    missing: number;
    missingPosterIds: string[];
    unusedExternalPosterIds: string[];
    byKind: Record<string, number>;
    existingByKind: Record<string, number>;
    missingByKind: Record<string, number>;
  };
  entries: Array<{
    cineprintPosterId: string;
    notionPageId: string;
    notionTitle: string;
    raindropId: string | null;
    raindropCollectionId: number | null;
    sourceProvider: string;
    sourceAvailability: string;
    sourceMimeType: string | null;
    sourceDimensions: { width: number; height: number } | null;
    sourceSizeBytes: number | null;
    originalR2Key: string | null;
    optimizedR2Key: string | null;
    identityMatchMethod: string;
    identityConfidence: string;
    migrationStatus: string;
    optimizedAction: string;
    optimizedCurrentlyUnused: boolean;
    verificationNotes: string;
  }>;
}): string {
  const lines: string[] = [];
  lines.push("# CinePrint — Poster Identity & Asset Recovery Manifest");
  lines.push("");
  lines.push(`**Generated:** ${manifest.generatedAt}  `);
  lines.push(`**Baseline:** ${manifest.baselineCommit}  `);
  lines.push(`**Source commit:** ${manifest.sourceCommit}  `);
  lines.push(`**Mode:** read-only audit; no Notion, Raindrop, Firestore, Blob or R2 writes.`);
  lines.push("");
  lines.push("## 1. Executive summary");
  lines.push("");
  lines.push(`- Firestore documents: **${manifest.counts.firestoreDocuments}**`);
  lines.push(`- Notion pages: **${manifest.counts.notionPages}**`);
  lines.push(`- Manifest entries: **${manifest.counts.manifestEntries}**`);
  lines.push(`- Identity coverage: **${manifest.coverage.identity}**`);
  lines.push(`- Source coverage: **${manifest.coverage.source}**`);
  lines.push(`- Firestore IDs preserved: **${manifest.coverage.firestoreIdsPreserved}**`);
  lines.push(`- High-confidence identities: **${manifest.counts.highConfidence}**`);
  lines.push(`- Medium-confidence identities: **${manifest.counts.mediumConfidence}**`);
  lines.push(`- Optimized assets existing: **${manifest.counts.optimizedExisting}**`);
  lines.push(`- Optimized assets to regenerate: **${manifest.counts.optimizedMissing}**`);
  lines.push(`- Source size/MIME matches existing Blob original: **${manifest.counts.sourceSizeMatchesExistingOriginal}**`);
  lines.push(`- Source size/MIME mismatches: **${manifest.counts.sourceSizeMismatchesExistingOriginal}**`);
  lines.push(`- Duplicate source URLs: **${manifest.duplicates.sourceImageUrls.length}**`);
  lines.push(`- Duplicate Raindrop IDs: **${manifest.duplicates.raindropIds.length}**`);
  lines.push("");
  lines.push("## 2. Source providers");
  lines.push("");
  lines.push("| Provider | Entries |");
  lines.push("|---|---:|");
  for (const [provider, count] of Object.entries(manifest.sourceProviders)) {
    lines.push(`| ${provider} | ${count} |`);
  }
  lines.push("");
  lines.push("## 3. Source-to-Blob size reconciliation");
  lines.push("");
  lines.push(`- Sources whose size and MIME exactly match the existing Blob original: **${manifest.counts.sourceSizeMatchesExistingOriginal}/${manifest.counts.manifestEntries}**`);
  lines.push(`- Sources with a size or MIME mismatch: **${manifest.counts.sourceSizeMismatchesExistingOriginal}**`);
  lines.push("");
  lines.push("An exact size and MIME match is strong evidence that the recovered Raindrop/pbs source is the same asset as the Blob original. It is not a cryptographic comparison because the Blob content is currently inaccessible.");
  lines.push("");
  lines.push("## 4. Identity match methods");
  lines.push("");
  lines.push("| Method | Entries |");
  lines.push("|---|---:|");
  for (const [method, count] of Object.entries(manifest.identityMethods)) {
    lines.push(`| ${method} | ${count} |`);
  }
  lines.push("");
  lines.push("## 5. Migration status");
  lines.push("");
  lines.push("| Status | Entries |");
  lines.push("|---|---:|");
  for (const [status, count] of Object.entries(manifest.migrationStatusCounts)) {
    lines.push(`| ${status} | ${count} |`);
  }
  lines.push("");
  lines.push("## 6. Multi-image Notion pages");
  lines.push("");
  lines.push("| Notion page | Title | Images | Poster IDs | Poster Image URL provider |");
  lines.push("|---|---|---:|---|---|");
  for (const page of manifest.multiImagePages) {
    lines.push(
      `| ${page.notionPageId} | ${page.notionTitle} | ${page.imageCount} | ${page.posterIds.join(", ")} | ${page.posterImageUrlProvider} |`,
    );
  }
  lines.push("");
  lines.push("## 7. Ambiguous or review-required mappings");
  lines.push("");
  if (manifest.ambiguities.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| Poster ID | Notion page | Raindrop ID | Method | Confidence | Status | Reason |");
    lines.push("|---|---|---|---|---|---|---|");
    for (const entry of manifest.ambiguities) {
      lines.push(
        `| ${entry.cineprintPosterId} | ${entry.notionPageId} | ${entry.raindropId ?? "—"} | ${entry.identityMatchMethod} | ${entry.identityConfidence} | ${entry.migrationStatus} | ${entry.reason.replace(/\|/g, "\\|")} |`,
      );
    }
  }
  lines.push("");
  lines.push("## 8. Optimized asset inventory");
  lines.push("");
  lines.push(`- Existing: **${manifest.optimized.existing}**`);
  lines.push(`- Missing and must be regenerated: **${manifest.optimized.missing}**`);
  lines.push(`- Existing but currently unused by the resolver: **${manifest.optimized.unusedExternalPosterIds.length}**`);
  lines.push("");
  lines.push("| Variant | All entries | Existing | Missing |");
  lines.push("|---|---:|---:|---:|");
  for (const kind of ["legacy", "external", "artwork"]) {
    lines.push(
      `| ${kind} | ${manifest.optimized.byKind[kind] ?? 0} | ${manifest.optimized.existingByKind[kind] ?? 0} | ${manifest.optimized.missingByKind[kind] ?? 0} |`,
    );
  }
  lines.push("");
  lines.push("### Optimized assets to regenerate");
  lines.push("");
  if (manifest.optimized.missingPosterIds.length === 0) {
    lines.push("None.");
  } else {
    for (const id of manifest.optimized.missingPosterIds) {
      lines.push(`- ${id}`);
    }
  }
  lines.push("");
  lines.push("### Optimized external assets currently unused");
  lines.push("");
  if (manifest.optimized.unusedExternalPosterIds.length === 0) {
    lines.push("None.");
  } else {
    for (const id of manifest.optimized.unusedExternalPosterIds) {
      lines.push(`- ${id}`);
    }
  }
  lines.push("");
  lines.push("## 9. Proposed `CinePrint Poster ID` schema change (not applied)");
  lines.push("");
  lines.push("Add a new Notion property:");
  lines.push("");
  lines.push("| Property | Type | Purpose |");
  lines.push("|---|---|---|");
  lines.push("| `CinePrint Poster ID` | `rich_text` | Immutable canonical poster identity; initialized from the current Firestore document ID. |");
  lines.push("");
  lines.push("Proposed sync precedence:");
  lines.push("");
  lines.push("1. If `CinePrint Poster ID` is non-empty, use it as the Firestore document ID.");
  lines.push("2. Otherwise, fall back to the current `artwork-<raindropId>` / `slug` / `slug-<n>` logic.");
  lines.push("3. Backfill `CinePrint Poster ID` with the current Firestore document ID for all 63 posters.");
  lines.push("4. Add `Raindrop ID` to legacy pages only after the precedence change is deployed and dry-run verified.");
  lines.push("5. Split the 5 multi-image pages into 12 poster pages (or use a per-poster mapping) before adding per-poster Raindrop IDs.");
  lines.push("");
  lines.push("This report does **not** apply the schema change.");
  lines.push("");
  lines.push("## 10. Dry-run validation");
  lines.push("");
  lines.push("The manifest is validated against `migration/firestore-identities.json` and the results are written to `migration/dry-run-validation.json`.");
  lines.push("");
  lines.push(`- Manifest entries: **${manifest.dryRunValidation.manifestEntries}**`);
  lines.push(`- Firestore documents: **${manifest.dryRunValidation.firestoreDocuments}**`);
  lines.push(`- ID sets match: **${manifest.dryRunValidation.idsMatch ? "yes" : "no"}**`);
  lines.push(`- Missing from manifest: **${manifest.dryRunValidation.missingFromManifest.length}**`);
  lines.push(`- Extra in manifest: **${manifest.dryRunValidation.extraInManifest.length}**`);
  lines.push(`- Notion page ID mismatches: **${manifest.dryRunValidation.notionPageIdMismatches.length}**`);
  lines.push(`- Current image URL mismatches: **${manifest.dryRunValidation.currentImageUrlMismatches.length}**`);
  lines.push(`- Notion-derived ID mismatches: **${manifest.dryRunValidation.notionDerivedIdMismatches.length}**`);
  lines.push(`- Sources available: **${manifest.dryRunValidation.sourceAvailable}/${manifest.dryRunValidation.manifestEntries}**`);
  lines.push(`- Optimized existing: **${manifest.dryRunValidation.optimizedExisting}**`);
  lines.push(`- Optimized to regenerate: **${manifest.dryRunValidation.optimizedMissing}**`);
  lines.push("");
  lines.push("| Check | Result |");
  lines.push("|---|---|");
  for (const [check, result] of Object.entries(manifest.dryRunValidation.checks)) {
    lines.push(`| ${check} | ${result ? "PASS" : "FAIL"} |`);
  }
  lines.push("");
  lines.push("## 11. Full manifest table");
  lines.push("");
  lines.push("| Poster ID | Notion page | Title | Raindrop ID | Collection | Provider | MIME | Dimensions | Size | Confidence | Status | Optimized |");
  lines.push("|---|---|---|---:|---|---|---|---:|---:|---|---|---|");
  for (const entry of manifest.entries) {
    const dimensions = entry.sourceDimensions
      ? `${entry.sourceDimensions.width}x${entry.sourceDimensions.height}`
      : "—";
    const size = entry.sourceSizeBytes === null ? "—" : `${(entry.sourceSizeBytes / 1024).toFixed(1)} KB`;
    lines.push(
      `| ${entry.cineprintPosterId} | ${entry.notionPageId} | ${entry.notionTitle.replace(/\|/g, "\\|")} | ${entry.raindropId ?? "—"} | ${entry.raindropCollectionId ?? "—"} | ${entry.sourceProvider} | ${entry.sourceMimeType ?? "—"} | ${dimensions} | ${size} | ${entry.identityConfidence} | ${entry.migrationStatus} | ${entry.optimizedAction}${entry.optimizedCurrentlyUnused ? " (unused)" : ""} |`,
    );
  }
  lines.push("");
  lines.push("## 12. Safety statement");
  lines.push("");
  lines.push("No Notion, Raindrop, Firestore, Vercel Blob, R2, DNS or deployment writes were performed. The manifest and snapshot are derived from read-only API responses. No credentials are included in the manifest.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

main().catch((error) => {
  console.error(`Manifest build failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
