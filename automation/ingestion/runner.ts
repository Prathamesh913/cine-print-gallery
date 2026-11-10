/**
 * Orchestrated, resumable ingestion runner.
 *
 * Every stage is checkpointed before the next one starts. Retries reuse the
 * verified image references and the Notion page, so a failure after an R2 upload
 * or after Notion creation cannot create duplicates.
 */

import type { CinePrintDraft } from "../shared/cineprint-draft";
import type { EnrichedDraft } from "../tmdb/types";
import type { NotionDraftSync } from "../notion/sync";
import type { SyncOutcome } from "../notion/sync";
import {
  NotionApiError,
  NotionAuthError,
  NotionNetworkError,
  NotionRateLimitError,
} from "../notion/client";
import {
  R2UploadError,
  R2ConflictError,
  R2VerificationError,
  R2InconclusiveError,
  R2UploadUnknownError,
} from "../migration/r2";
import { optimizedVersionKey } from "../migration/versioning";
import type { Logger } from "./logger";
import { ImageDownloadError } from "./download";
import type { DownloadedSourceImage } from "./download";
import type { PreparedImage } from "./image";
import type { R2ImagePublisher } from "./r2-images";
import { planR2Keys } from "./r2-images";
import { advanceJob, createJob, failJob, isRetryableNow, type JobStore } from "./state";
import {
  INGESTION_SCHEMA_VERSION,
  TERMINAL_INGESTION_STAGES,
  type IngestionCounts,
  type IngestionJob,
  type IngestionSummary,
  type StageFailure,
} from "./types";
import { isPosterId, reviewDecisionFromJob } from "./identity";
import { dedupeBookmarks, isSameSourceRevision, validateBookmark } from "./validation";
import type { BookmarkInput, ValidatedBookmark } from "./validation";

export interface IngestionCandidate {
  posterId: string;
  raindropId: string;
  sourceKey: string;
  raindropUpdatedAt: string | null;
  sourceImageUrl: string;
  draft: CinePrintDraft & { posterId: string; raindropId: string };
}

export interface IngestionRunnerDeps {
  jobStore: JobStore;
  enrich: (draft: CinePrintDraft, job: IngestionJob | null) => Promise<EnrichedDraft>;
  download: (url: string) => Promise<DownloadedSourceImage>;
  prepare: (downloaded: DownloadedSourceImage) => Promise<PreparedImage>;
  r2: Pick<R2ImagePublisher, "publish"> | null;
  optimizer: Parameters<typeof optimizedVersionKey>[2];
  drafts: Pick<NotionDraftSync, "syncOne">;
  logger: Logger;
  now?: () => Date;
  concurrency?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  batchLimit?: number;
  publicBaseUrl?: string;
}

export interface RunIngestionInput {
  bookmarks: BookmarkInput[];
  dryRun: boolean;
  runId: string;
  startedAt?: Date;
}

const RESUMABLE_STAGES = new Set(["uploading", "image_verified", "validating", "enriching"]);

function isRetryableError(error: unknown): boolean {
  if (error instanceof ImageDownloadError) return error.retryable;
  if (error instanceof R2ConflictError) return false;
  if (error instanceof R2UploadError) return error.retryable;
  if (error instanceof R2VerificationError || error instanceof R2UploadUnknownError) return true;
  if (error instanceof R2InconclusiveError) return true;
  if (error instanceof NotionAuthError) return false;
  if (error instanceof NotionRateLimitError || error instanceof NotionNetworkError) return true;
  if (error instanceof NotionApiError) return error.status === 429 || error.status >= 500;
  return true;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function candidateFromValidated(validated: ValidatedBookmark): IngestionCandidate {
  return {
    posterId: validated.posterId,
    raindropId: validated.draft.raindropId,
    sourceKey: validated.sourceKey,
    raindropUpdatedAt: validated.raindropUpdatedAt,
    sourceImageUrl: validated.draft.imageUrl,
    draft: validated.draft,
  };
}

export function candidateFromJob(job: IngestionJob): IngestionCandidate | null {
  if (!isPosterId(job.posterId) || !job.sourceImageUrl) return null;
  if (!job.title || !Number.isFinite(job.year) || !job.mediaType) return null;
  return {
    posterId: job.posterId,
    raindropId: job.raindropId,
    sourceKey: job.sourceKey,
    raindropUpdatedAt: job.raindropUpdatedAt,
    sourceImageUrl: job.sourceImageUrl,
    draft: {
      posterId: job.posterId,
      raindropId: job.raindropId,
      title: job.title,
      year: job.year,
      mediaType: job.mediaType,
      artists: job.artists,
      imageUrl: job.sourceImageUrl,
      sourceUrl: job.sourceUrl,
    },
  };
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(Math.max(concurrency, 1), items.length) }, () =>
    run(),
  );
  await Promise.all(workers);
  return results;
}

export async function runIngestion(
  deps: IngestionRunnerDeps,
  input: RunIngestionInput,
): Promise<IngestionSummary> {
  const startedAt = input.startedAt ?? (deps.now ?? (() => new Date()))();
  const now = deps.now ?? (() => new Date());
  const concurrency = deps.concurrency ?? 2;
  const maxAttempts = deps.maxAttempts ?? 3;
  const retryDelayMs = deps.retryDelayMs ?? 60_000;
  const batchLimit = deps.batchLimit ?? 25;
  const logger = deps.logger;

  const counts: IngestionCounts = {
    bookmarksDiscovered: input.bookmarks.length,
    alreadyProcessed: 0,
    newCandidates: 0,
    tmdbMatches: 0,
    needsReview: 0,
    uploadsVerified: 0,
    notionDraftsCreated: 0,
    notionDraftsUpdated: 0,
    failed: 0,
  };
  const failures: StageFailure[] = [];

  const { unique } = dedupeBookmarks(input.bookmarks);
  const existingJobs = await deps.jobStore.list();
  const jobsById = new Map(existingJobs.map((job) => [job.posterId, job]));
  const seenPosterIds = new Set<string>();
  const candidates: IngestionCandidate[] = [];

  for (const bookmark of unique) {
    const validated = validateBookmark(bookmark);

    if (!validated.ok) {
      counts.needsReview += 1;
      failures.push({
        posterId: null,
        raindropId: validated.raindropId,
        stage: "validating",
        reason: validated.reason,
        retryable: false,
      });
      logger.warn("ingest.validation_failed", {
        raindropId: validated.raindropId,
        reason: validated.reason,
      });
      continue;
    }

    const candidate = candidateFromValidated(validated.value);
    seenPosterIds.add(candidate.posterId);
    const job = jobsById.get(candidate.posterId) ?? null;

    if (job) {
      const sameRevision = isSameSourceRevision(job, {
        lastUpdate: candidate.raindropUpdatedAt ?? undefined,
      });

      if (sameRevision && TERMINAL_INGESTION_STAGES.includes(job.stage)) {
        counts.alreadyProcessed += 1;
        continue;
      }
      if (sameRevision && job.stage === "needs_review" && !job.reviewDecision) {
        counts.alreadyProcessed += 1;
        counts.needsReview += 1;
        continue;
      }
      if (sameRevision && job.stage === "failed" && !isRetryableNow(job, now())) {
        counts.alreadyProcessed += 1;
        continue;
      }
    }

    candidates.push(candidate);
  }

  // Resume durable work even when the bookmark has fallen outside the fetched
  // page window or the source list is temporarily unavailable.
  for (const job of existingJobs) {
    if (seenPosterIds.has(job.posterId)) continue;
    const resumable =
      (job.stage === "failed" && isRetryableNow(job, now())) ||
      RESUMABLE_STAGES.has(job.stage) ||
      (job.stage === "needs_review" && Boolean(job.reviewDecision));
    if (!resumable) continue;
    const candidate = candidateFromJob(job);
    if (candidate) candidates.push(candidate);
  }

  const selected = candidates.slice(0, batchLimit);
  counts.newCandidates = selected.length;

  logger.info("ingest.candidates_selected", {
    discovered: counts.bookmarksDiscovered,
    alreadyProcessed: counts.alreadyProcessed,
    candidates: selected.length,
    batchLimit,
  });

  const processCandidate = async (candidate: IngestionCandidate): Promise<void> => {
    let job =
      jobsById.get(candidate.posterId) ??
      createJob({
        posterId: candidate.posterId,
        raindropId: candidate.raindropId,
        sourceKey: candidate.sourceKey,
        raindropUpdatedAt: candidate.raindropUpdatedAt,
        title: candidate.draft.title,
        year: candidate.draft.year,
        mediaType: candidate.draft.mediaType,
        artists: candidate.draft.artists,
        sourceUrl: candidate.draft.sourceUrl,
        sourceImageUrl: candidate.sourceImageUrl,
        now: now(),
      });

    const previousJob = job;
    const save = async (next: IngestionJob) => {
      job = next;
      if (!input.dryRun) await deps.jobStore.save(next);
    };

    try {
      const sourceChanged =
        previousJob.raindropUpdatedAt !== null &&
        candidate.raindropUpdatedAt !== null &&
        previousJob.raindropUpdatedAt !== candidate.raindropUpdatedAt;

      await save(
        advanceJob(
          job,
          "validating",
          {
            title: candidate.draft.title,
            year: candidate.draft.year,
            mediaType: candidate.draft.mediaType,
            artists: candidate.draft.artists,
            sourceUrl: candidate.draft.sourceUrl,
            sourceImageUrl: candidate.sourceImageUrl,
            raindropUpdatedAt: candidate.raindropUpdatedAt,
            lastError: null,
            // A changed source revision invalidates the previous bytes, so the
            // image stage must re-download and re-derive its versioned keys.
            ...(sourceChanged ? { images: null, sourceImageSha256: null } : {}),
          },
          now(),
        ),
      );

      let enriched: EnrichedDraft = { ...candidate.draft, status: "parsed" };
      const decision = reviewDecisionFromJob(job);
      const sameEnrichmentInput =
        previousJob.title === candidate.draft.title &&
        previousJob.year === candidate.draft.year &&
        previousJob.mediaType === candidate.draft.mediaType;

      if (job.tmdbId && job.imdbId && job.slug && sameEnrichmentInput) {
        enriched = {
          ...candidate.draft,
          status: "enriched",
          tmdb: {
            id: job.tmdbId,
            imdbId: job.imdbId,
            genres: job.genres,
            slug: job.slug,
            libraryName:
              job.libraryName ?? (candidate.draft.mediaType === "show" ? "TV Shows" : "Movies"),
          },
        };
      } else {
        await save(advanceJob(job, "enriching", {}, now()));
        enriched = decision
          ? await deps.enrich(candidate.draft, {
              ...job,
              tmdbId: decision.tmdbId,
            })
          : await deps.enrich(candidate.draft, job);
      }

      if (enriched.status === "needs_review") {
        await save(
          advanceJob(
            job,
            "needs_review",
            {
              lastError: enriched.reason ?? "Needs review",
              retryable: false,
              nextAttemptAt: null,
            },
            now(),
          ),
        );
        counts.needsReview += 1;
        return;
      }

      if (enriched.status === "failed" || !enriched.tmdb) {
        throw new Error(enriched.reason ?? "TMDB enrichment failed");
      }

      counts.tmdbMatches += 1;
      job = advanceJob(
        job,
        "enriching",
        {
          tmdbId: enriched.tmdb.id,
          imdbId: enriched.tmdb.imdbId,
          slug: enriched.tmdb.slug,
          genres: enriched.tmdb.genres,
          libraryName: enriched.tmdb.libraryName,
          lastError: null,
        },
        now(),
      );
      await save(job);

      let images = job.images;

      if (!images) {
        const downloaded = await deps.download(candidate.sourceImageUrl);
        const prepared = await deps.prepare(downloaded);
        const sourceSha256 = prepared.original.sha256;

        if (input.dryRun) {
          const planned = planR2Keys(candidate.posterId, prepared, deps.optimizer, {
            publicBaseUrl: deps.publicBaseUrl,
          });
          logger.info("ingest.dry_run_upload_planned", {
            posterId: candidate.posterId,
            sourceSha256,
            originalKey: planned.originalKey,
            optimizedKey: optimizedVersionKey(
              candidate.posterId,
              sourceSha256,
              deps.optimizer,
              800,
              80,
            ),
          });
          await save(
            advanceJob(
              job,
              "enriching",
              {
                sourceImageSha256: sourceSha256,
                lastError: null,
              },
              now(),
            ),
          );
          return;
        }

        await save(advanceJob(job, "uploading", { sourceImageSha256: sourceSha256 }, now()));
        if (!deps.r2) throw new Error("R2 publisher is required for apply runs");
        images = await deps.r2.publish(candidate.posterId, prepared, candidate.raindropId);
        counts.uploadsVerified += 1;
        await save(
          advanceJob(job, "image_verified", { images, sourceImageSha256: sourceSha256 }, now()),
        );
      }

      if (input.dryRun) {
        logger.info("ingest.dry_run_notion_planned", {
          posterId: candidate.posterId,
          imageUrl: images.original.url,
        });
        return;
      }

      const notionDraft: EnrichedDraft = {
        ...enriched,
        posterId: candidate.posterId,
        imageUrl: images.original.url,
      };
      const outcome: SyncOutcome = await deps.drafts.syncOne(notionDraft);
      if (outcome.kind === "failed") {
        throw new Error(outcome.error);
      }
      if (outcome.kind === "skipped") {
        throw new Error(outcome.reason);
      }

      if (outcome.kind === "created") counts.notionDraftsCreated += 1;
      if (outcome.kind === "updated" && outcome.changed) counts.notionDraftsUpdated += 1;

      await save(
        advanceJob(
          job,
          "notion_draft_created",
          {
            notionPageId: outcome.pageId,
            notionStatus: "Draft",
            lastError: null,
            retryable: false,
            nextAttemptAt: null,
          },
          now(),
        ),
      );
    } catch (error) {
      counts.failed += 1;
      const retryable = isRetryableError(error);
      const failed = failJob(
        job,
        { message: messageOf(error), retryable },
        { now: now(), maxAttempts, retryDelayMs },
      );
      await save(failed).catch(() => undefined);
      failures.push({
        posterId: candidate.posterId,
        raindropId: candidate.raindropId,
        stage: failed.stage,
        reason: messageOf(error),
        retryable: failed.retryable,
      });
      logger.error("ingest.stage_failed", {
        posterId: candidate.posterId,
        retryable: failed.retryable,
        reason: messageOf(error),
      });
    }
  };

  await mapWithConcurrency(selected, concurrency, processCandidate);

  const finishedAt = (deps.now ?? (() => new Date()))();
  const summary: IngestionSummary = {
    mode: "ingest",
    schemaVersion: INGESTION_SCHEMA_VERSION,
    runId: input.runId,
    dryRun: input.dryRun,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    counts,
    failures,
  };

  logger.info("ingest.summary", { counts });
  return summary;
}
