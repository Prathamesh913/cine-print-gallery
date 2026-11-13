/**
 * Notion published-record → Firestore synchronization.
 *
 * Extends the existing identity contract rather than replacing it:
 * - the canonical ID still comes from `CinePrint Poster ID` (single-image pages)
 *   or per-image identity records (multi-image pages);
 * - the deterministic `artwork-{raindropId}` identity is accepted for automated
 *   single-image pages, which is exactly what the ingestion pipeline writes;
 * - ambiguous or conflicting identities are reported, never guessed;
 * - unchanged records are not rewritten.
 */

import {
  canonicalPosterIdFromPage,
  imageUrlsFromPage,
  richTextValue,
  type IdentityRecord,
} from "../../scripts/poster-identity.js";
import { parsePageData } from "../../scripts/sync-notion-to-firestore.js";
import type { Logger } from "./logger";
import type { NotionPageLike, NotionPageSource } from "./notion-pages";
import { isPublishedStatus, statusName } from "./notion-pages";
import {
  PosterDocumentMissingError,
  type PosterCatalog,
  type PosterDocument,
} from "./poster-catalog";
import { contentFingerprint, isPosterId, stableStringify } from "./identity";
import { advanceJob, type JobStore } from "./state";
import type { IngestionJob, PublishCounts, PublishSummary, StageFailure } from "./types";
import { INGESTION_SCHEMA_VERSION } from "./types";
import { validateR2ImageReference } from "../../src/lib/r2-image-reference";

export const REQUIRED_POSTER_PROPERTIES = ["Name", "Year", "Media Type", "Image URL"] as const;

/**
 * Mirrors the legacy status mapping for recognized values. Missing, blank or
 * unknown values return null: they must never be translated into an explicit
 * status transition, because that could unpublish a valid catalogue record.
 */
export function normalizeNotionStatus(raw: string): string | null {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (!value) return null;
  if (value === "published") return "published";
  if (value === "review" || value === "in review") return "review";
  if (value === "draft" || value === "unpublished") return "draft";
  if (value === "archived" || value === "rejected") return "archived";
  return null;
}

export interface PublishedResolution {
  posterId: string;
  imageUrl: string;
  page: NotionPageLike;
  /** True when the Notion page groups several poster images. */
  multiImage: boolean;
}

export interface ResolutionFailure {
  pageId: string;
  reason: string;
  kind: "needs_review" | "conflict";
}

export interface ResolvePublishedResult {
  resolved: PublishedResolution[];
  failures: ResolutionFailure[];
}

function prop(page: NotionPageLike, name: string): unknown {
  return page.properties?.[name];
}

function raindropIdFromPage(page: NotionPageLike): string | null {
  const value = richTextValue(prop(page, "Raindrop ID")).trim();
  return /^\d+$/.test(value) ? value : null;
}

/**
 * Resolves every published page into one or more poster identities. A page with
 * several images must have exactly one active identity record per image.
 */
export function resolvePublishedPages(
  pages: NotionPageLike[],
  identityRecords: IdentityRecord[],
): ResolvePublishedResult {
  const resolved: PublishedResolution[] = [];
  const failures: ResolutionFailure[] = [];
  const byPage = new Map<string, IdentityRecord[]>();

  for (const record of identityRecords) {
    if ((record.status || "active") !== "active") continue;
    if (!record.groupingPageId) continue;
    const group = byPage.get(record.groupingPageId) ?? [];
    group.push(record);
    byPage.set(record.groupingPageId, group);
  }

  const claimed = new Map<string, string>();

  for (const page of pages) {
    const pageId = String(page.id);
    if (!isPublishedStatus(statusName(prop(page, "Status")))) {
      continue;
    }

    const images = imageUrlsFromPage(page);
    if (images.length === 0) {
      failures.push({ pageId, reason: "Published page has no Image URL", kind: "needs_review" });
      continue;
    }

    const canonical = canonicalPosterIdFromPage(page);
    if (canonical.status === "invalid") {
      failures.push({
        pageId,
        reason: `Invalid CinePrint Poster ID: ${canonical.reason ?? "unknown reason"}`,
        kind: "conflict",
      });
      continue;
    }

    const pageResolutions: PublishedResolution[] = [];

    if (images.length === 1) {
      if (canonical.status === "present") {
        if (!canonical.posterId) {
          failures.push({ pageId, reason: "Invalid CinePrint Poster ID", kind: "conflict" });
          continue;
        }
        pageResolutions.push({
          posterId: canonical.posterId,
          imageUrl: images[0],
          page,
          multiImage: false,
        });
      } else {
        const raindropId = raindropIdFromPage(page);
        if (!raindropId) {
          failures.push({
            pageId,
            reason: "Published page has no CinePrint Poster ID or Raindrop ID",
            kind: "needs_review",
          });
          continue;
        }
        pageResolutions.push({
          posterId: `artwork-${raindropId}`,
          imageUrl: images[0],
          page,
          multiImage: false,
        });
      }
    } else {
      if (canonical.status === "present") {
        failures.push({
          pageId,
          reason: "Multi-image page must use identity records, not a page-level poster ID",
          kind: "conflict",
        });
        continue;
      }
      const records = byPage.get(pageId) ?? [];
      let pageFailed = false;
      for (const imageUrl of images) {
        const matches = records.filter((record) => record.imageUrl === imageUrl);
        if (matches.length !== 1) {
          failures.push({
            pageId,
            reason:
              matches.length === 0
                ? `No identity record for image on published page`
                : `Multiple identity records for image on published page`,
            kind: matches.length === 0 ? "needs_review" : "conflict",
          });
          pageFailed = true;
          continue;
        }
        const candidate = matches[0];
        if (!isPosterId(candidate.posterId)) {
          failures.push({
            pageId,
            reason: `Identity record has an invalid poster ID`,
            kind: "conflict",
          });
          pageFailed = true;
          continue;
        }
        pageResolutions.push({
          posterId: candidate.posterId,
          imageUrl,
          page,
          multiImage: true,
        });
      }
      if (pageFailed) continue;
    }

    for (const resolution of pageResolutions) {
      const owner = claimed.get(resolution.posterId);
      if (owner && owner !== pageId) {
        failures.push({
          pageId,
          reason: `Poster ID ${resolution.posterId} is claimed by multiple Notion pages`,
          kind: "conflict",
        });
        // Fail closed for the identity: the earlier claim must not be written
        // either, because the correct owner is now uncertain.
        for (let index = resolved.length - 1; index >= 0; index -= 1) {
          if (resolved[index].posterId === resolution.posterId) resolved.splice(index, 1);
        }
        claimed.set(resolution.posterId, "conflict");
        continue;
      }
      if (owner === "conflict") continue;
      claimed.set(resolution.posterId, pageId);
      resolved.push(resolution);
    }
  }

  return { resolved, failures };
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isR2Url(value: unknown): value is string {
  if (!isHttpsUrl(value)) return false;
  return new URL(value).hostname === "images.cineprint.click";
}

function presentString(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

function presentArray(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0;
}

export interface BuiltRecord {
  posterId: string;
  pageId: string;
  data: Record<string, unknown>;
}

export class RecordValidationError extends Error {}

/** Identity or ownership conflict. Never auto-resolved. */
export class PublishConflictError extends RecordValidationError {}

/**
 * Builds the exact Firestore record shape from the authoritative parser, then
 * layers the dynamic R2 reference for automated posters.
 */
export function buildPosterRecord(
  resolution: PublishedResolution,
  job: IngestionJob | null,
  options: { creating: boolean },
): BuiltRecord {
  const records = parsePageData(resolution.page) as Array<
    Record<string, unknown> & { image?: string; notionPageId?: string }
  >;
  const matches = records.filter(
    (record) => record.image === resolution.imageUrl && record.notionPageId === resolution.page.id,
  );

  if (matches.length !== 1) {
    throw new RecordValidationError(
      `Expected exactly one parsed record for image on page ${resolution.page.id}, found ${matches.length}`,
    );
  }

  const { id: _unused, ...parsed } = matches[0];
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== undefined) data[key] = value;
  }

  data.status = "published";
  data.notionPageId = resolution.page.id;

  // Automated drafts have no Notion `Source` property today. Record the truthful
  // provenance instead of persisting the parser's "Unknown" default.
  if (job && (!presentString(data.source) || data.source === "Unknown")) {
    data.source = "Raindrop";
  }

  if (job?.images) {
    const validated = validateR2ImageReference(job.images, resolution.posterId);
    if (validated.ok) {
      data.r2Image = validated.value;
    }
  }

  // Required metadata is enforced for creates and updates. Syncing a partial
  // Notion page must never overwrite a complete catalogue document with empty
  // defaults.
  const reason = missingRequiredMetadata(data);
  if (reason) throw new RecordValidationError(reason);
  if (options.creating && !isR2Url(data.image)) {
    throw new RecordValidationError("New records must use a verified R2 image URL");
  }
  if (!presentString(data.slug)) {
    throw new RecordValidationError("Record has no slug");
  }

  data.contentHash = contentFingerprint(data);
  return { posterId: resolution.posterId, pageId: resolution.page.id, data };
}

export function missingRequiredMetadata(data: Record<string, unknown>): string | null {
  if (!presentString(data.title)) return "Missing title";
  if (typeof data.year !== "number" || !Number.isFinite(data.year) || data.year <= 0) {
    return "Missing or invalid year";
  }
  if (data.mediaType !== "movie" && data.mediaType !== "show") return "Missing media type";
  if (!isHttpsUrl(data.image)) return "Missing or invalid image URL";
  if (!presentString(data.artist)) return "Missing artist";
  if (!presentArray(data.genre)) return "Missing genre";
  if (!presentArray(data.libraryNames)) return "Missing library";
  if (!presentString(data.tmdbId)) return "Missing TMDB ID";
  if (!presentString(data.imdbId)) return "Missing IMDb ID";
  return null;
}

export function recordMatchesExisting(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
): boolean {
  for (const [key, value] of Object.entries(next)) {
    if (key === "contentHash") continue;
    if (stableStringify(existing[key]) !== stableStringify(value)) return false;
  }
  return true;
}

export interface PublishDeps {
  source: NotionPageSource;
  catalog: PosterCatalog;
  jobs: JobStore;
  logger: Logger;
  now?: () => Date;
  batchLimit?: number;
  /** Where skip detection read existing state from. */
  stateSource?: "firestore" | "memory";
}

export interface RunPublishInput {
  runId: string;
  dryRun: boolean;
  startedAt?: Date;
}

export async function runPublishingSync(
  deps: PublishDeps,
  input: RunPublishInput,
): Promise<PublishSummary> {
  const now = deps.now ?? (() => new Date());
  const startedAt = input.startedAt ?? now();
  const counts: PublishCounts = {
    publishedRecordsDiscovered: 0,
    firestoreRecordsCreated: 0,
    firestoreRecordsUpdated: 0,
    alreadySynchronized: 0,
    needsReview: 0,
    failed: 0,
  };
  const failures: StageFailure[] = [];
  const logger = deps.logger;

  // Validate every configured Notion object before reading a single record, so a
  // bad data-source ID fails with a configuration error instead of an opaque
  // API error after partial processing.
  await deps.source.preflight?.();

  const pages = await deps.source.listPages();
  const identityRecords = await deps.source.listIdentityRecords();
  const publishedPages = pages.filter((page) =>
    isPublishedStatus(statusName(page.properties.Status)),
  );
  counts.publishedRecordsDiscovered = publishedPages.length;

  const resolution = resolvePublishedPages(publishedPages, identityRecords);
  for (const failure of resolution.failures) {
    if (failure.kind === "conflict") counts.failed += 1;
    else counts.needsReview += 1;
    failures.push({
      posterId: null,
      raindropId: null,
      stage: "published",
      reason: `${failure.pageId}: ${failure.reason}`,
      retryable: false,
    });
    logger.warn("publish.identity_unresolved", {
      pageId: failure.pageId,
      kind: failure.kind,
      reason: failure.reason,
    });
  }

  // A record set back to Draft/Review/Archived in Notion must stop being served
  // by the public query. Only the status field is changed; catalogue content is
  // never rewritten from an incomplete editorial page.
  const catalogue = await deps.catalog.listAll();
  const docsByPage = new Map<string, PosterDocument[]>();
  for (const document of catalogue) {
    const pageId = document.data.notionPageId;
    if (typeof pageId !== "string" || !pageId) continue;
    const group = docsByPage.get(pageId) ?? [];
    group.push(document);
    docsByPage.set(pageId, group);
  }

  for (const page of pages) {
    if (isPublishedStatus(statusName(page.properties.Status))) continue;
    const rawStatus = statusName(page.properties.Status);
    const nextStatus = normalizeNotionStatus(rawStatus);
    if (nextStatus === null) {
      counts.needsReview += 1;
      failures.push({
        posterId: null,
        raindropId: null,
        stage: "published",
        reason: `Page ${page.id}: missing or unrecognized Status; existing Firestore status preserved`,
        retryable: false,
      });
      logger.warn("publish.status_invalid", { pageId: page.id });
      continue;
    }

    const associated = docsByPage.get(page.id) ?? [];
    if (associated.length === 0) continue;

    for (const document of associated) {
      if (document.data.status === nextStatus) continue;
      if (input.dryRun) {
        counts.firestoreRecordsUpdated += 1;
        logger.info("publish.dry_run_status_planned", {
          posterId: document.id,
          status: nextStatus,
        });
        continue;
      }
      const nextData = { ...document.data, status: nextStatus } as Record<string, unknown>;
      delete nextData.contentHash;
      await deps.catalog.update(document.id, {
        status: nextStatus,
        contentHash: contentFingerprint(nextData),
      });
      counts.firestoreRecordsUpdated += 1;
      logger.info("publish.record_unpublished", {
        posterId: document.id,
        status: nextStatus,
      });
    }
  }

  const jobList = await deps.jobs.list();
  const jobsById = new Map(jobList.map((job) => [job.posterId, job]));
  const limit = deps.batchLimit ?? 100;
  const selected = resolution.resolved.slice(0, limit);

  for (const item of selected) {
    let targetId = item.posterId;
    let job: IngestionJob | null = null;
    try {
      let existing = await deps.catalog.get(targetId);

      // Preserve a legacy Firestore document that is already associated with
      // this Notion page instead of creating a parallel artwork-* identity.
      // This protects the intentionally unresolved identities and any page
      // whose canonical property was never backfilled.
      if (!existing && !item.multiImage) {
        const associated = await deps.catalog.listByNotionPageId(item.page.id);
        if (associated.length === 1) {
          targetId = associated[0].id;
          existing = associated[0];
          logger.warn("publish.legacy_document_reused", {
            resolvedPosterId: item.posterId,
            targetPosterId: targetId,
            pageId: item.page.id,
          });
        } else if (associated.length > 1) {
          throw new PublishConflictError(
            `Notion page ${item.page.id} is associated with multiple Firestore documents`,
          );
        }
      }

      job = jobsById.get(targetId) ?? jobsById.get(item.posterId) ?? null;
      const existingPageId =
        typeof existing?.data.notionPageId === "string" ? existing.data.notionPageId : null;

      if (existing) {
        if (!existingPageId) {
          throw new PublishConflictError(
            `Firestore document ${targetId} has no Notion page association`,
          );
        }
        if (existingPageId !== item.page.id) {
          throw new PublishConflictError(
            `Poster ${targetId} is already associated with Notion page ${existingPageId}`,
          );
        }
      } else {
        // Creation is a separate, explicit path. Only an ingestion job that has
        // produced a Notion draft may create a new catalogue document. A record
        // deleted after synchronization has a later stage and must not be
        // silently recreated on retry.
        if (!job) {
          throw new RecordValidationError(
            `No existing Firestore document for ${targetId} and no ingestion job authorises creation`,
          );
        }
        const canCreate =
          job.stage === "notion_draft_created" || job.stage === "awaiting_publication";
        if (!canCreate) {
          throw new PosterDocumentMissingError(targetId);
        }
      }

      const built = buildPosterRecord(item, job, { creating: !existing });
      const creating = !existing;

      if (existing && recordMatchesExisting(existing.data, built.data)) {
        counts.alreadySynchronized += 1;
        if (!input.dryRun && job && job.stage !== "firestore_synced") {
          await deps.jobs.save(
            advanceJob(
              job,
              "firestore_synced",
              {
                notionPageId: item.page.id,
                notionStatus: "Published",
                lastError: null,
                retryable: false,
                nextAttemptAt: null,
              },
              now(),
            ),
          );
        }
        continue;
      }

      if (input.dryRun) {
        if (creating) counts.firestoreRecordsCreated += 1;
        else counts.firestoreRecordsUpdated += 1;
        logger.info("publish.dry_run_write_planned", {
          posterId: targetId,
          action: creating ? "create" : "update",
        });
        continue;
      }

      if (creating) {
        await deps.catalog.create(targetId, built.data);
        counts.firestoreRecordsCreated += 1;
      } else {
        await deps.catalog.update(targetId, built.data);
        counts.firestoreRecordsUpdated += 1;
      }

      // Confirmation against the same public query contract: a published record
      // with a non-empty image URL. This is a real read-back, not an assumption.
      const confirmed = await deps.catalog.get(targetId);
      if (
        !confirmed ||
        confirmed.data.status !== "published" ||
        !presentString(confirmed.data.image)
      ) {
        throw new Error(`Poster ${targetId} is not visible after the Firestore write`);
      }

      if (job) {
        await deps.jobs.save(
          advanceJob(
            job,
            "published",
            { notionPageId: item.page.id, notionStatus: "Published" },
            now(),
          ),
        );
        await deps.jobs.save(
          advanceJob(
            job,
            "firestore_synced",
            {
              notionPageId: item.page.id,
              notionStatus: "Published",
              lastError: null,
              retryable: false,
              nextAttemptAt: null,
            },
            now(),
          ),
        );
      }

      logger.info("publish.record_synced", {
        posterId: targetId,
        action: creating ? "create" : "update",
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const needsReview =
        error instanceof RecordValidationError && !(error instanceof PublishConflictError);
      if (needsReview) counts.needsReview += 1;
      else counts.failed += 1;
      failures.push({
        posterId: targetId,
        raindropId: job?.raindropId ?? null,
        stage: error instanceof RecordValidationError ? "published" : "firestore_synced",
        reason,
        retryable: !(
          error instanceof RecordValidationError || error instanceof PosterDocumentMissingError
        ),
      });
      logger.error("publish.record_failed", { posterId: targetId, reason });
    }
  }

  const finishedAt = now();
  const summary: PublishSummary = {
    mode: "publish",
    schemaVersion: INGESTION_SCHEMA_VERSION,
    runId: input.runId,
    dryRun: input.dryRun,
    stateSource: deps.stateSource ?? "memory",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    counts,
    failures,
  };

  logger.info("publish.summary", { counts });
  return summary;
}
