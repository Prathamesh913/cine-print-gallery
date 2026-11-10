/**
 * Durable pipeline state.
 *
 * One document per poster identity (`automationIngestionJobs/{posterId}`)
 * records the last completed stage, attempt count and verified image
 * references. This is the checkpoint that makes retries and resumptions
 * idempotent without introducing a new persistence system.
 */

import type { Logger } from "./logger";
import {
  FAILURE_STAGE,
  INGESTION_SCHEMA_VERSION,
  INGESTION_STAGES,
  type IngestionJob,
  type IngestionStage,
  type RunRecord,
} from "./types";
import { validateR2ImageReference } from "../../src/lib/r2-image-reference";

export const DEFAULT_JOB_COLLECTION = "automationIngestionJobs";
export const DEFAULT_RUN_COLLECTION = "automationIngestionRuns";
export const MAX_JOB_SCAN = 1000;

export interface JobStore {
  get(posterId: string): Promise<IngestionJob | null>;
  save(job: IngestionJob): Promise<void>;
  list(): Promise<IngestionJob[]>;
}

export interface RunStore {
  save(record: RunRecord): Promise<void>;
}

export class InMemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, IngestionJob>();
  writes = 0;

  constructor(seed: IngestionJob[] = []) {
    for (const job of seed) this.jobs.set(job.posterId, job);
  }

  async get(posterId: string): Promise<IngestionJob | null> {
    return this.jobs.get(posterId) ?? null;
  }

  async save(job: IngestionJob): Promise<void> {
    this.writes += 1;
    this.jobs.set(job.posterId, job);
  }

  async list(): Promise<IngestionJob[]> {
    return [...this.jobs.values()];
  }
}

export class InMemoryRunStore implements RunStore {
  readonly runs: RunRecord[] = [];

  async save(record: RunRecord): Promise<void> {
    this.runs.push(record);
  }
}

export class NoopRunStore implements RunStore {
  async save(): Promise<void> {
    // Dry runs never persist a run record.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStage(value: unknown): value is IngestionStage {
  return typeof value === "string" && (INGESTION_STAGES as readonly string[]).includes(value);
}

function isIsoOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

/** Validates untrusted Firestore data before it enters the pipeline. */
export function parseIngestionJob(raw: unknown): IngestionJob | null {
  if (!isRecord(raw)) return null;
  if (raw.schemaVersion !== INGESTION_SCHEMA_VERSION) return null;
  if (typeof raw.posterId !== "string" || raw.posterId.trim() === "") return null;
  if (typeof raw.raindropId !== "string" || raw.raindropId.trim() === "") return null;
  if (typeof raw.sourceKey !== "string" || raw.sourceKey.trim() === "") return null;
  if (!isStage(raw.stage)) return null;
  if (!Number.isInteger(raw.attempts) || (raw.attempts as number) < 0) return null;
  if (typeof raw.title !== "string") return null;
  if (typeof raw.year !== "number") return null;
  if (raw.mediaType !== "movie" && raw.mediaType !== "show") return null;
  if (!Array.isArray(raw.artists) || raw.artists.some((artist) => typeof artist !== "string")) {
    return null;
  }
  if (typeof raw.sourceUrl !== "string") return null;
  if (!isIsoOrNull(raw.raindropUpdatedAt)) return null;
  if (!isIsoOrNull(raw.createdAt) || typeof raw.updatedAt !== "string") return null;

  if (raw.images !== null) {
    const validated = validateR2ImageReference(raw.images, raw.posterId);
    if (!validated.ok) return null;
  }

  const optionalString = (value: unknown): string | null =>
    typeof value === "string" && value.trim() !== "" ? value : null;

  return {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    posterId: raw.posterId,
    raindropId: raw.raindropId,
    sourceKey: raw.sourceKey,
    stage: raw.stage,
    attempts: raw.attempts as number,
    lastError: optionalString(raw.lastError),
    retryable: raw.retryable === true,
    nextAttemptAt: isIsoOrNull(raw.nextAttemptAt) ? (raw.nextAttemptAt as string | null) : null,
    raindropUpdatedAt: isIsoOrNull(raw.raindropUpdatedAt)
      ? (raw.raindropUpdatedAt as string | null)
      : null,
    title: raw.title,
    year: raw.year as number,
    mediaType: raw.mediaType,
    artists: raw.artists as string[],
    sourceUrl: raw.sourceUrl,
    sourceImageUrl: optionalString(raw.sourceImageUrl),
    sourceImageSha256: optionalString(raw.sourceImageSha256),
    tmdbId: typeof raw.tmdbId === "number" ? raw.tmdbId : null,
    imdbId: optionalString(raw.imdbId),
    slug: optionalString(raw.slug),
    genres: Array.isArray(raw.genres)
      ? raw.genres.filter((genre): genre is string => typeof genre === "string")
      : [],
    libraryName:
      raw.libraryName === "Movies" || raw.libraryName === "TV Shows" ? raw.libraryName : null,
    images: raw.images as IngestionJob["images"],
    notionPageId: optionalString(raw.notionPageId),
    notionStatus: optionalString(raw.notionStatus),
    reviewDecision: isRecord(raw.reviewDecision)
      ? (raw.reviewDecision as IngestionJob["reviewDecision"])
      : null,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt,
  };
}

export function createJob(input: {
  posterId: string;
  raindropId: string;
  sourceKey: string;
  raindropUpdatedAt: string | null;
  title: string;
  year: number;
  mediaType: "movie" | "show";
  artists: string[];
  sourceUrl: string;
  sourceImageUrl: string | null;
  now: Date;
}): IngestionJob {
  const timestamp = input.now.toISOString();
  return {
    schemaVersion: INGESTION_SCHEMA_VERSION,
    posterId: input.posterId,
    raindropId: input.raindropId,
    sourceKey: input.sourceKey,
    stage: "discovered",
    attempts: 0,
    lastError: null,
    retryable: true,
    nextAttemptAt: null,
    raindropUpdatedAt: input.raindropUpdatedAt,
    title: input.title,
    year: input.year,
    mediaType: input.mediaType,
    artists: input.artists,
    sourceUrl: input.sourceUrl,
    sourceImageUrl: input.sourceImageUrl,
    sourceImageSha256: null,
    tmdbId: null,
    imdbId: null,
    slug: null,
    genres: [],
    libraryName: null,
    images: null,
    notionPageId: null,
    notionStatus: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function advanceJob(
  job: IngestionJob,
  stage: IngestionStage,
  patch: Partial<IngestionJob> = {},
  now: Date = new Date(),
): IngestionJob {
  return {
    ...job,
    ...patch,
    stage,
    updatedAt: now.toISOString(),
  };
}

export function failJob(
  job: IngestionJob,
  error: { message: string; retryable: boolean },
  options: { now: Date; maxAttempts: number; retryDelayMs: number },
): IngestionJob {
  const attempts = job.attempts + 1;
  const exhausted = attempts >= options.maxAttempts || !error.retryable;
  return {
    ...job,
    stage: FAILURE_STAGE,
    attempts,
    lastError: error.message,
    retryable: !exhausted,
    nextAttemptAt: exhausted
      ? null
      : new Date(options.now.getTime() + options.retryDelayMs).toISOString(),
    updatedAt: options.now.toISOString(),
  };
}

export function isRetryableNow(job: IngestionJob, now: Date): boolean {
  if (job.stage !== FAILURE_STAGE) return false;
  if (!job.retryable) return false;
  if (!job.nextAttemptAt) return true;
  const next = Date.parse(job.nextAttemptAt);
  return !Number.isFinite(next) || next <= now.getTime();
}

export interface FirestoreLike {
  collection(name: string): {
    doc(id: string): {
      get(): Promise<{ exists: boolean; data(): Record<string, unknown> | undefined }>;
      set(data: Record<string, unknown>, options?: { merge?: boolean }): Promise<unknown>;
      update?(data: Record<string, unknown>): Promise<unknown>;
    };
    limit(count: number): {
      get(): Promise<{
        docs: Array<{ id: string; data(): Record<string, unknown> | undefined }>;
      }>;
    };
    where?: (
      field: string,
      operator: string,
      value: unknown,
    ) => {
      limit(count: number): {
        get(): Promise<{
          docs: Array<{ id: string; data(): Record<string, unknown> | undefined }>;
        }>;
      };
    };
  };
}

export class FirestoreJobStore implements JobStore {
  constructor(
    private readonly db: FirestoreLike,
    private readonly collectionName = DEFAULT_JOB_COLLECTION,
    private readonly logger?: Logger,
  ) {}

  async get(posterId: string): Promise<IngestionJob | null> {
    const snapshot = await this.db.collection(this.collectionName).doc(posterId).get();
    if (!snapshot.exists) return null;
    const job = parseIngestionJob(snapshot.data());
    if (!job) {
      this.logger?.warn("state.invalid_job_document", { posterId });
    }
    return job;
  }

  async save(job: IngestionJob): Promise<void> {
    await this.db
      .collection(this.collectionName)
      .doc(job.posterId)
      .set({ ...job });
  }

  async list(): Promise<IngestionJob[]> {
    const snapshot = await this.db.collection(this.collectionName).limit(MAX_JOB_SCAN).get();
    const jobs: IngestionJob[] = [];
    for (const doc of snapshot.docs) {
      const job = parseIngestionJob(doc.data());
      if (job) jobs.push(job);
      else this.logger?.warn("state.invalid_job_document", { posterId: doc.id });
    }
    return jobs;
  }
}

export class FirestoreRunStore implements RunStore {
  constructor(
    private readonly db: FirestoreLike,
    private readonly collectionName = DEFAULT_RUN_COLLECTION,
  ) {}

  async save(record: RunRecord): Promise<void> {
    await this.db
      .collection(this.collectionName)
      .doc(record.runId)
      .set({ ...record });
  }
}
