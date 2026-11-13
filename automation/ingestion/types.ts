/**
 * Domain types for the automated Raindrop ingestion and Notion publishing
 * pipeline. Kept free of SDK imports so every stage is unit-testable.
 */

import type { R2ImageReference } from "../../src/lib/r2-image-reference";

export const INGESTION_SCHEMA_VERSION = 1;

export const INGESTION_STAGES = [
  "discovered",
  "validating",
  "enriching",
  "needs_review",
  "uploading",
  "image_verified",
  "notion_draft_created",
  "awaiting_publication",
  "published",
  "firestore_synced",
  "failed",
] as const;

export type IngestionStage = (typeof INGESTION_STAGES)[number];

/** Stages that need no further ingestion work. */
export const TERMINAL_INGESTION_STAGES: readonly IngestionStage[] = [
  "notion_draft_created",
  "awaiting_publication",
  "published",
  "firestore_synced",
];

export const FAILURE_STAGE: IngestionStage = "failed";

export type IngestionImageReferences = R2ImageReference & {
  sourceSha256: string;
};

export interface IngestionJob {
  schemaVersion: typeof INGESTION_SCHEMA_VERSION;
  /** Stable catalogue identity. Never derived from title or image position. */
  posterId: string;
  raindropId: string;
  sourceKey: string;
  stage: IngestionStage;
  attempts: number;
  lastError: string | null;
  retryable: boolean;
  nextAttemptAt: string | null;
  raindropUpdatedAt: string | null;
  title: string;
  year: number;
  mediaType: "movie" | "show";
  artists: string[];
  sourceUrl: string;
  /** Never logged. Persisted so a retry does not need the bookmark list. */
  sourceImageUrl: string | null;
  sourceImageSha256: string | null;
  tmdbId: number | null;
  imdbId: string | null;
  slug: string | null;
  genres: string[];
  libraryName: "Movies" | "TV Shows" | null;
  images: IngestionImageReferences | null;
  notionPageId: string | null;
  notionStatus: string | null;
  /**
   * Persisted human decision for an ambiguous TMDB match. When present, the
   * pipeline reuses that TMDB identity instead of re-ranking candidates.
   */
  reviewDecision?: {
    posterId: string;
    raindropId: string;
    tmdbId: number;
    decidedAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface StageFailure {
  posterId: string | null;
  raindropId: string | null;
  stage: IngestionStage;
  reason: string;
  retryable: boolean;
}

export interface IngestionCounts {
  bookmarksDiscovered: number;
  alreadyProcessed: number;
  newCandidates: number;
  tmdbMatches: number;
  needsReview: number;
  uploadsVerified: number;
  notionDraftsCreated: number;
  notionDraftsUpdated: number;
  failed: number;
}

export interface IngestionSummary {
  mode: "ingest";
  schemaVersion: typeof INGESTION_SCHEMA_VERSION;
  runId: string;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  counts: IngestionCounts;
  failures: StageFailure[];
}

export interface PublishCounts {
  publishedRecordsDiscovered: number;
  firestoreRecordsCreated: number;
  firestoreRecordsUpdated: number;
  alreadySynchronized: number;
  needsReview: number;
  failed: number;
}

export interface PublishSummary {
  mode: "publish";
  schemaVersion: typeof INGESTION_SCHEMA_VERSION;
  runId: string;
  dryRun: boolean;
  /** `memory` means existing Firestore state was not read for this run. */
  stateSource?: "firestore" | "memory";
  startedAt: string;
  finishedAt: string;
  counts: PublishCounts;
  failures: StageFailure[];
}

export type ExecutionSummary = IngestionSummary | PublishSummary;

export type RunRecord = ExecutionSummary & {
  jobCollection: string;
};
