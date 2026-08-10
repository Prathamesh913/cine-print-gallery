import "dotenv/config";
import { parseBookmark } from "./parser";
import type { RaindropBookmark } from "./parser";
import type { CinePrintDraft } from "./shared/cineprint-draft";
import { createTMDBEnrichmentService } from "./tmdb/service";
import type { EnrichedDraft } from "./tmdb/types";
import { BlobClient } from "./blob/client";
import { getBlobCredentials } from "./blob/env";
import { BlobImageImporter } from "./blob/import";
import { applyImageStage } from "./pipeline";
import type { ImageStageResult } from "./pipeline";
import { NotionApiClient } from "./notion/client";
import { requestPropertyValue } from "./notion/mapper";
import { countOutcomes } from "./notion/report";
import { NotionDraftSync } from "./notion/sync";
import type { SyncOutcome } from "./notion/sync";

const RAINDROP_API_URL = "https://api.raindrop.io/rest/v1/raindrops";
const PER_PAGE = 50;

const DRY_RUN_LABELS: Array<[string, string]> = [
  ["Name", "Title"],
  ["Year", "Year"],
  ["Media Type", "Media Type"],
  ["TMDB ID", "TMDB ID"],
  ["IMDb ID", "IMDb ID"],
  ["Genre", "Genres"],
  ["Library Names", "Library"],
  ["Slug", "Slug"],
  ["Artist", "Artist"],
  ["Image URL", "Image"],
  ["Source URL", "Source"],
  ["Raindrop ID", "Raindrop ID"],
  ["Status", "Status"],
];

type RaindropResponse = {
  items?: RaindropBookmark[];
  count?: number;
};

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

async function fetchBookmarks(
  accessToken: string,
  collectionId: string,
): Promise<{ bookmarks: RaindropBookmark[]; totalCount: number }> {
  const bookmarks: RaindropBookmark[] = [];
  let page = 0;
  let totalCount: number | undefined;

  while (true) {
    const url = new URL(`${RAINDROP_API_URL}/${encodeURIComponent(collectionId)}`);
    url.searchParams.set("page", String(page));
    url.searchParams.set("perpage", String(PER_PAGE));

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    const responseText = await response.text();
    let data: RaindropResponse;

    try {
      data = JSON.parse(responseText) as RaindropResponse;
    } catch {
      throw new Error(
        `Raindrop API returned invalid JSON (${response.status} ${response.statusText})`,
      );
    }

    if (!response.ok) {
      throw new Error(`Raindrop API request failed (${response.status} ${response.statusText})`);
    }

    if (!Array.isArray(data.items)) {
      throw new Error("Raindrop API response did not contain an items array");
    }

    bookmarks.push(...data.items);
    totalCount = typeof data.count === "number" ? data.count : totalCount;

    if (
      data.items.length === 0 ||
      data.items.length < PER_PAGE ||
      (totalCount !== undefined && bookmarks.length >= totalCount)
    ) {
      break;
    }

    page += 1;
  }

  return { bookmarks, totalCount: totalCount ?? bookmarks.length };
}

function printValue(value: unknown) {
  if (Array.isArray(value)) {
    for (const item of value) {
      console.log(item);
    }
    return;
  }
  console.log(value ?? "N/A");
}

function printDryRunOutcome(outcome: SyncOutcome) {
  console.log("----------------------------------------");
  console.log("DRY RUN");
  console.log("");

  if (outcome.kind === "skipped") {
    console.log("SKIPPED");
    console.log("");
    console.log("Title:");
    console.log(outcome.draft.title);
    console.log("");
    console.log("Reason:");
    console.log(outcome.reason);
    console.log("");
    return;
  }

  if (outcome.kind === "failed") {
    console.log("FAILED");
    console.log("");
    console.log("Title:");
    console.log(outcome.draft.title);
    console.log("");
    console.log("Reason:");
    console.log(outcome.error);
    console.log("");
    return;
  }

  if (outcome.kind === "created") {
    console.log("CREATE");
  } else {
    console.log("UPDATE");
    if (outcome.changed) {
      console.log("");
      console.log("Changes:");
      for (const field of outcome.changedFields ?? []) {
        console.log(`- ${field}`);
      }
    } else {
      console.log("");
      console.log("No changes");
    }
  }

  const properties = outcome.properties;

  for (const [property, label] of DRY_RUN_LABELS) {
    const value = properties ? requestPropertyValue(properties[property]) : null;
    console.log("");
    console.log(`${label}:`);
    printValue(value);
  }

  console.log("");
}

function printReport(input: {
  total: number;
  parsed: number;
  parseFailed: number;
  tmdbEnriched: number;
  needsReview: number;
  tmdbFailed: number;
  imageFailed: number;
  imageFailures: Array<{ raindropId: string; title: string; reason: string }>;
  outcomes: SyncOutcome[];
}) {
  const counts = countOutcomes(input.outcomes);

  console.log("========================================");
  console.log("CinePrint Import Report");
  console.log("========================================");
  console.log(`Total bookmarks: ${input.total}`);
  console.log("");
  console.log(`Parsed: ${input.parsed}`);
  console.log(`TMDB enriched: ${input.tmdbEnriched}`);
  console.log(`Needs review: ${input.needsReview}`);
  if (input.tmdbFailed > 0) {
    console.log(`TMDB failed: ${input.tmdbFailed}`);
  }
  if (input.imageFailed > 0) {
    console.log(`Image failed: ${input.imageFailed}`);
  }
  if (input.parseFailed > 0) {
    console.log(`Parse failed: ${input.parseFailed}`);
  }
  console.log("");
  console.log("Notion:");
  console.log(`Created: ${counts.created}`);
  console.log(`Updated: ${counts.updated}`);
  console.log(`Skipped: ${counts.skipped}`);
  console.log(`Failed: ${counts.failed}`);
  console.log("========================================");

  for (const outcome of input.outcomes) {
    if (outcome.kind === "failed") {
      console.log(
        `FAILED: Raindrop ID: ${outcome.draft.raindropId}, Title: ${outcome.draft.title}, Reason: ${outcome.error}`,
      );
    }
    if (outcome.kind === "skipped") {
      console.log(
        `SKIPPED: Raindrop ID: ${outcome.draft.raindropId}, Title: ${outcome.draft.title}, Reason: ${outcome.reason}`,
      );
    }
  }

  for (const failure of input.imageFailures) {
    console.log(
      `IMAGE FAILED: Raindrop ID: ${failure.raindropId}, Title: ${failure.title}, Reason: ${failure.reason}`,
    );
  }
}

function printImageReady(result: Extract<ImageStageResult, { ok: true }>) {
  console.log("✓ Image ready");
  console.log("");
  console.log("Title:");
  console.log(result.draft.title);
  console.log("");
  console.log("Storage:");
  console.log("Vercel Blob");
  console.log("");
  console.log("Blob:");
  console.log(
    result.status === "uploaded"
      ? "UPLOAD"
      : result.status === "reused"
        ? "REUSED"
        : "WOULD UPLOAD",
  );
  console.log("");
  console.log("URL:");
  console.log(result.url);
  console.log("");
  console.log("Source:");
  console.log(result.sourceKind === "raindrop" ? "Raindrop file" : "External image");
  console.log("");
}

async function main() {
  console.log("CinePrint automation started");
  const dryRun = process.argv.includes("--dry-run");
  if (dryRun) {
    console.log("Mode: dry-run (no Notion writes)");
  }

  try {
    const accessToken = getRequiredEnv("RAINDROP_ACCESS_TOKEN");
    const collectionId = getRequiredEnv("RAINDROP_COLLECTION_ID");
    const notionKey = getRequiredEnv("NOTION_KEY");
    const notionDatabaseId = getRequiredEnv("NOTION_DATABASE_ID");

    const { oidcToken, storeId } = getBlobCredentials();

    if (!oidcToken) {
      throw new Error("VERCEL_OIDC_TOKEN is required");
    }
    if (!storeId) {
      throw new Error("BLOB_STORE_ID is required");
    }

    const { bookmarks, totalCount } = await fetchBookmarks(accessToken, collectionId);

    console.log(`Total bookmark count: ${totalCount}`);
    console.log("");

    const drafts: CinePrintDraft[] = [];
    let parseFailed = 0;

    for (const bookmark of bookmarks) {
      const result = parseBookmark(bookmark);

      if (result.ok) {
        drafts.push(result.draft);
      } else {
        parseFailed += 1;
      }
    }

    const enrichmentService = createTMDBEnrichmentService();
    const imageImporter = new BlobImageImporter(new BlobClient({ oidcToken, storeId }));
    const enrichedDrafts: EnrichedDraft[] = [];
    const imageFailures: Array<{ raindropId: string; title: string; reason: string }> = [];
    let tmdbEnriched = 0;
    let needsReview = 0;
    let tmdbFailed = 0;
    let imageFailed = 0;

    for (const draft of drafts) {
      const outcome = await enrichmentService.enrichDraft(draft);

      if (outcome.status === "enriched") {
        tmdbEnriched += 1;
        const imageResult = await applyImageStage(outcome, imageImporter, {
          raindropToken: accessToken,
          dryRun,
        });

        if (imageResult.ok) {
          printImageReady(imageResult);
          enrichedDrafts.push(imageResult.draft);
        } else {
          imageFailed += 1;
          imageFailures.push({
            raindropId: outcome.raindropId,
            title: outcome.title,
            reason: imageResult.reason,
          });
          console.error(`✗ Image import failed for "${outcome.title}": ${imageResult.reason}`);
        }
      } else if (outcome.status === "needs_review") {
        needsReview += 1;
        enrichedDrafts.push(outcome);
      } else if (outcome.status === "failed") {
        tmdbFailed += 1;
        enrichedDrafts.push(outcome);
      }
    }

    const notionClient = new NotionApiClient({
      apiKey: notionKey,
      databaseId: notionDatabaseId,
    });
    const sync = new NotionDraftSync(notionClient);
    const outcomes = await sync.syncMany(enrichedDrafts, { dryRun });

    if (dryRun) {
      for (const outcome of outcomes) {
        printDryRunOutcome(outcome);
      }
    } else {
      for (const outcome of outcomes) {
        if (outcome.kind === "created") {
          console.log(`✓ CREATED: ${outcome.draft.title} (page ${outcome.pageId})`);
        } else if (outcome.kind === "updated") {
          console.log(
            outcome.changed
              ? `✓ UPDATED: ${outcome.draft.title} (page ${outcome.pageId})`
              : `- UNCHANGED: ${outcome.draft.title} (page ${outcome.pageId})`,
          );
        } else if (outcome.kind === "skipped") {
          console.log(`- SKIPPED: ${outcome.draft.title} (${outcome.reason})`);
        } else {
          console.log(`✗ FAILED: ${outcome.draft.title} (${outcome.error})`);
        }
      }
    }

    printReport({
      total: totalCount,
      parsed: drafts.length,
      parseFailed,
      tmdbEnriched,
      needsReview,
      tmdbFailed,
      imageFailed,
      imageFailures,
      outcomes,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Pipeline error: ${message}`);
    process.exitCode = 1;
  }
}

void main();
